// src/export/exportRunner.ts
import type { Viewer } from 'cesium';
import type { Project } from '../models/project';
import type { MediaAssetStore } from '../media/MediaAssetStore';
import type { EvaluatedLayer } from '../models/timeline';
import { selectExportMimeType, type CodecSelection } from './codecSelection';
import { compileProjectTimeline } from '../timeline/compiler';
import { evaluateProjectTimeline } from '../timeline/evaluator';
import { applyCameraState } from '../cesium/applyCameraState';
import { compositeFrame } from './frameCompositor';
import { createExportAudioGraph, type ExportAudioGraph } from './audioGraph';
import { filterProjectForVariant, type ExportVariant } from './exportVariants';

export interface ExportOptions {
  project: Project;
  viewer: Viewer;
  outputCanvas: HTMLCanvasElement;
  mediaAssetStore: MediaAssetStore;
  onProgress: (elapsedMs: number, totalMs: number) => void;
  signal: AbortSignal;
  variant?: ExportVariant;
  selectMimeType?: () => CodecSelection | null;
  now?: () => number;
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  AudioContextCtor?: typeof AudioContext;
}

interface ResolvedMediaElement {
  element: HTMLImageElement | HTMLVideoElement;
  objectUrl: string;
}

/** Sentinel sourceId the compiler emits for fade-to-black segments; never a real stored asset. */
const BLACK_SENTINEL_SOURCE_ID = '__black__';

function loadImageElement(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load an image asset for export.'));
    img.src = objectUrl;
  });
}

function loadVideoElement(objectUrl: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error('Failed to load a video asset for export.'));
    video.playsInline = true;
    // Muted by default (matching PreviewStage's `muted={!layer.audioEnabled}`) for two reasons:
    // an audio-disabled clip must not leak out of the user's real speakers during export, and an
    // UNmuted play() is exactly what browser autoplay policy can reject — a muted one essentially
    // cannot be. Entries whose segment has audioEnabled: true are un-muted again below only once
    // their audio has been routed into the Web Audio graph (so it lands in the recording, not the
    // speakers). See the videoEntryMap loop in runExport.
    video.muted = true;
    video.src = objectUrl;
  });
}

async function resolveMediaElements(
  segments: { sourceType: 'map' | 'image' | 'video'; sourceId: string }[],
  mediaAssetStore: MediaAssetStore,
): Promise<{ elements: Map<string, HTMLImageElement | HTMLVideoElement>; resolved: ResolvedMediaElement[] }> {
  const elements = new Map<string, HTMLImageElement | HTMLVideoElement>();
  const resolved: ResolvedMediaElement[] = [];
  const missingSourceIds: string[] = [];

  const uniqueByKind = new Map<string, 'image' | 'video'>();
  for (const segment of segments) {
    if (segment.sourceType === 'map') continue;
    // The compiler emits fade-to-black segments with the '__black__' sentinel sourceId. It is
    // never a real stored asset (frameCompositor paints those layers directly), so looking it up
    // is a guaranteed-null round-trip that would also register as a "missing asset" below.
    if (segment.sourceId === BLACK_SENTINEL_SOURCE_ID) continue;
    uniqueByKind.set(segment.sourceId, segment.sourceType);
  }

  for (const [sourceId, kind] of uniqueByKind) {
    const blob = await mediaAssetStore.get(sourceId);
    if (!blob) {
      // The spec makes the runner responsible for having every needed asset loaded before
      // recording starts; frameCompositor's `if (!element) continue;` is only a defensive
      // backstop. Silently skipping here would produce a full real-time export that ends in a
      // video with a blank region and no warning at all, so collect and report instead.
      missingSourceIds.push(sourceId);
      continue;
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
      const element = kind === 'video' ? await loadVideoElement(objectUrl) : await loadImageElement(objectUrl);
      elements.set(sourceId, element);
      resolved.push({ element, objectUrl });
    } catch (error) {
      // This asset's own object URL was never pushed to `resolved`, so revoke it directly;
      // every earlier asset in this call succeeded and IS in `resolved`, so revoke those too
      // before propagating — otherwise a partial failure here leaks every object URL created
      // by this call so far.
      URL.revokeObjectURL(objectUrl);
      for (const { objectUrl: earlierObjectUrl } of resolved) {
        URL.revokeObjectURL(earlierObjectUrl);
      }
      throw error;
    }
  }

  if (missingSourceIds.length > 0) {
    for (const { objectUrl } of resolved) {
      URL.revokeObjectURL(objectUrl);
    }
    throw new Error(
      `Could not load ${missingSourceIds.length} media asset(s) for export: ${missingSourceIds.join(', ')}`,
    );
  }

  return { elements, resolved };
}

