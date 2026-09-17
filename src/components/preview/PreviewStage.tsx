import { useEffect, useMemo, useRef, useState } from 'react';
import './PreviewStage.css';
import { compileProjectTimeline } from '../../timeline/compiler';
import { PlaybackController } from '../../timeline/playbackController';
import { createCesiumViewer, type CesiumViewerHandle } from '../../cesium/viewer';
import { applyCameraState } from '../../cesium/applyCameraState';
import { createMediaAssetStore } from '../../media/createMediaAssetStore';
import type { MediaAssetStore } from '../../media/MediaAssetStore';
import { PlaybackControls } from './PlaybackControls';
import type { EvaluatedFrame, EvaluatedLayer } from '../../models/timeline';
import type { Project } from '../../models/project';
import type { VisualTransform } from '../../models/scenes';

interface PreviewStageProps {
  project: Project;
}

function transformToCss(transform?: VisualTransform): string {
  if (!transform) return '';
  const rotation = transform.rotation ?? 0;
  return `translate(-50%, -50%) translate(${(transform.centerX - 0.5) * 100}%, ${(transform.centerY - 0.5) * 100}%) scale(${transform.scale}) rotate(${rotation}deg)`;
}

function overlayLayer(layers: EvaluatedLayer[]): EvaluatedLayer | undefined {
  return layers.find((layer) => layer.kind !== 'map-hold' && layer.kind !== 'map-travel');
}

export function PreviewStage({ project }: PreviewStageProps) {
  const timeline = useMemo(() => compileProjectTimeline(project), [project]);
  const cesiumContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerHandleRef = useRef<CesiumViewerHandle | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStoreRef = useRef<MediaAssetStore | null>(null);

  const [frame, setFrame] = useState<EvaluatedFrame | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!cesiumContainerRef.current) return;
    const handle = createCesiumViewer(cesiumContainerRef.current);
    viewerHandleRef.current = handle;
    return () => handle.destroy();
  }, []);

  useEffect(() => {
    const controller = new PlaybackController(timeline);
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe((nextFrame, timeMs) => {
      setFrame(nextFrame);
      setCurrentTimeMs(timeMs);
      setIsPlaying(controller.isPlaying);
    });
    controller.seek(0);
    return () => {
      unsubscribe();
      controller.destroy();
    };
  }, [timeline]);

  useEffect(() => {
    if (!frame || !viewerHandleRef.current) return;
    const mapLayer = frame.layers.find((layer) => layer.kind === 'map-hold' || layer.kind === 'map-travel');
    if (mapLayer?.camera) {
      applyCameraState(viewerHandleRef.current.viewer, mapLayer.camera);
    }
  }, [frame]);

  const overlay = frame ? overlayLayer(frame.layers) : undefined;
  const overlaySourceId = overlay && overlay.kind !== 'black' ? overlay.sourceId : undefined;

  // Resolves the active overlay layer's MediaAsset into a displayable blob: URL via
  // the Phase 1 MediaAssetStore. Re-runs only when the underlying asset changes (not
  // on every animation frame), and always revokes the previous object URL.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      if (!overlaySourceId) {
        if (!cancelled) setOverlayUrl(null);
        return;
      }
      if (!mediaStoreRef.current) {
        mediaStoreRef.current = await createMediaAssetStore();
      }
      const blob = await mediaStoreRef.current.get(overlaySourceId);
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setOverlayUrl(objectUrl);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [overlaySourceId]);

  useEffect(() => {
    if (overlay?.kind === 'video' && videoRef.current) {
      videoRef.current.currentTime = overlay.localTimeMs / 1000;
    }
  }, [overlay]);

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
      {overlay?.kind === 'black' && <div className="preview-black-overlay" style={{ opacity: overlay.opacity }} />}
      {(overlay?.kind === 'storefront' || overlay?.kind === 'photo') && overlayUrl && (
        <img
          className="preview-overlay-image"
          src={overlayUrl}
          alt=""
          style={{ opacity: overlay.opacity, transform: transformToCss(overlay.transform) }}
        />
      )}
      {overlay?.kind === 'video' && overlayUrl && (
        <video
          ref={videoRef}
          className="preview-overlay-video"
          src={overlayUrl}
          style={{ opacity: overlay.opacity }}
          muted={!overlay.audioEnabled}
        />
      )}
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
