# Phase 4b: Studio Desktop Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Studio desktop editor — manual waypoint capture/editing, a scrub/select timeline UI, per-element inspectors, drag-reorder for interior media, and timeline-scaling controls — on top of Phase 1-3 and 4a's data model, timeline engine, and Cesium viewer/preview, all merged to `main`.

**Architecture:** New pure/testable modules (`uiStore`, `captureCameraState`, `waypointEditing`, `findWaypointSegmentStartMs`, a `projectStore.updateProject` action) land first. Two small, additive, optional props on the existing `PreviewStage` (`onOverlayClick`, `onViewerReady`) plus a third this plan adds to make timeline-block seeking possible (`onControllerReady` — see Task 6's note) expose what Studio needs from the already-existing Cesium viewer and `PlaybackController` without any new camera-control mechanism. Timeline-UI and inspector React components (untestable without jsdom, per this project's established precedent) are built on top, composed into `StudioView`, then wired into `App.tsx`'s routing alongside a new `ProjectList` entry point.

**Tech Stack:** React 19, TypeScript (strict), Zustand, Zod, `dnd-kit` (`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` — new), CesiumJS (via the existing `cesium/viewer.ts`/`cesium/applyCameraState.ts`), Vitest 5 (`environment: 'node'`, no jsdom).

**Spec:** `docs/superpowers/specs/2026-09-17-phase-4b-studio-editor-design.md`

## Global Constraints

- `dnd-kit` (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) is the only new runtime dependency this phase adds.
- Studio adds no new persisted `Project`/scene/waypoint fields — every field this plan's inspectors edit already exists in `src/models/scenes.ts` / `src/models/project.ts` (Phase 1).
- Save is explicit only: edits mutate `projectStore.currentProject` in memory immediately via a new `updateProject` action; IndexedDB persistence happens only on an explicit **Save** click (the existing `saveProject()` action). No autosave.
- No direct Cesium `camera.flyTo()`/animation calls anywhere outside the two functions that already own camera translation: `applyCameraState` (existing, Phase 4a) and `captureCameraState` (new, Task 2). "Go To Waypoint" reuses `applyCameraState`; it does not introduce a new camera-control path.
- No bulk-edit operations (Apply to All / Regenerate Photo Motion — deferred to Phase 6), no add/remove waypoint, no compositor/export, no user-saved templates, no media relinking, no undo/redo, no project JSON import/export.
- React/Cesium/drag-interaction components are not unit-tested, per this project's established precedent (Vitest runs with `environment: 'node'`, no jsdom). They are verified by `npx tsc -b` (zero type errors) and, for the final task, a real-browser pass. Only pure, dependency-free logic gets Vitest coverage.
- Every new/modified `.ts`/`.tsx` file must leave `npx tsc -b` clean (strict mode, `noUnusedLocals`/`noUnusedParameters` are both on) and every existing Vitest suite passing (`npm run test`).

---

## Task 1: `uiStore.ts` — transient selection/expansion state

**Files:**
- Create: `src/store/uiStore.ts`
- Test: `src/tests/uiStore.test.ts`

**Interfaces:**
- Produces: `StudioSelection` (union type), `ExpandedSection` (union type), `useUiStore` (Zustand hook) with state `{ selection: StudioSelection; expandedSection: ExpandedSection }` and actions `select(selection: StudioSelection): void`, `toggleExpanded(section: 'map' | 'interior-tour'): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/uiStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../store/uiStore';

beforeEach(() => {
  useUiStore.setState({ selection: null, expandedSection: null });
});

describe('uiStore', () => {
  it('select sets the selection', () => {
    useUiStore.getState().select({ type: 'storefront', sceneId: 'storefront-1' });
    expect(useUiStore.getState().selection).toEqual({ type: 'storefront', sceneId: 'storefront-1' });
  });

  it('select can clear the selection', () => {
    useUiStore.getState().select({ type: 'storefront', sceneId: 'storefront-1' });
    useUiStore.getState().select(null);
    expect(useUiStore.getState().selection).toBeNull();
  });

  it('toggleExpanded expands a collapsed section', () => {
    useUiStore.getState().toggleExpanded('map');
    expect(useUiStore.getState().expandedSection).toBe('map');
  });

  it('toggleExpanded collapses the section if it is already expanded (not a no-op)', () => {
    useUiStore.getState().toggleExpanded('map');
    useUiStore.getState().toggleExpanded('map');
    expect(useUiStore.getState().expandedSection).toBeNull();
  });

  it('toggleExpanded switches to a different section, collapsing the previous one', () => {
    useUiStore.getState().toggleExpanded('map');
    useUiStore.getState().toggleExpanded('interior-tour');
    expect(useUiStore.getState().expandedSection).toBe('interior-tour');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/uiStore.test.ts`
Expected: FAIL — `src/store/uiStore.ts` does not exist yet.

- [ ] **Step 3: Implement `uiStore.ts`**

```ts
// src/store/uiStore.ts
import { create } from 'zustand';

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

export const useUiStore = create<UiStoreState>()((set, get) => ({
  selection: null,
  expandedSection: null,
  select: (selection) => set({ selection }),
  toggleExpanded: (section) => set({ expandedSection: get().expandedSection === section ? null : section }),
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/uiStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/uiStore.ts src/tests/uiStore.test.ts
git commit -m "feat: add uiStore for Studio selection and expansion state"
```

---

## Task 2: `captureCameraState.ts` — read the live Cesium camera into a `CameraState`

**Files:**
- Create: `src/cesium/captureCameraState.ts`
- Test: `src/tests/captureCameraState.test.ts`

**Interfaces:**
- Consumes: `CameraState` (from `src/models/scenes.ts`, existing).
- Produces: `captureCameraState(viewer: Viewer): CameraState`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/captureCameraState.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Viewer } from 'cesium';

vi.mock('cesium', () => ({
  Math: { toDegrees: (rad: number) => (rad * 180) / Math.PI },
}));

