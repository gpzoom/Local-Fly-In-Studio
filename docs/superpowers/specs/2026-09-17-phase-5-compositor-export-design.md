# Phase 5: Compositor + Export — Design Spec

Date: 2026-09-17
Status: Approved for implementation planning

## Context

Local Fly-In Studio's full product scope is defined in:

- `../../../Local Fly-In Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up)
- `../../../Claude Code Build Prompt — Local Fly-In Studio v3.0.md`

Phases 1-4b are complete and merged: data model/persistence, the timeline
engine (compiler/evaluator/easing/camera interpolation/scaling), media
ingestion/destination resolution, the Cesium viewer + Quick Create flow,
and the Studio desktop editor (manual waypoint editing, timeline UI,
per-element inspectors, drag-reorder, scaling controls). This spec covers
Phase 5: rendering the compiled timeline into an actual downloadable video
file — the Output Compositor and the export UI. Studio's own preview
(`PreviewStage`) is DOM/CSS-layered and is not modified by this phase; the
compositor is new, canvas-based code that reuses the same evaluator output
`PreviewStage` already consumes.

Remaining phase after this one: Phase 6 (user-saved templates, bulk edit,
media relinking, additional export variants, polish, README).

## Goal

1. A canvas-based compositor that, given the project's already-compiled
   timeline and the live Cesium viewer, draws one fully-composited output
   frame at a time — map + storefront/interior overlay + transitions — at
   an exact target resolution.
2. Real-time recording of that compositor's output, plus each active
   interior video's audio (when enabled), into a single downloadable video
   file via `MediaRecorder`, honoring the project's persisted
   `VideoSettings` (resolution/fps).
3. Capability/codec detection that runs before recording starts and
   explains, specifically, why export can't proceed if it can't — never a
   silent or generic failure.
4. An **Export** entry point in Studio with settings, live progress
   (elapsed time / project duration), and a download link when done.

Scope for this phase, decided during brainstorming:

- **Export Complete Video only.** The PRD's other three variants (Fly-In
  Only, Fly-In + Storefront, Interior Tour Only) are deferred — they are a
  cheap follow-up once this compositor exists (each is just a differently
  filtered/compiled sub-timeline fed through the same pipeline), not a
  redesign, but they add UI surface this phase doesn't need to carry.
- **Audio is included** in this phase (not deferred), per the PRD's
  described Web-Audio-based architecture, since audio routing is a small,
  well-scoped addition once the video pipeline exists and deferring it
  would mean touching the export pipeline twice.
- **Reuse the live, already-mounted Studio Cesium viewer** for export
  rather than spinning up a second offscreen instance. Export is a
  real-time, blocking, watch-it-happen operation: the camera visibly flies
  through the timeline during recording, matching the PRD's explicit
  real-time-recording UX (progress, elapsed time, project duration shown
  while it runs). This avoids a second Cesium instance's GPU/memory cost
  and viewer-lifecycle complexity.
- **Export button lives in `StudioView`'s header**, opening a panel/modal
  — not a new top-level `App.tsx` view — since export is one more thing
  you do from Studio, not a separate destination.

Out of scope for Phase 5 (see each section below for the specific
PRD-described piece deferred): offline/frame-perfect rendering (PRD's own
Phase 2), mobile export support, resolutions/framerates beyond the 3 PRD
presets and 30/60fps, and the 3 non-Complete export variants.

## New Dependency

None. `MediaRecorder`, `canvas.captureStream()`, and the Web Audio API are
native browser APIs — no new npm package is required.

## `src/export/codecSelection.ts`

```ts
export interface CodecSelection {
  mimeType: string;
  fileExtension: string;
}

export function selectExportMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): CodecSelection | null
```

A pure function wrapping the PRD's exact codec priority order — tried via
`MediaRecorder.isTypeSupported` (injected as an optional last parameter,
DI pattern, matching every browser-API-touching function since Phase 1):

1. `video/mp4;codecs=avc1` (real MP4/H.264, only when genuinely supported —
   "do not assume MP4 support")
2. `video/webm;codecs=vp9`
3. `video/webm;codecs=vp8`
4. `video/webm` (unspecified codec, last resort before giving up)

Returns the first supported entry's `{ mimeType, fileExtension }`
(`.mp4` only for the real MP4 case; `.webm` for every WebM case — "never
put an `.mp4` filename on WebM content"), or `null` if nothing in the list
is supported. This same function is called both by the capability check
(below) and by the export runner's actual `MediaRecorder` construction, so
there is exactly one source of truth for "what are we allowed to record."

## `src/export/capabilities.ts`

```ts
export interface ExportCapabilityReport {
  canRecord: boolean;
  blockingIssues: string[];
}

