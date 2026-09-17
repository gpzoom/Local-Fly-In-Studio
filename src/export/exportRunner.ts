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
import { createExportAudioGraph } from './audioGraph';

export interface ExportOptions {
  project: Project;
  viewer: Viewer;
  outputCanvas: HTMLCanvasElement;
  mediaAssetStore: MediaAssetStore;
  onProgress: (elapsedMs: number, totalMs: number) => void;
  signal: AbortSignal;
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
    video.src = objectUrl;
  });
}

async function resolveMediaElements(
  segments: { sourceType: 'map' | 'image' | 'video'; sourceId: string }[],
  mediaAssetStore: MediaAssetStore,
): Promise<{ elements: Map<string, HTMLImageElement | HTMLVideoElement>; resolved: ResolvedMediaElement[] }> {
  const elements = new Map<string, HTMLImageElement | HTMLVideoElement>();
  const resolved: ResolvedMediaElement[] = [];

  const uniqueByKind = new Map<string, 'image' | 'video'>();
  for (const segment of segments) {
    if (segment.sourceType === 'map') continue;
    uniqueByKind.set(segment.sourceId, segment.sourceType);
  }

  for (const [sourceId, kind] of uniqueByKind) {
    const blob = await mediaAssetStore.get(sourceId);
    if (!blob) continue;
    const objectUrl = URL.createObjectURL(blob);
    const element = kind === 'video' ? await loadVideoElement(objectUrl) : await loadImageElement(objectUrl);
    elements.set(sourceId, element);
    resolved.push({ element, objectUrl });
  }

  return { elements, resolved };
}

export async function runExport(options: ExportOptions): Promise<Blob> {
  const {
    project,
    viewer,
    outputCanvas,
    mediaAssetStore,
    onProgress,
    signal,
    selectMimeType = selectExportMimeType,
    now = () => performance.now(),
    requestAnimationFrame: raf = (cb: FrameRequestCallback) => globalThis.requestAnimationFrame(cb),
    cancelAnimationFrame: caf = (handle: number) => globalThis.cancelAnimationFrame(handle),
    AudioContextCtor,
  } = options;

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

  const videoEntries: { element: HTMLVideoElement; audioEnabled: boolean }[] = [];
  for (const segment of timeline.segments) {
    if (segment.sourceType !== 'video') continue;
    const element = mediaElements.get(segment.sourceId);
    if (!(element instanceof HTMLVideoElement)) continue;
    videoEntries.push({ element, audioEnabled: segment.audioEnabled ?? false });
  }
  const audioGraph = createExportAudioGraph(videoEntries, AudioContextCtor);

  const cleanup = () => {
    for (const { element } of resolved) {
      if (element instanceof HTMLVideoElement) element.pause();
    }
    for (const { objectUrl } of resolved) {
      URL.revokeObjectURL(objectUrl);
    }
    audioGraph?.close();
  };

  const outputStream = outputCanvas.captureStream(project.videoSettings.fps);
  if (audioGraph) {
    for (const track of audioGraph.destinationStream.getAudioTracks()) {
      outputStream.addTrack(track);
    }
  }

  const recorder = new MediaRecorder(outputStream, { mimeType: codec.mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

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
          element.currentTime = layer.localTimeMs / 1000;
          void element.play();
        }
      }
      for (const sourceId of activeVideoSourceIds) {
        if (nextActiveVideoSourceIds.has(sourceId)) continue;
        const element = mediaElements.get(sourceId);
        if (element instanceof HTMLVideoElement) element.pause();
      }
      activeVideoSourceIds = nextActiveVideoSourceIds;

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
