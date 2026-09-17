# Phase 4b: Studio Desktop Editor — Design Spec

Date: 2026-09-17
Status: Approved for implementation planning

## Context

Local Fly-In Studio's full product scope is defined in:

- `../../../Local Fly-In Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up)
- `../../../Claude Code Build Prompt — Local Fly-In Studio v3.0.md`

Phases 1-3 and 4a are complete and merged: data model/persistence, the
timeline engine (compiler/evaluator/easing/camera interpolation/scaling),
media ingestion/destination resolution, and the Cesium viewer + Quick
Create flow (`PlaybackController`, `PreviewStage`, `createDraft`, the
built-in map template). This spec covers Phase 4b: the Studio desktop
editor — manual waypoint capture/editing, the timeline UI, per-element
inspectors, drag-reorder for interior media, and timeline-scaling
controls. Both product modes edit the same `Project` model; Studio adds
no new persisted fields, only UI to edit the ones Phase 1 already defined.

Remaining phases after this one: Phase 5 (compositor + export), Phase 6
(user-saved templates, bulk edit, media relinking, polish, README).

## Goal

1. An entry point into Studio: a "Fine-tune in Studio" button after Quick
   Create's preview, and a minimal project list (reusing Phase 1's
   `listProjects`) for reopening any previously saved project.
2. A timeline UI — collapsed three-section strip, expandable per-section
   into sub-blocks (map waypoints; interior tour items) — that doubles as
   both a selection mechanism (driving an inspector panel) and a scrub
   mechanism (clicking a block seeks the existing `PlaybackController`).
3. Manual waypoint editing: Capture Current View, Replace Selected
   Waypoint, Go To Waypoint — reusing/extending Phase 4a's Cesium viewer
   and camera-state translation.
4. Per-element inspectors: waypoint (name/durations/easing), storefront
   (duration/motion/transitions/Set Door Target), interior photo
   (duration/motion/transition), interior video (trim/playback
   rate/audio/fit mode/transition).
5. Drag-reorder for interior tour items, via `dnd-kit` (first use in this
   project).
6. Timeline-scaling controls wired to Phase 2's already-existing pure
   functions (`fitMapToDuration`/`fitInteriorTourToDuration`/
   `fitProjectToDuration`).
7. An explicit Save action, matching the PRD's workflow listing "save
   project" as its own step.

No bulk-edit operations (Apply to All / Regenerate Photo Motion — Phase
6), no add/remove waypoint (the PRD names only Capture/Replace/Go To as
waypoint operations), no compositor/export, no templates management, no
media relinking.

## New Dependency

- `dnd-kit` (`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`)
  — named in the project's tech stack, first needed now for interior-item
  drag-reorder.

## Design Decision: A Separate `uiStore` for Transient Selection/Expansion State

Studio needs UI state that isn't durable project data: what's currently
selected (driving which inspector renders) and which timeline section is
expanded. This lives in a new `src/store/uiStore.ts` (Zustand), separate
from `projectStore`, matching the file organization the build prompt
itself suggests (`store/projectStore.ts` + `store/uiStore.ts`). Keeping it
separate means opening/closing Studio never needs to touch project data,
and any component (timeline blocks, inspectors) can read/set selection
without prop-drilling through the whole Studio tree.

```ts
export type StudioSelection =
  | { type: 'waypoint'; sceneId: string; waypointId: string }
  | { type: 'storefront'; sceneId: string }
  | { type: 'interior-item'; sceneId: string; itemId: string }
  | null;

export type ExpandedSection = 'map' | 'interior-tour' | null;