export function checkExportCapabilities(
  canvas: HTMLCanvasElement,
  selectMimeType?: () => CodecSelection | null,
): ExportCapabilityReport
```

Runs once when the Export panel opens (not re-run per attempt within the
same panel session). Checks, accumulating every failure into
`blockingIssues` rather than stopping at the first (so the panel can show
the user everything wrong at once):

- `typeof canvas.captureStream === 'function'` — else
  `"This browser does not support recording canvas output."`
- `typeof MediaRecorder !== 'undefined'` — else
  `"This browser does not support MediaRecorder."`
- `selectExportMimeType()` returns non-null — else
  `"No supported video format is available in this browser."`
- A real draw-then-read probe: draw onto a detached 2×2 canvas and call
  `getImageData` inside a `try`/`catch`; a thrown `SecurityError` (tainted
  canvas — e.g. a cross-origin imagery tile that didn't set CORS headers)
  becomes `"Map imagery could not be read for export (a cross-origin
  security restriction)."` This is the check the PRD explicitly calls out
  as required, not assumed: canvas extraction must be verified working,
  not just attempted at export time.

`canRecord` is `blockingIssues.length === 0`. The Export panel disables
Start and lists every blocking issue verbatim when `canRecord` is false.

## `src/export/frameCompositor.ts`

```ts
export function compositeFrame(
  ctx: CanvasRenderingContext2D,
  frame: EvaluatedFrame,
  cesiumCanvas: HTMLCanvasElement,
  mediaElements: ReadonlyMap<string, HTMLImageElement | HTMLVideoElement>,
  outputWidth: number,
  outputHeight: number,
): void
```

Pure frame-in-pixels-out drawing, with no dependency on the export clock,
`MediaRecorder`, or React — the same shape of function as
`applyCameraState`/`captureCameraState`, and tested the same way (a fake
`CanvasRenderingContext2D` that records calls, no real canvas needed).

1. `ctx.fillStyle = 'black'; ctx.fillRect(0, 0, outputWidth, outputHeight)`
   — always fills the full frame first, matching `PreviewStage`'s black
   backdrop, so there is never an undefined region regardless of aspect
   mismatches.