describe('captureCameraState', () => {
  it('converts the live viewer camera state from radians to a degrees-based CameraState', async () => {
    const { captureCameraState } = await import('../cesium/captureCameraState');

    const fakeViewer = {
      camera: {
        positionCartographic: {
          longitude: (-104.9 * Math.PI) / 180,
          latitude: (39.7 * Math.PI) / 180,
          height: 500,
        },
        heading: (90 * Math.PI) / 180,
        pitch: (-30 * Math.PI) / 180,
        roll: 0,
      },
    } as unknown as Viewer;

    const result = captureCameraState(fakeViewer);

    expect(result.longitude).toBeCloseTo(-104.9, 6);
    expect(result.latitude).toBeCloseTo(39.7, 6);
    expect(result.height).toBe(500);
    expect(result.heading).toBeCloseTo(90, 6);
    expect(result.pitch).toBeCloseTo(-30, 6);
    expect(result.roll).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/captureCameraState.test.ts`
Expected: FAIL — `src/cesium/captureCameraState.ts` does not exist yet.

- [ ] **Step 3: Implement `captureCameraState.ts`**

This is the inverse of the existing `src/cesium/applyCameraState.ts` (Phase 4a) — same mocked-`cesium`-module testing precedent, opposite direction (radians in, degrees out).

```ts
// src/cesium/captureCameraState.ts
import { Math as CesiumMath } from 'cesium';
import type { Viewer } from 'cesium';
import type { CameraState } from '../models/scenes';

export function captureCameraState(viewer: Viewer): CameraState {
  const { camera } = viewer;
  const { longitude, latitude, height } = camera.positionCartographic;

  return {
    longitude: CesiumMath.toDegrees(longitude),
    latitude: CesiumMath.toDegrees(latitude),
    height,
    heading: CesiumMath.toDegrees(camera.heading),
    pitch: CesiumMath.toDegrees(camera.pitch),
    roll: CesiumMath.toDegrees(camera.roll),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/captureCameraState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cesium/captureCameraState.ts src/tests/captureCameraState.test.ts
git commit -m "feat: add captureCameraState, the inverse of applyCameraState"
```

---

## Task 3: `waypointEditing.ts` — pure waypoint/transform editing helpers

**Files:**
- Create: `src/timeline/waypointEditing.ts`
- Test: `src/tests/waypointEditing.test.ts`

**Interfaces:**
- Consumes: `Waypoint`, `CameraState`, `VisualTransform` (from `src/models/scenes.ts`, existing).
- Produces: `replaceWaypointCamera(waypoint: Waypoint, camera: CameraState): Waypoint`, `computeDoorTargetTransform(current: VisualTransform, normalized: { x: number; y: number }): VisualTransform`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/waypointEditing.test.ts
import { describe, it, expect } from 'vitest';
import { replaceWaypointCamera, computeDoorTargetTransform } from '../timeline/waypointEditing';
import type { CameraState, VisualTransform, Waypoint } from '../models/scenes';

describe('replaceWaypointCamera', () => {
  it('converts a destination-relative waypoint to absolute with the given camera, preserving non-camera fields', () => {
    const waypoint: Waypoint = {
      id: 'w1',
      name: 'Neighborhood',
      type: 'destination-relative',
      relativeCamera: { headingDeg: 45, pitchDeg: -20, distanceMeters: 500, heightMeters: 100 },
      travelDurationMs: 2000,
      holdDurationMs: 1000,
      travelDurationLocked: true,
      holdDurationLocked: false,
      easing: 'smooth',
    };
    const camera: CameraState = { longitude: -104.9, latitude: 39.7, height: 300, heading: 10, pitch: -25, roll: 0 };

    const result = replaceWaypointCamera(waypoint, camera);

    expect(result).toEqual({
      id: 'w1',
      name: 'Neighborhood',
      type: 'absolute',
      camera,
      travelDurationMs: 2000,
      holdDurationMs: 1000,
      travelDurationLocked: true,
      holdDurationLocked: false,
      easing: 'smooth',
    });
  });

  it('overwrites the camera on an already-absolute waypoint, dropping nothing else', () => {
    const waypoint: Waypoint = {
      id: 'w2',
      name: 'City',
      type: 'absolute',
      camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
      travelDurationMs: 0,
      holdDurationMs: 500,
      travelDurationLocked: false,
      holdDurationLocked: true,
      easing: 'linear',
    };
    const camera: CameraState = { longitude: 5, latitude: 5, height: 200, heading: 90, pitch: -10, roll: 0 };

    const result = replaceWaypointCamera(waypoint, camera);

    expect(result.type).toBe('absolute');
    expect(result).not.toHaveProperty('relativeCamera');
    if (result.type === 'absolute') {
      expect(result.camera).toEqual(camera);
    }
    expect(result.holdDurationLocked).toBe(true);
    expect(result.name).toBe('City');
  });
});

describe('computeDoorTargetTransform', () => {
  it('repositions centerX/centerY to the normalized point, preserving scale and rotation', () => {
    const current: VisualTransform = { centerX: 0.5, centerY: 0.5, scale: 1.2, rotation: 5 };

    const result = computeDoorTargetTransform(current, { x: 0.3, y: 0.7 });

    expect(result).toEqual({ centerX: 0.3, centerY: 0.7, scale: 1.2, rotation: 5 });
  });

  it('clamps out-of-range normalized coordinates to [0, 1]', () => {
    const current: VisualTransform = { centerX: 0.5, centerY: 0.5, scale: 1 };

    const result = computeDoorTargetTransform(current, { x: -0.02, y: 1.05 });

    expect(result.centerX).toBe(0);
    expect(result.centerY).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/waypointEditing.test.ts`
Expected: FAIL — `src/timeline/waypointEditing.ts` does not exist yet.

- [ ] **Step 3: Implement `waypointEditing.ts`**

```ts
// src/timeline/waypointEditing.ts
import type { CameraState, VisualTransform, Waypoint } from '../models/scenes';

/**
 * A freely-navigated captured camera position is inherently absolute, not defined
 * relative to the destination — so a manual "Replace" always produces an absolute
 * waypoint, even when the original was destination-relative.
 */
export function replaceWaypointCamera(waypoint: Waypoint, camera: CameraState): Waypoint {
  return {
    id: waypoint.id,
    name: waypoint.name,
    type: 'absolute',
    camera,
    travelDurationMs: waypoint.travelDurationMs,
    holdDurationMs: waypoint.holdDurationMs,
    travelDurationLocked: waypoint.travelDurationLocked,
    holdDurationLocked: waypoint.holdDurationLocked,
    easing: waypoint.easing,
  };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function computeDoorTargetTransform(
  current: VisualTransform,
  normalized: { x: number; y: number },
): VisualTransform {
  return {
    ...current,
    centerX: clamp01(normalized.x),
    centerY: clamp01(normalized.y),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/waypointEditing.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/timeline/waypointEditing.ts src/tests/waypointEditing.test.ts
git commit -m "feat: add replaceWaypointCamera and computeDoorTargetTransform"
```

---

## Task 4: `findWaypointSegmentStartMs` — pure lookup for timeline-block-click-to-seek

**Files:**
- Create: `src/timeline/findWaypointSegmentStartMs.ts`
- Test: `src/tests/findWaypointSegmentStartMs.test.ts`

**Interfaces:**
- Consumes: `CompiledTimeline` (from `src/models/timeline.ts`, existing), `compileProjectTimeline` (from `src/timeline/compiler.ts`, existing, for tests only).
- Produces: `findWaypointSegmentStartMs(timeline: CompiledTimeline, waypointId: string): number | undefined`.

**Behavior:** `compileProjectTimeline`'s `buildMapUnits` (see `src/timeline/compiler.ts:54-80`) always emits a `map-travel` segment (`toWaypoint` = the waypoint being traveled to) for every waypoint after the first, followed by a `map-hold` segment (`fromWaypoint` = the waypoint itself). A `WaypointBlocks` UI block spans both — its start is the travel segment's start when one exists (a waypoint reached by travel), falling back to the hold segment's start for the very first waypoint (which has no preceding travel segment).

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/findWaypointSegmentStartMs.test.ts
import { describe, it, expect } from 'vitest';
import { findWaypointSegmentStartMs } from '../timeline/findWaypointSegmentStartMs';
import { compileProjectTimeline } from '../timeline/compiler';
import { makeMinimalProject } from './fixtures';
import type { MapScene, Waypoint } from '../models/scenes';

function makeWaypoint(overrides: Partial<Waypoint> & { id: string }): Waypoint {
  return {
    type: 'absolute',
    name: overrides.id,
    camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
    travelDurationMs: 0,
    holdDurationMs: 1000,
    travelDurationLocked: false,
    holdDurationLocked: false,
    easing: 'cinematic',
    ...overrides,
  } as Waypoint;
}

const mapScene: MapScene = {
  id: 'map-1',
  type: 'map',
  waypoints: [
    makeWaypoint({ id: 'w0', holdDurationMs: 1000 }),
    makeWaypoint({ id: 'w1', travelDurationMs: 2000, holdDurationMs: 500 }),
  ],
};

describe('findWaypointSegmentStartMs', () => {
  it('returns the hold segment start for the first waypoint (no preceding travel segment)', () => {
    const project = makeMinimalProject({ scenes: [mapScene] });
    const timeline = compileProjectTimeline(project);

    expect(findWaypointSegmentStartMs(timeline, 'w0')).toBe(0);
  });

  it('returns the travel segment start for a waypoint reached by travel', () => {
    const project = makeMinimalProject({ scenes: [mapScene] });
    const timeline = compileProjectTimeline(project);

    // w0's hold segment occupies 0-1000ms; w1's travel segment starts right after.
    expect(findWaypointSegmentStartMs(timeline, 'w1')).toBe(1000);
  });

  it('returns undefined for a waypoint id not present in the timeline', () => {
    const project = makeMinimalProject({ scenes: [mapScene] });
    const timeline = compileProjectTimeline(project);

    expect(findWaypointSegmentStartMs(timeline, 'nonexistent')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/findWaypointSegmentStartMs.test.ts`
Expected: FAIL — `src/timeline/findWaypointSegmentStartMs.ts` does not exist yet.

- [ ] **Step 3: Implement `findWaypointSegmentStartMs.ts`**

```ts
// src/timeline/findWaypointSegmentStartMs.ts
import type { CompiledTimeline } from '../models/timeline';

export function findWaypointSegmentStartMs(timeline: CompiledTimeline, waypointId: string): number | undefined {
  const travelSegment = timeline.segments.find(
    (segment) => segment.kind === 'map-travel' && segment.toWaypoint?.id === waypointId,
  );
  if (travelSegment) return travelSegment.startMs;

  const holdSegment = timeline.segments.find(
    (segment) => segment.kind === 'map-hold' && segment.fromWaypoint?.id === waypointId,
  );
  return holdSegment?.startMs;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/findWaypointSegmentStartMs.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/timeline/findWaypointSegmentStartMs.ts src/tests/findWaypointSegmentStartMs.test.ts
git commit -m "feat: add findWaypointSegmentStartMs for timeline-block seeking"
```

---

## Task 5: `projectStore.ts` — add the `updateProject` action

**Files:**
- Modify: `src/store/projectStore.ts` (full current content below)
- Test: `src/tests/projectStore.test.ts` (append; existing 3 tests must remain unmodified and passing)

**Interfaces:**
- Consumes: `Project` (existing).
- Produces: `useProjectStore`'s new `updateProject: (updater: (project: Project) => Project) => void` action, alongside the existing `currentProject`, `createProject`, `loadProject`, `saveProject`.

The current full file:

```ts
import { create } from 'zustand';
import type { Project } from '../models/project';
import {
  saveProject as persistProject,
  loadProject as fetchProject,
} from '../persistence/projectRepository';
import { setLastOpenProjectId } from './lastOpenProject';

interface ProjectStoreState {
  currentProject: Project | null;
  createProject: (project: Project) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  saveProject: () => Promise<void>;
}

export const useProjectStore = create<ProjectStoreState>()((set, get) => ({
  currentProject: null,

  async createProject(project: Project) {
    await persistProject(project);
    set({ currentProject: project });
    setLastOpenProjectId(project.id);
  },

  async loadProject(id: string) {
    const project = await fetchProject(id);
    set({ currentProject: project });
    if (project) {
      setLastOpenProjectId(project.id);
    }
  },

  async saveProject() {
    const { currentProject } = get();
    if (!currentProject) return;
    await persistProject(currentProject);
  },
}));
```

- [ ] **Step 1: Write the failing tests (append to the existing file)**

Append these two `it` blocks inside the existing `describe('projectStore', ...)` block in `src/tests/projectStore.test.ts`, after the existing "saves changes to the current project" test:

```ts
  it('updateProject mutates the current project in memory without persisting it', async () => {
    const project = makeMinimalProject({ id: 'store-proj-4' });
    await useProjectStore.getState().createProject(project);

    useProjectStore.getState().updateProject((p) => ({ ...p, projectName: 'Edited In Memory' }));

    expect(useProjectStore.getState().currentProject?.projectName).toBe('Edited In Memory');

    useProjectStore.setState({ currentProject: null });
    await useProjectStore.getState().loadProject('store-proj-4');
    expect(useProjectStore.getState().currentProject?.projectName).toBe('Test Project');
  });

  it('updateProject is a no-op when there is no current project', () => {
    useProjectStore.setState({ currentProject: null });
    expect(() => useProjectStore.getState().updateProject((p) => p)).not.toThrow();
    expect(useProjectStore.getState().currentProject).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/projectStore.test.ts`
Expected: FAIL — `updateProject` does not exist on the store yet.

- [ ] **Step 3: Add the `updateProject` action**

In `src/store/projectStore.ts`, add `updateProject` to the `ProjectStoreState` interface:

```ts
interface ProjectStoreState {
  currentProject: Project | null;
  createProject: (project: Project) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  saveProject: () => Promise<void>;
  updateProject: (updater: (project: Project) => Project) => void;
}
```

And add the implementation to the store object, after `saveProject`:

```ts
  updateProject(updater: (project: Project) => Project) {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ currentProject: updater(currentProject) });
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/projectStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/projectStore.ts src/tests/projectStore.test.ts
git commit -m "feat: add updateProject action to projectStore for in-memory edits"
```

---

## Task 6: `PreviewStage.tsx` — add `onOverlayClick`, `onViewerReady`, `onControllerReady`

**Files:**
- Modify: `src/components/preview/PreviewStage.tsx`

**Interfaces:**
- Consumes: `EvaluatedLayer` (existing), `Viewer` (from `cesium`), `PlaybackController` (existing, `src/timeline/playbackController.ts`).
- Produces: three new optional `PreviewStageProps` — `onOverlayClick?: (normalized: { x: number; y: number }, layer: EvaluatedLayer) => void`, `onViewerReady?: (viewer: Viewer) => void`, `onControllerReady?: (controller: PlaybackController) => void`.

**Note on `onControllerReady`:** the spec (design doc) names `onOverlayClick` and `onViewerReady` explicitly, and describes the timeline UI as calling `controller.seek(...)` on click — but `PreviewStage` never exposed its internally-owned `PlaybackController` externally. `onControllerReady` is the same small, additive, optional-prop pattern as `onViewerReady`, added here to close that gap: it is the only way `StudioView` (Task 13) can reach the controller `WaypointBlocks`/`InteriorItemBlocks` need to seek on click. Quick Create's existing usage (`<PreviewStage project={project} />`, no new props) is unaffected by any of the three additions.

This task is not unit-tested, per this project's established no-jsdom precedent for React/Cesium components — verified by `npx tsc -b` here, and covered end-to-end by Task 15's real-browser pass.

- [ ] **Step 1: Add the `Viewer` type import**

At the top of `src/components/preview/PreviewStage.tsx`, alongside the existing imports (after the `applyCameraState` import), add:

```ts
import type { Viewer } from 'cesium';
```

- [ ] **Step 2: Extend `PreviewStageProps`**

Replace:

```ts
interface PreviewStageProps {
  project: Project;
}
```

with:

```ts
interface PreviewStageProps {
  project: Project;
  onOverlayClick?: (normalized: { x: number; y: number }, layer: EvaluatedLayer) => void;
  onViewerReady?: (viewer: Viewer) => void;
  onControllerReady?: (controller: PlaybackController) => void;
}
```

- [ ] **Step 3: Destructure the new props and add latest-callback refs**

Replace the component's opening line:

```ts
export function PreviewStage({ project }: PreviewStageProps) {
```

with:

```ts
export function PreviewStage({ project, onOverlayClick, onViewerReady, onControllerReady }: PreviewStageProps) {
```

Then, directly after the existing `urlCacheRef` declaration (`const urlCacheRef = useRef<Map<string, string>>(new Map());`) and before the `useState` declarations, add:

```ts
  // Latest-callback refs so the mount-only viewer effect and the timeline-keyed
  // controller effect don't need onViewerReady/onControllerReady in their dependency
  // arrays — an unstable inline function from the caller must never recreate the
  // Cesium viewer or the PlaybackController.
  const onViewerReadyRef = useRef(onViewerReady);
  onViewerReadyRef.current = onViewerReady;
  const onControllerReadyRef = useRef(onControllerReady);
  onControllerReadyRef.current = onControllerReady;
```

- [ ] **Step 4: Call `onViewerReady` from the viewer-creation effect**

Replace:

```ts
  useEffect(() => {
    if (!cesiumContainerRef.current) return;
    const handle = createCesiumViewer(cesiumContainerRef.current);
    viewerHandleRef.current = handle;
    return () => handle.destroy();
  }, []);
```

with:

```ts
  useEffect(() => {
    if (!cesiumContainerRef.current) return;
    const handle = createCesiumViewer(cesiumContainerRef.current);
    viewerHandleRef.current = handle;
    onViewerReadyRef.current?.(handle.viewer);
    return () => handle.destroy();
  }, []);
```

- [ ] **Step 5: Call `onControllerReady` from the controller-creation effect**

Replace:

```ts
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
```

with:

```ts
  useEffect(() => {
    const controller = new PlaybackController(timeline);
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe((nextFrame, timeMs) => {
      setFrame(nextFrame);
      setCurrentTimeMs(timeMs);
      setIsPlaying(controller.isPlaying);
    });
    controller.seek(0);
    onControllerReadyRef.current?.(controller);
    return () => {
      unsubscribe();
      controller.destroy();
    };
  }, [timeline]);
```

- [ ] **Step 6: Wire `onOverlayClick` onto the rendered `<img>` overlay**

Replace:

```tsx
        return (
          <img
            key={layer.segmentId}
            className="preview-overlay-image"
            src={url}
            alt=""
            style={{ opacity: layer.opacity, transform: transformToCss(layer.transform) }}
          />
        );
```

with:

```tsx
        return (
          <img
            key={layer.segmentId}
            className="preview-overlay-image"
            src={url}
            alt=""
            style={{ opacity: layer.opacity, transform: transformToCss(layer.transform) }}
            onClick={
              onOverlayClick
                ? (event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = (event.clientX - rect.left) / rect.width;
                    const y = (event.clientY - rect.top) / rect.height;
                    onOverlayClick({ x, y }, layer);
                  }
                : undefined
            }
          />
        );
```

`<video>` overlays are deliberately left untouched — door-target-setting is a storefront-photo-only operation per the spec.

- [ ] **Step 7: Verify TypeScript compiles and existing tests still pass**

Run: `npx tsc -b`
Expected: no errors.

Run: `npm run test`
Expected: all existing tests pass unmodified (this file has no direct Vitest suite of its own, but nothing else should break).

- [ ] **Step 8: Commit**

```bash
git add src/components/preview/PreviewStage.tsx
git commit -m "feat: add onOverlayClick/onViewerReady/onControllerReady to PreviewStage"
```

---

## Task 7: `TimelineStrip.tsx` + `WaypointBlocks.tsx` — collapsed strip and map-waypoint blocks

**Files:**
- Create: `src/components/timeline/TimelineStrip.tsx`
- Create: `src/components/timeline/WaypointBlocks.tsx`
- Create: `src/components/timeline/TimelineStrip.css`

**Interfaces:**
- Consumes: `compileProjectTimeline` (existing), `useUiStore` (Task 1), `findWaypointSegmentStartMs` (Task 4), `MapScene`/`StorefrontScene`/`InteriorTourScene` (existing), `CompiledTimeline` (existing).
- Produces: `TimelineStrip({ project: Project; onSeek: (timeMs: number) => void })`, `WaypointBlocks({ mapScene: MapScene; timeline: CompiledTimeline; onSeek: (timeMs: number) => void })`.

Not unit-tested (React, no jsdom) — verified by `npx tsc -b` and Task 15's real-browser pass. The interior-tour expandable block strip (`InteriorItemBlocks`) is added to `TimelineStrip` in Task 8, once it exists — `TimelineStrip` in this task only wires the map section; the "Interior Tour" button toggles `uiStore.expandedSection` (a real, testable state change) even though nothing yet renders under it.

- [ ] **Step 1: Create `WaypointBlocks.tsx`**

```tsx
// src/components/timeline/WaypointBlocks.tsx
import { useUiStore } from '../../store/uiStore';
import { findWaypointSegmentStartMs } from '../../timeline/findWaypointSegmentStartMs';
import type { MapScene } from '../../models/scenes';
import type { CompiledTimeline } from '../../models/timeline';

interface WaypointBlocksProps {
  mapScene: MapScene;
  timeline: CompiledTimeline;
  onSeek: (timeMs: number) => void;
}

export function WaypointBlocks({ mapScene, timeline, onSeek }: WaypointBlocksProps) {
  const select = useUiStore((state) => state.select);
  const selection = useUiStore((state) => state.selection);

  const totalMs = mapScene.waypoints.reduce(
    (sum, wp, i) => sum + (i > 0 ? wp.travelDurationMs : 0) + wp.holdDurationMs,
    0,
  );

  return (
    <div className="waypoint-blocks">
      {mapScene.waypoints.map((waypoint, i) => {
        const durationMs = (i > 0 ? waypoint.travelDurationMs : 0) + waypoint.holdDurationMs;
        const widthPercent = totalMs > 0 ? (durationMs / totalMs) * 100 : 0;
        const isSelected =
          selection?.type === 'waypoint' &&
          selection.sceneId === mapScene.id &&
          selection.waypointId === waypoint.id;

        return (
          <button
            key={waypoint.id}
            type="button"
            className={isSelected ? 'timeline-block timeline-block--selected' : 'timeline-block'}
            style={{ width: `${widthPercent}%` }}
            onClick={() => {
              select({ type: 'waypoint', sceneId: mapScene.id, waypointId: waypoint.id });
              const startMs = findWaypointSegmentStartMs(timeline, waypoint.id);
              if (startMs !== undefined) onSeek(startMs);
            }}
          >
            {waypoint.name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `TimelineStrip.tsx`**

```tsx
// src/components/timeline/TimelineStrip.tsx
import { useMemo } from 'react';
import './TimelineStrip.css';
import { compileProjectTimeline } from '../../timeline/compiler';
import { useUiStore } from '../../store/uiStore';
import { WaypointBlocks } from './WaypointBlocks';
import type { Project } from '../../models/project';
import type { MapScene, StorefrontScene, InteriorTourScene } from '../../models/scenes';

interface TimelineStripProps {
  project: Project;
  onSeek: (timeMs: number) => void;
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

export function TimelineStrip({ project, onSeek }: TimelineStripProps) {
  const timeline = useMemo(() => compileProjectTimeline(project), [project]);
  const expandedSection = useUiStore((state) => state.expandedSection);
  const toggleExpanded = useUiStore((state) => state.toggleExpanded);
  const select = useUiStore((state) => state.select);

  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');

  const mapSection = timeline.sections.find((s) => s.type === 'map');
  const storefrontSection = timeline.sections.find((s) => s.type === 'storefront');
  const interiorSection = timeline.sections.find((s) => s.type === 'interior-tour');

  return (
    <div className="timeline-strip">
      <div className="timeline-sections">
        {mapScene && mapSection && (
          <button
            type="button"
            aria-expanded={expandedSection === 'map'}
            onClick={() => toggleExpanded('map')}
          >
            Map Fly-In ({seconds(mapSection.endMs - mapSection.startMs)}s)
          </button>
        )}
        {storefrontScene && (
          <button
            type="button"
            onClick={() => select({ type: 'storefront', sceneId: storefrontScene.id })}
          >
            Storefront ({storefrontSection ? seconds(storefrontSection.endMs - storefrontSection.startMs) : 0}s)
          </button>
        )}
        {interiorScene && interiorSection && (
          <button
            type="button"
            aria-expanded={expandedSection === 'interior-tour'}
            onClick={() => toggleExpanded('interior-tour')}
          >
            Interior Tour ({seconds(interiorSection.endMs - interiorSection.startMs)}s)
          </button>
        )}
      </div>
      {expandedSection === 'map' && mapScene && (
        <WaypointBlocks mapScene={mapScene} timeline={timeline} onSeek={onSeek} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `TimelineStrip.css`**

```css
/* src/components/timeline/TimelineStrip.css */
.timeline-strip {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timeline-sections {
  display: flex;
  gap: 4px;
}

.timeline-sections button {
  flex: 1;
}

.waypoint-blocks,
.interior-item-blocks {
  display: flex;
  gap: 2px;
  min-height: 32px;
}

.timeline-block {
  min-width: 24px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.timeline-block--selected {
  outline: 2px solid #2684ff;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/TimelineStrip.tsx src/components/timeline/WaypointBlocks.tsx src/components/timeline/TimelineStrip.css
git commit -m "feat: add TimelineStrip and WaypointBlocks for the Studio timeline UI"
```

---

## Task 8: `InteriorItemBlocks.tsx` — drag-reorderable interior item blocks (adds `dnd-kit`)

**Files:**
- Create: `src/components/timeline/InteriorItemBlocks.tsx`
- Modify: `src/components/timeline/TimelineStrip.tsx`
- Modify: `package.json` (new dependencies)

**Interfaces:**
- Consumes: `useUiStore` (Task 1), `InteriorTourScene`/`InteriorTourItem` (existing), `CompiledTimeline` (existing), `Project` (existing), the `updateProject` action shape (Task 5: `(updater: (project: Project) => Project) => void`).
- Produces: `InteriorItemBlocks({ interiorScene: InteriorTourScene; timeline: CompiledTimeline; updateProject: (updater: (project: Project) => Project) => void; onSeek: (timeMs: number) => void })`. Extends `TimelineStripProps` with `updateProject`.

Not unit-tested (React + drag interaction, no jsdom) — verified by `npx tsc -b` and Task 15's real-browser pass, which explicitly includes dragging two interior items to reorder them.

- [ ] **Step 1: Install `dnd-kit`**

Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

This adds exactly these three packages to `package.json`'s `dependencies` — the only new runtime dependency this phase introduces (per the Global Constraints).

- [ ] **Step 2: Create `InteriorItemBlocks.tsx`**

```tsx
// src/components/timeline/InteriorItemBlocks.tsx
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUiStore } from '../../store/uiStore';
import type { Project } from '../../models/project';
import type { InteriorTourScene, InteriorTourItem } from '../../models/scenes';
import type { CompiledTimeline } from '../../models/timeline';

interface InteriorItemBlocksProps {
  interiorScene: InteriorTourScene;
  timeline: CompiledTimeline;
  updateProject: (updater: (project: Project) => Project) => void;
  onSeek: (timeMs: number) => void;
}

function itemEffectiveDurationMs(item: InteriorTourItem): number {
  if (item.type === 'photo') return item.durationMs;
  return (item.trimEndMs - item.trimStartMs) / item.playbackRate;
}

function findItemSegmentStartMs(timeline: CompiledTimeline, itemId: string): number | undefined {
  return timeline.segments.find((segment) => segment.itemId === itemId)?.startMs;
}

interface SortableItemBlockProps {
  item: InteriorTourItem;
  widthPercent: number;
  isSelected: boolean;
  onClick: () => void;
}

function SortableItemBlock({ item, widthPercent, isSelected, onClick }: SortableItemBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={isSelected ? 'timeline-block timeline-block--selected' : 'timeline-block'}
      style={{ width: `${widthPercent}%`, transform: CSS.Transform.toString(transform), transition }}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {item.type === 'photo' ? 'Photo' : 'Video'}
    </button>
  );
}

export function InteriorItemBlocks({ interiorScene, timeline, updateProject, onSeek }: InteriorItemBlocksProps) {
  const select = useUiStore((state) => state.select);
  const selection = useUiStore((state) => state.selection);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const totalMs = interiorScene.items.reduce((sum, item) => sum + itemEffectiveDurationMs(item), 0);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = interiorScene.items.findIndex((item) => item.id === active.id);
    const newIndex = interiorScene.items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(interiorScene.items, oldIndex, newIndex);
    updateProject((project) => ({
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === interiorScene.id ? { ...scene, items: reordered } : scene,
      ),
    }));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={interiorScene.items.map((item) => item.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="interior-item-blocks">
          {interiorScene.items.map((item) => {
            const widthPercent = totalMs > 0 ? (itemEffectiveDurationMs(item) / totalMs) * 100 : 0;
            const isSelected =
              selection?.type === 'interior-item' &&
              selection.sceneId === interiorScene.id &&
              selection.itemId === item.id;

            return (
              <SortableItemBlock
                key={item.id}
                item={item}
                widthPercent={widthPercent}
                isSelected={isSelected}
                onClick={() => {
                  select({ type: 'interior-item', sceneId: interiorScene.id, itemId: item.id });
                  const startMs = findItemSegmentStartMs(timeline, item.id);
                  if (startMs !== undefined) onSeek(startMs);
                }}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 3: Wire `InteriorItemBlocks` into `TimelineStrip`**

In `src/components/timeline/TimelineStrip.tsx`, add the import:

```ts
import { InteriorItemBlocks } from './InteriorItemBlocks';
```

Add `updateProject` to `TimelineStripProps` and the component signature. Replace:

```ts
interface TimelineStripProps {
  project: Project;
  onSeek: (timeMs: number) => void;
}
```

with:

```ts
interface TimelineStripProps {
  project: Project;
  onSeek: (timeMs: number) => void;
  updateProject: (updater: (project: Project) => Project) => void;
}
```

Replace:

```ts
export function TimelineStrip({ project, onSeek }: TimelineStripProps) {
```

with:

```ts
export function TimelineStrip({ project, onSeek, updateProject }: TimelineStripProps) {
```

Replace the end of the component (the closing `{expandedSection === 'map' && ...}` block and the two closing tags):

```tsx
      {expandedSection === 'map' && mapScene && (
        <WaypointBlocks mapScene={mapScene} timeline={timeline} onSeek={onSeek} />
      )}
    </div>
  );
}
```

with:

```tsx
      {expandedSection === 'map' && mapScene && (
        <WaypointBlocks mapScene={mapScene} timeline={timeline} onSeek={onSeek} />
      )}
      {expandedSection === 'interior-tour' && interiorScene && (
        <InteriorItemBlocks
          interiorScene={interiorScene}
          timeline={timeline}
          updateProject={updateProject}
          onSeek={onSeek}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/InteriorItemBlocks.tsx src/components/timeline/TimelineStrip.tsx package.json package-lock.json
git commit -m "feat: add drag-reorderable InteriorItemBlocks via dnd-kit"
```

---

## Task 9: `WaypointInspector.tsx` — Capture/Replace/Go To + waypoint fields

**Files:**
- Create: `src/components/inspectors/WaypointInspector.tsx`

**Interfaces:**
- Consumes: `captureCameraState` (Task 2), `replaceWaypointCamera` (Task 3), `applyCameraState`/`resolveRelativeCameraState` (existing, Phase 4a), `EasingPreset`/`Waypoint` (existing).
- Produces: `WaypointInspector({ project: Project; sceneId: string; waypointId: string; updateProject: (updater: (project: Project) => Project) => void; viewerRef: RefObject<Viewer | null> })`.

Not unit-tested (React + live Cesium viewer, no jsdom) — verified by `npx tsc -b` and Task 15's real-browser pass, which explicitly exercises Capture, Replace, and Go To.

- [ ] **Step 1: Create `WaypointInspector.tsx`**

```tsx
// src/components/inspectors/WaypointInspector.tsx
import { useState } from 'react';
import type { RefObject } from 'react';
import type { Viewer } from 'cesium';
import { captureCameraState } from '../../cesium/captureCameraState';
import { applyCameraState } from '../../cesium/applyCameraState';
import { replaceWaypointCamera } from '../../timeline/waypointEditing';
import { resolveRelativeCameraState } from '../../timeline/resolveRelativeCamera';
import type { Project } from '../../models/project';
import type { CameraState, EasingPreset, MapScene, Waypoint } from '../../models/scenes';

const EASING_PRESETS: EasingPreset[] = ['cinematic', 'smooth', 'linear', 'accelerate', 'decelerate'];

interface WaypointInspectorProps {
  project: Project;
  sceneId: string;
  waypointId: string;
  updateProject: (updater: (project: Project) => Project) => void;
  viewerRef: RefObject<Viewer | null>;
}

export function WaypointInspector({ project, sceneId, waypointId, updateProject, viewerRef }: WaypointInspectorProps) {
  const [captured, setCaptured] = useState<CameraState | null>(null);

  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map' && s.id === sceneId);
  const waypoint = mapScene?.waypoints.find((wp) => wp.id === waypointId);

  if (!mapScene || !waypoint) return null;

  function replaceWaypoint(nextWaypoint: Waypoint) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === sceneId && scene.type === 'map'
          ? { ...scene, waypoints: scene.waypoints.map((wp) => (wp.id === waypointId ? nextWaypoint : wp)) }
          : scene,
      ),
    }));
  }

  function updateWaypoint(patch: Partial<Waypoint>) {
    if (!waypoint) return;
    replaceWaypoint({ ...waypoint, ...patch } as Waypoint);
  }

  const goToCamera: CameraState | null =
    waypoint.type === 'absolute' ? waypoint.camera : resolveRelativeCameraState(waypoint.relativeCamera, project.destination);

  return (
    <div className="inspector waypoint-inspector">
      <h3>Waypoint: {waypoint.name}</h3>

      <label>
        Name
        <input type="text" value={waypoint.name} onChange={(e) => updateWaypoint({ name: e.target.value })} />
      </label>

      <label>
        Travel duration (ms)
        <input
          type="number"
          value={waypoint.travelDurationMs}
          onChange={(e) => updateWaypoint({ travelDurationMs: Number(e.target.value) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={waypoint.travelDurationLocked}
          onChange={(e) => updateWaypoint({ travelDurationLocked: e.target.checked })}
        />
        Lock travel duration
      </label>

      <label>
        Hold duration (ms)
        <input
          type="number"
          value={waypoint.holdDurationMs}
          onChange={(e) => updateWaypoint({ holdDurationMs: Number(e.target.value) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={waypoint.holdDurationLocked}
          onChange={(e) => updateWaypoint({ holdDurationLocked: e.target.checked })}
        />
        Lock hold duration
      </label>

      <label>
        Easing
        <select value={waypoint.easing} onChange={(e) => updateWaypoint({ easing: e.target.value as EasingPreset })}>
          {EASING_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>

      <div className="waypoint-inspector-actions">
        <button
          type="button"
          onClick={() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            setCaptured(captureCameraState(viewer));
          }}
        >
          Capture Current View
        </button>
        <button
          type="button"
          onClick={() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            replaceWaypoint(replaceWaypointCamera(waypoint, captureCameraState(viewer)));
          }}
        >
          Replace Selected Waypoint
        </button>
        <button
          type="button"
          disabled={!goToCamera}
          onClick={() => {
            const viewer = viewerRef.current;
            if (!viewer || !goToCamera) return;
            applyCameraState(viewer, goToCamera);
          }}
        >
          Go To Waypoint
        </button>
      </div>

      {captured && (
        <dl className="captured-camera-readout">
          <dt>Longitude</dt>
          <dd>{captured.longitude.toFixed(6)}</dd>
          <dt>Latitude</dt>
          <dd>{captured.latitude.toFixed(6)}</dd>
          <dt>Height</dt>
          <dd>{captured.height.toFixed(1)}</dd>
          <dt>Heading</dt>
          <dd>{captured.heading.toFixed(1)}</dd>
          <dt>Pitch</dt>
          <dd>{captured.pitch.toFixed(1)}</dd>
          <dt>Roll</dt>
          <dd>{captured.roll.toFixed(1)}</dd>
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inspectors/WaypointInspector.tsx
git commit -m "feat: add WaypointInspector with Capture/Replace/Go To"
```

---

## Task 10: `StorefrontInspector.tsx`

**Files:**
- Create: `src/components/inspectors/StorefrontInspector.tsx`

**Interfaces:**
- Consumes: `StorefrontScene`/`StorefrontMotionPreset`/`TransitionType` (existing).
- Produces: `StorefrontInspector({ project: Project; sceneId: string; updateProject: (updater: (project: Project) => Project) => void })`.

No "Set Door Target" button lives here — that's wired via `PreviewStage`'s `onOverlayClick` in `StudioView` (Task 13), per the spec's "click the storefront image in the preview" instruction.

- [ ] **Step 1: Create `StorefrontInspector.tsx`**

```tsx
// src/components/inspectors/StorefrontInspector.tsx
import type { Project } from '../../models/project';
import type { StorefrontMotionPreset, StorefrontScene, TransitionType } from '../../models/scenes';

const MOTION_PRESETS: StorefrontMotionPreset[] = ['none', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'custom'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface StorefrontInspectorProps {
  project: Project;
  sceneId: string;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function StorefrontInspector({ project, sceneId, updateProject }: StorefrontInspectorProps) {
  const scene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront' && s.id === sceneId);
  if (!scene) return null;

  function updateScene(patch: Partial<StorefrontScene>) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => (s.id === sceneId && s.type === 'storefront' ? { ...s, ...patch } : s)),
    }));
  }

  return (
    <div className="inspector storefront-inspector">
      <h3>Storefront</h3>

      <label>
        Duration (ms)
        <input
          type="number"
          value={scene.durationMs}
          onChange={(e) => updateScene({ durationMs: Number(e.target.value) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={scene.durationLocked}
          onChange={(e) => updateScene({ durationLocked: e.target.checked })}
        />
        Lock duration
      </label>

      <label>
        Motion preset
        <select
          value={scene.motionPreset}
          onChange={(e) => updateScene({ motionPreset: e.target.value as StorefrontMotionPreset })}
        >
          {MOTION_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Transition in</legend>
        <select
          value={scene.transitionIn.type}
          onChange={(e) =>
            updateScene({ transitionIn: { ...scene.transitionIn, type: e.target.value as TransitionType } })
          }
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={scene.transitionIn.durationMs}
          onChange={(e) =>
            updateScene({ transitionIn: { ...scene.transitionIn, durationMs: Number(e.target.value) } })
          }
        />
      </fieldset>

      <fieldset>
        <legend>Transition out</legend>
        <select
          value={scene.transitionOut.type}
          onChange={(e) =>
            updateScene({ transitionOut: { ...scene.transitionOut, type: e.target.value as TransitionType } })
          }
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={scene.transitionOut.durationMs}
          onChange={(e) =>
            updateScene({ transitionOut: { ...scene.transitionOut, durationMs: Number(e.target.value) } })
          }
        />
      </fieldset>

      <p className="inspector-hint">Click the storefront image in the preview above to set the door target.</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inspectors/StorefrontInspector.tsx
git commit -m "feat: add StorefrontInspector"
```

---

## Task 11: `InteriorPhotoInspector.tsx` + `InteriorVideoInspector.tsx`

**Files:**
- Create: `src/components/inspectors/InteriorPhotoInspector.tsx`
- Create: `src/components/inspectors/InteriorVideoInspector.tsx`

**Interfaces:**
- Consumes: `InteriorPhotoItem`/`InteriorVideoItem`/`PhotoMotionPreset`/`FitMode`/`TransitionType` (existing).
- Produces: `InteriorPhotoInspector({ project: Project; sceneId: string; itemId: string; updateProject: (updater: (project: Project) => Project) => void })`, `InteriorVideoInspector` with the same prop shape.

Each component internally finds its item and defensively returns `null` if the item is missing or of the wrong `type` (e.g. `StudioView` mis-selecting) — cheap insurance, not exercised in normal use since `StudioView` (Task 13) only renders the matching component for the selected item's actual type.

- [ ] **Step 1: Create `InteriorPhotoInspector.tsx`**

```tsx
// src/components/inspectors/InteriorPhotoInspector.tsx
import type { Project } from '../../models/project';
import type { InteriorPhotoItem, InteriorTourScene, PhotoMotionPreset, TransitionType } from '../../models/scenes';

const PHOTO_MOTION_PRESETS: PhotoMotionPreset[] = ['push-in', 'pull-out', 'pan-left-right', 'pan-right-left'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface InteriorPhotoInspectorProps {
  project: Project;
  sceneId: string;
  itemId: string;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function InteriorPhotoInspector({ project, sceneId, itemId, updateProject }: InteriorPhotoInspectorProps) {
  const scene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour' && s.id === sceneId);
  const item = scene?.items.find((i): i is InteriorPhotoItem => i.id === itemId && i.type === 'photo');
  if (!scene || !item) return null;

  function updateItem(patch: Partial<InteriorPhotoItem>) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => {
        if (s.id !== sceneId || s.type !== 'interior-tour') return s;
        return {
          ...s,
          items: s.items.map((i) => (i.id === itemId && i.type === 'photo' ? { ...i, ...patch } : i)),
        };
      }),
    }));
  }

  return (
    <div className="inspector interior-photo-inspector">
      <h3>Interior Photo</h3>

      <label>
        Duration (ms)
        <input
          type="number"
          value={item.durationMs}
          onChange={(e) => updateItem({ durationMs: Number(e.target.value) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={item.durationLocked}
          onChange={(e) => updateItem({ durationLocked: e.target.checked })}
        />
        Lock duration
      </label>

      <label>
        Motion preset
        <select
          value={item.motionPreset}
          onChange={(e) => updateItem({ motionPreset: e.target.value as PhotoMotionPreset })}
        >
          {PHOTO_MOTION_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Transition to next</legend>
        <select
          value={item.transitionToNext.type}
          onChange={(e) =>
            updateItem({ transitionToNext: { ...item.transitionToNext, type: e.target.value as TransitionType } })
          }
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={item.transitionToNext.durationMs}
          onChange={(e) =>
            updateItem({ transitionToNext: { ...item.transitionToNext, durationMs: Number(e.target.value) } })
          }
        />
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 2: Create `InteriorVideoInspector.tsx`**

```tsx
// src/components/inspectors/InteriorVideoInspector.tsx
import type { Project } from '../../models/project';
import type { FitMode, InteriorTourScene, InteriorVideoItem, TransitionType } from '../../models/scenes';

const FIT_MODES: FitMode[] = ['cover', 'contain'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface InteriorVideoInspectorProps {
  project: Project;
  sceneId: string;
  itemId: string;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function InteriorVideoInspector({ project, sceneId, itemId, updateProject }: InteriorVideoInspectorProps) {
  const scene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour' && s.id === sceneId);
  const item = scene?.items.find((i): i is InteriorVideoItem => i.id === itemId && i.type === 'video');
  if (!scene || !item) return null;

  function updateItem(patch: Partial<InteriorVideoItem>) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => {
        if (s.id !== sceneId || s.type !== 'interior-tour') return s;
        return {
          ...s,
          items: s.items.map((i) => (i.id === itemId && i.type === 'video' ? { ...i, ...patch } : i)),
        };
      }),
    }));
  }

  return (
    <div className="inspector interior-video-inspector">
      <h3>Interior Video</h3>

      <label>
        Trim start (ms)
        <input
          type="number"
          value={item.trimStartMs}
          onChange={(e) => updateItem({ trimStartMs: Number(e.target.value) })}
        />
      </label>
      <label>
        Trim end (ms)
        <input
          type="number"
          value={item.trimEndMs}
          onChange={(e) => updateItem({ trimEndMs: Number(e.target.value) })}
        />
      </label>
      <label>
        Playback rate
        <input
          type="number"
          step="0.1"
          min="0.1"
          value={item.playbackRate}
          onChange={(e) => updateItem({ playbackRate: Number(e.target.value) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={item.audioEnabled}
          onChange={(e) => updateItem({ audioEnabled: e.target.checked })}
        />
        Audio enabled
      </label>
      <label>
        Fit mode
        <select value={item.fitMode} onChange={(e) => updateItem({ fitMode: e.target.value as FitMode })}>
          {FIT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Transition to next</legend>
        <select
          value={item.transitionToNext.type}
          onChange={(e) =>
            updateItem({ transitionToNext: { ...item.transitionToNext, type: e.target.value as TransitionType } })
          }
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={item.transitionToNext.durationMs}
          onChange={(e) =>
            updateItem({ transitionToNext: { ...item.transitionToNext, durationMs: Number(e.target.value) } })
          }
        />
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/inspectors/InteriorPhotoInspector.tsx src/components/inspectors/InteriorVideoInspector.tsx
git commit -m "feat: add InteriorPhotoInspector and InteriorVideoInspector"
```

---

## Task 12: `ScalingControls.tsx`

**Files:**
- Create: `src/components/inspectors/ScalingControls.tsx`

**Interfaces:**
- Consumes: `fitMapToDuration`/`fitInteriorTourToDuration`/`fitProjectToDuration`/`TimelineScalingError` (existing, `src/timeline/scaling.ts`), `MapScene`/`InteriorTourScene` (existing).
- Produces: `ScalingControls({ project: Project; updateProject: (updater: (project: Project) => Project) => void })`.

Always visible (not selection-dependent), per the spec.

- [ ] **Step 1: Create `ScalingControls.tsx`**

```tsx
// src/components/inspectors/ScalingControls.tsx
import { useState } from 'react';
import { fitMapToDuration, fitInteriorTourToDuration, fitProjectToDuration, TimelineScalingError } from '../../timeline/scaling';
import type { Project } from '../../models/project';
import type { InteriorTourScene, MapScene } from '../../models/scenes';

interface ScalingControlsProps {
  project: Project;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function ScalingControls({ project, updateProject }: ScalingControlsProps) {
  const [targetSeconds, setTargetSeconds] = useState('30');
  const [error, setError] = useState<string | null>(null);

  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');

  function targetMs(): number {
    return Math.round(Number(targetSeconds) * 1000);
  }

  function applyFit(kind: 'map' | 'interior' | 'project') {
    setError(null);
    try {
      updateProject((current) => {
        if (kind === 'map') {
          const scene = current.scenes.find((s): s is MapScene => s.type === 'map');
          if (!scene) return current;
          const fitted = fitMapToDuration(scene, targetMs());
          return { ...current, scenes: current.scenes.map((s) => (s.id === scene.id ? fitted : s)) };
        }
        if (kind === 'interior') {
          const scene = current.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');
          if (!scene) return current;
          const fitted = fitInteriorTourToDuration(scene, targetMs());
          return { ...current, scenes: current.scenes.map((s) => (s.id === scene.id ? fitted : s)) };
        }
        return fitProjectToDuration(current, targetMs());
      });
    } catch (err) {
      if (err instanceof TimelineScalingError) {
        setError(err.message);
        return;
      }
      throw err;
    }
  }

  return (
    <div className="inspector scaling-controls">
      <h3>Timeline Scaling</h3>
      <label>
        Target duration (seconds)
        <input type="number" value={targetSeconds} onChange={(e) => setTargetSeconds(e.target.value)} />
      </label>
      <div className="scaling-controls-actions">
        <button type="button" disabled={!mapScene} onClick={() => applyFit('map')}>
          Fit Map Fly-In
        </button>
        <button type="button" disabled={!interiorScene} onClick={() => applyFit('interior')}>
          Fit Interior Tour
        </button>
        <button type="button" onClick={() => applyFit('project')}>
          Fit Full Project
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inspectors/ScalingControls.tsx
git commit -m "feat: add ScalingControls wired to the Phase 2 fit-to-duration functions"
```

---

## Task 13: `StudioView.tsx` — top-level Studio composition

**Files:**
- Create: `src/components/studio/StudioView.tsx`
- Create: `src/components/studio/StudioView.css`

**Interfaces:**
- Consumes: `useProjectStore` (Task 5's `updateProject` + existing `currentProject`/`saveProject`), `useUiStore` (Task 1), `TimelineStrip` (Tasks 7-8), `PreviewStage` (Task 6), `WaypointInspector`/`StorefrontInspector`/`InteriorPhotoInspector`/`InteriorVideoInspector` (Tasks 9-11), `ScalingControls` (Task 12), `computeDoorTargetTransform` (Task 3).
- Produces: `StudioView({ onBack: () => void })`.

Implements the spec's Save-is-explicit design decision (`isDirty` flag, `window.confirm` guard on Back) and wires the storefront door-target click handler onto `PreviewStage`'s `onOverlayClick`.

- [ ] **Step 1: Create `StudioView.tsx`**

```tsx
// src/components/studio/StudioView.tsx
import { useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import './StudioView.css';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { computeDoorTargetTransform } from '../../timeline/waypointEditing';
import type { PlaybackController } from '../../timeline/playbackController';
import { TimelineStrip } from '../timeline/TimelineStrip';
import { PreviewStage } from '../preview/PreviewStage';
import { WaypointInspector } from '../inspectors/WaypointInspector';
import { StorefrontInspector } from '../inspectors/StorefrontInspector';
import { InteriorPhotoInspector } from '../inspectors/InteriorPhotoInspector';
import { InteriorVideoInspector } from '../inspectors/InteriorVideoInspector';
import { ScalingControls } from '../inspectors/ScalingControls';
import type { Project } from '../../models/project';
import type { EvaluatedLayer } from '../../models/timeline';
import type { InteriorTourScene, StorefrontScene } from '../../models/scenes';

interface StudioViewProps {
  onBack: () => void;
}

export function StudioView({ onBack }: StudioViewProps) {
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateProjectAction = useProjectStore((state) => state.updateProject);
  const saveProjectAction = useProjectStore((state) => state.saveProject);
  const selection = useUiStore((state) => state.selection);

  const viewerRef = useRef<Viewer | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  if (!currentProject) return null;

  function updateProject(updater: (project: Project) => Project) {
    updateProjectAction(updater);
    setIsDirty(true);
  }

  async function handleSave() {
    await saveProjectAction();
    setIsDirty(false);
  }

  function handleBack() {
    if (isDirty && !window.confirm('You have unsaved changes. Discard them and go back?')) return;
    onBack();
  }

  function handleSeek(timeMs: number) {
    controllerRef.current?.seek(timeMs);
  }

  function handleOverlayClick(normalized: { x: number; y: number }, layer: EvaluatedLayer) {
    if (!currentProject || selection?.type !== 'storefront') return;
    const storefrontScene = currentProject.scenes.find(
      (s): s is StorefrontScene => s.type === 'storefront' && s.id === selection.sceneId,
    );
    if (!storefrontScene || layer.sourceId !== storefrontScene.assetId) return;

    const newEndTransform = computeDoorTargetTransform(storefrontScene.endTransform, normalized);
    updateProject((project) => ({
      ...project,
      scenes: project.scenes.map((s) =>
        s.id === storefrontScene.id && s.type === 'storefront' ? { ...s, endTransform: newEndTransform } : s,
      ),
    }));
  }

  function renderInspector() {
    if (!selection) return null;

    if (selection.type === 'waypoint') {
      return (
        <WaypointInspector
          project={currentProject}
          sceneId={selection.sceneId}
          waypointId={selection.waypointId}
          updateProject={updateProject}
          viewerRef={viewerRef}
        />
      );
    }
    if (selection.type === 'storefront') {
      return <StorefrontInspector project={currentProject} sceneId={selection.sceneId} updateProject={updateProject} />;
    }
    if (selection.type === 'interior-item') {
      const interiorScene = currentProject.scenes.find(
        (s): s is InteriorTourScene => s.type === 'interior-tour' && s.id === selection.sceneId,
      );
      const item = interiorScene?.items.find((i) => i.id === selection.itemId);
      if (item?.type === 'photo') {
        return (
          <InteriorPhotoInspector
            project={currentProject}
            sceneId={selection.sceneId}
            itemId={selection.itemId}
            updateProject={updateProject}
          />
        );
      }
      if (item?.type === 'video') {
        return (
          <InteriorVideoInspector
            project={currentProject}
            sceneId={selection.sceneId}
            itemId={selection.itemId}
            updateProject={updateProject}
          />
        );
      }
    }
    return null;
  }

  return (
    <div className="studio-view">
      <div className="studio-header">
        <button type="button" onClick={handleBack}>
          Back
        </button>
        <h2>{currentProject.projectName}</h2>
        <button type="button" disabled={!isDirty} onClick={() => void handleSave()}>
          Save
        </button>
      </div>

      <TimelineStrip project={currentProject} onSeek={handleSeek} updateProject={updateProject} />

      <PreviewStage
        project={currentProject}
        onOverlayClick={handleOverlayClick}
        onViewerReady={(viewer) => {
          viewerRef.current = viewer;
        }}
        onControllerReady={(controller) => {
          controllerRef.current = controller;
        }}
      />

      <div className="studio-inspector">{renderInspector()}</div>

      <ScalingControls project={currentProject} updateProject={updateProject} />
    </div>
  );
}
```

- [ ] **Step 2: Create `StudioView.css`**

```css
/* src/components/studio/StudioView.css */
.studio-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 960px;
}

.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.studio-header h2 {
  margin: 0;
  font-size: 16px;
}

.studio-inspector {
  min-height: 40px;
}

.inspector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 480px;
}

.inspector label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.inspector fieldset {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.waypoint-inspector-actions,
.scaling-controls-actions {
  display: flex;
  gap: 8px;
}

.captured-camera-readout {
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 8px;
  font-size: 12px;
  font-family: monospace;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/studio/StudioView.tsx src/components/studio/StudioView.css
git commit -m "feat: add StudioView composing the timeline, preview, and inspectors"
```

---

## Task 14: `ProjectList.tsx` — entry point for reopening a saved project

**Files:**
- Create: `src/components/studio/ProjectList.tsx`

**Interfaces:**
- Consumes: `listProjects` (existing, `src/persistence/projectRepository.ts`), `useProjectStore.loadProject` (existing).
- Produces: `ProjectList({ onOpen: () => void; onCreateNew: () => void })`.

No search/sort/delete UI — out of scope per the spec (YAGNI for an MVP entry point).

- [ ] **Step 1: Create `ProjectList.tsx`**

```tsx
// src/components/studio/ProjectList.tsx
import { useEffect, useState } from 'react';
import { listProjects } from '../../persistence/projectRepository';
import { useProjectStore } from '../../store/projectStore';
import type { Project } from '../../models/project';

interface ProjectListProps {
  onOpen: () => void;
  onCreateNew: () => void;
}

export function ProjectList({ onOpen, onCreateNew }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const loadProject = useProjectStore((state) => state.loadProject);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await listProjects();
      if (cancelled) return;
      setProjects(all);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOpen(id: string) {
    await loadProject(id);
    onOpen();
  }

  return (
    <div className="project-list">
      <button type="button" onClick={onCreateNew}>
        Create New
      </button>
      {loading ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <p>No saved projects yet.</p>
      ) : (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              <button type="button" onClick={() => void handleOpen(project.id)}>
                {project.projectName} — updated {new Date(project.updatedAt).toLocaleString()}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/studio/ProjectList.tsx
git commit -m "feat: add ProjectList for reopening saved projects"
```

---

## Task 15: `App.tsx` routing — wire Studio and ProjectList into the app shell

**Files:**
- Modify: `src/App.tsx` (full current content below)
- Create: `src/App.css`

**Interfaces:**
- Consumes: `ProjectList` (Task 14), `StudioView` (Task 13), `QuickCreateWizard`/`PreviewStage` (existing, Phase 4a), `useProjectStore.currentProject` (existing).
- Produces: the app's top-level view routing (`'project-list' | 'quick-create' | 'preview' | 'studio'`).

This is the final task — after it lands, run the full manual/Playwright end-to-end flow described in Step 4 before considering the phase done.

The current full file:

```tsx
import { useState } from 'react';
import { QuickCreateWizard } from './components/quick-create/QuickCreateWizard';
import { PreviewStage } from './components/preview/PreviewStage';
import type { Project } from './models/project';

export function App() {
  const [draftProject, setDraftProject] = useState<Project | null>(null);

  return (
    <div id="app-shell">
      <h1>Local Fly-In Studio</h1>
      {draftProject ? (
        <PreviewStage project={draftProject} />
      ) : (
        <QuickCreateWizard onDraftReady={setDraftProject} />
      )}
    </div>
  );
}
```

- [ ] **Step 1: Replace `App.tsx`**

```tsx
// src/App.tsx
import { useState } from 'react';
import './App.css';
import { QuickCreateWizard } from './components/quick-create/QuickCreateWizard';
import { PreviewStage } from './components/preview/PreviewStage';
import { ProjectList } from './components/studio/ProjectList';
import { StudioView } from './components/studio/StudioView';
import { useProjectStore } from './store/projectStore';
import type { Project } from './models/project';

type View = 'project-list' | 'quick-create' | 'preview' | 'studio';

export function App() {
  const [view, setView] = useState<View>('project-list');
  const [draftProject, setDraftProject] = useState<Project | null>(null);
  const currentProject = useProjectStore((state) => state.currentProject);

  function handleDraftReady(project: Project) {
    setDraftProject(project);
    setView('preview');
  }

  function handleCreateNew() {
    setDraftProject(null);
    setView('quick-create');
  }

  function handleOpenFromList() {
    setView('studio');
  }

  function handleBackFromStudio() {
    setView('project-list');
  }

  return (
    <div id="app-shell">
      <h1>Local Fly-In Studio</h1>
      {view === 'project-list' && <ProjectList onOpen={handleOpenFromList} onCreateNew={handleCreateNew} />}
      {view === 'quick-create' && <QuickCreateWizard onDraftReady={handleDraftReady} />}
      {view === 'preview' && draftProject && (
        <div className="preview-actions-wrapper">
          <PreviewStage project={draftProject} />
          <div className="preview-actions">
            <button type="button" onClick={() => setView('studio')}>
              Fine-tune in Studio
            </button>
            <button type="button" onClick={handleCreateNew}>
              New Project
            </button>
          </div>
        </div>
      )}
      {view === 'studio' && currentProject && <StudioView onBack={handleBackFromStudio} />}
    </div>
  );
}
```

- [ ] **Step 2: Create `App.css`**

```css
/* src/App.css */
.preview-actions-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 3: Verify TypeScript compiles and the full suite passes**

Run: `npx tsc -b`
Expected: no errors.

Run: `npm run test`
Expected: every test passes, including every suite added in Tasks 1-5.

Run: `npm run build`
Expected: succeeds (this also confirms `dnd-kit` bundles cleanly via Vite).

- [ ] **Step 4: Real-browser end-to-end verification**

Using Playwright MCP tools where available (per this project's established precedent — this is where Phase 4a's most serious bugs were caught and Vitest could not have found them), run `npm run dev` and walk through:

1. From the project list (empty on a fresh DB), click **Create New** → complete Quick Create with a real storefront photo and at least one interior photo and one interior video → land on the preview screen.
2. Click **Fine-tune in Studio**.
3. Select a map waypoint block; click **Capture Current View** (verify the read-only readout appears and nothing else changes); pan/zoom the Cesium view; click **Replace Selected Waypoint** (verify the waypoint's camera updates — e.g. by clicking **Go To Waypoint** afterward and seeing the view snap to the new position, not the old one).
4. Select the Storefront section; click the storefront image in the preview; verify the door target updates (no visible crash; a subsequent playback of the storefront segment reflects the new end position).
5. Expand the interior tour section; select an interior item; edit its duration and transition fields; verify the preview/timeline reflect the edit.
6. Drag-reorder two interior item blocks; verify the block order and the corresponding preview playback order both update.
7. In Scaling Controls, apply **Fit Full Project** with a very small target (e.g. 1 second) to trigger the impossible-target error path; verify the specific `TimelineScalingError` message renders (not a generic failure). Then apply a reasonable target and verify it succeeds.
8. Click **Save**; click **Back**; verify no `window.confirm` fires (nothing unsaved). Reopen the same project from the project list; verify every edit from steps 3-7 persisted.
9. Confirm via `browser_network_requests` (or equivalent) that no request went to `ion.cesium.com`/`api.cesium.com` at any point in this flow, matching the project's "no Cesium ion" constraint.

If any step reveals a bug, fix it before proceeding — this task's review should treat an unexercised step in this list the same as a failing automated test.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat: wire ProjectList and StudioView into App routing"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section has a task — `uiStore` (Task 1), `captureCameraState` (Task 2), `waypointEditing` (Task 3), the waypoint-segment lookup (Task 4), the `updateProject`/explicit-Save design decision (Task 5, Task 13), `PreviewStage`'s two named props plus the plan-added `onControllerReady` (Task 6), the timeline UI (Tasks 7-8), all five inspectors (Tasks 9-12), `StudioView` (Task 13), `ProjectList` (Task 14), and `App.tsx` routing (Task 15).
- **Gap resolved during planning:** the spec described `WaypointBlocks`/`InteriorItemBlocks` calling `controller.seek(...)` but never defined how Studio would reach `PreviewStage`'s internally-owned `PlaybackController`. Task 6 adds `onControllerReady`, mirroring the spec's own `onViewerReady` pattern exactly — this is the plan resolving an implicit requirement, not a new feature.
- **Type consistency:** `updateProject`'s signature — `(updater: (project: Project) => Project) => void` — is introduced in Task 5 and used identically (same parameter name and type) in Tasks 8, 9, 10, 11, 12, and 13. `StudioSelection`'s three variants (Task 1) are matched exactly by the `selection.type` checks in `WaypointBlocks`, `InteriorItemBlocks`, and `StudioView`'s `renderInspector`/`handleOverlayClick`.
- **No placeholders:** every step above contains complete, runnable code; no task defers logic to "later" or references an undefined function/type.
