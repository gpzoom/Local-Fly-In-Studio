# Phase 4a: Cesium Viewer + Quick Create — Design Spec

Date: 2026-09-17
Status: Approved for implementation planning

## Context

Local Fly-In Studio's full product scope is defined in:

- `../../../Local Fly-In Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up)
- `../../../Claude Code Build Prompt — Local Fly-In Studio v3.0.md`

Phases 1-3 are complete and merged: Phase 1 (Foundation — Zod data model,
OPFS/IndexedDB persistence), Phase 2 (Timeline Engine Core — compiler,
evaluator, easing, camera interpolation math, scaling), Phase 3 (Media
Ingestion + Destination Resolution — EXIF/GPS extraction, HEIC conversion,
Census geocoding, device location, the four-function destination resolver).

The original 6-phase plan named Phase 4 "Cesium map + Quick Create/Studio UI
+ playback." That scope is too large for one plan/SDD cycle, so it is split
into 4a (this spec) and 4b. 4a delivers a complete, working vertical slice
of the PRD's primary workflow: take/select a storefront photo, add interior
media, generate a draft project automatically, and preview it play/pause/
scrub — all rendered through the Phase 2 evaluator, never through chained
Cesium `camera.flyTo()` calls, per the PRD's central "one evaluator drives
every playback mode" rule. 4b (a separate spec, written after 4a merges)
covers the Studio desktop editor: manual waypoint capture/edit, the timeline
UI, inspectors, and drag-reorder.

Remaining phases after 4a and 4b: Phase 5 (compositor + export), Phase 6
(user-saved templates, bulk edit, relinking, polish, README).

## Goal

1. A working CesiumJS viewer, configured against USGS National Map imagery,
   with no Cesium ion dependency, that survives a production Vite build.
2. A `PlaybackController` that drives a single Cesium viewer plus image/video
   preview surfaces from `evaluateProjectTimeline`'s output — used
   identically for play, pause, and scrub.
3. A two-step Quick Create wizard that runs the PRD's `createDraft`
   algorithm end-to-end: storefront photo → GPS/fallback destination
   resolution → auto-generated `MapScene` from a built-in template →
   default `StorefrontScene` → default `InteriorTourItem`s → saved
   `Project` → preview.
4. The no-GPS fallback chain (current location / address / pick-on-map).

No Studio editor, no manual waypoint editing, no compositor/export, no
user-saved templates. Those are 4b, Phase 5, and Phase 6 respectively.

## New Dependencies

- `cesium` — the CesiumJS library itself (referenced throughout the PRD but
  not yet installed).
- `vite-plugin-cesium` — handles copying Cesium's static assets (Workers,
  Widgets CSS, Assets) into the Vite build and setting `CESIUM_BASE_URL`
  automatically. Chosen over hand-rolling a static-copy config: it is the
  well-trodden path for Vite+Cesium and keeps `vite.config.ts` small.
- `lucide-react` — icon set named in the project's tech stack, first needed
  now for Quick Create's buttons (take/select photo, add media, create
  draft).

All three are runtime `dependencies` (Cesium and Lucide render in the
browser; the Vite plugin is a `devDependency` since it only runs at build
time).

`dnd-kit` remains uninstalled — Quick Create has no reordering UI; it is a
4b (Studio) dependency.

## Design Decision: Evaluator-Driven Rendering, No Direct Cesium Animation

The PRD is explicit: do not implement the Map Scene as chained
`camera.flyTo()` calls, and do not let the app wait for one scene's
callback before starting another. The application owns the clock.

Concretely, this phase introduces exactly one piece of new *stateful*
runtime logic — `PlaybackController` — and treats every other renderer as a
pure function of the `EvaluatedFrame` it receives on each tick. Play, pause,
and scrub are all "set `currentTimeMs`, call `evaluateProjectTimeline`,
render the result" — they differ only in whether a `requestAnimationFrame`
loop is advancing `currentTimeMs` automatically (play/pause) or a caller is
setting it directly (scrub). No renderer keeps its own notion of "current
time" independent of the controller.

## Design Decision: Dependency Injection for Browser/Timing APIs

Continuing the pattern from Phases 1-3: `PlaybackController` takes injected
`requestAnimationFrame`, `cancelAnimationFrame`, and `now` (defaulting to
the real globals), so its scheduling and time-accumulation logic is fully
unit-testable under Vitest's `environment: 'node'` without a real browser
loop or fake timers hackery. `src/media/videoMetadata.ts` follows the same
shape as Phase 3's `metadata.ts`: a `loadMetadata` seam that defaults to a
real hidden-`<video>`-element implementation but accepts an injected fake
in tests.

Cesium itself is **not** DI-wrapped at the unit-test level — `viewer.ts` and
`applyCameraState.ts` are thin, verified by running the app and by the
production build smoke check (see Testing), not by Vitest. This mirrors how
OPFS-real-filesystem code in Phase 1 and heic2any's real conversion path in
Phase 3 were left to manual/production verification rather than mocked into
false confidence.

## `src/cesium/viewer.ts`

```ts
export interface CesiumViewerHandle {
  viewer: Cesium.Viewer;
  destroy: () => void;
}