2. For each `frame.layers` entry, in the array's existing order (already
   correctly ordered by the evaluator: at most 2 layers during a
   crossfade, outgoing then incoming):
   - **`map-hold`/`map-travel`**: `ctx.drawImage(cesiumCanvas, 0, 0,
     cesiumCanvas.width, cesiumCanvas.height, 0, 0, outputWidth,
     outputHeight)`. No letterbox math needed — the on-screen Cesium
     viewer is already kept at the project's `VideoSettings.aspectRatio`
     via CSS (the same way `PreviewStage`'s `.preview-stage` is), so a
     straight stretch-to-fit is a correct 1:1 scale.
   - **`storefront`/`photo`**: looks up `mediaElements.get(layer.sourceId)`
     (an `HTMLImageElement`); if missing, skips the layer (the runner is
     responsible for having every needed asset loaded before recording
     starts — see below). Applies `ctx.globalAlpha = layer.opacity`, then
     `ctx.translate`/`ctx.scale`/`ctx.rotate` using `layer.transform`'s
     `centerX`/`centerY`/`scale`/`rotation` fields — the canvas-transform
     equivalent of `PreviewStage.tsx`'s `transformToCss`, translating the
     element's center to the transform's normalized point scaled into
     output pixels, then applying scale/rotation around that point.
   - **`video`**: looks up an `HTMLVideoElement`; applies `opacity` the
     same way; honors `fitMode` (`cover`/`contain`) with the same
     source-rect-vs-destination-rect math `object-fit` performs, using the
     video's `videoWidth`/`videoHeight` against `outputWidth`/`outputHeight`.
   - **`black`**: `ctx.globalAlpha = layer.opacity; ctx.fillRect(0, 0,
     outputWidth, outputHeight)`.
   - `ctx.globalAlpha` is reset to `1` and any `ctx.save()`/`ctx.restore()`
     pair used for a layer's transform is balanced before the next layer.

## `src/export/audioGraph.ts`

```ts
export interface ExportAudioGraph {
  destinationStream: MediaStream;
  close(): void;
}

export function createExportAudioGraph(
  videoElements: readonly { element: HTMLVideoElement; audioEnabled: boolean }[],
  AudioContextCtor?: typeof AudioContext,
): ExportAudioGraph | null
```

Creates one `AudioContext` and one `MediaStreamAudioDestinationNode`. For
every entry with `audioEnabled: true`, creates a
`MediaElementAudioSourceNode` from its `element` and `.connect()`s it to
the shared destination; entries with `audioEnabled: false` get no source
node at all — genuinely silent, zero Web Audio overhead, no per-frame
mute/unmute logic needed. Returns `{ destinationStream:
destinationNode.stream, close }`, where `close()` disconnects every source
node and calls `audioContext.close()`.

Returns `null` (not throws) if `AudioContext` construction itself fails
(autoplay-policy restriction, unsupported browser) — the caller falls back
to a video-only stream. Per the PRD, **audio must never be mandatory for
export success**; this function's `null`-on-failure contract makes that
guarantee mechanical rather than something the caller has to remember to
wrap in a `try`/`catch` correctly.

## `src/export/exportRunner.ts`

```ts
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

export async function runExport(options: ExportOptions): Promise<Blob>
```

`fps` and the output resolution are never passed in separately — the
runner reads `project.videoSettings.fps`/`.widthPx`/`.heightPx` itself
(the single source of truth established above), sizing `outputCanvas` to
`widthPx`×`heightPx` as its first setup step. This follows the same
DI-for-testability pattern as `PlaybackController` (optional
`now`/`requestAnimationFrame`/`cancelAnimationFrame`, defaulting to the
real globals) even though this function itself is not unit-tested (see
Testing) — the pattern is kept for consistency and because it is what
makes `frameCompositor` and `codecSelection` cleanly separable from it in
the first place.

1. **Setup**: `compileProjectTimeline(project)` once; size `outputCanvas`
   from `project.videoSettings`. Collect every non-map segment's
   `sourceId` (its `sourceType` field — `'image'` or `'video'` — says
   which element kind to build); resolve each via
   `mediaAssetStore.get(sourceId)` into a real `<img>` or `<video>`
   element (created detached, never appended to the visible DOM), waiting
   for `onload`/`onloadedmetadata` before proceeding. If `selectMimeType()` returns `null` here, reject
   immediately with a clear error (the capability check should have
   already prevented reaching this point, but the runner re-checks rather
   than trusting the panel's earlier check blindly).
2. **Audio**: build the video-element list with each item's
   `audioEnabled` and call `createExportAudioGraph`. `null` is a valid,
   expected result (video-only fallback).
3. **Recorder**: `outputCanvas.captureStream(project.videoSettings.fps)`; if an audio graph
   exists, add its audio track(s) to the same `MediaStream` via
   `stream.addTrack(...)`; construct
   `new MediaRecorder(stream, { mimeType })`; collect chunks on
   `dataavailable`; `.start()`.
4. **Record loop**: `requestAnimationFrame`-driven (matching
   `PlaybackController`'s tick shape), computing `elapsedMs` from a
   `now()` timestamp taken at loop start. Each tick:
   - `evaluateProjectTimeline(timeline, elapsedMs)`.
   - For the frame's map layer (if any), `applyCameraState(viewer,
     layer.camera)` — the existing Phase 4a function, no new camera-control
     path introduced.
   - For each video layer that just became active this tick (compared to
     the previous tick's active set): seek its element to
     `segment.trimStartMs / 1000`, set `playbackRate`, call `.play()`. For
     one that just became inactive: `.pause()`.
   - `compositeFrame(ctx, frame, viewer.scene.canvas, mediaElements,
     outputWidth, outputHeight)`.
   - `onProgress(elapsedMs, timeline.totalDurationMs)`.
   - If `signal.aborted`: stop the recorder, clean up (pause every video,
     close the audio graph), and reject the promise.
   - If `elapsedMs >= timeline.totalDurationMs`: stop the recorder instead
     of scheduling another frame.
5. **Finish**: on the recorder's `stop` event, concatenate the collected
   chunks into one `Blob` with the selected `mimeType`, clean up (pause
   every video element, close the audio graph, release object URLs created
   for loaded media), and resolve the returned promise with that `Blob`.

## `src/components/studio/ExportPanel.tsx`

A panel/modal opened by a new **Export** button in `StudioView`'s header
(alongside the existing Back/Save buttons). Internal state machine:

- **`idle`**: no new resolution/fps choice — `VideoSettings` (aspectRatio,
  widthPx, heightPx, fps) is already a persisted field on `Project`, set
  once elsewhere in the product (Quick Create), and the PRD's 3 resolution
  presets map 1:1 onto the 3 supported aspect ratios (`16:9` → 1920×1080,
  `9:16` → 1080×1920, `1:1` → 1080×1080), so there is no independent
  export-time setting to surface — a second control here could only ever
  duplicate or silently diverge from the project's own settings. The panel
  displays `project.videoSettings` read-only (e.g. "Exporting at
  1920×1080, 30fps") and exports at exactly those values. Runs
  `checkExportCapabilities` once on mount; if
  `canRecord` is false, Start is disabled and every blocking issue is
  listed. Otherwise a **Start** button calls `runExport` (via a new
  `AbortController` the panel owns) and moves to `recording`.
- **`recording`**: a progress bar (`elapsedMs / totalMs`), elapsed time,
  and total project duration (both formatted `mm:ss`), plus a **Cancel**
  button that calls `abortController.abort()`. Closing the panel (✕ or
  clicking outside) during this state does the same.
- **`done`**: an `<a download="<project-name>.<ext>">` link built from
  `URL.createObjectURL(blob)`, revoked when the panel closes or a new
  export starts.
- **`error`** (reachable from any state via a caught rejection): the
  specific failure message from the runner or the abort path — "Export
  cancelled." for a user-initiated abort, the underlying `Error.message`
  for anything else.

## Testing (Vitest, `environment: 'node'`)

- **`codecSelection.ts`**: a fake `isTypeSupported` implementation per
  test case verifies the priority order (only WebM VP8 supported → picks
  it and not MP4; nothing supported → returns `null`; MP4 supported →
  picked first even when WebM is also supported) and the exact
  mimeType/extension pairing (never `.mp4` for a WebM `mimeType`).
- **`capabilities.ts`**: DI-injected fakes for `captureStream` presence,
  `MediaRecorder` presence, and `selectMimeType`'s result, verifying
  `blockingIssues` accumulates every failure (not just the first) and
  `canRecord` is exactly `blockingIssues.length === 0`. The canvas-taint
  probe is tested by injecting a canvas-like fake whose `getImageData`
  throws a `DOMException` named `SecurityError`, verifying the specific
  message is produced.
- **`frameCompositor.ts`**: a fake `CanvasRenderingContext2D` (an object
  recording every method call, matching the `applyCameraState.test.ts`
  mocking style) verifies: the background fill always happens first; a
  map layer draws the Cesium canvas stretched to the exact output
  dimensions; an image layer's transform math produces the expected
  translate/scale/rotate calls for known `VisualTransform` inputs
  (including the default no-rotation case); a black layer fills at its
  opacity; a missing `mediaElements` entry for a referenced `sourceId` is
  skipped without throwing.
- **`audioGraph.ts`**: a fake `AudioContextCtor` (constructing fake nodes
  that record `.connect()`/`.disconnect()` calls) verifies: only
  `audioEnabled: true` entries get a source node created and connected;
  `close()` disconnects every created node and closes the context; a
  throwing `AudioContextCtor` makes the function return `null` rather than
  throwing.
- **`exportRunner.ts`, `ExportPanel.tsx`**: not unit-tested (no jsdom, no
  real `MediaRecorder`/`AudioContext`/Cesium in this project's Vitest
  environment), per established precedent. Verified by TypeScript
  compilation and a real-browser Playwright pass: open Export from
  Studio, confirm the capability check runs and Start is enabled, start an
  export on a short test project, watch progress advance and the camera
  visibly move, let it complete, download the resulting file and confirm
  (via `browser_network_requests`/file inspection where the tooling
  allows) it has non-zero size and the expected container/codec; also
  exercise Cancel mid-export and confirm no broken download is offered
  afterward.

## Acceptance Criteria

- All new pure-logic Vitest suites (`codecSelection`, `capabilities`,
  `frameCompositor`, `audioGraph`) pass, alongside every existing test
  unmodified.
- `npm run build` succeeds; no new runtime dependency was added.
- A real project (map + storefront + interior photos/videos, at least one
  with `audioEnabled: true`) exports successfully end-to-end in a real
  browser: the downloaded file plays, shows the map fly-in through
  storefront through interior tour with correct transitions, and includes
  audio from the enabled video item(s) and silence where disabled.
- The capability check correctly blocks Start with a specific message when
  a required API is genuinely unavailable (simulated by stubbing it out in
  a Playwright `browser_evaluate` call), and export still succeeds with a
  video-only file when the audio graph specifically fails to construct
  (simulated the same way) — proving audio failure never blocks video
  export.
- Cancelling mid-export stops recording, releases all resources (no
  lingering playing `<video>` elements or open `AudioContext` visible via
  `browser_evaluate`/dev tools), and the panel returns to a state where a
  fresh export can be started.