interface UiStoreState {
  selection: StudioSelection;
  expandedSection: ExpandedSection;
  select: (selection: StudioSelection) => void;
  toggleExpanded: (section: 'map' | 'interior-tour') => void;
}
```

`toggleExpanded('map')` sets `expandedSection` to `'map'` if it wasn't
already, or back to `null` if it was — only one section is expanded at a
time, matching the PRD's simple collapsed/expanded toggle (not an
accordion of independently-expandable sections).

## Design Decision: Save Is Explicit, Not Automatic

Studio edits mutate `projectStore`'s `currentProject` in memory
immediately (so the preview reflects changes live, matching "seeking must
update preview immediately" applied to editing too), via a new
`updateProject: (updater: (project: Project) => Project) => void` action
added to `useProjectStore`. Persisting to IndexedDB happens only when the
user clicks **Save**, calling the store's existing `saveProject()` action
(Phase 1). This matches the PRD's workflow explicitly listing "save
project" as its own distinct step rather than implying autosave. Studio
tracks a local `isDirty` flag (true after any `updateProject` call, reset
on successful save) to enable/disable the Save button and warn before
navigating away with unsaved changes (a `window.confirm`, not a custom
modal — simplest maintainable choice for an MVP-level warning).

## `src/cesium/captureCameraState.ts`

```ts
export function captureCameraState(viewer: Viewer): CameraState
```

The inverse of Phase 4a's `applyCameraState`: reads `viewer.camera`'s
current `positionCartographic` (longitude/latitude in radians, height in
meters) and `heading`/`pitch`/`roll` (radians), converts to the degrees
`CameraState` the rest of the app uses via `Cesium.Math.toDegrees`. Not
DI-wrapped at the unit-test level — same precedent as `applyCameraState`:
tested by mocking the `cesium` module entirely (`vi.mock('cesium', ...)`)
and passing a minimal fake object shaped like the subset of `Viewer` this
function touches, asserting the radians-to-degrees conversion math is
correct.

## `src/timeline/waypointEditing.ts`

```ts
export function replaceWaypointCamera(waypoint: Waypoint, camera: CameraState): Waypoint
```

Returns a new `Waypoint` with `type: 'absolute'` and `camera` set to the
given `CameraState`, preserving `id`/`name`/`travelDurationMs`/
`holdDurationMs`/`travelDurationLocked`/`holdDurationLocked`/`easing` from
the input — dropping any `relativeCamera`. A destination-relative
waypoint that gets "Replace Selected Waypoint"'d becomes absolute: a
freely-navigated captured camera position is inherently an absolute
position, not one defined relative to the destination, so there is no
meaningful way to keep it destination-relative after a manual override.
This mirrors (but is distinct from) Phase 4a's `resolveWaypointCamera`
inside `compiler.ts` — that one is an automatic, compile-time, read-only
resolution; this one is a manual, permanent, user-initiated edit.

```ts
export function computeDoorTargetTransform(
  current: VisualTransform,
  normalized: { x: number; y: number },
): VisualTransform
```

Returns `{ ...current, centerX: clamp(normalized.x, 0, 1), centerY:
clamp(normalized.y, 0, 1) }` — repositions the transform's target point,
keeping its existing `scale`/`rotation` unchanged. Used for "Set Door
Target": the PRD says only "create an appropriate endTransform around
that normalized point," and keeping the current scale is the simplest
maintainable interpretation — the user can still adjust scale separately
via the storefront inspector's existing duration/motion fields (motion
preset governs the push/pull effect; this function only repositions where
it's centered on).

Both functions are pure, dependency-free, and fully unit-testable.

## Modification: `src/components/preview/PreviewStage.tsx`

Add one optional prop:

```ts
interface PreviewStageProps {
  project: Project;
  onOverlayClick?: (normalized: { x: number; y: number }, layer: EvaluatedLayer) => void;
}
```

When present, an `onClick` handler is attached to the rendered `<img>`
element (not `<video>` — door-target-setting is a storefront-photo-only
operation) for each active image-kind overlay layer. The handler computes
normalized coordinates from the click event's `currentTarget
.getBoundingClientRect()` and `event.clientX`/`clientY`, then calls
`onOverlayClick(normalized, layer)`. Quick Create's existing usage
(`<PreviewStage project={project} />`, no prop) is unaffected — this is
purely additive. Studio passes a handler that checks whether the clicked
layer is the currently-selected storefront scene's asset before acting
(so clicking during interior-tour playback does nothing), calls
`computeDoorTargetTransform`, and updates the project via
`updateProject`.

## Timeline UI (`src/components/timeline/`)

- `TimelineStrip.tsx` — the collapsed three-section view
  `[ MAP FLY-IN ] [ STOREFRONT ] [ INTERIOR TOUR ]`, each section's
  duration read from `compileProjectTimeline(project).sections` (already
  built, Phase 2). Clicking "Storefront" calls `uiStore.select({type:
  'storefront', sceneId})` directly. Clicking "Map Fly-In" or "Interior
  Tour" calls `uiStore.toggleExpanded(...)`; when expanded, the
  corresponding block-strip component renders beneath it.
- `WaypointBlocks.tsx` — renders when the map section is expanded: one
  block per `MapScene.waypoint`, width proportional to that waypoint's
  `travelDurationMs + holdDurationMs` relative to the map section's total.
  Clicking a block calls `uiStore.select({type: 'waypoint', sceneId,
  waypointId})` AND `controller.seek(...)` to that waypoint's segment
  start time (looked up from the compiled timeline's segments by
  matching `fromWaypoint?.id`/`toWaypoint?.id` — see Testing below for
  how this lookup is verified). No drag-reorder here (map waypoints keep
  the template's fixed sequence in this phase).
- `InteriorItemBlocks.tsx` — renders when the interior-tour section is
  expanded: one block per `InteriorTourScene.item`, width proportional to
  its effective duration (`durationMs` for photos,
  `(trimEndMs-trimStartMs)/playbackRate` for videos — the same formula
  `compiler.ts` already uses internally). Clicking a block selects it
  (`{type: 'interior-item', sceneId, itemId}`) and seeks to its segment
  start. Wrapped in `dnd-kit`'s `DndContext`/`SortableContext`; each block
  is a `useSortable` item. On drop, reorders `InteriorTourScene.items` via
  `updateProject` — transitions stay attached to their own item (each
  item's `transitionToNext` describes "my transition to whatever comes
  after me," so reordering the array naturally recomputes which pairwise
  transition applies where; no special-case handling needed, matching how
  `compiler.ts`'s `buildInteriorTourUnits` already reads
  `scene.items[index-1].transitionToNext`).

`PlaybackController` and its `seek` already exist (Phase 4a) — the
timeline UI is a second, richer way to invoke `seek`, not a new playback
mechanism, keeping the PRD's "one evaluator drives every mode" rule intact.

## Inspectors (`src/components/inspectors/`)

- `WaypointInspector.tsx` — shown when `uiStore.selection.type ===
  'waypoint'`. Fields: name (text), travel duration + locked toggle, hold
  duration + locked toggle, easing preset (dropdown of the 5
  `EasingPreset` values). Buttons, each self-contained (no multi-click
  dependency between them, so a stale captured value can never be applied
  to the wrong waypoint if the user changes selection between clicks):
  **Capture Current View** calls `captureCameraState` on the live Cesium
  viewer (see "Viewer Access" below) and displays the resulting
  longitude/latitude/height/heading/pitch/roll as read-only text in the
  inspector — an inspection tool, not a commit; it applies nothing.
  **Replace Selected Waypoint** does its own internal
  `captureCameraState` call at click-time, then `replaceWaypointCamera`,
  then `updateProject`s the map scene's matching waypoint in one atomic
  action. **Go To Waypoint** resolves the selected waypoint's camera —
  direct if `type === 'absolute'`, via `resolveRelativeCameraState
  (waypoint.relativeCamera, project.destination)` if
  `'destination-relative'` — and calls `applyCameraState` on the live
  viewer; if resolution returns `null`, the button is disabled, though in
  practice every project's destination is resolved by the time it exists
  per Phase 4a's `createDraft` guarantee, so this is a defensive-only
  branch.
- `StorefrontInspector.tsx` — shown when `selection.type === 'storefront'`.
  Fields: duration + locked, motion preset (dropdown of the 6
  `StorefrontMotionPreset` values), transition in/out (type + duration
  each). No explicit "Set Door Target" button — the instruction text
  reads "click the storefront image in the preview while this scene is
  selected," and the click is wired via `PreviewStage`'s new
  `onOverlayClick` prop (see above).
- `InteriorPhotoInspector.tsx` — shown when `selection.type ===
  'interior-item'` and the matching item's `type === 'photo'`. Fields:
  duration + locked, motion preset (dropdown of the 4 `PhotoMotionPreset`
  values), transition-to-next (type + duration).
- `InteriorVideoInspector.tsx` — shown when the matching item's `type ===
  'video'`. Fields: trim start/end (ms), playback rate (number, > 0),
  audio enabled (toggle), fit mode (`cover`/`contain` dropdown),
  transition-to-next.
- `ScalingControls.tsx` — always visible (not selection-dependent): a
  duration input plus three buttons — **Fit Map Fly-In**, **Fit Interior
  Tour**, **Fit Full Project** — each calling the matching Phase 2
  function (`fitMapToDuration`/`fitInteriorTourToDuration`/
  `fitProjectToDuration`) inside a `try`/`catch`. On success,
  `updateProject`s the result. On a caught `TimelineScalingError`,
  displays its `.message` (already a complete, specific string per Phase
  2's implementation — e.g. "Cannot fit map fly-in to 5000ms: locked
  durations alone total 8000ms.") rather than a generic failure message,
  satisfying the PRD's "if target is impossible, show a useful error."

**Viewer Access:** `WaypointInspector`'s Capture/Go To buttons need the
live `Cesium.Viewer` instance that `PreviewStage` privately owns
(`viewerHandleRef.current.viewer`, never previously exposed outside that
component). Add one more optional prop to `PreviewStage`:
`onViewerReady?: (viewer: Viewer) => void`, called once from the existing
viewer-creation `useEffect` right after `createCesiumViewer` succeeds.
`StudioView` (below) uses this to capture the viewer instance into a ref
it can hand to `WaypointInspector`. This is the same "small, additive,
optional-prop" pattern as `onOverlayClick` — Quick Create's usage is
unaffected.

## `src/components/studio/StudioView.tsx`

Top-level composition: `TimelineStrip` (+ its expanded block strip) above
a `PreviewStage` (now receiving `onOverlayClick` and `onViewerReady`)
above the selection-dependent inspector (`WaypointInspector` /
`StorefrontInspector` / `InteriorPhotoInspector` / `InteriorVideoInspector`
/ nothing, switched on `uiStore.selection`) and the always-visible
`ScalingControls`. A header bar has **Save** (disabled when not dirty),
and **Back** (guarded by the `isDirty` `window.confirm` from the Save
design decision above).

## `src/components/studio/ProjectList.tsx`

A minimal list: calls Phase 1's `listProjects()` on mount, renders each
project's `projectName` + `updatedAt` with a button that calls
`useProjectStore`'s `loadProject(id)` then navigates to Studio. No
search/sort/delete UI — out of scope, YAGNI for an MVP entry point whose
only job is "let the user get back into a project they already made."

## `App.tsx` Routing

Extends the existing local-state pattern (no router) with one more view
enum: `'project-list' | 'quick-create' | 'preview' | 'studio'`. On first
load with no `currentProject`, shows `ProjectList` with a "Create New"
button that switches to `'quick-create'`. After Quick Create's draft
completes (existing `onDraftReady`), instead of rendering bare
`PreviewStage`, a thin wrapper renders `PreviewStage` plus a small button
bar: **Fine-tune in Studio** (switches to `'studio'`) and **New Project**
(switches to `'quick-create'`, clearing `currentProject`). `ProjectList`'s
"open" action also switches to `'studio'` directly (an existing project is
opened straight into editing, not into a read-only preview first).

## Testing (Vitest, `environment: 'node'`)

- **captureCameraState.ts**: mocked-`cesium` test verifying the
  radians-to-degrees conversion for a representative fake camera state
  (mirrors `applyCameraState.test.ts`'s pattern exactly, in the opposite
  direction).
- **waypointEditing.ts**: `replaceWaypointCamera` converts a
  destination-relative waypoint to absolute with the given camera,
  preserves all non-camera fields, and also works when applied to an
  already-absolute waypoint (simple overwrite). `computeDoorTargetTransform`
  repositions `centerX`/`centerY`, preserves `scale`/`rotation`, and
  clamps out-of-range input (e.g. a click event's rect math producing a
  value fractionally outside `[0,1]` at an edge).
- **uiStore.ts**: `select` sets/clears selection; `toggleExpanded` toggles
  the named section and collapses the other one if it was expanded
  (mutual exclusivity); calling `toggleExpanded` with the already-expanded
  section collapses it (not a no-op).
- **The waypoint-block-to-segment-start-time lookup** (used by
  `WaypointBlocks.tsx` to seek on click) is extracted as a pure function
  (e.g. `findWaypointSegmentStartMs(timeline: CompiledTimeline,
  waypointId: string): number | undefined`, in `src/timeline/` alongside
  the other timeline pure modules) specifically so it gets real Vitest
  coverage rather than living inline in an untested component — tests
  cover: a waypoint that starts a hold segment, one that starts a travel
  segment, and a waypoint id not present in the timeline (returns
  `undefined`, component treats this as "don't seek, selection still
  works").
- **React/Cesium/drag-interaction components** (`TimelineStrip`,
  `WaypointBlocks`, `InteriorItemBlocks`, all four inspectors,
  `ScalingControls`, `StudioView`, `ProjectList`, the `PreviewStage`
  prop additions): not unit-tested, per this project's established
  precedent (no jsdom). Verified by TypeScript compilation and a
  real-browser check covering the full Studio flow — select a waypoint,
  capture/replace/go-to, select storefront, set a door target by
  clicking the preview, select an interior item, drag-reorder two items,
  apply a fit-to-duration operation (including triggering the
  impossible-target error path), save, reload via the project list, and
  confirm the edits persisted — following Phase 4a's precedent of using
  Playwright MCP tools where available.

## Out of Scope for Phase 4b

Bulk-edit operations (Apply Duration/Transition to All, Regenerate Photo
Motion), adding or removing map waypoints, user-saved/custom templates,
media relinking, the output compositor/export/`MediaRecorder`, project
JSON import/export, undo/redo (not mentioned in the PRD's Studio
requirements read so far; if a later phase's spec introduces it, that's a
new design decision then, not assumed here).

## Acceptance Criteria

- All new Vitest suites (`captureCameraState`, `waypointEditing`,
  `uiStore`, the waypoint-segment-lookup function) pass, alongside every
  existing test unmodified.
- `npm run build` succeeds; `dnd-kit` is the only new runtime dependency.
- Manually exercising the full flow in a real browser works end-to-end:
  open Studio from a Quick Create draft → select and edit a waypoint via
  Capture/Replace/Go To → select the storefront and set a door target by
  clicking its image in the preview → select an interior item, edit its
  duration/transition → drag-reorder two interior items → apply a
  fit-to-duration operation, including seeing the specific error message
  for an impossible target → Save → return to the project list → reopen
  the same project → confirm every edit persisted.