export function createCesiumViewer(container: HTMLElement): CesiumViewerHandle
```

Creates a `Cesium.Viewer` with:
- `Cesium.Ion.defaultAccessToken = ''` and no ion-backed imagery/terrain —
  the viewer's `imageryProvider` is supplied explicitly by
  `src/cesium/imagery.ts` (see below), and `baseLayerPicker: false`,
  `geocoder: false`, `homeButton: false`, `sceneModePicker: false`,
  `navigationHelpButton: false`, `animation: false`, `timeline: false`,
  `fullscreenButton: false`, `infoBox: false`, `selectionIndicator: false` —
  every stock Cesium UI widget is disabled since this app owns its own
  chrome (play/pause/scrub bar, wizard steps).
- Terrain: `Cesium.EllipsoidTerrainProvider` (flat ellipsoid) — the PRD's
  non-goals exclude photorealistic 3D buildings/terrain; a flat globe with
  imagery draped on it is sufficient and avoids any terrain-service
  dependency.

`destroy()` calls `viewer.destroy()` — called from the owning React
component's cleanup effect.

## `src/cesium/imagery.ts`

```ts
export function createUsgsImageryProvider(): Cesium.ImageryProvider
```

Wraps USGS The National Map's imagery service (aerial/satellite) as a
Cesium `ImageryProvider`. **Implementation note:** this spec does not pin
the exact USGS REST endpoint/provider class (e.g. whether USGS's service is
best consumed via `Cesium.ArcGisMapServerImageryProvider` pointed at a USGS
ArcGIS REST endpoint, or `Cesium.WebMapTileServiceImageryProvider` against a
USGS WMTS endpoint) — the implementing task must verify USGS's currently
published imagery service URL and the correct Cesium provider class against
USGS's own documentation, matching Phase 3's precedent of verifying an
external API's real shape during implementation rather than guessing it in
the spec. The requirement that does not move: no Cesium ion, no Google/
Mapbox imagery.

## `src/cesium/applyCameraState.ts`

```ts
export function applyCameraState(viewer: Cesium.Viewer, camera: CameraState): void
```

Translates a `CameraState` (Phase 1's model: `longitude`, `latitude`,
`height`, `heading`, `pitch`, `roll`, all already in the units Cesium's
`camera.setView` expects — degrees for heading/pitch/roll,
`Cesium.Math.toRadians` conversion happens inside this function) into
`viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(...),
orientation: { heading, pitch, roll } })`. Called once per animation frame
by `PlaybackController`'s render callback whenever the active `EvaluatedFrame`
contains a `map-hold` or `map-travel` layer — never accumulates state of its
own, purely a translation of "this frame's camera state" into a Cesium call.

## `src/timeline/playbackController.ts`

```ts
export interface PlaybackControllerOptions {
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
  now?: () => number;
}

export type PlaybackListener = (frame: EvaluatedFrame, timeMs: number) => void;

export class PlaybackController {
  constructor(
    timeline: CompiledTimeline,
    options?: PlaybackControllerOptions,
  );

