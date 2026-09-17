# Phase 4a: Cesium Viewer + Quick Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working CesiumJS viewer plus a complete Quick Create flow — storefront photo in, auto-generated draft `Project` out, playable/pausable/scrubbable preview — all driven by the Phase 2 evaluator.

**Architecture:** A `PlaybackController` owns a `requestAnimationFrame` loop and calls `evaluateProjectTimeline` on every tick; a `PreviewStage` component routes each resulting layer to a Cesium camera update, an `<img>`, or a `<video>`. `createDraft` composes already-built Phase 1/2/3 services (media store, EXIF/HEIC pipeline, destination resolver) with one new built-in map template into a saved `Project`.

**Tech Stack:** React 19, TypeScript (strict), Vite, CesiumJS + vite-plugin-cesium, Zustand, Zod, lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-phase-4a-quick-create-design.md`

## Global Constraints

- No Cesium ion dependency — `Cesium.Ion.defaultAccessToken` must never be set to a real token, and imagery must come from USGS, not an ion-hosted layer.
- No Google Maps, Mapbox, or any second mapping library — the same Cesium viewer is reused for "Pick on Map."
- Every playback mode (play, pause, scrub) must go through `evaluateProjectTimeline` — never a direct Cesium `camera.flyTo()`/animation call.
- Continue the project's dependency-injection pattern for every new browser/timing API: an optional last parameter defaulting to the real implementation, so Vitest (`environment: 'node'`, no jsdom) can exercise the logic with fakes.
- Cesium's own rendering is not unit-tested; it is verified by running the app and by confirming `npm run build`'s output renders correctly (see Task 7 and Task 11).
- `resolveFromDeviceLocation`/`resolveFromAddress` are only ever invoked from an explicit user action in the no-GPS fallback UI, never automatically.
- Interior media import order is the default order; no drag-reorder in this phase (Studio/4b feature).
- `dnd-kit` is not installed in this phase.

---

### Task 1: Resolve destination-relative waypoints to absolute camera state

**Why this task exists:** Phase 2's evaluator (`src/timeline/evaluator.ts:25` and `:42`) only produces a `camera` for a segment when the waypoint's `type` is `'absolute'` — for a `'destination-relative'` waypoint it returns `camera: undefined`. Phase 4a's built-in map template (Task 6) generates destination-relative waypoints for every stop after "Earth," exactly as the PRD's data model intends ("Destination-relative waypoints regenerate around Destination"). Without resolving these into real coordinates before the evaluator sees them, the Cesium camera would never move during the auto-generated fly-in — Phase 4a's own acceptance criteria ("preview screen plays... the map fly-in... correctly") would be unmet. This task closes that gap with a small, additive change: it does not touch `evaluator.ts` at all, and every existing Phase 2 test (which only ever uses `type: 'absolute'` waypoints) is unaffected.

**Files:**
- Create: `src/timeline/resolveRelativeCamera.ts`
- Create: `src/tests/resolveRelativeCamera.test.ts`
- Modify: `src/timeline/compiler.ts:36-61` (the `buildMapUnits` function) and `src/timeline/compiler.ts:117` (its call site)
- Modify: `src/tests/compiler.test.ts` (add new tests; existing tests must keep passing unmodified)

**Interfaces:**
- Produces: `resolveRelativeCameraState(relative: RelativeCameraState, destination: Destination): CameraState | null` — used by `compiler.ts` in this task, and available for reuse by 4b's Studio editor later.
- Consumes: `RelativeCameraState`, `CameraState`, `Waypoint` from `../models/scenes`; `Destination` from `../models/project` (all already defined in Phase 1).

- [ ] **Step 1: Write the failing test for `resolveRelativeCameraState`**

Create `src/tests/resolveRelativeCamera.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveRelativeCameraState } from '../timeline/resolveRelativeCamera';
import type { Destination } from '../models/project';

