import { useEffect, useMemo, useRef, useState } from 'react';
import './PreviewStage.css';
import { compileProjectTimeline } from '../../timeline/compiler';
import { PlaybackController } from '../../timeline/playbackController';
import { createCesiumViewer, type CesiumViewerHandle } from '../../cesium/viewer';
import { applyCameraState } from '../../cesium/applyCameraState';
import type { Viewer } from 'cesium';
import { createMediaAssetStore } from '../../media/createMediaAssetStore';
import type { MediaAssetStore } from '../../media/MediaAssetStore';
import { PlaybackControls } from './PlaybackControls';
import type { EvaluatedFrame, EvaluatedLayer } from '../../models/timeline';
import type { Project } from '../../models/project';
import type { VisualTransform } from '../../models/scenes';

interface PreviewStageProps {
  project: Project;
  refreshEpoch?: number;
  onOverlayClick?: (normalized: { x: number; y: number }, layer: EvaluatedLayer) => void;
  onViewerReady?: (viewer: Viewer) => void;
  onControllerReady?: (controller: PlaybackController) => void;
}

/** Separator used to build a stable dependency key from a list of sourceIds. */
const SOURCE_ID_SEPARATOR = '\n';

function transformToCss(transform?: VisualTransform): string {
  // The overlay image is positioned at top/left: 50%, so the centering translate is
  // always required — even when a layer carries no transform of its own.
  if (!transform) return 'translate(-50%, -50%)';
  const rotation = transform.rotation ?? 0;
  return `translate(-50%, -50%) translate(${(transform.centerX - 0.5) * 100}%, ${(transform.centerY - 0.5) * 100}%) scale(${transform.scale}) rotate(${rotation}deg)`;
}

function isMapLayer(layer: EvaluatedLayer): boolean {
  return layer.kind === 'map-hold' || layer.kind === 'map-travel';
}

/**
 * Every non-map layer active in this frame. During a crossfade the evaluator emits
 * TWO simultaneously-active layers (outgoing fading 1 -> 0, incoming 0 -> 1); all of
 * them must be rendered, each with its own opacity and media.
 */
function overlayLayers(layers: EvaluatedLayer[]): EvaluatedLayer[] {
  return layers.filter((layer) => !isMapLayer(layer));
}