export async function runExport(options: ExportOptions): Promise<Blob> {
  const {
    project: rawProject,
    viewer,
    outputCanvas,
    mediaAssetStore,
    onProgress,
    signal,
    variant,
    selectMimeType = selectExportMimeType,
    now = () => performance.now(),
    requestAnimationFrame: raf = (cb: FrameRequestCallback) => globalThis.requestAnimationFrame(cb),
    cancelAnimationFrame: caf = (handle: number) => globalThis.cancelAnimationFrame(handle),
    AudioContextCtor,
  } = options;

  // Every later reference to `project` in this function is deliberately the FILTERED project —
  // renaming the destructured field to `rawProject` here means nothing below needs to change.
  const project = filterProjectForVariant(rawProject, variant ?? 'complete');

  const codec = selectMimeType();
  if (!codec) {
    throw new Error('No supported video format is available in this browser.');
  }

  const timeline = compileProjectTimeline(project);
  outputCanvas.width = project.videoSettings.widthPx;
  outputCanvas.height = project.videoSettings.heightPx;
  const ctx = outputCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire a 2D drawing context for export.');
  }

  const { elements: mediaElements, resolved } = await resolveMediaElements(timeline.segments, mediaAssetStore);

  const releaseResolvedMedia = () => {
    for (const { element } of resolved) {
      if (element instanceof HTMLVideoElement) element.pause();
    }
    for (const { objectUrl } of resolved) {
      URL.revokeObjectURL(objectUrl);
    }
  };

  // Dedupe by sourceId: a video asset reused across multiple segments (e.g. the same clip
  // appearing twice in an interior tour) must only ever produce ONE audio-graph entry for its
  // element — createExportAudioGraph calls audioContext.createMediaElementSource(element) per
  // entry, and calling that twice on the same element throws InvalidStateError in real browsers.
  const videoEntryMap = new Map<string, { element: HTMLVideoElement; audioEnabled: boolean }>();
  for (const segment of timeline.segments) {
    if (segment.sourceType !== 'video') continue;
    const element = mediaElements.get(segment.sourceId);
    if (!(element instanceof HTMLVideoElement)) continue;
    const audioEnabled = segment.audioEnabled ?? false;
    const existing = videoEntryMap.get(segment.sourceId);
    if (existing) {
      if (audioEnabled) existing.audioEnabled = true;
    } else {
      videoEntryMap.set(segment.sourceId, { element, audioEnabled });
    }
  }
  const videoEntries = Array.from(videoEntryMap.values());

  // Everything from here through MediaRecorder construction can throw (a duplicate audio
  // source node, an unsupported constraint, etc.). Nothing else owns cleanup of the media
  // elements resolved above until the Promise executor below is reached, so release them
  // here on any failure instead of leaking their object URLs and audio graph.
  let audioGraph: ExportAudioGraph | null = null;
  let outputStream: MediaStream | null = null;
  let recorder: MediaRecorder;
  const stopOutputStreamTracks = () => {
    if (!outputStream) return;
    for (const track of outputStream.getTracks()) {
      track.stop();
    }
  };
  try {
    audioGraph = createExportAudioGraph(videoEntries, AudioContextCtor);

    // Mirror PreviewStage's `muted={!layer.audioEnabled}`. An audio-enabled clip is only un-muted
    // once createExportAudioGraph has actually taken ownership of its audio via
    // createMediaElementSource — from that point its output is routed into the recording's
    // destination node rather than the user's speakers. If the graph could not be built
    // (createExportAudioGraph returned null) no audio can reach the file anyway, so every element
    // stays muted: that keeps the export silent locally AND keeps play() muted, which browser
    // autoplay policy essentially cannot reject.
    if (audioGraph) {
      for (const entry of videoEntries) {
        entry.element.muted = !entry.audioEnabled;
      }
    }

    outputStream = outputCanvas.captureStream(project.videoSettings.fps);
    if (audioGraph) {
      for (const track of audioGraph.destinationStream.getAudioTracks()) {
        outputStream.addTrack(track);
      }
    }

    recorder = new MediaRecorder(outputStream, { mimeType: codec.mimeType });
  } catch (error) {
    audioGraph?.close();
    stopOutputStreamTracks();
    releaseResolvedMedia();
    throw error;
  }

  const cleanup = () => {
    releaseResolvedMedia();
    audioGraph?.close();
    // The canvas capture stream's video track keeps the canvas hooked into the capture pipeline
    // until it is explicitly stopped; audioGraph.close() only tears down the audio side.
    stopOutputStreamTracks();
  };

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  // EvaluatedLayer does not carry playbackRate (only the compiled TimelineSegment does), so
  // look segments up by id to apply each video's configured playback rate during export.
  const segmentsById = new Map(timeline.segments.map((segment) => [segment.id, segment]));

  return new Promise<Blob>((resolve, reject) => {
    let activeVideoSourceIds = new Set<string>();
    let frameHandle: number | null = null;
    let startedAt = 0;
    let settled = false;
    let abortedByUser = false;

    const finish = (blob: Blob) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(blob);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (frameHandle !== null) caf(frameHandle);
      cleanup();
      reject(error);
    };

    recorder.onstop = () => {
      if (abortedByUser) {
        fail(new Error('Export cancelled.'));
      } else {
        finish(new Blob(chunks, { type: codec.mimeType }));
      }
    };
    recorder.onerror = () => {
      fail(new Error('Recording failed unexpectedly.'));
    };

    const tick = () => {
      // recorder.onerror (or any other path) may have already settled the promise and run
      // cleanup(); without this guard the rAF loop keeps running indefinitely afterward —
      // re-triggering play() on videos cleanup() just paused, calling applyCameraState on the
      // live shared viewer, and reporting progress after the export has already ended.
      if (settled) return;

      if (signal.aborted) {
        abortedByUser = true;
        if (frameHandle !== null) caf(frameHandle);
        recorder.stop();
        return;
      }

      const elapsedMs = now() - startedAt;
      const frame = evaluateProjectTimeline(timeline, elapsedMs);

      const mapLayer = frame.layers.find(
        (layer: EvaluatedLayer) => layer.kind === 'map-hold' || layer.kind === 'map-travel',
      );
      if (mapLayer?.camera) {
        applyCameraState(viewer, mapLayer.camera);
      }

      const nextActiveVideoSourceIds = new Set(
        frame.layers.filter((layer: EvaluatedLayer) => layer.kind === 'video').map((layer: EvaluatedLayer) => layer.sourceId),
      );
      for (const layer of frame.layers) {
        if (layer.kind !== 'video') continue;
        const element = mediaElements.get(layer.sourceId);
        if (!(element instanceof HTMLVideoElement)) continue;
        if (!activeVideoSourceIds.has(layer.sourceId)) {
          const segment = segmentsById.get(layer.segmentId);
          const sourceId = layer.sourceId;
          element.currentTime = layer.localTimeMs / 1000;
          element.playbackRate = segment?.playbackRate ?? 1;
          // A discarded play() promise is dangerous here: if autoplay policy rejects the call the
          // element silently never advances, compositeFrame keeps drawing its frozen first frame,
          // and the export "succeeds" with a silently wrong result. Fail the whole export instead,
          // naming the asset. AbortError is excluded because that is what our OWN pause() (below,
          // or in cleanup) produces against a still-pending play() — not a real playback failure.
          element.play().catch((error: unknown) => {
            if (settled) return;
            if (error instanceof DOMException && error.name === 'AbortError') return;
            const detail = error instanceof Error ? error.message : String(error);
            fail(new Error(`Could not play video asset "${sourceId}" during export: ${detail}`));
          });
        }
      }
      for (const sourceId of activeVideoSourceIds) {
        if (nextActiveVideoSourceIds.has(sourceId)) continue;
        const element = mediaElements.get(sourceId);
        if (element instanceof HTMLVideoElement) element.pause();
      }
      activeVideoSourceIds = nextActiveVideoSourceIds;

      // `tick` MUST stay a plain rAF callback that re-registers itself at the end of its own body
      // (see the raf(tick) call below). That is what keeps it ordered AFTER Cesium's own render
      // callback within each animation frame, which in turn is the only reason compositeFrame's
      // `drawImage(viewer.scene.canvas, ...)` reads real map pixels instead of a cleared WebGL
      // buffer — the viewer is built without `preserveDrawingBuffer`. See the long comment at that
      // drawImage call in frameCompositor.ts before changing how this loop is scheduled.
      compositeFrame(ctx, frame, viewer.scene.canvas, mediaElements, outputCanvas.width, outputCanvas.height);
      onProgress(Math.min(elapsedMs, timeline.totalDurationMs), timeline.totalDurationMs);

      if (elapsedMs >= timeline.totalDurationMs) {
        recorder.stop();
        return;
      }
      frameHandle = raf(tick);
    };

    recorder.start();
    startedAt = now();
    frameHandle = raf(tick);
  });
}
