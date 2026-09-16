# Phase 2: Timeline Engine Core — Design Spec

Date: 2026-09-16
Status: Approved for implementation planning

## Context

Local Fly-In Studio's full product scope is defined in:

- `../../../Local-Fly-In-Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up)
- `../../../Claude Code Build Prompt — Local-Fly-In-Studio v3.0.md`

The project is decomposed into six phases. Phase 1 (Foundation — scaffold,
Zod data model, OPFS/IndexedDB persistence) is complete and merged to
`main`. This spec covers Phase 2: the deterministic timeline engine that
compiles a `Project`'s scene hierarchy into a flat timeline and answers
"what is visible at time T" for any T — the architectural backbone the
PRD calls out as fundamental (build prompt, "IMPORTANT TIMELINE RULE").

Remaining phases after this one: Phase 3 (media ingestion + destination
resolution), Phase 4 (Cesium map + Quick Create/Studio UI + playback),
Phase 5 (compositor + export), Phase 6 (templates, bulk edit, relinking,
polish, README).

## Goal

Pure, dependency-free TypeScript modules that:
1. Compile a `Project` (as modeled in `src/models/project.ts` and
   `src/models/scenes.ts` from Phase 1) into a flat `CompiledTimeline` of
   renderable segments with absolute start/end times, correctly accounting
   for crossfade overlap between adjacent items.
2. Evaluate that compiled timeline at any arbitrary `timeMs`, returning
   exactly what should be visible (one layer normally, two during a
   crossfade) with interpolated camera/transform state.
3. Support "fit to duration" scaling that respects locked durations and
   never silently shortens video clips.

No Cesium, no rendering, no React, no UI. Everything is testable with
plain Vitest. Phase 4 will consume this engine's evaluator to drive an
actual `requestAnimationFrame` playback loop and a Cesium viewer; this
phase only has to prove the math and data flow are correct.

## Design Decision: Camera Interpolation Without Cesium

The build prompt says camera interpolation should "use Cesium
geographic/geodesic utilities where appropriate," but Phase 2 is scoped to
exclude Cesium (that arrives in Phase 4). The underlying requirement —
"do not interpolate Cartesian coordinates through the Earth" — is
satisfied by implementing geographic surface interpolation as pure
spherical/great-circle math (haversine-based slerp) instead of Cartesian
lerp. This keeps Phase 2 dependency-free and fully unit-testable. Phase 4
feeds this same interpolator real waypoint data; it does not need to
reimplement the math, though it may later choose to swap in Cesium's own
`EllipsoidGeodesic` as an internal optimization without changing the
public interpolation function's signature.

## Data Structures (`src/models/timeline.ts`)

```ts
type SegmentKind = 'map-hold' | 'map-travel' | 'storefront' | 'photo' | 'video' | 'black';

interface TimelineSegment {
  id: string;
  sourceType: 'map' | 'image' | 'video';
  sourceId: string;          // assetId for image/video; 'map' for map segments
  sectionId: string;         // the owning scene's id
  itemId?: string;           // for interior tour items
  kind: SegmentKind;
  startMs: number;           // absolute project time
  endMs: number;             // absolute project time (may overlap next segment's startMs during a crossfade)
  transitionIn?: Transition; // crossfade/fade-black/cut into this segment
  transitionOut?: Transition;

  // kind === 'map-hold' | 'map-travel'
  fromWaypoint?: Waypoint;
  toWaypoint?: Waypoint;     // absent for map-hold

  // kind === 'storefront' | 'photo'
  startTransform?: VisualTransform;
  endTransform?: VisualTransform;
  motionPreset?: StorefrontMotionPreset | PhotoMotionPreset;

  // kind === 'video'
  trimStartMs?: number;
  trimEndMs?: number;
  playbackRate?: number;
  fitMode?: FitMode;
  audioEnabled?: boolean;
}

interface CompiledTimeline {
  segments: TimelineSegment[];   // sorted by startMs
  totalDurationMs: number;
  sections: Array<{ id: string; type: 'map' | 'storefront' | 'interior-tour'; startMs: number; endMs: number }>;
}

interface EvaluatedLayer {
  sourceType: 'map' | 'image' | 'video';
  sourceId: string;
  localTimeMs: number;
  opacity: number;
  transform?: VisualTransform;   // for image/storefront layers
  camera?: CameraState;          // for map layers
}