export function PreviewStage({
  project,
  refreshEpoch,
  onOverlayClick,
  onViewerReady,
  onControllerReady,
}: PreviewStageProps) {
  const timeline = useMemo(() => compileProjectTimeline(project), [project]);
  const cesiumContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerHandleRef = useRef<CesiumViewerHandle | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const mediaStoreRef = useRef<MediaAssetStore | null>(null);
  /** segmentId -> mounted <video>, so each active video layer can be seeked independently. */
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  /** sourceId -> blob: URL. Mutable source of truth; `overlayUrls` mirrors it for rendering. */
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  /**
   * Last playhead position, preserved across controller recreation. Every edit produces a
   * new `project` (and so a new `timeline`), which rebuilds the controller; without this the
   * preview would snap back to 0 on every keystroke in the inspectors.
   */
  const lastTimeMsRef = useRef(0);
  /**
   * Last-seen refreshEpoch, so the blob-loading effect below can tell a relink happened
   * (StudioView bumps this after every successful relink) even though the affected
   * sourceId itself never changes — relinking overwrites the asset's blob in place.
   */
  const lastRefreshEpochRef = useRef(refreshEpoch ?? 0);

  // Latest-callback refs so the mount-only viewer effect and the timeline-keyed
  // controller effect don't need onViewerReady/onControllerReady in their dependency
  // arrays — an unstable inline function from the caller must never recreate the
  // Cesium viewer or the PlaybackController.
  const onViewerReadyRef = useRef(onViewerReady);
  onViewerReadyRef.current = onViewerReady;
  const onControllerReadyRef = useRef(onControllerReady);
  onControllerReadyRef.current = onControllerReady;

  const [frame, setFrame] = useState<EvaluatedFrame | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [overlayUrls, setOverlayUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [mapImageryError, setMapImageryError] = useState<string | null>(null);

  useEffect(() => {
    if (!cesiumContainerRef.current) return;
    const handle = createCesiumViewer(cesiumContainerRef.current, (message) => {
      // Tile failures can repeat rapidly (e.g. offline) — only the first one is worth
      // showing; the user can dismiss it, and a fresh session gets a fresh chance.
      // The raw provider message (tile coordinates, HTTP status) is developer
      // diagnostic detail, not something a viewer should have to parse — log it,
      // show a plain-language explanation instead.
      console.warn('Map imagery tile failed to load:', message);
      setMapImageryError(
        (current) => current ?? "Close-up map imagery isn't available for this location — the fly-in will continue.",
      );
    });
    viewerHandleRef.current = handle;
    onViewerReadyRef.current?.(handle.viewer);
    return () => handle.destroy();
  }, []);

  useEffect(() => {
    const controller = new PlaybackController(timeline);
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe((nextFrame, timeMs) => {
      setFrame(nextFrame);
      setCurrentTimeMs(timeMs);
      lastTimeMsRef.current = timeMs;
      setIsPlaying(controller.isPlaying);
    });
    // `seek` clamps to [0, totalDurationMs], so this is safe even when an edit made the
    // new timeline shorter than the old playhead position.
    controller.seek(lastTimeMsRef.current);
    onControllerReadyRef.current?.(controller);
    return () => {
      unsubscribe();
      controller.destroy();
    };
  }, [timeline]);

  useEffect(() => {
    if (!frame || !viewerHandleRef.current) return;
    const mapLayer = frame.layers.find(isMapLayer);
    if (mapLayer?.camera) {
      applyCameraState(viewerHandleRef.current.viewer, mapLayer.camera);
    }
  }, [frame]);

  const activeOverlays = useMemo(() => (frame ? overlayLayers(frame.layers) : []), [frame]);
  const hasMapLayer = frame?.layers.some(isMapLayer) ?? false;

  // The set of media assets the current frame needs, as a stable string so the
  // resolution effect re-runs only at segment boundaries — not on every frame.
  const neededSourceIdKey = useMemo(() => {
    const ids = new Set<string>();
    for (const layer of activeOverlays) {
      if (layer.kind === 'black') continue;
      ids.add(layer.sourceId);
    }
    return [...ids].sort().join(SOURCE_ID_SEPARATOR);
  }, [activeOverlays]);

  const neededSourceIds = useMemo(
    () => (neededSourceIdKey === '' ? [] : neededSourceIdKey.split(SOURCE_ID_SEPARATOR)),
    [neededSourceIdKey],
  );

  // Resolves every active overlay layer's MediaAsset into a displayable blob: URL via
  // the Phase 1 MediaAssetStore, cached by sourceId. A cached URL is evicted (and
  // revoked) only once no currently-active layer needs it, so a crossfade's outgoing
  // image keeps a valid src while the incoming one is still resolving.
  useEffect(() => {
    let cancelled = false;
    const cache = urlCacheRef.current;

    const epochChanged = (refreshEpoch ?? 0) !== lastRefreshEpochRef.current;
    lastRefreshEpochRef.current = refreshEpoch ?? 0;

    if (epochChanged) {
      // A relink may have replaced the blob behind an already-cached sourceId — the id itself
      // never changes (media relinking overwrites in place), so the normal already-cached
      // check below would never notice. Clear everything and let it refetch; this only runs
      // right after an actual relink, and only ever evicts what's currently on screen.
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
      setOverlayUrls(new Map());
    }

    let evicted = false;
    for (const [sourceId, url] of [...cache]) {
      if (neededSourceIds.includes(sourceId)) continue;
      URL.revokeObjectURL(url);
      cache.delete(sourceId);
      evicted = true;
    }
    if (evicted) setOverlayUrls(new Map(cache));

    const missing = neededSourceIds.filter((sourceId) => !cache.has(sourceId));
    if (missing.length > 0) {
      void (async () => {
        if (!mediaStoreRef.current) {
          mediaStoreRef.current = await createMediaAssetStore();
        }
        const store = mediaStoreRef.current;
        for (const sourceId of missing) {
          const blob = await store.get(sourceId);
          // Guard against a stale resolution landing after the frame moved on.
          if (cancelled) return;
          if (!blob || cache.has(sourceId)) continue;
          cache.set(sourceId, URL.createObjectURL(blob));
          setOverlayUrls(new Map(cache));
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [neededSourceIds, refreshEpoch]);

  // Revoke every cached object URL when the stage goes away.
  useEffect(() => {
    const cache = urlCacheRef.current;
    return () => {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  // Seek every active video layer (there can be more than one during a crossfade).
  useEffect(() => {
    for (const layer of activeOverlays) {
      if (layer.kind !== 'video') continue;
      const element = videoElementsRef.current.get(layer.segmentId);
      if (element) {
        element.currentTime = layer.localTimeMs / 1000;
      }
    }
  }, [activeOverlays]);

  function handleTogglePlay() {
    const controller = controllerRef.current;
    if (!controller) return;
    if (controller.isPlaying) {
      controller.pause();
    } else {
      controller.play();
    }
  }

  return (
    <div className="preview-stage">
      <div ref={cesiumContainerRef} className="preview-cesium-container" />
      {/* Opaque backdrop so the globe never shows through an overlay's letterbox bars
          while no map layer is on screen. Sits above Cesium, below the overlays. */}
      {!hasMapLayer && <div className="preview-black-overlay" />}
      {/* Only shown while the globe itself is actually visible — the overlays/black
          backdrop above cover it completely during every other segment. */}
      {hasMapLayer && <p className="preview-attribution">Imagery courtesy of the U.S. Geological Survey</p>}
      {hasMapLayer && mapImageryError && (
        <p className="preview-map-error" role="alert">
          {mapImageryError}
          <button type="button" onClick={() => setMapImageryError(null)}>
            Dismiss
          </button>
        </p>
      )}
      {activeOverlays.map((layer) => {
        if (layer.kind === 'black') {
          return (
            <div key={layer.segmentId} className="preview-black-overlay" style={{ opacity: layer.opacity }} />
          );
        }

        const url = overlayUrls.get(layer.sourceId);
        if (!url) return null;

        if (layer.kind === 'video') {
          return (
            <video
              key={layer.segmentId}
              ref={(element) => {
                if (element) {
                  videoElementsRef.current.set(layer.segmentId, element);
                } else {
                  videoElementsRef.current.delete(layer.segmentId);
                }
              }}
              className="preview-overlay-video"
              src={url}
              style={{ opacity: layer.opacity, objectFit: layer.fitMode ?? 'contain' }}
              muted={!layer.audioEnabled}
            />
          );
        }

        return (
          <img
            key={layer.segmentId}
            className="preview-overlay-image"
            src={url}
            alt=""
            style={{ opacity: layer.opacity, transform: transformToCss(layer.transform) }}
            onClick={
              onOverlayClick
                ? (event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = (event.clientX - rect.left) / rect.width;
                    const y = (event.clientY - rect.top) / rect.height;
                    onOverlayClick({ x, y }, layer);
                  }
                : undefined
            }
          />
        );
      })}
      <PlaybackControls
        isPlaying={isPlaying}
        currentTimeMs={currentTimeMs}
        totalDurationMs={timeline.totalDurationMs}
        onTogglePlay={handleTogglePlay}
        onSeek={(timeMs) => controllerRef.current?.seek(timeMs)}
      />
    </div>
  );
}
