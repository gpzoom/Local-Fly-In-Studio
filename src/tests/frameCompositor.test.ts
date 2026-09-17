// src/tests/frameCompositor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { compositeFrame } from '../export/frameCompositor';
import type { EvaluatedFrame, EvaluatedLayer } from '../models/timeline';

function createFakeCtx() {
  const calls: { method: string; args: unknown[] }[] = [];
  const ctx: Record<string, unknown> = { fillStyle: '', globalAlpha: 1 };
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };
  ctx.fillRect = vi.fn(record('fillRect'));
  ctx.drawImage = vi.fn(record('drawImage'));
  ctx.save = vi.fn(record('save'));
  ctx.restore = vi.fn(record('restore'));
  ctx.translate = vi.fn(record('translate'));
  ctx.rotate = vi.fn(record('rotate'));
  ctx.scale = vi.fn(record('scale'));
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function layer(overrides: Partial<EvaluatedLayer>): EvaluatedLayer {
  return {
    segmentId: 'seg-1',
    sourceType: 'image',
    sourceId: 'asset-1',
    kind: 'photo',
    localTimeMs: 0,
    opacity: 1,
    ...overrides,
  };
}

describe('compositeFrame', () => {
  it('fills the background black before drawing anything else', () => {
    const { ctx, calls } = createFakeCtx();
    const frame: EvaluatedFrame = { projectTimeMs: 0, layers: [], activeSectionId: 'section-1' };
    compositeFrame(ctx, frame, {} as HTMLCanvasElement, new Map(), 1920, 1080);
    expect(calls[0]).toEqual({ method: 'fillRect', args: [0, 0, 1920, 1080] });
  });

  it('draws a map layer stretched to the exact output dimensions', () => {
    const { ctx, calls } = createFakeCtx();
    const cesiumCanvas = { width: 800, height: 450 } as HTMLCanvasElement;
    const frame: EvaluatedFrame = {
      projectTimeMs: 0,
      layers: [layer({ kind: 'map-hold', sourceType: 'map', sourceId: 'map' })],
      activeSectionId: 'map-scene',
    };
    compositeFrame(ctx, frame, cesiumCanvas, new Map(), 1920, 1080);
    const drawImageCall = calls.find((c) => c.method === 'drawImage');
    expect(drawImageCall?.args).toEqual([cesiumCanvas, 0, 0, 800, 450, 0, 0, 1920, 1080]);
  });

  it('draws an image layer with the expected translate/scale/rotate for a known transform', () => {
    const { ctx, calls } = createFakeCtx();
    const img = { naturalWidth: 400, naturalHeight: 200 } as HTMLImageElement;
    const frame: EvaluatedFrame = {
      projectTimeMs: 0,
      layers: [
        layer({
          kind: 'storefront',
          sourceId: 'asset-1',
          transform: { centerX: 0.75, centerY: 0.25, scale: 2, rotation: 90 },
        }),
      ],
      activeSectionId: 'storefront-scene',
    };
    const mediaElements = new Map<string, HTMLImageElement | HTMLVideoElement>([['asset-1', img]]);
    compositeFrame(ctx, frame, {} as HTMLCanvasElement, mediaElements, 1000, 500);

    expect(calls.find((c) => c.method === 'translate')?.args).toEqual([750, 125]);
    expect(calls.find((c) => c.method === 'rotate')?.args[0]).toBeCloseTo(Math.PI / 2, 10);
    expect(calls.find((c) => c.method === 'scale')?.args).toEqual([2, 2]);
    // naturalWidth/Height 400x200 contained within 1000x500 -> scale min(2.5, 2.5) = 2.5 -> 1000x500 (fills exactly)
    expect(calls.find((c) => c.method === 'drawImage')?.args).toEqual([img, -500, -250, 1000, 500]);
  });

  it('uses default centered, unscaled placement when a layer has no transform', () => {
    const { ctx, calls } = createFakeCtx();
    const img = { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement;
    const frame: EvaluatedFrame = {
      projectTimeMs: 0,
      layers: [layer({ kind: 'photo', sourceId: 'asset-1', transform: undefined })],
      activeSectionId: 'interior-scene',
    };
    const mediaElements = new Map<string, HTMLImageElement | HTMLVideoElement>([['asset-1', img]]);
    compositeFrame(ctx, frame, {} as HTMLCanvasElement, mediaElements, 200, 200);
    expect(calls.find((c) => c.method === 'translate')?.args).toEqual([100, 100]);
    expect(calls.find((c) => c.method === 'rotate')?.args[0]).toBe(0);
    expect(calls.find((c) => c.method === 'scale')?.args).toEqual([1, 1]);
  });

  it('draws a video layer using cover fit-mode source/destination math', () => {
    const { ctx, calls } = createFakeCtx();
    const video = { videoWidth: 1000, videoHeight: 500 } as HTMLVideoElement;
    const frame: EvaluatedFrame = {
      projectTimeMs: 0,
      layers: [
        layer({ kind: 'video', sourceType: 'video', sourceId: 'video-1', fitMode: 'cover', transform: undefined }),
      ],
      activeSectionId: 'interior-scene',
    };
    const mediaElements = new Map<string, HTMLImageElement | HTMLVideoElement>([['video-1', video]]);
    compositeFrame(ctx, frame, {} as HTMLCanvasElement, mediaElements, 400, 400);
    // cover: scale = max(400/1000, 400/500) = 0.8 -> 800x400, centered -> x=(400-800)/2=-200, y=0
    expect(calls.find((c) => c.method === 'drawImage')?.args).toEqual([video, -200, 0, 800, 400]);
  });

  it('fills a black layer at its opacity', () => {
    const { ctx, calls } = createFakeCtx();
    const frame: EvaluatedFrame = {
      projectTimeMs: 0,
      layers: [layer({ kind: 'black', sourceId: '__black__', opacity: 0.4 })],
      activeSectionId: 'interior-scene',
    };
    compositeFrame(ctx, frame, {} as HTMLCanvasElement, new Map(), 200, 200);
    const fillRectCalls = calls.filter((c) => c.method === 'fillRect');
    expect(fillRectCalls).toHaveLength(2);
    expect(fillRectCalls[1].args).toEqual([0, 0, 200, 200]);
  });

  it('skips a layer whose sourceId has no entry in mediaElements, without throwing', () => {
    const { ctx, calls } = createFakeCtx();
    const frame: EvaluatedFrame = {
      projectTimeMs: 0,
      layers: [layer({ kind: 'photo', sourceId: 'missing-asset' })],
      activeSectionId: 'interior-scene',
    };
    expect(() => compositeFrame(ctx, frame, {} as HTMLCanvasElement, new Map(), 200, 200)).not.toThrow();
    expect(calls.some((c) => c.method === 'drawImage')).toBe(false);
  });
});