interface EvaluatedFrame {
  projectTimeMs: number;
  layers: EvaluatedLayer[];      // one normally, two during a crossfade
  activeSectionId: string;
  activeItemId?: string;
}
```

`Waypoint`, `CameraState`, `VisualTransform`, `Transition`,
`StorefrontMotionPreset`, `PhotoMotionPreset`, `FitMode` are all imported
from Phase 1's `src/models/scenes.ts` — no redefinition.

## Easing (`src/timeline/easing.ts`)

Five pure functions, one per `EasingPreset`, each `(t: number) => number`
mapping `[0,1] → [0,1]`:

- `linear`: identity.
- `accelerate`: `t => t * t` (ease-in quadratic).
- `decelerate`: `t => 1 - (1 - t) * (1 - t)` (ease-out quadratic).
- `smooth`: standard smoothstep, `t => t * t * (3 - 2 * t)`.
- `cinematic`: ease-in-out cubic, `t => t < 0.5 ? 4 * t³ : 1 - (-2t + 2)³ / 2`.

`getEasingFunction(preset: EasingPreset): (t: number) => number` is the
lookup entry point.

## Camera Interpolation (`src/timeline/cameraInterpolation.ts`)

```ts
function interpolateCameraState(
  from: CameraState,
  to: CameraState,
  t: number,               // already eased, in [0,1]
): CameraState
```

- **Surface position** (longitude/latitude): great-circle slerp using
  haversine-derived angular distance. When `from` and `to` are the same
  point (or antipodal, a degenerate case), fall back to linear
  interpolation to avoid division by zero.
- **Height**: linear interpolation.
- **Heading**: shortest angular path — normalize the delta into
  `(-180, 180]` before interpolating, so `350° → 10°` moves through `360°`
  (a 20° rotation) rather than backward through `180°`.
- **Pitch, roll**: linear interpolation (no wraparound concerns — pitch is
  bounded, roll rarely spans a full circle in this app's use case).

`t` is expected to already be eased (the caller applies the waypoint's
`EasingPreset` before calling this function) — this function only does
spatial interpolation, not timing.

## Timeline Compiler (`src/timeline/compiler.ts`)

```ts
function compileProjectTimeline(project: Project): CompiledTimeline
```

Walks `project.scenes` in order (Map → Storefront → Interior Tour, per the
fixed section order established in Phase 1's model — scene order in the
array is authoritative, not hardcoded by scene type, but the default
template always produces this order):

1. **MapScene**: waypoint 0 has no incoming travel (per PRD §17) — it
   contributes only a `map-hold` segment for its `holdDurationMs`. Each
   subsequent waypoint contributes a `map-travel` segment
   (`travelDurationMs`, referencing the previous and current waypoint) and
   its own `map-hold` segment (`holdDurationMs`, possibly zero).
2. **StorefrontScene**: one `storefront` segment of `durationMs`.
3. **InteriorTourScene**: one segment per item (`photo` or `video`), each
   sized by `durationMs` (photo) or effective duration
   `(trimEndMs - trimStartMs) / playbackRate` (video, per PRD §29 "VIDEO
   DURATION").

**Crossfade overlap** (PRD §34): when consecutive segments (across scene
boundaries too — e.g. Storefront → first Interior item) are joined by a
`crossfade` transition of duration `d`, the incoming segment's `startMs`
is set to `d` milliseconds before the outgoing segment's natural `endMs`,
and the outgoing segment's `endMs` is extended to its natural end (i.e.
segments overlap by `d` ms; total combined span is
`durationA + durationB - d`, matching the PRD's example exactly). `cut`
transitions have zero overlap. `fade-black` is modeled as two sequential
zero-overlap segments with a synthetic short "black" gap segment between
them (kind `'black'`, `sourceType: 'image'`, `sourceId: '__black__'`) —
simplest maintainable approach that keeps the evaluator's segment-lookup
logic uniform.

`sections` in the returned `CompiledTimeline` records each top-level
scene's aggregate `[startMs, endMs)` span, used by the evaluator to
populate `activeSectionId` and by the UI (Phase 4) for the collapsed
timeline view (PRD §39).

## Master Evaluator (`src/timeline/evaluator.ts`)

```ts
function evaluateProjectTimeline(timeline: CompiledTimeline, timeMs: number): EvaluatedFrame
```

1. Clamp `timeMs` to `[0, timeline.totalDurationMs]`.
2. Find all segments whose `[startMs, endMs)` contains `timeMs` — normally
   one, two during a crossfade overlap window.
3. For each active segment, compute `localTimeMs = timeMs - segment.startMs`
   and a normalized `t = localTimeMs / (segment.endMs - segment.startMs)`.
4. For `map-hold`/`map-travel` segments: apply the waypoint's easing to
   `t`, then call `interpolateCameraState` (travel) or return the held
   waypoint's camera directly (hold, `t` unused for interpolation).
5. For `storefront`/`photo` segments: apply the item's easing (defaulting
   to `linear` if the transform itself has no explicit easing — Phase 1's
   model doesn't carry a per-transform easing field, so this always uses
   linear unless a later phase adds one) to interpolate `VisualTransform`
   between `startTransform` and `endTransform`.
6. For `video` segments: `localTimeMs` maps directly to
   `trimStartMs + localTimeMs * playbackRate` — no easing, video plays at
   its own rate.
7. **Opacity**: outside any overlap window, `opacity = 1`. Inside a
   crossfade overlap, the outgoing layer's opacity fades `1 → 0` and the
   incoming layer's fades `0 → 1` linearly across the overlap window
   (crossfade opacity itself is not subject to the segment's own easing
   preset — easing applies to camera/transform motion, not transition
   opacity, matching how professional NLEs separate the two).
8. `activeSectionId` / `activeItemId` are read from whichever segment's
   `sectionId`/`itemId` corresponds to `timeMs` under the "current"
   (later-starting, i.e. primary) layer when two are active.

This is the only function that computes timing; nothing else (including a
future playback controller) duplicates this logic — it only calls this
function on a tick or a seek.

## Timeline Scaling (`src/timeline/scaling.ts`)

```ts
class TimelineScalingError extends Error {
  constructor(message: string, readonly requestedMs: number, readonly minimumPossibleMs: number) { super(message); }
}