  play(): void;
  pause(): void;
  seek(timeMs: number): void;
  subscribe(listener: PlaybackListener): () => void; // returns unsubscribe
  get isPlaying(): boolean;
  get currentTimeMs(): number;
  destroy(): void;
}
```

- `play()` starts (or resumes) a `requestAnimationFrame` loop. Each tick
  computes elapsed wall-clock time since the previous tick (via the
  injected `now`), advances `currentTimeMs` by that delta, clamps to
  `[0, timeline.totalDurationMs]`, calls
  `evaluateProjectTimeline(timeline, currentTimeMs)`, and notifies every
  subscriber with the resulting frame and time. Reaching
  `totalDurationMs` calls `pause()` automatically (no looping in 4a — the
  PRD does not ask for it, and adding it would be scope creep for a
  preview screen).
- `pause()` cancels the pending animation frame; `currentTimeMs` stays put.
- `seek(timeMs)` clamps, sets `currentTimeMs` directly, evaluates once, and
  notifies subscribers — without starting or requiring the RAF loop. This
  is what the preview's scrub bar calls on drag.
- `subscribe` supports multiple listeners because 4a has at least two
  independent renderers reacting to the same frame: `PreviewStage` (visual)
  and the scrub bar's playhead position (UI). Returns an unsubscribe
  function, matching the Zustand/observer idiom already used in
  `projectStore`.
- `destroy()` cancels any pending frame and clears listeners — called from
  the owning component's cleanup effect, mirroring `CesiumViewerHandle`.

## `src/media/videoMetadata.ts`

```ts
export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
}

export async function extractVideoMetadata(
  file: File | Blob,
  loadMetadata: (file: File | Blob) => Promise<VideoMetadata> = defaultLoadMetadata,
): Promise<VideoMetadata>
```

`defaultLoadMetadata` creates a detached `<video>` element, sets its `src`
via `URL.createObjectURL(file)`, waits for the `loadedmetadata` event (or
rejects on the `error` event), reads `duration`/`videoWidth`/`videoHeight`,
and revokes the object URL in a `finally`. Deferred out of Phase 3
specifically because nothing needed it until interior video import; used by
`createInteriorItems` (see below) to set each video item's initial
`durationMs` before the user ever opens Studio to trim it.

## `src/persistence/templates.ts`

```ts
export function createMapSceneFromTemplate(destination: Destination): MapScene
```

Encodes the PRD's built-in "Standard Local Business Fly-In" template as a
fixed sequence of destination-relative `Waypoint`s (Earth → Region → Metro →
City → Neighborhood → Business) using the PRD's suggested default timings
(Earth hold 1000ms; Region/Metro/City/Neighborhood/Business travel 1500/
1400/1300/1300/1800ms; Business hold 600ms), each `travelDurationLocked:
false, holdDurationLocked: false` (all user-adjustable later in Studio) and
`easing: 'cinematic'`. Every waypoint after the first is
`type: 'destination-relative'`, computed relative to the passed-in
`Destination`'s coordinates (or `null` coordinates when the destination has
none yet — see "No-GPS handling" below); waypoint zero (Earth) is
`type: 'absolute'` with a fixed global overview `CameraState`, matching the
model rule that "waypoint zero has no incoming travel." This is the *only*
template Phase 4a ships — user-saved/custom templates are Phase 6.

## `src/quickCreate/createDraft.ts`

```ts
export interface CreateDraftInput {
  storefrontPhoto: File;
  interiorMedia: File[];
  destinationOverride?: Destination; // set when the no-GPS fallback UI already resolved one
}

export interface CreateDraftDependencies {
  mediaStore: MediaAssetStore;                    // Phase 1, default: createMediaAssetStore()
  extractImageMetadata: typeof extractImageMetadata;       // Phase 3, default: the real function
  extractVideoMetadata: typeof extractVideoMetadata;       // this phase, default: the real function
  resolveFromPhotoGps: typeof resolveFromPhotoGps;         // Phase 3, default: the real function
  isHeic: typeof isHeic;                                   // Phase 3, default: the real function
  convertHeicToJpeg: typeof convertHeicToJpeg;             // Phase 3, default: the real function
}

