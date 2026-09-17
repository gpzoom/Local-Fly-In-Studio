// src/export/frameCompositor.ts
import type { EvaluatedFrame, EvaluatedLayer } from '../models/timeline';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeContainRect(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): Rect {
  const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight);
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return { x: (dstWidth - width) / 2, y: (dstHeight - height) / 2, width, height };
}

function computeCoverRect(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): Rect {
  const scale = Math.max(dstWidth / srcWidth, dstHeight / srcHeight);
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return { x: (dstWidth - width) / 2, y: (dstHeight - height) / 2, width, height };
}

function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: EvaluatedLayer,
  element: HTMLImageElement,
  outputWidth: number,
  outputHeight: number,
): void {
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  const centerXPx = (layer.transform?.centerX ?? 0.5) * outputWidth;
  const centerYPx = (layer.transform?.centerY ?? 0.5) * outputHeight;
  ctx.translate(centerXPx, centerYPx);
  ctx.rotate(((layer.transform?.rotation ?? 0) * Math.PI) / 180);
  const scale = layer.transform?.scale ?? 1;
  ctx.scale(scale, scale);
  const base = computeContainRect(element.naturalWidth, element.naturalHeight, outputWidth, outputHeight);
  ctx.drawImage(element, -base.width / 2, -base.height / 2, base.width, base.height);
  ctx.restore();
}

function drawVideoLayer(
  ctx: CanvasRenderingContext2D,
  layer: EvaluatedLayer,
  element: HTMLVideoElement,
  outputWidth: number,
  outputHeight: number,
): void {
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  const rect =
    layer.fitMode === 'cover'
      ? computeCoverRect(element.videoWidth, element.videoHeight, outputWidth, outputHeight)
      : computeContainRect(element.videoWidth, element.videoHeight, outputWidth, outputHeight);
  ctx.drawImage(element, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

export function compositeFrame(
  ctx: CanvasRenderingContext2D,
  frame: EvaluatedFrame,
  cesiumCanvas: HTMLCanvasElement,
  mediaElements: ReadonlyMap<string, HTMLImageElement | HTMLVideoElement>,
  outputWidth: number,
  outputHeight: number,
): void {
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  for (const layer of frame.layers) {
    if (layer.kind === 'map-hold' || layer.kind === 'map-travel') {
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      // LOAD-BEARING ORDERING ASSUMPTION. `cesiumCanvas` is a WebGL canvas created WITHOUT
      // `contextOptions.webgl.preserveDrawingBuffer: true` (see createCesiumViewer in
      // src/cesium/viewer.ts). Its drawing buffer is therefore only guaranteed to hold valid
      // pixels until the browser composites the frame — read it at the wrong moment and this
      // drawImage returns a cleared (black/transparent) buffer.
      //
      // It works today purely because of rAF ordering: Cesium registers its render callback when
      // the viewer is constructed (long before an export starts) and re-registers it at the END of
      // its own callback body, so within every animation frame Cesium renders FIRST and the export
      // runner's `tick` (registered later, and likewise re-registered at the end of its own body)
      // runs SECOND, while the just-rendered buffer is still intact.
      //
      // Verified end-to-end by pixel-sampling a real exported .mp4 (map frames at 2.5s/4s/6s/8s
      // were 100% non-black, mean RGB ~[91,120,93], 300-550 distinct colors — real imagery, not a
      // cleared buffer). Any change to that ordering — Cesium's `requestRenderMode`, a different
      // rAF registration order, moving compositing to an OffscreenCanvas/worker, or rendering the
      // scene on demand — will silently break this and produce a black map. Such a change MUST be
      // paired with `contextOptions: { webgl: { preserveDrawingBuffer: true } }` on the Viewer (or
      // an equivalent explicit "scene has rendered" guarantee before this read).
      ctx.drawImage(cesiumCanvas, 0, 0, cesiumCanvas.width, cesiumCanvas.height, 0, 0, outputWidth, outputHeight);
      ctx.restore();
      continue;
    }

    if (layer.kind === 'black') {
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, outputWidth, outputHeight);
      ctx.restore();
      continue;
    }

    const element = mediaElements.get(layer.sourceId);
    if (!element) continue;

    if (layer.kind === 'video') {
      drawVideoLayer(ctx, layer, element as HTMLVideoElement, outputWidth, outputHeight);
      continue;
    }

    drawImageLayer(ctx, layer, element as HTMLImageElement, outputWidth, outputHeight);
  }
}