function fitMapToDuration(mapScene: MapScene, targetMs: number): MapScene
function fitInteriorTourToDuration(tourScene: InteriorTourScene, targetMs: number): InteriorTourScene
function fitProjectToDuration(project: Project, targetMs: number): Project
```

Each function:
1. Sums the locked durations in scope (map: locked `travelDurationMs` +
   `holdDurationMs`; interior tour: locked photo `durationMs` + all video
   effective durations, since video is never touched).
2. If `lockedSum >= targetMs`, throws `TimelineScalingError` with a clear
   message and the computed `minimumPossibleMs`, per PRD §19 ("display a
   clear error").
3. Otherwise, distributes `targetMs - lockedSum` proportionally across the
   unlocked durations in scope, preserving their relative ratios (so a
   waypoint that was already twice as long as another stays twice as long
   after scaling).
4. Returns a new `MapScene`/`InteriorTourScene`/`Project` — these
   functions are pure, they do not mutate their input, matching the rest
   of the codebase's Zod-model-as-plain-data convention.

`fitProjectToDuration` composes the other two. Let `currentTotalMs` be the
project's current total duration (from compiling it), and
`currentMapPlusStorefrontMs` the current combined Map+Storefront duration.
It computes
`targetMapPlusStorefrontMs = targetMs * (currentMapPlusStorefrontMs / currentTotalMs)`
and `targetInteriorTourMs = targetMs - targetMapPlusStorefrontMs` —
i.e. the project-wide target is split between the two spans in the same
proportion they currently occupy, before each span is fit independently.
Within the Map+Storefront split, Storefront's own duration is treated as
unlocked-by-default (it has no separate "fit" function of its own since
it's a single scalar; it is scaled directly unless `durationLocked`, with
the remainder after any Storefront lock going to `fitMapToDuration`).

## Testing (Vitest)

- **Easing**: boundary values (`f(0) === 0`, `f(1) === 1`) and monotonic
  shape checks for all five presets.
- **Camera interpolation**: heading wraparound (`350° → 10°` takes the 20°
  path, not 340°); surface slerp midpoint lies between the two points
  geodesically (not the Cartesian midpoint, which would cut through the
  Earth for antipodal-ish points); height/pitch/roll linear interpolation;
  degenerate same-point case.
- **Compiler**: waypoint-zero-has-no-travel; total duration matches sum of
  travel+hold; crossfade overlap arithmetic matches the PRD's worked
  example (`4 + 4 - 0.5 = 7.5s`); cut has zero overlap; mixed photo/video
  interior tour ordering preserved; video effective-duration math.
- **Evaluator**: exact segment boundaries; mid-segment interpolation;
  mid-crossfade (two layers, opacities sum sensibly, both layers'
  `localTimeMs` correct); arbitrary seek anywhere in a multi-scene
  project resolves to the correct `activeSectionId`.
- **Scaling**: proportional redistribution with mixed locked/unlocked;
  impossible-target throws `TimelineScalingError` with correct
  `minimumPossibleMs`; video durations never altered by any scaling call.

Directly seeds PRD §69 test-list items 1–14 (map timeline creation, map
total duration, waypoint timing, timing locks, timeline scaling, easing,
heading interpolation, storefront transform interpolation, interior photo
duration, video effective duration, mixed ordering, crossfade overlap
math, nested timeline compilation, project seek/evaluation).

## Out of Scope for Phase 2

Cesium, any canvas/DOM rendering, React components, the playback
controller (`requestAnimationFrame` loop — Phase 4), `MediaAssetStore`/
persistence integration (the compiler takes a plain in-memory `Project`,
it does not load one), export/compositor (Phase 5).

## Acceptance Criteria

- All new Vitest suites (easing, cameraInterpolation, compiler, evaluator,
  scaling) pass.
- `npm run build` succeeds.
- No new runtime dependencies added to `package.json` — this phase is
  pure TypeScript over Phase 1's existing Zod models.
