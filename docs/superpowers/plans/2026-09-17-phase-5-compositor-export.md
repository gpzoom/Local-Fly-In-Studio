# Phase 5: Compositor + Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a project's compiled timeline into a downloadable video file via a canvas compositor, `MediaRecorder`, and an Export panel in Studio.

**Architecture:** A canvas-based frame compositor (`compositeFrame`) draws the evaluator's per-frame output (Cesium canvas + overlay images/videos + transitions) onto an offscreen `<canvas>`; `runExport` drives that compositor in real time via `requestAnimationFrame`, feeding `outputCanvas.captureStream()` (combined with a Web Audio graph for enabled interior-video audio) into a `MediaRecorder`. An `ExportPanel` component, opened from a new button in `StudioView`'s header, runs a capability/codec check up front, then shows progress and a download link.

**Tech Stack:** React 19, TypeScript, native `MediaRecorder`/`canvas.captureStream()`/Web Audio API (no new npm dependency), Vitest (`environment: 'node'`) for the pure-logic modules, Cesium (reusing the existing live viewer).

**Spec:** `docs/superpowers/specs/2026-09-17-phase-5-compositor-export-design.md`

## Global Constraints

- No new npm dependency: `MediaRecorder`, `canvas.captureStream()`, and the Web Audio API are native browser APIs.
- Codec priority order, exactly: `video/mp4;codecs=avc1` → `video/webm;codecs=vp9` → `video/webm;codecs=vp8` → `video/webm`. Never put an `.mp4` extension on WebM content.
- Export **Complete Video only** this phase — no UI for the other 3 PRD export variants.
- Audio is included this phase and must never be mandatory for export success: `createExportAudioGraph` returns `null` (not throws) on failure, and the caller falls back to video-only.
- Reuse the live, already-mounted Studio Cesium viewer for export. No second offscreen Cesium instance.
- The Export entry point lives in `StudioView`'s header and opens a panel — not a new top-level `App.tsx` view.
- fps and output resolution are read only from `project.videoSettings` (`widthPx`/`heightPx`/`fps`) — no new export-time resolution/fps chooser is introduced anywhere.
- No direct Cesium camera-control call outside `applyCameraState` anywhere in this phase's new code — the export runner's per-frame `applyCameraState(viewer, layer.camera)` call reuses the existing Phase 4a function; no new camera-control path is introduced.
- `codecSelection.ts`, `capabilities.ts`, `frameCompositor.ts`, and `audioGraph.ts` get real Vitest coverage (`environment: 'node'`, DI-optional-last-parameter pattern for every browser API, matching `applyCameraState`/`PlaybackController` precedent). `exportRunner.ts` and `ExportPanel.tsx` are **not** unit-tested (no jsdom, no real `MediaRecorder`/`AudioContext`/Cesium in this project's Vitest environment) — verified via `npx tsc -b` and a real-browser Playwright pass.
- Every file must leave `npx tsc -b` clean and every Vitest suite passing (existing suites unmodified, all new ones green).

---

### Task 1: Codec selection

**Files:**
- Create: `src/export/codecSelection.ts`
- Test: `src/tests/codecSelection.test.ts`

**Interfaces:**
- Produces: `export interface CodecSelection { mimeType: string; fileExtension: string; }` and `export function selectExportMimeType(isTypeSupported?: (mimeType: string) => boolean): CodecSelection | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/codecSelection.test.ts
import { describe, it, expect } from 'vitest';
import { selectExportMimeType } from '../export/codecSelection';

describe('selectExportMimeType', () => {
  it('picks MP4 first when supported, even when WebM variants are also supported', () => {
    const isTypeSupported = () => true;
    const result = selectExportMimeType(isTypeSupported);
    expect(result).toEqual({ mimeType: 'video/mp4;codecs=avc1', fileExtension: 'mp4' });
  });

  it('falls back to VP9 WebM when MP4 is unsupported', () => {
    const isTypeSupported = (mimeType: string) =>
      mimeType === 'video/webm;codecs=vp9' || mimeType === 'video/webm;codecs=vp8' || mimeType === 'video/webm';
    const result = selectExportMimeType(isTypeSupported);
    expect(result).toEqual({ mimeType: 'video/webm;codecs=vp9', fileExtension: 'webm' });
  });

  it('falls back to VP8 WebM when only VP8 and bare webm are supported', () => {
    const isTypeSupported = (mimeType: string) => mimeType === 'video/webm;codecs=vp8' || mimeType === 'video/webm';
    const result = selectExportMimeType(isTypeSupported);
    expect(result).toEqual({ mimeType: 'video/webm;codecs=vp8', fileExtension: 'webm' });
  });

  it('never puts an .mp4 extension on WebM content', () => {
    const isTypeSupported = (mimeType: string) => mimeType === 'video/webm';
    const result = selectExportMimeType(isTypeSupported);
    expect(result?.fileExtension).toBe('webm');
  });

  it('returns null when nothing in the priority list is supported', () => {
    const result = selectExportMimeType(() => false);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- codecSelection`
Expected: FAIL with "Failed to resolve import" or "selectExportMimeType is not a function" (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/export/codecSelection.ts
export interface CodecSelection {
  mimeType: string;
  fileExtension: string;
}

const CANDIDATES: CodecSelection[] = [
  { mimeType: 'video/mp4;codecs=avc1', fileExtension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', fileExtension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', fileExtension: 'webm' },
  { mimeType: 'video/webm', fileExtension: 'webm' },
];

export function selectExportMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): CodecSelection | null {
  const check =
    isTypeSupported ??
    (typeof MediaRecorder !== 'undefined'
      ? (mimeType: string) => MediaRecorder.isTypeSupported(mimeType)
      : () => false);

  for (const candidate of CANDIDATES) {
    if (check(candidate.mimeType)) return candidate;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- codecSelection`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/export/codecSelection.ts src/tests/codecSelection.test.ts
git commit -m "feat: add export codec selection"
```

---

### Task 2: Capability detection

**Files:**
- Create: `src/export/capabilities.ts`
- Test: `src/tests/capabilities.test.ts`

**Interfaces:**
- Consumes: `CodecSelection`, `selectExportMimeType` from Task 1 (`src/export/codecSelection.ts`).
- Produces: `export interface ExportCapabilityReport { canRecord: boolean; blockingIssues: string[]; }` and `export function checkExportCapabilities(canvas: HTMLCanvasElement, selectMimeType?: () => CodecSelection | null, createProbeContext?: () => CanvasRenderingContext2D | null): ExportCapabilityReport`.
  - `createProbeContext` is a third, trailing, optional DI parameter beyond the two the spec's signature shows — it exists purely as a testability seam (Vitest runs with `environment: 'node'`, which has no `document`), matching this codebase's established "every browser-API-touching function takes an optional last parameter defaulting to the real implementation" convention. Its default recreates the spec's "detached 2×2 canvas" behavior; omitting it (the only way `ExportPanel` will ever call this function) reproduces the spec's documented behavior exactly.
  - `canvas` is the source canvas being checked for tainted-readback risk — in production this is the live Cesium viewer's canvas (`viewer.scene.canvas`), since that's what `compositeFrame` will later `drawImage()` from. It cannot be read directly via `canvas.getContext('2d')` (Cesium's canvas holds a WebGL context, and a canvas can only ever expose one context type), so the probe copies the canvas's pixels onto a *separate* 2D canvas via `drawImage` and reads back from that.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/capabilities.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkExportCapabilities } from '../export/capabilities';
import type { CodecSelection } from '../export/codecSelection';

function fakeCanvas(overrides: Partial<{ captureStream: unknown }> = {}): HTMLCanvasElement {
  return { captureStream: vi.fn(), ...overrides } as unknown as HTMLCanvasElement;
}

function workingSelectMimeType(): () => CodecSelection | null {
  return () => ({ mimeType: 'video/webm', fileExtension: 'webm' });
}

function workingProbeContext(): () => CanvasRenderingContext2D | null {
  return () =>
    ({
      drawImage: vi.fn(),
      getImageData: vi.fn(),
    }) as unknown as CanvasRenderingContext2D;
}

describe('checkExportCapabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports canRecord: true and no blocking issues when everything is supported', () => {
    const report = checkExportCapabilities(fakeCanvas(), workingSelectMimeType(), workingProbeContext());
    expect(report).toEqual({ canRecord: true, blockingIssues: [] });
  });

  it('flags missing captureStream support', () => {
    const canvas = fakeCanvas({ captureStream: undefined });
    const report = checkExportCapabilities(canvas, workingSelectMimeType(), workingProbeContext());
    expect(report.canRecord).toBe(false);
    expect(report.blockingIssues).toContain('This browser does not support recording canvas output.');
  });

  it('flags missing MediaRecorder support', () => {
    vi.unstubAllGlobals();
    const report = checkExportCapabilities(fakeCanvas(), workingSelectMimeType(), workingProbeContext());
    expect(report.canRecord).toBe(false);
    expect(report.blockingIssues).toContain('This browser does not support MediaRecorder.');
  });

  it('flags no supported video format', () => {
    const report = checkExportCapabilities(fakeCanvas(), () => null, workingProbeContext());
    expect(report.canRecord).toBe(false);
    expect(report.blockingIssues).toContain('No supported video format is available in this browser.');
  });

  it('flags a tainted canvas via a SecurityError from getImageData', () => {
    const throwingProbeContext = () =>
      ({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => {
          throw new DOMException('tainted', 'SecurityError');
        }),
      }) as unknown as CanvasRenderingContext2D;
    const report = checkExportCapabilities(fakeCanvas(), workingSelectMimeType(), throwingProbeContext);
    expect(report.canRecord).toBe(false);
    expect(report.blockingIssues).toContain(
      'Map imagery could not be read for export (a cross-origin security restriction).',
    );
  });

  it('accumulates every failure at once rather than stopping at the first', () => {
    vi.unstubAllGlobals();
    const canvas = fakeCanvas({ captureStream: undefined });
    const report = checkExportCapabilities(canvas, () => null, workingProbeContext());
    expect(report.blockingIssues).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- capabilities`
Expected: FAIL (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/export/capabilities.ts
import { selectExportMimeType, type CodecSelection } from './codecSelection';

export interface ExportCapabilityReport {
  canRecord: boolean;
  blockingIssues: string[];
}

function defaultCreateProbeContext(): CanvasRenderingContext2D | null {
  const probe = document.createElement('canvas');
  probe.width = 2;
  probe.height = 2;
  return probe.getContext('2d');
}

export function checkExportCapabilities(
  canvas: HTMLCanvasElement,
  selectMimeType: () => CodecSelection | null = () => selectExportMimeType(),
  createProbeContext: () => CanvasRenderingContext2D | null = defaultCreateProbeContext,
): ExportCapabilityReport {
  const blockingIssues: string[] = [];

  if (typeof canvas.captureStream !== 'function') {
    blockingIssues.push('This browser does not support recording canvas output.');
  }
  if (typeof MediaRecorder === 'undefined') {
    blockingIssues.push('This browser does not support MediaRecorder.');
  }
  if (selectMimeType() === null) {
    blockingIssues.push('No supported video format is available in this browser.');
  }

  const probeCtx = createProbeContext();
  if (probeCtx) {
    try {
      probeCtx.drawImage(canvas, 0, 0, 2, 2);
      probeCtx.getImageData(0, 0, 2, 2);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        blockingIssues.push('Map imagery could not be read for export (a cross-origin security restriction).');
      } else {
        throw err;
      }
    }
  }

  return { canRecord: blockingIssues.length === 0, blockingIssues };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- capabilities`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/export/capabilities.ts src/tests/capabilities.test.ts
git commit -m "feat: add export capability detection"
```

---

### Task 3: Frame compositor

**Files:**
- Create: `src/export/frameCompositor.ts`
- Test: `src/tests/frameCompositor.test.ts`

**Interfaces:**
- Consumes: `EvaluatedFrame`, `EvaluatedLayer` from `src/models/timeline.ts` (existing — `EvaluatedLayer` has `segmentId`, `sourceType`, `sourceId`, `kind: SegmentKind`, `localTimeMs`, `opacity`, `transform?: VisualTransform`, `camera?: CameraState`, `fitMode?: FitMode`, `audioEnabled?: boolean`; `VisualTransform` has `centerX`, `centerY`, `scale`, `rotation?`).
- Produces: `export function compositeFrame(ctx: CanvasRenderingContext2D, frame: EvaluatedFrame, cesiumCanvas: HTMLCanvasElement, mediaElements: ReadonlyMap<string, HTMLImageElement | HTMLVideoElement>, outputWidth: number, outputHeight: number): void`.

**Drawing model:** an image/photo/storefront layer's `transform.centerX`/`centerY` map directly onto the output canvas as a normalized position (`centerX * outputWidth`, `centerY * outputHeight` — matching `transformToCss`'s `centerX = 0.5` meaning "dead center", the default when there's no active drag); `transform.scale` and `transform.rotation` apply around that point via `ctx.scale`/`ctx.rotate`; the image itself is drawn at its `object-fit: contain`-equivalent size (computed from the element's natural dimensions against the output dimensions), matching `.preview-overlay-image`'s `max-width/max-height: 100%; object-fit: contain` CSS. Video layers ignore `transform` (there is none on a video segment) and instead honor `fitMode` (`cover`/`contain`) against the full output frame, matching `.preview-overlay-video`'s `inset: 0; width/height: 100%`.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- frameCompositor`
Expected: FAIL (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- frameCompositor`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/export/frameCompositor.ts src/tests/frameCompositor.test.ts
git commit -m "feat: add export frame compositor"
```

---

### Task 4: Export audio graph

**Files:**
- Create: `src/export/audioGraph.ts`
- Test: `src/tests/audioGraph.test.ts`

**Interfaces:**
- Produces: `export interface ExportAudioGraph { destinationStream: MediaStream; close(): void; }` and `export function createExportAudioGraph(videoElements: readonly { element: HTMLVideoElement; audioEnabled: boolean }[], AudioContextCtor?: typeof AudioContext): ExportAudioGraph | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/audioGraph.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createExportAudioGraph } from '../export/audioGraph';

class FakeMediaElementAudioSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeMediaStreamAudioDestinationNode {
  stream = { __fakeStream: true } as unknown as MediaStream;
}

function createFakeAudioContextCtor(options: { throwOnConstruct?: boolean } = {}) {
  const createdSourceNodes: FakeMediaElementAudioSourceNode[] = [];
  const closeFn = vi.fn().mockResolvedValue(undefined);
  const destinationNode = new FakeMediaStreamAudioDestinationNode();

  class FakeAudioContext {
    close = closeFn;
    constructor() {
      if (options.throwOnConstruct) throw new Error('AudioContext not allowed');
    }
    createMediaStreamDestination() {
      return destinationNode;
    }
    createMediaElementSource(_element: HTMLVideoElement) {
      const node = new FakeMediaElementAudioSourceNode();
      createdSourceNodes.push(node);
      return node;
    }
  }

  return {
    FakeAudioContext: FakeAudioContext as unknown as typeof AudioContext,
    createdSourceNodes,
    closeFn,
    destinationNode,
  };
}

describe('createExportAudioGraph', () => {
  it('creates and connects a source node only for audioEnabled entries', () => {
    const { FakeAudioContext, createdSourceNodes, destinationNode } = createFakeAudioContextCtor();
    const graph = createExportAudioGraph(
      [
        { element: {} as HTMLVideoElement, audioEnabled: true },
        { element: {} as HTMLVideoElement, audioEnabled: false },
      ],
      FakeAudioContext,
    );

    expect(graph).not.toBeNull();
    expect(graph?.destinationStream).toBe(destinationNode.stream);
    expect(createdSourceNodes).toHaveLength(1);
    expect(createdSourceNodes[0].connect).toHaveBeenCalledWith(destinationNode);
  });

  it('close() disconnects every created source node and closes the context', () => {
    const { FakeAudioContext, createdSourceNodes, closeFn } = createFakeAudioContextCtor();
    const graph = createExportAudioGraph(
      [
        { element: {} as HTMLVideoElement, audioEnabled: true },
        { element: {} as HTMLVideoElement, audioEnabled: true },
      ],
      FakeAudioContext,
    );

    graph?.close();

    expect(createdSourceNodes).toHaveLength(2);
    for (const node of createdSourceNodes) {
      expect(node.disconnect).toHaveBeenCalledTimes(1);
    }
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('returns null rather than throwing when AudioContextCtor construction fails', () => {
    const { FakeAudioContext } = createFakeAudioContextCtor({ throwOnConstruct: true });
    const graph = createExportAudioGraph([], FakeAudioContext);
    expect(graph).toBeNull();
  });

  it('creates no source nodes when every entry has audioEnabled: false', () => {
    const { FakeAudioContext, createdSourceNodes } = createFakeAudioContextCtor();
    const graph = createExportAudioGraph([{ element: {} as HTMLVideoElement, audioEnabled: false }], FakeAudioContext);
    expect(graph).not.toBeNull();
    expect(createdSourceNodes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- audioGraph`
Expected: FAIL (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/export/audioGraph.ts
export interface ExportAudioGraph {
  destinationStream: MediaStream;
  close(): void;
}

export function createExportAudioGraph(
  videoElements: readonly { element: HTMLVideoElement; audioEnabled: boolean }[],
  AudioContextCtor?: typeof AudioContext,
): ExportAudioGraph | null {
  const Ctor = AudioContextCtor ?? (typeof AudioContext !== 'undefined' ? AudioContext : undefined);
  if (!Ctor) return null;

  let audioContext: AudioContext;
  try {
    audioContext = new Ctor();
  } catch {
    return null;
  }

  const destinationNode = audioContext.createMediaStreamDestination();
  const sourceNodes: MediaElementAudioSourceNode[] = [];

  for (const { element, audioEnabled } of videoElements) {
    if (!audioEnabled) continue;
    const sourceNode = audioContext.createMediaElementSource(element);
    sourceNode.connect(destinationNode);
    sourceNodes.push(sourceNode);
  }

  return {
    destinationStream: destinationNode.stream,
    close(): void {
      for (const sourceNode of sourceNodes) {
        sourceNode.disconnect();
      }
      void audioContext.close();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- audioGraph`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/export/audioGraph.ts src/tests/audioGraph.test.ts
git commit -m "feat: add export audio graph"
```

---

### Task 5: Export runner

**Files:**
- Create: `src/export/exportRunner.ts`

**Interfaces:**
- Consumes: `CodecSelection`/`selectExportMimeType` (Task 1), `checkExportCapabilities` is NOT called here (the panel calls it separately before starting); `compositeFrame` (Task 3); `createExportAudioGraph`/`ExportAudioGraph` (Task 4); `compileProjectTimeline` (`src/timeline/compiler.ts`, existing: `(project: Project) => CompiledTimeline`); `evaluateProjectTimeline` (`src/timeline/evaluator.ts`, existing: `(timeline: CompiledTimeline, timeMs: number) => EvaluatedFrame`); `applyCameraState` (`src/cesium/applyCameraState.ts`, existing: `(viewer: Viewer, camera: CameraState) => void`); `MediaAssetStore` (`src/media/MediaAssetStore.ts`, existing: `get(id: string): Promise<Blob | File | null>`).
- Produces: `export interface ExportOptions { project: Project; viewer: Viewer; outputCanvas: HTMLCanvasElement; mediaAssetStore: MediaAssetStore; onProgress: (elapsedMs: number, totalMs: number) => void; signal: AbortSignal; selectMimeType?: () => CodecSelection | null; now?: () => number; requestAnimationFrame?: (cb: FrameRequestCallback) => number; cancelAnimationFrame?: (handle: number) => void; AudioContextCtor?: typeof AudioContext; }` and `export async function runExport(options: ExportOptions): Promise<Blob>`.

This module is **not unit-tested** (no jsdom/real `MediaRecorder`/`AudioContext`/Cesium in this project's Vitest environment) per the Global Constraints — it is verified via `npx tsc -b` in this task and a real-browser pass in Task 8.

- [ ] **Step 1: Write the implementation**

```ts
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
```

- [ ] **Step 2: Verify the module compiles cleanly**

Run: `npx tsc -b`
Expected: no errors attributable to `src/export/exportRunner.ts`.

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS, every existing and new suite green (this file has no tests of its own).

- [ ] **Step 4: Commit**

```bash
git add src/export/exportRunner.ts
git commit -m "feat: add export runner orchestrating capture, compositing, and recording"
```

---

### Task 6: Export panel UI

**Files:**
- Create: `src/components/studio/ExportPanel.tsx`
- Create: `src/components/studio/ExportPanel.css`

**Interfaces:**
- Consumes: `checkExportCapabilities`/`ExportCapabilityReport` (Task 2); `runExport`/`ExportOptions` (Task 5); `createMediaAssetStore` (`src/media/createMediaAssetStore.ts`, existing: `(): Promise<MediaAssetStore>`); `Project` (`src/models/project.ts`, existing).
- Produces: `export interface ExportPanelProps { project: Project; viewer: Viewer; onClose: () => void; }` and `export function ExportPanel(props: ExportPanelProps): JSX.Element`. Task 7 renders this component from `StudioView`.

Not unit-tested (same reason as Task 5) — verified via `npx tsc -b` here and the real-browser pass in Task 8.

- [ ] **Step 1: Write the implementation**

```tsx
// src/components/studio/ExportPanel.tsx
import { useEffect, useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import './ExportPanel.css';
import type { Project } from '../../models/project';
import { checkExportCapabilities, type ExportCapabilityReport } from '../../export/capabilities';
import { createMediaAssetStore } from '../../media/createMediaAssetStore';
import { runExport } from '../../export/exportRunner';

interface ExportPanelProps {
  project: Project;
  viewer: Viewer;
  onClose: () => void;
}

type ExportPanelState =
  | { phase: 'idle'; capabilities: ExportCapabilityReport }
  | { phase: 'recording'; elapsedMs: number; totalMs: number }
  | { phase: 'done'; url: string; filename: string }
  | { phase: 'error'; message: string };

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ExportPanel({ project, viewer, onClose }: ExportPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [state, setState] = useState<ExportPanelState>(() => ({
    phase: 'idle',
    capabilities: checkExportCapabilities(viewer.scene.canvas),
  }));

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function handleStart() {
    if (!canvasRef.current) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setState({ phase: 'recording', elapsedMs: 0, totalMs: 0 });

    try {
      const mediaAssetStore = await createMediaAssetStore();
      const blob = await runExport({
        project,
        viewer,
        outputCanvas: canvasRef.current,
        mediaAssetStore,
        onProgress: (elapsedMs, totalMs) => setState({ phase: 'recording', elapsedMs, totalMs }),
        signal: abortController.signal,
      });
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      setState({ phase: 'done', url, filename: `${project.projectName}.${extension}` });
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Export failed.' });
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  function handleClose() {
    abortControllerRef.current?.abort();
    onClose();
  }

  return (
    <div className="export-panel-backdrop" onClick={handleClose}>
      <div className="export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-panel-header">
          <h3>Export Video</h3>
          <button type="button" onClick={handleClose}>
            &times;
          </button>
        </div>

        <canvas ref={canvasRef} className="export-panel-canvas" />

        {state.phase === 'idle' && (
          <div className="export-panel-body">
            <p>
              Exporting at {project.videoSettings.widthPx}&times;{project.videoSettings.heightPx},{' '}
              {project.videoSettings.fps}fps
            </p>
            {state.capabilities.blockingIssues.length > 0 && (
              <ul className="export-panel-issues">
                {state.capabilities.blockingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <button type="button" disabled={!state.capabilities.canRecord} onClick={() => void handleStart()}>
              Start
            </button>
          </div>
        )}

        {state.phase === 'recording' && (
          <div className="export-panel-body">
            <progress value={state.totalMs > 0 ? state.elapsedMs : 0} max={state.totalMs || 1} />
            <p>
              {formatMs(state.elapsedMs)} / {formatMs(state.totalMs)}
            </p>
            <button type="button" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        )}

        {state.phase === 'done' && (
          <div className="export-panel-body">
            <p>Export complete.</p>
            <a href={state.url} download={state.filename}>
              Download {state.filename}
            </a>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="export-panel-body">
            <p role="alert">{state.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

```css
/* src/components/studio/ExportPanel.css */
.export-panel-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.export-panel {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  min-width: 320px;
  max-width: 480px;
}

.export-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.export-panel-header h3 {
  margin: 0;
}

.export-panel-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.export-panel-canvas {
  display: none;
}

.export-panel-issues {
  color: #b00020;
  font-size: 13px;
}
```

- [ ] **Step 2: Verify the component compiles cleanly**

Run: `npx tsc -b`
Expected: no errors attributable to `src/components/studio/ExportPanel.tsx`.

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS, every existing and new suite green.

- [ ] **Step 4: Commit**

```bash
git add src/components/studio/ExportPanel.tsx src/components/studio/ExportPanel.css
git commit -m "feat: add ExportPanel UI"
```

---

### Task 7: Wire the Export button into StudioView

**Files:**
- Modify: `src/components/studio/StudioView.tsx`

**Interfaces:**
- Consumes: `ExportPanel`/`ExportPanelProps` (Task 6). `StudioView` already owns `viewerRef = useRef<Viewer | null>(null)` (set via `PreviewStage`'s `onViewerReady`) and `project` (the non-null-narrowed current project).
- Produces: nothing new for later tasks — this is the final integration point.

`StudioView`'s current `onViewerReady` inline callback only assigns `viewerRef.current`; it never triggers a re-render, so nothing currently tells React "the viewer is ready to read." Add a `viewerReady` boolean state, flipped inside that same callback, and gate the new Export button on it.

- [ ] **Step 1: Add `viewerReady` state and the `ExportPanel` import**

In `src/components/studio/StudioView.tsx`, add to the imports (after the existing `ScalingControls` import):

```ts
import { ExportPanel } from './ExportPanel';
```

Change the `isDirty`/`error` state block:

```ts
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
```

to:

```ts
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
```

- [ ] **Step 2: Flip `viewerReady` when the viewer mounts**

Change the `PreviewStage`'s `onViewerReady` prop from:

```tsx
        onViewerReady={(viewer) => {
          viewerRef.current = viewer;
        }}
```

to:

```tsx
        onViewerReady={(viewer) => {
          viewerRef.current = viewer;
          setViewerReady(true);
        }}
```

- [ ] **Step 3: Add the Export button to the header and render the panel**

Change the header block from:

```tsx
      <div className="studio-header">
        <button type="button" onClick={handleBack}>
          Back
        </button>
        <h2>{project.projectName}</h2>
        <button type="button" disabled={!isDirty} onClick={() => void handleSave()}>
          Save
        </button>
      </div>
```

to:

```tsx
      <div className="studio-header">
        <button type="button" onClick={handleBack}>
          Back
        </button>
        <h2>{project.projectName}</h2>
        <div className="studio-header-actions">
          <button type="button" disabled={!viewerReady} onClick={() => setExportOpen(true)}>
            Export
          </button>
          <button type="button" disabled={!isDirty} onClick={() => void handleSave()}>
            Save
          </button>
        </div>
      </div>
```

Add the panel render just before the closing `</div>` of the top-level `studio-view` container (after the `<ScalingControls .../>` line):

```tsx
      <ScalingControls project={project} updateProject={updateProject} />

      {exportOpen && viewerRef.current && (
        <ExportPanel project={project} viewer={viewerRef.current} onClose={() => setExportOpen(false)} />
      )}
```

- [ ] **Step 4: Add the header-actions layout rule**

In `src/components/studio/StudioView.css`, add after the existing `.studio-header h2` rule:

```css
.studio-header-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 5: Verify compilation and the full test suite**

Run: `npx tsc -b && npm test`
Expected: clean compile, all suites (existing + new) passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/StudioView.tsx src/components/studio/StudioView.css
git commit -m "feat: wire Export button and panel into StudioView"
```

---

### Task 8: Real-browser end-to-end verification

**Files:** none (verification only — no source changes expected; fix forward in the relevant file from Tasks 1-7 if this surfaces a real bug).

This task exercises the paths Task 5/6 could not unit-test: the actual `MediaRecorder` recording loop, Web Audio routing, and the Export panel's full state machine, in a real browser via the Playwright MCP tools. Run `npm run dev` first and navigate to it with `browser_navigate`.

- [ ] **Step 1: Confirm a clean baseline**

Run: `npx tsc -b && npm test && npm run build`
Expected: clean compile, full suite green (should already be true from Task 7 — this is a re-confirmation before the manual pass), and a successful production build (confirms the Acceptance Criteria's "`npm run build` succeeds; no new runtime dependency was added" — check `package.json` was not touched by any prior task as part of this same confirmation).

- [ ] **Step 2: Open a real project and the Export panel**

Using the Playwright tools: `browser_navigate` to the running dev server, open (or Quick-Create) a project that has a map scene, a storefront scene, and an interior tour with at least one photo and one video item where `audioEnabled: true`. Open Studio for it, click **Export**. Use `browser_snapshot` to confirm the panel shows "Exporting at `<width>`×`<height>`, `<fps>`fps" matching the project's `videoSettings`, the capability check ran (no blocking issues listed), and **Start** is enabled.

- [ ] **Step 3: Run a full export and verify the result**

Click **Start**. Confirm via `browser_snapshot`/polling that the progress bar and elapsed time advance and the Cesium camera visibly moves during the map portion. Wait for the `done` phase. Confirm the download link's `href` is a `blob:` URL and its `download` attribute ends in `.mp4` or `.webm` matching the browser's actual supported codec (check via `browser_evaluate` calling `MediaRecorder.isTypeSupported(...)` in the same page, or by reading the link's extension). Use `browser_evaluate` to fetch the blob URL and confirm its `Blob.size` is greater than 0.

- [ ] **Step 4: Verify the capability check blocks Start with a specific message**

Reload the page, open a project, and before opening Export use `browser_evaluate` to stub out canvas capture support (e.g. redefine `HTMLCanvasElement.prototype.captureStream` to `undefined` in the page context). Open Export and confirm via `browser_snapshot` that **Start** is disabled and "This browser does not support recording canvas output." is listed.

- [ ] **Step 5: Verify audio failure never blocks video export**

Reload, open a project with an `audioEnabled: true` interior video, and use `browser_evaluate` to stub `window.AudioContext` (and `webkitAudioContext` if present) to a constructor that throws. Open Export, click Start, and confirm the export still completes successfully and produces a downloadable, non-zero-size file (video-only — no audio track).

- [ ] **Step 6: Verify Cancel releases resources cleanly**

Reload, open a project, open Export, click Start, then click **Cancel** partway through. Confirm via `browser_snapshot` the panel returns to a state where a fresh export can be started (no broken/partial download offered), and via `browser_evaluate` confirm no `<video>` element in the document is still `paused === false`, and (where feasible to check) no export-created `AudioContext` remains in a `running` state.

- [ ] **Step 7: Record the outcome**

If every check in Steps 2-6 passes, this task is complete — no commit needed (verification only). If any step surfaces a real defect, fix it in the relevant file from Tasks 1-7, re-run `npx tsc -b && npm test`, repeat the failed verification step, and commit the fix with a message describing what was wrong (e.g. `fix: <description>`).

---