export async function createDraft(
  input: CreateDraftInput,
  deps?: Partial<CreateDraftDependencies>, // each field defaults independently to its real implementation
): Promise<Project>
```

Implements the PRD's `createDraft` algorithm using already-built services:
imports the storefront photo through Phase 1's `MediaAssetStore`, extracts
its metadata via Phase 3's `extractImageMetadata`, resolves a `Destination`
via `resolveFromPhotoGps` when GPS is present and `input.destinationOverride`
was not already supplied by the no-GPS fallback UI, builds the `MapScene`
via `createMapSceneFromTemplate`, builds a default `StorefrontScene` (no
door-target selection required — `entranceTarget` omitted, `motionPreset:
'push-in'`, default transitions), imports each interior media file (photos
through the existing image pipeline including HEIC conversion, videos
through `extractVideoMetadata` for initial duration), and applies default
ordering (import order), default photo motion (`push-in`, matching the
storefront default), and default transitions (crossfade) across the
interior items — mirroring the plan's reference algorithm's
`applyDefaultInteriorOrdering`/`applyDefaultPhotoMotion`/
`applyDefaultTransitions` steps as three small internal functions in this
same file, each independently testable. The resulting `Project` is *not*
saved by this function — the caller (the Quick Create wizard component)
saves it via `projectRepository.saveProject`, keeping `createDraft` a pure
data-producing function with no persistence side effect, consistent with
Phase 1's repository owning all writes.

**No-GPS handling:** when `extractImageMetadata` yields no coordinates and
no `destinationOverride` was supplied, `createDraft` throws a typed
`NoDestinationError` rather than silently falling back — the wizard catches
this and presents the fallback UI (see below), then re-invokes `createDraft`
with `destinationOverride` set once the user resolves one. This keeps the
fallback decision a UI concern, matching Phase 3's resolver design principle
that `resolveFromDeviceLocation`/`resolveFromAddress` are only ever invoked
by an explicit user action, never automatically.

## `src/components/quick-create/`

Two-step wizard, mobile-friendly (per the PRD's Quick Create mode):

- `StorefrontStep.tsx` — file input (`capture="environment"` on mobile,
  matching "take/select photo"), shows a thumbnail once selected, "Next"
  button.
- `NoDestinationFallback.tsx` — shown only when `createDraft` throws
  `NoDestinationError`. Three options per the PRD: "Use Current Location"
  (calls `resolveFromDeviceLocation`, the first point in this entire flow
  that triggers a permission prompt — matching Phase 3's explicit-action
  requirement), "Enter Address" (text field, calls `resolveFromAddress`),
  "Pick on Map" (renders the same `CesiumViewerHandle` in a click-to-pick
  mode: a click handler using `viewer.scene.pickPosition` /
  `viewer.camera.pickEllipsoid`, converted to `Cesium.Cartographic`, then
  `Cesium.Math.toDegrees` on `longitude`/`latitude`, calling `resolveManual`
  — reusing the Cesium viewer rather than a second mapping widget or
  library, since Cesium is already loaded and Google Maps/Mapbox are
  explicitly disallowed). Does not discard the storefront photo on any
  path, per the PRD.
- `InteriorTourStep.tsx` — multi-file input (photos and/or videos, mixed),
  thumbnail list in import order (no drag-reorder — 4b), "Create Draft"
  button. Interior media is optional — the PRD's "Quick Create Without
  Interior" case: an empty `interiorMedia` array is valid, `createDraft`
  produces a `Project` with just `MapScene` + `StorefrontScene`.
- `QuickCreateWizard.tsx` — owns the two-step state, invokes `createDraft`,
  handles `NoDestinationError` by showing the fallback, saves the resulting
  `Project` via `projectRepository`, and on success navigates to the
  preview screen (`PreviewStage` from `src/components/preview/`, showing
  the just-created project via `PlaybackController`).

## `src/components/preview/`

- `PreviewStage.tsx` — owns a `PlaybackController` instance (constructed
  from `compileProjectTimeline(project)`), a `CesiumViewerHandle`, and
  subscribes to the controller. On each `EvaluatedFrame`: any layer whose
  `kind` is `'map-hold'` or `'map-travel'` calls `applyCameraState` on the
  Cesium viewer (kept mounted/visible); any layer whose `kind` is
  `'storefront'` or `'photo'` renders an `<img>` positioned absolutely over
  the Cesium canvas with the layer's `VisualTransform` applied as a CSS
  `transform` and the layer's `opacity` as CSS `opacity` (for crossfades);
  any `'video'` layer renders an `<video>` element whose `currentTime` is
  set to the layer's item-local time (accounting for trim start and
  playback rate, matching the PRD's "Video Preview" section) and whose
  `opacity`/transform are applied the same way; a `'black'` layer renders
  an opaque overlay div. Layers not matching the current frame are
  unmounted/hidden, not merely `display: none`, to avoid video elements
  continuing to decode off-screen.
- `PlaybackControls.tsx` — play/pause button and a scrub bar (`<input
  type="range">` bound to `timeline.totalDurationMs`, calling
  `controller.seek` on drag) — Lucide `Play`/`Pause` icons. This is
  intentionally minimal; the full Studio scrub/inspector experience is 4b.

## Testing (Vitest, `environment: 'node'`)

- **playbackController.ts**: play advances `currentTimeMs` by injected
  `now()` deltas across multiple frames; pause stops advancing and a
  subsequent play resumes from the paused time (not from 0); seek updates
  `currentTimeMs` and notifies subscribers without requiring `play()`;
  reaching `totalDurationMs` auto-pauses; multiple subscribers all receive
  each notification; `destroy()` stops future notifications and cancels
  the pending frame (assert via the injected `cancelAnimationFrame` spy).
- **videoMetadata.ts**: successful metadata extraction via injected
  `loadMetadata`; the real `defaultLoadMetadata`'s error path is exercised
  through an injected implementation that simulates the `error` event
  firing, confirming the promise rejects rather than hanging.
- **templates.ts**: `createMapSceneFromTemplate` produces the correct
  waypoint count, names, `type` discriminants (waypoint zero absolute, rest
  destination-relative), and the PRD's exact default timing values; passing
  a `Destination` with `null` coordinates still produces a valid
  (destination-relative, unresolved-until-later) `MapScene`.
- **createDraft.ts**: full happy path with a photo-GPS destination and mixed
  interior media (photo + video) via injected dependencies, asserting the
  produced `Project` validates against `ProjectSchema`; `NoDestinationError`
  thrown when GPS is absent and no override is supplied; `destinationOverride`
  bypasses photo-GPS resolution entirely; empty `interiorMedia` produces a
  valid two-scene `Project` (no Interior Tour scene); default ordering,
  motion, and transitions are applied correctly to interior items.
- **applyCameraState.ts**: given the DI boundary is Cesium itself (not
  wrapped), this function is exercised via a minimal fake object shaped like
  the subset of `Cesium.Viewer` it touches (`camera.setView` spy), asserting
  the degrees-to-radians conversion and the `Cartesian3.fromDegrees` call
  arguments are correct — not a full Cesium integration test, but enough to
  catch a unit/sign error in the translation math without needing a real
  WebGL context.
- **Cesium viewer/imagery, React components**: not unit-tested (no jsdom in
  this project, per the Phase 3 precedent of leaving real-DOM/real-Cesium
  paths to manual and production-build verification). Verified by running
  `npm run dev` and exercising the full Quick Create flow in a real browser,
  plus `npm run build` + serving the production build to confirm the globe
  renders and Cesium's static assets resolve correctly (the PRD's explicit
  "verify `npm run build` and verify the production build renders the
  globe" requirement).

## Out of Scope for Phase 4a

Manual waypoint capture/replace/goto, the Studio editor, the full timeline
UI, inspectors, drag-reorder (all 4b). The output compositor, canvas
capture, `MediaRecorder`-based export, audio routing (Phase 5). User-saved/
custom templates, bulk edit, media relinking, README polish (Phase 6).
Video looping during preview playback. Terrain/3D buildings (PRD non-goal).

## Acceptance Criteria

- All new Vitest suites (`playbackController`, `videoMetadata`, `templates`,
  `createDraft`, `applyCameraState`) pass.
- `npm run build` succeeds and the production build, when served, renders
  the Cesium globe with USGS imagery.
- `cesium`, `lucide-react` are new runtime `dependencies`;
  `vite-plugin-cesium` is a new `devDependency`. No other new dependencies.
- Manually exercising the full flow in a dev-server browser session works
  end-to-end: select/take a storefront photo → (GPS present: skip to
  interior step; GPS absent: resolve via one of the three fallbacks,
  including "Pick on Map" against the live Cesium globe) → add interior
  photos/videos (or none) → "Create Draft" → project is saved
  (`projectRepository`) → preview screen plays, pauses, and scrubs the
  resulting timeline correctly, including the map fly-in, the storefront
  photo, and any interior photos/videos in sequence.