describe('resolveRelativeCameraState', () => {
  it('returns null when the destination has no coordinates yet', () => {
    const destination: Destination = { source: 'address', latitude: null, longitude: null };
    const result = resolveRelativeCameraState(
      { headingDeg: 0, pitchDeg: -30, distanceMeters: 1000, heightMeters: 500 },
      destination,
    );
    expect(result).toBeNull();
  });

  it('places the camera exactly at the destination when distanceMeters is 0, passing height/heading/pitch through and roll at 0', () => {
    const destination: Destination = { source: 'manual', latitude: 10, longitude: 20 };
    const result = resolveRelativeCameraState(
      { headingDeg: 45, pitchDeg: -30, distanceMeters: 0, heightMeters: 500 },
      destination,
    );
    expect(result).not.toBeNull();
    expect(result!.latitude).toBeCloseTo(10, 6);
    expect(result!.longitude).toBeCloseTo(20, 6);
    expect(result!.height).toBe(500);
    expect(result!.heading).toBe(45);
    expect(result!.pitch).toBe(-30);
    expect(result!.roll).toBe(0);
  });

  it('places the camera south of a destination on the equator when headingDeg is 0 (camera looks north back toward it)', () => {
    const destination: Destination = { source: 'manual', latitude: 0, longitude: 0 };
    const result = resolveRelativeCameraState(
      { headingDeg: 0, pitchDeg: -45, distanceMeters: 200_000, heightMeters: 1000 },
      destination,
    );
    expect(result).not.toBeNull();
    expect(result!.latitude).toBeLessThan(0);
    expect(result!.longitude).toBeCloseTo(0, 5);
    expect(result!.heading).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- resolveRelativeCamera`
Expected: FAIL — `Cannot find module '../timeline/resolveRelativeCamera'`.

- [ ] **Step 3: Implement `resolveRelativeCameraState`**

Create `src/timeline/resolveRelativeCamera.ts`:

```ts
import type { CameraState, RelativeCameraState } from '../models/scenes';
import type { Destination } from '../models/project';

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Standard spherical-earth "destination point given start point, bearing, and
 * distance" formula — the same great-circle approximation already used by
 * cameraInterpolation.ts, kept consistent rather than introducing full WGS84
 * ellipsoid precision this MVP-level cinematic camera doesn't need.
 */
function destinationPoint(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  distanceMeters: number,
): { latitude: number; longitude: number } {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDeg);
  const lat1 = toRadians(latDeg);
  const lon1 = toRadians(lonDeg);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { latitude: toDegrees(lat2), longitude: toDegrees(lon2) };
}

/**
 * Resolves a destination-relative waypoint's camera into an absolute
 * CameraState. The camera sits `distanceMeters` from the destination, in the
 * direction opposite `headingDeg` (so that heading `headingDeg` looks back
 * toward the destination), at `heightMeters` above the ellipsoid. Returns
 * null when the destination has no coordinates yet — callers must leave the
 * waypoint destination-relative (unresolved) rather than guessing a camera
 * position.
 */
export function resolveRelativeCameraState(
  relative: RelativeCameraState,
  destination: Destination,
): CameraState | null {
  if (destination.latitude === null || destination.longitude === null) {
    return null;
  }

  const cameraBearingFromDestination = relative.headingDeg + 180;
  const position = destinationPoint(
    destination.latitude,
    destination.longitude,
    cameraBearingFromDestination,
    relative.distanceMeters,
  );

  return {
    latitude: position.latitude,
    longitude: position.longitude,
    height: relative.heightMeters,
    heading: relative.headingDeg,
    pitch: relative.pitchDeg,
    roll: 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- resolveRelativeCamera`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/timeline/resolveRelativeCamera.ts src/tests/resolveRelativeCamera.test.ts
git commit -m "feat: add destination-relative to absolute camera state resolution"
```

- [ ] **Step 6: Write the failing test for `compileProjectTimeline` resolving destination-relative waypoints**

Add to `src/tests/compiler.test.ts` (new `describe` block; do not modify the existing tests):

```ts
describe('compileProjectTimeline — destination-relative waypoints', () => {
  it('resolves a destination-relative waypoint to a real camera when the destination has coordinates', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    project.destination = { source: 'manual', latitude: 10, longitude: 20 };
    mapScene.waypoints = [
      makeWaypoint({ id: 'earth', holdDurationMs: 1000 }),
      {
        id: 'business',
        name: 'Business',
        type: 'destination-relative',
        relativeCamera: { headingDeg: 0, pitchDeg: -25, distanceMeters: 0, heightMeters: 220 },
        travelDurationMs: 1800,
        holdDurationMs: 600,
        travelDurationLocked: false,
        holdDurationLocked: false,
        easing: 'cinematic',
      },
    ];

    const timeline = compileProjectTimeline(project);
    const holdSegment = timeline.segments.find(
      (s) => s.sectionId === mapScene.id && s.kind === 'map-hold' && s.startMs > 1000,
    )!;
    expect(holdSegment.fromWaypoint?.type).toBe('absolute');
    expect(holdSegment.camera).toBeUndefined(); // segments don't carry `camera` directly — evaluator does

    const frame = evaluateProjectTimeline(timeline, holdSegment.startMs);
    const mapLayer = frame.layers.find((l) => l.sourceType === 'map')!;
    expect(mapLayer.camera).toEqual({ latitude: 10, longitude: 20, height: 220, heading: 0, pitch: -25, roll: 0 });
  });

  it('leaves a destination-relative waypoint unresolved (no camera) when the destination has no coordinates', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    project.destination = { source: 'address', latitude: null, longitude: null };
    mapScene.waypoints = [
      {
        id: 'business',
        name: 'Business',
        type: 'destination-relative',
        relativeCamera: { headingDeg: 0, pitchDeg: -25, distanceMeters: 400, heightMeters: 220 },
        travelDurationMs: 0,
        holdDurationMs: 600,
        travelDurationLocked: false,
        holdDurationLocked: false,
        easing: 'cinematic',
      },
    ];

    const timeline = compileProjectTimeline(project);
    const frame = evaluateProjectTimeline(timeline, 0);
    const mapLayer = frame.layers.find((l) => l.sourceType === 'map')!;
    expect(mapLayer.camera).toBeUndefined();
  });
});
```

Add `evaluateProjectTimeline` to the existing `import { compileProjectTimeline } from '../timeline/compiler';` line's neighboring import (add a new import line `import { evaluateProjectTimeline } from '../timeline/evaluator';`).

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm run test -- compiler`
Expected: FAIL — the resolved-coordinates test's `mapLayer.camera` is `undefined` instead of the expected object (destination-relative waypoints aren't resolved yet).

- [ ] **Step 8: Modify `compiler.ts` to resolve destination-relative waypoints before building map units**

In `src/timeline/compiler.ts`, add to the top-of-file imports:

```ts
import type { Destination } from '../models/project';
import { resolveRelativeCameraState } from './resolveRelativeCamera';
```

Replace the `buildMapUnits` function (currently `src/timeline/compiler.ts:36-61`) with:

```ts
function resolveWaypointCamera(waypoint: Waypoint, destination: Destination): Waypoint {
  if (waypoint.type === 'absolute') return waypoint;
  const camera = resolveRelativeCameraState(waypoint.relativeCamera, destination);
  if (!camera) return waypoint;
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

function buildMapUnits(scene: MapScene, destination: Destination): PendingUnit[] {
  const resolvedWaypoints = scene.waypoints.map((wp) => resolveWaypointCamera(wp, destination));
  const units: PendingUnit[] = [];
  resolvedWaypoints.forEach((waypoint, index) => {
    if (index > 0) {
      const prev = resolvedWaypoints[index - 1];
      units.push({
        sectionId: scene.id,
        kind: 'map-travel',
        sourceType: 'map',
        sourceId: 'map',
        durationMs: waypoint.travelDurationMs,
        fromWaypoint: prev,
        toWaypoint: waypoint,
      });
    }
    units.push({
      sectionId: scene.id,
      kind: 'map-hold',
      sourceType: 'map',
      sourceId: 'map',
      durationMs: waypoint.holdDurationMs,
      fromWaypoint: waypoint,
    });
  });
  return units;
}
```

Update the call site at `src/timeline/compiler.ts:117` from:

```ts
  if (mapScene) units.push(...buildMapUnits(mapScene));
```

to:

```ts
  if (mapScene) units.push(...buildMapUnits(mapScene, project.destination));
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm run test -- compiler`
Expected: PASS — all existing `compiler.test.ts` tests plus the two new ones.

Then run the full suite to confirm no regressions elsewhere:

Run: `npm run test`
Expected: PASS, same total test count as before plus the 3 new `resolveRelativeCamera` tests and 2 new `compiler` tests.

- [ ] **Step 10: Commit**

```bash
git add src/timeline/compiler.ts src/tests/compiler.test.ts
git commit -m "fix: resolve destination-relative waypoints to real camera state at compile time"
```

---

### Task 2: Install and configure Cesium, vite-plugin-cesium, and lucide-react

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: the `cesium` package importable as `import * as Cesium from 'cesium'`; Vite serving/bundling Cesium's static assets automatically; `lucide-react` importable as `import { IconName } from 'lucide-react'`.

- [ ] **Step 1: Install the dependencies**

```bash
npm install cesium lucide-react
npm install -D vite-plugin-cesium
```

- [ ] **Step 2: Configure Vite**

Update `vite.config.ts` to:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [react(), cesium()],
  test: {
    environment: 'node',
    globals: false,
  },
});
```

**Verification note for the implementer:** confirm against `node_modules/vite-plugin-cesium`'s own README/type definitions that the plugin's default export is a zero-argument factory function used exactly this way — this is the documented usage as of this writing, but versions drift. If the installed version's API differs, adjust the config to match while preserving the same outcome (Cesium's static assets copied into the build, `CESIUM_BASE_URL` set automatically, no Cesium ion token configured anywhere).

- [ ] **Step 3: Verify the dev server starts and the production build succeeds**

Run: `npm run build`
Expected: succeeds with no errors. Inspect `dist/` (or the configured build output directory) and confirm it contains a `cesium/` (or similarly named) subdirectory with Cesium's `Workers`, `Assets`, and `Widgets` folders — evidence the plugin copied Cesium's static assets.

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `npm run test`
Expected: PASS, same test count as the end of Task 1 (this task adds no new Vitest tests — it is a dependency/config change with no testable logic of its own).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "build: add cesium, vite-plugin-cesium, and lucide-react"
```

---

### Task 3: Camera state translation for Cesium (`applyCameraState`)

**Files:**
- Create: `src/cesium/applyCameraState.ts`
- Test: `src/tests/applyCameraState.test.ts`

**Interfaces:**
- Consumes: `CameraState` from `../models/scenes` (fields in degrees: `longitude`, `latitude`, `height`, `heading`, `pitch`, `roll`).
- Produces: `applyCameraState(viewer: CesiumViewerLike, camera: CameraState): void`, used by Task 10's `PreviewStage`.

**Design note:** the real `cesium` package is not imported at the top level of the test file — this project's Vitest config runs with `environment: 'node'` and no jsdom, and Cesium's bundle is written for a browser and is not guaranteed to evaluate cleanly under Node (the same category of problem Phase 3 hit with `heic2any`). The test instead mocks the `cesium` module entirely with `vi.mock`, so it verifies the translation math (degrees→radians conversion, which arguments get passed to `Cartesian3.fromDegrees` and `camera.setView`) without ever loading real Cesium.

- [ ] **Step 1: Write the failing test**

Create `src/tests/applyCameraState.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { CameraState } from '../models/scenes';

const fromDegreesMock = vi.fn((longitude: number, latitude: number, height: number) => ({
  __fakeCartesian3: true,
  longitude,
  latitude,
  height,
}));

vi.mock('cesium', () => ({
  Cartesian3: { fromDegrees: fromDegreesMock },
  Math: { toRadians: (deg: number) => (deg * Math.PI) / 180 },
}));

describe('applyCameraState', () => {
  it('converts degrees to radians and calls viewer.camera.setView with the right destination and orientation', async () => {
    const { applyCameraState } = await import('../cesium/applyCameraState');
    const setView = vi.fn();
    const fakeViewer = { camera: { setView } } as unknown as Parameters<typeof applyCameraState>[0];

    const camera: CameraState = {
      longitude: -104.9,
      latitude: 39.7,
      height: 500,
      heading: 90,
      pitch: -30,
      roll: 0,
    };

    applyCameraState(fakeViewer, camera);

    expect(fromDegreesMock).toHaveBeenCalledWith(-104.9, 39.7, 500);
    expect(setView).toHaveBeenCalledTimes(1);
    const call = setView.mock.calls[0][0];
    expect(call.destination).toEqual({ __fakeCartesian3: true, longitude: -104.9, latitude: 39.7, height: 500 });
    expect(call.orientation.heading).toBeCloseTo((90 * Math.PI) / 180, 10);
    expect(call.orientation.pitch).toBeCloseTo((-30 * Math.PI) / 180, 10);
    expect(call.orientation.roll).toBeCloseTo(0, 10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- applyCameraState`
Expected: FAIL — `Cannot find module '../cesium/applyCameraState'`.

- [ ] **Step 3: Implement `applyCameraState`**

Create `src/cesium/applyCameraState.ts`:

```ts
import { Cartesian3, Math as CesiumMath } from 'cesium';
import type { Viewer } from 'cesium';
import type { CameraState } from '../models/scenes';

export function applyCameraState(viewer: Viewer, camera: CameraState): void {
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(camera.longitude, camera.latitude, camera.height),
    orientation: {
      heading: CesiumMath.toRadians(camera.heading),
      pitch: CesiumMath.toRadians(camera.pitch),
      roll: CesiumMath.toRadians(camera.roll),
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- applyCameraState`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cesium/applyCameraState.ts src/tests/applyCameraState.test.ts
git commit -m "feat: add CameraState to Cesium viewer translation"
```

---

### Task 4: Playback controller

**Files:**
- Create: `src/timeline/playbackController.ts`
- Test: `src/tests/playbackController.test.ts`

**Interfaces:**
- Consumes: `CompiledTimeline`, `EvaluatedFrame` from `../models/timeline`; `evaluateProjectTimeline` from `./evaluator` (Phase 2, unchanged).
- Produces:
  ```ts
  export interface PlaybackControllerOptions {
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
    now?: () => number;
  }
  export type PlaybackListener = (frame: EvaluatedFrame, timeMs: number) => void;
  export class PlaybackController {
    constructor(timeline: CompiledTimeline, options?: PlaybackControllerOptions);
    play(): void;
    pause(): void;
    seek(timeMs: number): void;
    subscribe(listener: PlaybackListener): () => void;
    get isPlaying(): boolean;
    get currentTimeMs(): number;
    destroy(): void;
  }
  ```
  Used by Task 10's `PreviewStage` and `PlaybackControls`.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/playbackController.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { PlaybackController } from '../timeline/playbackController';
import { compileProjectTimeline } from '../timeline/compiler';
import { makeMinimalProject } from './fixtures';

function makeFakeScheduler() {
  let pendingCallback: FrameRequestCallback | null = null;
  let nextHandle = 1;
  const cancelled: number[] = [];
  return {
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      pendingCallback = cb;
      return nextHandle++;
    },
    cancelAnimationFrame: (handle: number) => {
      cancelled.push(handle);
    },
    fireFrame(timestamp: number) {
      const cb = pendingCallback;
      pendingCallback = null;
      cb?.(timestamp);
    },
    get cancelledHandles() {
      return cancelled;
    },
  };
}

function makeFakeClock(startAt = 0) {
  let current = startAt;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe('PlaybackController', () => {
  const timeline = compileProjectTimeline(makeMinimalProject());

  it('play() advances currentTimeMs by now() deltas across multiple frames', () => {
    const scheduler = makeFakeScheduler();
    const clock = makeFakeClock(0);
    const controller = new PlaybackController(timeline, {
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
      now: clock.now,
    });

    controller.play();
    clock.advance(500);
    scheduler.fireFrame(500);
    expect(controller.currentTimeMs).toBe(500);

    clock.advance(300);
    scheduler.fireFrame(800);
    expect(controller.currentTimeMs).toBe(800);

    controller.destroy();
  });

  it('pause() stops advancing and a later play() resumes from the paused time', () => {
    const scheduler = makeFakeScheduler();
    const clock = makeFakeClock(0);
    const controller = new PlaybackController(timeline, {
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
      now: clock.now,
    });

    controller.play();
    clock.advance(400);
    scheduler.fireFrame(400);
    expect(controller.currentTimeMs).toBe(400);

    controller.pause();
    clock.advance(10_000);
    expect(controller.currentTimeMs).toBe(400);
    expect(controller.isPlaying).toBe(false);

    controller.play();
    clock.advance(100);
    scheduler.fireFrame(100);
    expect(controller.currentTimeMs).toBe(500);

    controller.destroy();
  });

  it('seek() updates currentTimeMs and notifies subscribers without requiring play()', () => {
    const controller = new PlaybackController(timeline);
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.seek(1200);

    expect(controller.currentTimeMs).toBe(1200);
    expect(controller.isPlaying).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1]).toBe(1200);

    controller.destroy();
  });

  it('reaching totalDurationMs auto-pauses', () => {
    const scheduler = makeFakeScheduler();
    const clock = makeFakeClock(0);
    const controller = new PlaybackController(timeline, {
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
      now: clock.now,
    });

    controller.play();
    clock.advance(timeline.totalDurationMs + 5000);
    scheduler.fireFrame(timeline.totalDurationMs + 5000);

    expect(controller.currentTimeMs).toBe(timeline.totalDurationMs);
    expect(controller.isPlaying).toBe(false);

    controller.destroy();
  });

  it('notifies multiple subscribers on every notification', () => {
    const controller = new PlaybackController(timeline);
    const a = vi.fn();
    const b = vi.fn();
    controller.subscribe(a);
    controller.subscribe(b);

    controller.seek(300);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it('destroy() stops future notifications and cancels the pending frame', () => {
    const scheduler = makeFakeScheduler();
    const clock = makeFakeClock(0);
    const controller = new PlaybackController(timeline, {
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
      now: clock.now,
    });
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.play();
    const cancelledBefore = scheduler.cancelledHandles.length;
    controller.destroy();

    expect(scheduler.cancelledHandles.length).toBe(cancelledBefore + 1);

    controller.seek(999);
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- playbackController`
Expected: FAIL — `Cannot find module '../timeline/playbackController'`.

- [ ] **Step 3: Implement `PlaybackController`**

Create `src/timeline/playbackController.ts`:

```ts
import type { CompiledTimeline, EvaluatedFrame } from '../models/timeline';
import { evaluateProjectTimeline } from './evaluator';

export interface PlaybackControllerOptions {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
}

export type PlaybackListener = (frame: EvaluatedFrame, timeMs: number) => void;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class PlaybackController {
  private readonly timeline: CompiledTimeline;
  private readonly raf: (callback: FrameRequestCallback) => number;
  private readonly caf: (handle: number) => void;
  private readonly nowFn: () => number;
  private readonly listeners = new Set<PlaybackListener>();
  private playing = false;
  private timeMs = 0;
  private frameHandle: number | null = null;
  private lastTickAt = 0;

  constructor(timeline: CompiledTimeline, options: PlaybackControllerOptions = {}) {
    this.timeline = timeline;
    this.raf = options.requestAnimationFrame ?? requestAnimationFrame;
    this.caf = options.cancelAnimationFrame ?? cancelAnimationFrame;
    this.nowFn = options.now ?? (() => performance.now());
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTimeMs(): number {
    return this.timeMs;
  }

  play(): void {
    if (this.playing) return;
    if (this.timeMs >= this.timeline.totalDurationMs) {
      this.timeMs = 0;
    }
    this.playing = true;
    this.lastTickAt = this.nowFn();
    this.frameHandle = this.raf(this.tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.frameHandle !== null) {
      this.caf(this.frameHandle);
      this.frameHandle = null;
    }
  }

  seek(timeMs: number): void {
    this.timeMs = clamp(timeMs, 0, this.timeline.totalDurationMs);
    this.notify();
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.frameHandle !== null) {
      this.caf(this.frameHandle);
      this.frameHandle = null;
    }
    this.playing = false;
    this.listeners.clear();
  }

  private readonly tick = (): void => {
    if (!this.playing) return;
    const currentNow = this.nowFn();
    const deltaMs = currentNow - this.lastTickAt;
    this.lastTickAt = currentNow;
    this.timeMs = clamp(this.timeMs + deltaMs, 0, this.timeline.totalDurationMs);
    this.notify();
    if (this.timeMs >= this.timeline.totalDurationMs) {
      this.pause();
      return;
    }
    this.frameHandle = this.raf(this.tick);
  };

  private notify(): void {
    const frame = evaluateProjectTimeline(this.timeline, this.timeMs);
    for (const listener of this.listeners) {
      listener(frame, this.timeMs);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- playbackController`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/timeline/playbackController.ts src/tests/playbackController.test.ts
git commit -m "feat: add PlaybackController driving play/pause/seek through the evaluator"
```

---

### Task 5: Video metadata extraction

**Files:**
- Create: `src/media/videoMetadata.ts`
- Test: `src/tests/videoMetadata.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface VideoMetadata {
    durationMs: number;
    width: number;
    height: number;
  }
  export async function extractVideoMetadata(
    file: File | Blob,
    loadMetadata?: (file: File | Blob) => Promise<VideoMetadata>,
  ): Promise<VideoMetadata>;
  ```
  Used by Task 8's `createDraft.ts` to set an interior video item's initial duration.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/videoMetadata.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { extractVideoMetadata, type VideoMetadata } from '../media/videoMetadata';

describe('extractVideoMetadata', () => {
  it('resolves with duration/width/height from the injected loader', async () => {
    const fakeLoad = vi.fn().mockResolvedValue({ durationMs: 4200, width: 1920, height: 1080 });
    const result = await extractVideoMetadata(new Blob(), fakeLoad);
    expect(result).toEqual({ durationMs: 4200, width: 1920, height: 1080 });
  });

  it('rejects when the loader simulates the underlying video element firing an error event', async () => {
    const fakeLoad = vi.fn().mockImplementation(
      () =>
        new Promise<VideoMetadata>((_resolve, reject) => {
          // Mirrors defaultLoadMetadata's video.onerror handler.
          reject(new Error('Could not read video metadata'));
        }),
    );
    await expect(extractVideoMetadata(new Blob(), fakeLoad)).rejects.toThrow(
      'Could not read video metadata',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- videoMetadata`
Expected: FAIL — `Cannot find module '../media/videoMetadata'`.

- [ ] **Step 3: Implement `extractVideoMetadata`**

Create `src/media/videoMetadata.ts`:

```ts
export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
}

async function defaultLoadMetadata(file: File | Blob): Promise<VideoMetadata> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    return await new Promise<VideoMetadata>((resolve, reject) => {
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve({
          durationMs: video.duration * 1000,
          width: video.videoWidth,
          height: video.videoHeight,
        });
      };
      video.onerror = () => {
        reject(new Error('Could not read video metadata'));
      };
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractVideoMetadata(
  file: File | Blob,
  loadMetadata: (file: File | Blob) => Promise<VideoMetadata> = defaultLoadMetadata,
): Promise<VideoMetadata> {
  return loadMetadata(file);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- videoMetadata`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/media/videoMetadata.ts src/tests/videoMetadata.test.ts
git commit -m "feat: add video duration/dimension extraction"
```

---

### Task 6: Built-in map template

**Files:**
- Create: `src/persistence/templates.ts`
- Test: `src/tests/templates.test.ts`

**Interfaces:**
- Consumes: `Destination` from `../models/project`; `MapScene`, `Waypoint`, `MapSceneSchema` from `../models/scenes`.
- Produces: `createMapSceneFromTemplate(destination: Destination): MapScene`, used by Task 8's `createDraft.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMapSceneFromTemplate } from '../persistence/templates';
import { MapSceneSchema } from '../models/scenes';
import type { Destination } from '../models/project';

describe('createMapSceneFromTemplate', () => {
  const destination: Destination = { source: 'photo-gps', latitude: 39.5, longitude: -104.9 };

  it('produces 6 waypoints: Earth (absolute) followed by 5 destination-relative stops', () => {
    const scene = createMapSceneFromTemplate(destination);
    expect(scene.type).toBe('map');
    expect(scene.waypoints).toHaveLength(6);
    expect(scene.waypoints[0].type).toBe('absolute');
    expect(scene.waypoints[0].name).toBe('Earth');
    for (const wp of scene.waypoints.slice(1)) {
      expect(wp.type).toBe('destination-relative');
    }
    expect(scene.waypoints.slice(1).map((w) => w.name)).toEqual([
      'Region',
      'Metro',
      'City',
      'Neighborhood',
      'Business',
    ]);
  });

  it('uses the PRD default timings', () => {
    const scene = createMapSceneFromTemplate(destination);
    const [earth, region, metro, city, neighborhood, business] = scene.waypoints;
    expect(earth.holdDurationMs).toBe(1000);
    expect(region.travelDurationMs).toBe(1500);
    expect(metro.travelDurationMs).toBe(1400);
    expect(city.travelDurationMs).toBe(1300);
    expect(neighborhood.travelDurationMs).toBe(1300);
    expect(business.travelDurationMs).toBe(1800);
    expect(business.holdDurationMs).toBe(600);
  });

  it('produces a valid MapScene even when the destination has no coordinates yet', () => {
    const unresolved: Destination = { source: 'address', latitude: null, longitude: null, originalAddress: '123 Main St' };
    const scene = createMapSceneFromTemplate(unresolved);
    expect(() => MapSceneSchema.parse(scene)).not.toThrow();
  });

  it('validates against MapSceneSchema for a resolved destination', () => {
    const scene = createMapSceneFromTemplate(destination);
    expect(() => MapSceneSchema.parse(scene)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- templates`
Expected: FAIL — `Cannot find module '../persistence/templates'`.

- [ ] **Step 3: Implement `createMapSceneFromTemplate`**

Create `src/persistence/templates.ts`:

```ts
import type { Destination } from '../models/project';
import type { MapScene, Waypoint } from '../models/scenes';

const EARTH_OVERVIEW_WAYPOINT: Waypoint = {
  id: 'template-earth',
  name: 'Earth',
  type: 'absolute',
  camera: { longitude: 0, latitude: 0, height: 20_000_000, heading: 0, pitch: -90, roll: 0 },
  travelDurationMs: 0,
  holdDurationMs: 1000,
  travelDurationLocked: false,
  holdDurationLocked: false,
  easing: 'cinematic',
};

interface RelativeStop {
  id: string;
  name: string;
  travelDurationMs: number;
  holdDurationMs: number;
  headingDeg: number;
  pitchDeg: number;
  distanceMeters: number;
  heightMeters: number;
}

// Suggested defaults per the PRD's "Standard Local Business Fly-In" template.
// distanceMeters/heightMeters/headingDeg/pitchDeg are not specified by the PRD
// numerically — these are sensible cinematic defaults (decreasing zoom level
// from region to business); every value here is user-adjustable in Studio (4b).
const RELATIVE_STOPS: RelativeStop[] = [
  { id: 'template-region', name: 'Region', travelDurationMs: 1500, holdDurationMs: 0, headingDeg: 0, pitchDeg: -45, distanceMeters: 300_000, heightMeters: 200_000 },
  { id: 'template-metro', name: 'Metro', travelDurationMs: 1400, holdDurationMs: 0, headingDeg: 0, pitchDeg: -45, distanceMeters: 80_000, heightMeters: 50_000 },
  { id: 'template-city', name: 'City', travelDurationMs: 1300, holdDurationMs: 0, headingDeg: 0, pitchDeg: -40, distanceMeters: 20_000, heightMeters: 12_000 },
  { id: 'template-neighborhood', name: 'Neighborhood', travelDurationMs: 1300, holdDurationMs: 0, headingDeg: 0, pitchDeg: -35, distanceMeters: 3_000, heightMeters: 1_800 },
  { id: 'template-business', name: 'Business', travelDurationMs: 1800, holdDurationMs: 600, headingDeg: 0, pitchDeg: -25, distanceMeters: 400, heightMeters: 220 },
];

export function createMapSceneFromTemplate(destination: Destination): MapScene {
  const waypoints: Waypoint[] = [
    EARTH_OVERVIEW_WAYPOINT,
    ...RELATIVE_STOPS.map(
      (stop): Waypoint => ({
        id: stop.id,
        name: stop.name,
        type: 'destination-relative',
        relativeCamera: {
          headingDeg: stop.headingDeg,
          pitchDeg: stop.pitchDeg,
          distanceMeters: stop.distanceMeters,
          heightMeters: stop.heightMeters,
        },
        travelDurationMs: stop.travelDurationMs,
        holdDurationMs: stop.holdDurationMs,
        travelDurationLocked: false,
        holdDurationLocked: false,
        easing: 'cinematic',
      }),
    ),
  ];

  return {
    id: `map-${destination.source}-${crypto.randomUUID()}`,
    type: 'map',
    waypoints,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- templates`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/templates.ts src/tests/templates.test.ts
git commit -m "feat: add built-in Standard Local Business Fly-In map template"
```

---

### Task 7: Cesium viewer and USGS imagery provider

**Files:**
- Create: `src/cesium/imagery.ts`
- Create: `src/cesium/viewer.ts`

**Interfaces:**
- Produces:
  ```ts
  // imagery.ts
  export function createUsgsImageryProvider(): Cesium.ImageryProvider;

  // viewer.ts
  export interface CesiumViewerHandle {
    viewer: Cesium.Viewer;
    destroy: () => void;
  }
  export function createCesiumViewer(container: HTMLElement): CesiumViewerHandle;
  ```
  Used by Task 9's `NoDestinationFallback` and Task 10's `PreviewStage`.

**No Vitest coverage for this task** — per the spec's design decision, Cesium's real viewer/rendering is verified by running the app, not by Node-environment unit tests. Verification here is a real, automated browser check via the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`), not a manual step for a human to perform later.

- [ ] **Step 1: Implement the USGS imagery provider**

Create `src/cesium/imagery.ts`:

```ts
import { WebMapTileServiceImageryProvider } from 'cesium';

/**
 * USGS The National Map's imagery service (aerial/satellite), consumed as a
 * WMTS endpoint. Verify the exact currently-published USGS WMTS URL and
 * layer/tile-matrix-set identifiers against USGS's own documentation before
 * relying on this — the values below are believed correct as of this
 * writing but USGS endpoints have moved before. No Cesium ion is used here
 * or anywhere else in this file.
 */
export function createUsgsImageryProvider(): WebMapTileServiceImageryProvider {
  return new WebMapTileServiceImageryProvider({
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS/tile/1.0.0/USGSImageryOnly/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    layer: 'USGSImageryOnly',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: 'default028mm',
    maximumLevel: 19,
  });
}
```

- [ ] **Step 2: Implement the Cesium viewer factory**

Create `src/cesium/viewer.ts`:

```ts
import { Ion, Viewer, EllipsoidTerrainProvider } from 'cesium';
import { createUsgsImageryProvider } from './imagery';

export interface CesiumViewerHandle {
  viewer: Viewer;
  destroy: () => void;
}

export function createCesiumViewer(container: HTMLElement): CesiumViewerHandle {
  // No Cesium ion dependency anywhere in this app.
  Ion.defaultAccessToken = '';

  const viewer = new Viewer(container, {
    imageryProvider: createUsgsImageryProvider(),
    terrainProvider: new EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  });

  return {
    viewer,
    destroy: () => viewer.destroy(),
  };
}
```

- [ ] **Step 3: Type-check the new files**

Run: `npx tsc -b`
Expected: succeeds with no errors (confirms the Cesium API surface used here — `Viewer`, `EllipsoidTerrainProvider`, `Ion`, `WebMapTileServiceImageryProvider` constructor options — matches the installed `cesium` package's type definitions). If any option name doesn't compile, check `node_modules/cesium/Source/Widgets/Viewer/Viewer.d.ts` (or the equivalent bundled `.d.ts`) for the current option names and adjust — keep the same intent (all stock Cesium UI chrome disabled, no ion, USGS imagery, flat ellipsoid terrain).

- [ ] **Step 4: Verify the globe actually renders, using Playwright**

If the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`) are available to you: start the dev server in the background (`npm run dev`), use `browser_navigate` to open it, temporarily render a minimal page that calls `createCesiumViewer` against a full-size container div (a throwaway scratch change is fine — revert it after this check, it is not part of this task's deliverable), take a screenshot with `browser_take_screenshot`, and check `browser_console_messages` for errors. Confirm the screenshot shows Cesium's globe with visible imagery tiles (not a blank/black canvas) and the console has no uncaught errors. Stop the dev server afterward.

If Playwright MCP tools are not available to you: report this task as `DONE_WITH_CONCERNS` and note that visual rendering was not verified — a human needs to run `npm run dev` and confirm the globe renders before this phase is considered complete (Task 11 repeats this check against the full app, so it is not lost if skipped here).

- [ ] **Step 5: Commit**

```bash
git add src/cesium/imagery.ts src/cesium/viewer.ts
git commit -m "feat: add Cesium viewer with USGS National Map imagery, no ion"
```

---

### Task 8: Quick Create draft algorithm (`createDraft`)

**Files:**
- Create: `src/quickCreate/createDraft.ts`
- Test: `src/tests/createDraft.test.ts`

**Interfaces:**
- Consumes:
  - `MediaAssetStore`, `StoredMediaAsset` from `../media/MediaAssetStore` (Phase 1)
  - `createMediaAssetStore` from `../media/createMediaAssetStore` (Phase 1)
  - `extractImageMetadata`, `ExtractedMediaMetadata` from `../media/metadata` (Phase 3)
  - `isHeic`, `convertHeicToJpeg` from `../media/imageDecoder` (Phase 3)
  - `resolveFromPhotoGps` from `../destination/resolver` (Phase 3)
  - `extractVideoMetadata` from `../media/videoMetadata` (Task 5)
  - `createMapSceneFromTemplate` from `../persistence/templates` (Task 6)
  - `Project`, `Destination`, `CURRENT_SCHEMA_VERSION` from `../models/project`
  - `ProjectScene`, `StorefrontScene`, `InteriorTourItem`, `Transition` from `../models/scenes`
  - `MediaAsset` from `../models/media`
- Produces:
  ```ts
  export class NoDestinationError extends Error {}
  export interface CreateDraftInput {
    storefrontPhoto: File;
    interiorMedia: File[];
    destinationOverride?: Destination;
  }
  export interface CreateDraftDependencies {
    mediaStore: MediaAssetStore;
    extractImageMetadata: typeof extractImageMetadata;
    extractVideoMetadata: typeof extractVideoMetadata;
    resolveFromPhotoGps: typeof resolveFromPhotoGps;
    isHeic: typeof isHeic;
    convertHeicToJpeg: typeof convertHeicToJpeg;
  }
  export async function createDraft(
    input: CreateDraftInput,
    deps?: Partial<CreateDraftDependencies>,
  ): Promise<Project>;
  ```
  Used by Task 9's `QuickCreateWizard`.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/createDraft.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createDraft, NoDestinationError, type CreateDraftDependencies } from '../quickCreate/createDraft';
import { ProjectSchema } from '../models/project';
import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import type { VideoMetadata } from '../media/videoMetadata';

function makeFakeMediaStore(): MediaAssetStore {
  let counter = 0;
  return {
    save: vi.fn(async (file: File): Promise<StoredMediaAsset> => {
      counter += 1;
      return {
        id: `asset-${counter}`,
        storageLocation: 'indexeddb',
        storageKey: `key-${counter}`,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        filename: file.name,
      };
    }),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
  };
}

function makeDeps(overrides: Partial<CreateDraftDependencies> = {}): Partial<CreateDraftDependencies> {
  return {
    mediaStore: makeFakeMediaStore(),
    extractImageMetadata: vi.fn(async () => ({ latitude: 39.5, longitude: -104.9 })),
    resolveFromPhotoGps: vi.fn((metadata) =>
      typeof metadata.latitude === 'number' && typeof metadata.longitude === 'number'
        ? { source: 'photo-gps' as const, latitude: metadata.latitude, longitude: metadata.longitude }
        : null,
    ),
    isHeic: vi.fn(() => false),
    convertHeicToJpeg: vi.fn(async () => ({ ok: true as const, blob: new Blob() })),
    extractVideoMetadata: vi.fn(async (): Promise<VideoMetadata> => ({ durationMs: 6000, width: 1920, height: 1080 })),
    ...overrides,
  };
}

function makeFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

describe('createDraft', () => {
  it('produces a valid Project from a photo-GPS destination and mixed interior media', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('room.jpg', 'image/jpeg'), makeFile('clip.mp4', 'video/mp4')],
      },
      deps,
    );

    expect(() => ProjectSchema.parse(project)).not.toThrow();
    expect(project.destination).toEqual({ source: 'photo-gps', latitude: 39.5, longitude: -104.9 });
    expect(project.scenes.map((s) => s.type)).toEqual(['map', 'storefront', 'interior-tour']);
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(interiorScene.items).toHaveLength(2);
    expect(interiorScene.items[0].type).toBe('photo');
    expect(interiorScene.items[1].type).toBe('video');
  });

  it('throws NoDestinationError when the photo has no GPS and no override is supplied', async () => {
    const deps = makeDeps({ extractImageMetadata: vi.fn(async () => ({})) });
    await expect(
      createDraft({ storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] }, deps),
    ).rejects.toBeInstanceOf(NoDestinationError);
  });

  it('uses destinationOverride and never calls resolveFromPhotoGps when it is supplied', async () => {
    const deps = makeDeps({ extractImageMetadata: vi.fn(async () => ({})) });
    const override = { source: 'manual' as const, latitude: 1, longitude: 2 };
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [], destinationOverride: override },
      deps,
    );
    expect(project.destination).toEqual(override);
    expect(deps.resolveFromPhotoGps).not.toHaveBeenCalled();
  });

  it('produces a valid two-scene Project (no interior-tour scene) when interiorMedia is empty', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] },
      deps,
    );
    expect(() => ProjectSchema.parse(project)).not.toThrow();
    expect(project.scenes.map((s) => s.type)).toEqual(['map', 'storefront']);
  });

  it('applies default push-in motion to every photo item and crossfade transitions to every item', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('a.jpg', 'image/jpeg'), makeFile('b.jpg', 'image/jpeg')],
      },
      deps,
    );
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    for (const item of interiorScene.items) {
      expect(item.transitionToNext).toEqual({ type: 'crossfade', durationMs: 500 });
      if (item.type === 'photo') {
        expect(item.motionPreset).toBe('push-in');
      }
    }
  });

  it('keeps import order as the default interior item order', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('first.jpg', 'image/jpeg'), makeFile('second.mp4', 'video/mp4'), makeFile('third.jpg', 'image/jpeg')],
      },
      deps,
    );
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(interiorScene.items.map((i) => i.type)).toEqual(['photo', 'video', 'photo']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- createDraft`
Expected: FAIL — `Cannot find module '../quickCreate/createDraft'`.

- [ ] **Step 3: Implement `createDraft`**

Create `src/quickCreate/createDraft.ts`:

```ts
import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import { createMediaAssetStore } from '../media/createMediaAssetStore';
import { extractImageMetadata, type ExtractedMediaMetadata } from '../media/metadata';
import { isHeic, convertHeicToJpeg } from '../media/imageDecoder';
import { resolveFromPhotoGps } from '../destination/resolver';
import { extractVideoMetadata } from '../media/videoMetadata';
import { createMapSceneFromTemplate } from '../persistence/templates';
import { CURRENT_SCHEMA_VERSION, type Project, type Destination } from '../models/project';
import type { ProjectScene, StorefrontScene, InteriorTourItem, Transition } from '../models/scenes';
import type { MediaAsset } from '../models/media';

export class NoDestinationError extends Error {
  constructor() {
    super('Could not determine a destination for this storefront photo — no GPS data found.');
    this.name = 'NoDestinationError';
  }
}

export interface CreateDraftInput {
  storefrontPhoto: File;
  interiorMedia: File[];
  destinationOverride?: Destination;
}

export interface CreateDraftDependencies {
  mediaStore: MediaAssetStore;
  extractImageMetadata: typeof extractImageMetadata;
  extractVideoMetadata: typeof extractVideoMetadata;
  resolveFromPhotoGps: typeof resolveFromPhotoGps;
  isHeic: typeof isHeic;
  convertHeicToJpeg: typeof convertHeicToJpeg;
}

async function heicToJpegFile(
  file: File,
  doConvertHeicToJpeg: CreateDraftDependencies['convertHeicToJpeg'],
): Promise<File> {
  const result = await doConvertHeicToJpeg(file);
  if (!result.ok) {
    throw new Error(result.error);
  }
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([result.blob], newName, { type: 'image/jpeg' });
}

async function importStorefrontAsset(
  file: File,
  metadata: ExtractedMediaMetadata,
  deps: CreateDraftDependencies,
): Promise<MediaAsset> {
  const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
  const stored = await deps.mediaStore.save(finalFile);
  const gps =
    typeof metadata.latitude === 'number' && typeof metadata.longitude === 'number'
      ? { latitude: metadata.latitude, longitude: metadata.longitude }
      : undefined;
  return {
    id: stored.id,
    kind: 'image',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    captureTime: metadata.captureTime,
    gps,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
}

function createDefaultStorefrontScene(assetId: string): StorefrontScene {
  return {
    id: `storefront-${crypto.randomUUID()}`,
    type: 'storefront',
    assetId,
    durationMs: 2500,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
    motionPreset: 'push-in',
    transitionIn: { type: 'crossfade', durationMs: 600 },
    transitionOut: { type: 'crossfade', durationMs: 600 },
  };
}

interface ImportedInteriorItem {
  item: InteriorTourItem;
  mediaAsset: MediaAsset;
}

async function importInteriorPhoto(
  file: File,
  index: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem> {
  const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
  const stored: StoredMediaAsset = await deps.mediaStore.save(finalFile);
  const mediaAsset: MediaAsset = {
    id: stored.id,
    kind: 'image',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
  const item: InteriorTourItem = {
    id: `interior-item-${index}-${stored.id}`,
    type: 'photo',
    assetId: stored.id,
    durationMs: 4000,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.08 },
    motionPreset: 'none',
    transitionToNext: { type: 'cut', durationMs: 0 },
  };
  return { item, mediaAsset };
}

async function importInteriorVideo(
  file: File,
  index: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem> {
  const stored = await deps.mediaStore.save(file);
  const videoMeta = await deps.extractVideoMetadata(file);
  const mediaAsset: MediaAsset = {
    id: stored.id,
    kind: 'video',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    width: videoMeta.width,
    height: videoMeta.height,
    durationMs: videoMeta.durationMs,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
  const item: InteriorTourItem = {
    id: `interior-item-${index}-${stored.id}`,
    type: 'video',
    assetId: stored.id,
    trimStartMs: 0,
    trimEndMs: videoMeta.durationMs,
    playbackRate: 1,
    audioEnabled: false,
    fitMode: 'cover',
    transitionToNext: { type: 'cut', durationMs: 0 },
  };
  return { item, mediaAsset };
}

async function createInteriorItems(
  files: File[],
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem[]> {
  const results: ImportedInteriorItem[] = [];
  for (const [index, file] of files.entries()) {
    const isVideo = file.type.startsWith('video/');
    results.push(isVideo ? await importInteriorVideo(file, index, deps) : await importInteriorPhoto(file, index, deps));
  }
  return results;
}

function applyDefaultInteriorOrdering(items: InteriorTourItem[]): InteriorTourItem[] {
  // Import order is already the default order — no reordering needed.
  // Returns a fresh array so callers can treat ordering as an explicit step.
  return [...items];
}

function applyDefaultPhotoMotion(items: InteriorTourItem[]): void {
  for (const item of items) {
    if (item.type === 'photo') {
      item.motionPreset = 'push-in';
    }
  }
}

function applyDefaultTransitions(items: InteriorTourItem[]): void {
  const defaultTransition: Transition = { type: 'crossfade', durationMs: 500 };
  for (const item of items) {
    item.transitionToNext = defaultTransition;
  }
}

export async function createDraft(
  input: CreateDraftInput,
  overrides: Partial<CreateDraftDependencies> = {},
): Promise<Project> {
  const deps: CreateDraftDependencies = {
    mediaStore: overrides.mediaStore ?? (await createMediaAssetStore()),
    extractImageMetadata: overrides.extractImageMetadata ?? extractImageMetadata,
    extractVideoMetadata: overrides.extractVideoMetadata ?? extractVideoMetadata,
    resolveFromPhotoGps: overrides.resolveFromPhotoGps ?? resolveFromPhotoGps,
    isHeic: overrides.isHeic ?? isHeic,
    convertHeicToJpeg: overrides.convertHeicToJpeg ?? convertHeicToJpeg,
  };

  const metadata = await deps.extractImageMetadata(input.storefrontPhoto);
  const destination = input.destinationOverride ?? deps.resolveFromPhotoGps(metadata);
  if (!destination) {
    throw new NoDestinationError();
  }

  const storefrontAsset = await importStorefrontAsset(input.storefrontPhoto, metadata, deps);
  const mapScene = createMapSceneFromTemplate(destination);
  const storefrontScene = createDefaultStorefrontScene(storefrontAsset.id);

  const imported = await createInteriorItems(input.interiorMedia, deps);
  const orderedItems = applyDefaultInteriorOrdering(imported.map((i) => i.item));
  applyDefaultPhotoMotion(orderedItems);
  applyDefaultTransitions(orderedItems);

  const scenes: ProjectScene[] = [mapScene, storefrontScene];
  const mediaAssets: MediaAsset[] = [storefrontAsset, ...imported.map((i) => i.mediaAsset)];

  if (orderedItems.length > 0) {
    scenes.push({
      id: `interior-${crypto.randomUUID()}`,
      type: 'interior-tour',
      items: orderedItems,
      defaultPhotoDurationMs: 4000,
      defaultTransition: { type: 'crossfade', durationMs: 500 },
    });
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `project-${crypto.randomUUID()}`,
    projectName: destination.businessName ?? 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    destination,
    scenes,
    mediaAssets,
    videoSettings: { aspectRatio: '16:9', widthPx: 1920, heightPx: 1080, fps: 30 },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- createDraft`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: PASS, cumulative count from all prior tasks plus these 6.

- [ ] **Step 6: Commit**

```bash
git add src/quickCreate/createDraft.ts src/tests/createDraft.test.ts
git commit -m "feat: add Quick Create draft algorithm"
```

---

### Task 9: Quick Create UI components

**Files:**
- Create: `src/components/quick-create/StorefrontStep.tsx`
- Create: `src/components/quick-create/NoDestinationFallback.tsx`
- Create: `src/components/quick-create/InteriorTourStep.tsx`
- Create: `src/components/quick-create/QuickCreateWizard.tsx`

**Interfaces:**
- Consumes: `createDraft`, `NoDestinationError` from `../../quickCreate/createDraft` (Task 8); `resolveFromDeviceLocation`, `resolveFromAddress`, `resolveManual` from `../../destination/resolver` (Phase 3); `createCesiumViewer` from `../../cesium/viewer` (Task 7); `useProjectStore` from `../../store/projectStore` (Phase 1); `Destination` from `../../models/project`.
- Produces: `<QuickCreateWizard onDraftReady={(project: Project) => void} />`, mounted by Task 11's `App.tsx`.

**No Vitest coverage for this task** (React components, no jsdom in this project). Verified by TypeScript compilation and by Task 11's end-to-end check.

- [ ] **Step 1: Implement `StorefrontStep`**

Create `src/components/quick-create/StorefrontStep.tsx`:

```tsx
import { useState } from 'react';
import { Camera } from 'lucide-react';

interface StorefrontStepProps {
  onNext: (file: File) => void;
}

export function StorefrontStep({ onNext }: StorefrontStepProps) {
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelected(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  return (
    <div className="quick-create-step">
      <h2>1. Storefront</h2>
      <label className="quick-create-photo-input">
        <Camera size={20} />
        <span>Take / Select Photo</span>
        <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} />
      </label>
      {previewUrl && <img className="quick-create-thumbnail" src={previewUrl} alt="Selected storefront" />}
      <button type="button" disabled={!selected} onClick={() => selected && onNext(selected)}>
        Next
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implement `NoDestinationFallback`**

Create `src/components/quick-create/NoDestinationFallback.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { resolveFromDeviceLocation, resolveFromAddress, resolveManual } from '../../destination/resolver';
import { createCesiumViewer, type CesiumViewerHandle } from '../../cesium/viewer';
import { Cartographic, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { Destination } from '../../models/project';

interface NoDestinationFallbackProps {
  onResolved: (destination: Destination) => void;
}

export function NoDestinationFallback({ onResolved }: NoDestinationFallbackProps) {
  const [mode, setMode] = useState<'choose' | 'address' | 'pick-map'>('choose');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerHandleRef = useRef<CesiumViewerHandle | null>(null);

  useEffect(() => {
    if (mode !== 'pick-map' || !mapContainerRef.current) return;
    const handle = createCesiumViewer(mapContainerRef.current);
    viewerHandleRef.current = handle;

    const clickHandler = new ScreenSpaceEventHandler(handle.viewer.scene.canvas);
    clickHandler.setInputAction((click: { position: import('cesium').Cartesian2 }) => {
      const cartesian = handle.viewer.camera.pickEllipsoid(click.position, handle.viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      const cartographic = Cartographic.fromCartesian(cartesian);
      const latitude = CesiumMath.toDegrees(cartographic.latitude);
      const longitude = CesiumMath.toDegrees(cartographic.longitude);
      onResolved(resolveManual(latitude, longitude));
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      clickHandler.destroy();
      handle.destroy();
      viewerHandleRef.current = null;
    };
  }, [mode, onResolved]);

  async function handleUseCurrentLocation() {
    setError(null);
    try {
      const destination = await resolveFromDeviceLocation();
      onResolved(destination);
    } catch {
      setError('Could not get your current location. Try entering an address instead.');
    }
  }

  async function handleSubmitAddress() {
    setError(null);
    const destination = await resolveFromAddress(address);
    if (destination.latitude === null || destination.longitude === null) {
      setError('No match found for that address. Try a different address or pick on the map.');
      return;
    }
    onResolved(destination);
  }

  if (mode === 'pick-map') {
    return (
      <div className="quick-create-step">
        <h2>Pick on Map</h2>
        <p>Click anywhere on the globe to set the location.</p>
        <div ref={mapContainerRef} className="quick-create-map-picker" />
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  if (mode === 'address') {
    return (
      <div className="quick-create-step">
        <h2>Enter Address</h2>
        <input
          type="text"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="123 Main St, City, State"
        />
        <button type="button" onClick={handleSubmitAddress} disabled={address.trim().length === 0}>
          Find Location
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="quick-create-step">
      <h2>We couldn't find a location in that photo</h2>
      <button type="button" onClick={handleUseCurrentLocation}>
        Use Current Location
      </button>
      <button type="button" onClick={() => setMode('address')}>
        Enter Address
      </button>
      <button type="button" onClick={() => setMode('pick-map')}>
        Pick on Map
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Implement `InteriorTourStep`**

Create `src/components/quick-create/InteriorTourStep.tsx`:

```tsx
import { useState } from 'react';
import { ImagePlus } from 'lucide-react';

interface InteriorTourStepProps {
  onCreateDraft: (files: File[]) => void;
  onBack: () => void;
  submitting: boolean;
}

export function InteriorTourStep({ onCreateDraft, onBack, submitting }: InteriorTourStepProps) {
  const [files, setFiles] = useState<File[]>([]);

  function handleFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files;
    if (!selected) return;
    setFiles(Array.from(selected));
  }

  return (
    <div className="quick-create-step">
      <h2>2. Interior Tour</h2>
      <label className="quick-create-photo-input">
        <ImagePlus size={20} />
        <span>Add Photos or Video</span>
        <input type="file" accept="image/*,video/*" multiple onChange={handleFilesChange} />
      </label>
      {files.length > 0 && (
        <ul className="quick-create-file-list">
          {files.map((file) => (
            <li key={file.name}>{file.name}</li>
          ))}
        </ul>
      )}
      <div className="quick-create-actions">
        <button type="button" onClick={onBack} disabled={submitting}>
          Back
        </button>
        <button type="button" onClick={() => onCreateDraft(files)} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Draft'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `QuickCreateWizard`**

Create `src/components/quick-create/QuickCreateWizard.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { StorefrontStep } from './StorefrontStep';
import { InteriorTourStep } from './InteriorTourStep';
import { NoDestinationFallback } from './NoDestinationFallback';
import { createDraft, NoDestinationError } from '../../quickCreate/createDraft';
import { useProjectStore } from '../../store/projectStore';
import type { Destination, Project } from '../../models/project';

type WizardStep = 'storefront' | 'interior' | 'no-destination' | 'creating';

interface QuickCreateWizardProps {
  onDraftReady: (project: Project) => void;
}

export function QuickCreateWizard({ onDraftReady }: QuickCreateWizardProps) {
  const [step, setStep] = useState<WizardStep>('storefront');
  const [storefrontPhoto, setStorefrontPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createProject = useProjectStore((state) => state.createProject);

  const runCreateDraft = useCallback(
    async (interiorMedia: File[], destinationOverride?: Destination) => {
      if (!storefrontPhoto) return;
      setStep('creating');
      setError(null);
      try {
        const project = await createDraft({ storefrontPhoto, interiorMedia, destinationOverride });
        await createProject(project);
        onDraftReady(project);
      } catch (err) {
        if (err instanceof NoDestinationError) {
          setStep('no-destination');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not create the draft.');
        setStep('interior');
      }
    },
    [storefrontPhoto, createProject, onDraftReady],
  );

  if (step === 'storefront') {
    return (
      <StorefrontStep
        onNext={(file) => {
          setStorefrontPhoto(file);
          setStep('interior');
        }}
      />
    );
  }

  if (step === 'no-destination') {
    return (
      <NoDestinationFallback
        onResolved={(destination) => {
          void runCreateDraft([], destination);
        }}
      />
    );
  }

  return (
    <div>
      <InteriorTourStep
        onCreateDraft={(files) => void runCreateDraft(files)}
        onBack={() => setStep('storefront')}
        submitting={step === 'creating'}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/quick-create
git commit -m "feat: add Quick Create wizard UI"
```

---

### Task 10: Preview components

**Files:**
- Create: `src/components/preview/PreviewStage.tsx`
- Create: `src/components/preview/PlaybackControls.tsx`

**Interfaces:**
- Consumes: `PlaybackController` from `../../timeline/playbackController` (Task 4); `applyCameraState` from `../../cesium/applyCameraState` (Task 3); `createCesiumViewer` from `../../cesium/viewer` (Task 7); `compileProjectTimeline` from `../../timeline/compiler` (Phase 2); `EvaluatedFrame`, `EvaluatedLayer` from `../../models/timeline`; `Project` from `../../models/project`.
- Produces: `<PreviewStage project={project} />`, mounted by Task 11's `App.tsx`.

**No Vitest coverage for this task** (React + Cesium, no jsdom). Verified by TypeScript compilation and Task 11's end-to-end check.

- [ ] **Step 1: Implement `PlaybackControls`**

Create `src/components/preview/PlaybackControls.tsx`:

```tsx
import { Play, Pause } from 'lucide-react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTimeMs: number;
  totalDurationMs: number;
  onTogglePlay: () => void;
  onSeek: (timeMs: number) => void;
}

export function PlaybackControls({
  isPlaying,
  currentTimeMs,
  totalDurationMs,
  onTogglePlay,
  onSeek,
}: PlaybackControlsProps) {
  return (
    <div className="playback-controls">
      <button type="button" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <input
        type="range"
        min={0}
        max={totalDurationMs}
        value={currentTimeMs}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
    </div>
  );
}
```

- [ ] **Step 2: Implement `PreviewStage`**

Create `src/components/preview/PreviewStage.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { compileProjectTimeline } from '../../timeline/compiler';
import { PlaybackController } from '../../timeline/playbackController';
import { createCesiumViewer, type CesiumViewerHandle } from '../../cesium/viewer';
import { applyCameraState } from '../../cesium/applyCameraState';
import { createMediaAssetStore } from '../../media/createMediaAssetStore';
import type { MediaAssetStore } from '../../media/MediaAssetStore';
import { PlaybackControls } from './PlaybackControls';
import type { EvaluatedFrame, EvaluatedLayer } from '../../models/timeline';
import type { Project } from '../../models/project';
import type { VisualTransform } from '../../models/scenes';

interface PreviewStageProps {
  project: Project;
}

function transformToCss(transform?: VisualTransform): string {
  if (!transform) return '';
  const rotation = transform.rotation ?? 0;
  return `translate(-50%, -50%) translate(${(transform.centerX - 0.5) * 100}%, ${(transform.centerY - 0.5) * 100}%) scale(${transform.scale}) rotate(${rotation}deg)`;
}

function overlayLayer(layers: EvaluatedLayer[]): EvaluatedLayer | undefined {
  return layers.find((layer) => layer.kind !== 'map-hold' && layer.kind !== 'map-travel');
}

export function PreviewStage({ project }: PreviewStageProps) {
  const timeline = useMemo(() => compileProjectTimeline(project), [project]);
  const cesiumContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerHandleRef = useRef<CesiumViewerHandle | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStoreRef = useRef<MediaAssetStore | null>(null);

  const [frame, setFrame] = useState<EvaluatedFrame | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!cesiumContainerRef.current) return;
    const handle = createCesiumViewer(cesiumContainerRef.current);
    viewerHandleRef.current = handle;
    return () => handle.destroy();
  }, []);

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

  useEffect(() => {
    if (!frame || !viewerHandleRef.current) return;
    const mapLayer = frame.layers.find((layer) => layer.kind === 'map-hold' || layer.kind === 'map-travel');
    if (mapLayer?.camera) {
      applyCameraState(viewerHandleRef.current.viewer, mapLayer.camera);
    }
  }, [frame]);

  const overlay = frame ? overlayLayer(frame.layers) : undefined;
  const overlaySourceId = overlay && overlay.kind !== 'black' ? overlay.sourceId : undefined;

  // Resolves the active overlay layer's MediaAsset into a displayable blob: URL via
  // the Phase 1 MediaAssetStore. Re-runs only when the underlying asset changes (not
  // on every animation frame), and always revokes the previous object URL.
  useEffect(() => {
    if (!overlaySourceId) {
      setOverlayUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      if (!mediaStoreRef.current) {
        mediaStoreRef.current = await createMediaAssetStore();
      }
      const blob = await mediaStoreRef.current.get(overlaySourceId);
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setOverlayUrl(objectUrl);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [overlaySourceId]);

  useEffect(() => {
    if (overlay?.kind === 'video' && videoRef.current) {
      videoRef.current.currentTime = overlay.localTimeMs / 1000;
    }
  }, [overlay]);

  function handleTogglePlay() {
    const controller = controllerRef.current;
    if (!controller) return;
    if (controller.isPlaying) {
      controller.pause();
    } else {
      controller.play();
    }
  }

  return (
    <div className="preview-stage">
      <div ref={cesiumContainerRef} className="preview-cesium-container" />
      {overlay?.kind === 'black' && <div className="preview-black-overlay" style={{ opacity: overlay.opacity }} />}
      {(overlay?.kind === 'storefront' || overlay?.kind === 'photo') && overlayUrl && (
        <img
          className="preview-overlay-image"
          src={overlayUrl}
          alt=""
          style={{ opacity: overlay.opacity, transform: transformToCss(overlay.transform) }}
        />
      )}
      {overlay?.kind === 'video' && overlayUrl && (
        <video
          ref={videoRef}
          className="preview-overlay-video"
          src={overlayUrl}
          style={{ opacity: overlay.opacity }}
          muted={!overlay.audioEnabled}
        />
      )}
      <PlaybackControls
        isPlaying={isPlaying}
        currentTimeMs={currentTimeMs}
        totalDurationMs={timeline.totalDurationMs}
        onTogglePlay={handleTogglePlay}
        onSeek={(timeMs) => controllerRef.current?.seek(timeMs)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/preview
git commit -m "feat: add PreviewStage and PlaybackControls"
```

---

### Task 11: Wire up App.tsx and verify the end-to-end flow

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `QuickCreateWizard` (Task 9), `PreviewStage` (Task 10), `Project` from `../models/project`.

- [ ] **Step 1: Wire the wizard and preview together**

Replace `src/App.tsx` with:

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

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: PASS, all tests from every prior task in this plan plus every test from Phases 1-3.

- [ ] **Step 3: Type-check and build**

Run: `npx tsc -b && npm run build`
Expected: both succeed with no errors. Confirm (per Task 2) that the build output includes Cesium's copied static assets.

- [ ] **Step 4: End-to-end verification with Playwright**

If the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`) are available to you: start the dev server in the background (`npm run dev`), then drive the full primary workflow through a real browser:
1. `browser_navigate` to the dev server URL.
2. Use `browser_file_upload` (or the equivalent form-fill tool) to select a storefront photo for the Storefront step's file input. Use a real JPEG with embedded GPS EXIF data if one is available in the test fixtures directory; otherwise use a plain JPEG and confirm the no-GPS fallback screen appears, then exercise "Pick on Map" by clicking on the globe.
3. Advance to the Interior Tour step, optionally add one or two photos, click "Create Draft."
4. Confirm the preview screen appears, showing the Cesium globe.
5. Click play; confirm `currentTimeMs` advances (observable via the scrub bar's value changing) and the display transitions from the map to the storefront photo at the expected time.
6. Drag the scrub bar; confirm the displayed frame updates to match (map view or storefront image, matching the scrubbed time).
7. Use `browser_console_messages` to confirm no uncaught errors occurred during the whole flow.
8. Take a final screenshot with `browser_take_screenshot` for the record.
9. Stop the dev server.

If Playwright MCP tools are not available to you: report this task as `DONE_WITH_CONCERNS` and list each of the 9 checks above as unverified — a human must run `npm run dev` and manually confirm the full flow before this phase is considered complete. Do not report `DONE` if the flow was never exercised in a real browser by any means.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire Quick Create wizard and preview into App"
```
