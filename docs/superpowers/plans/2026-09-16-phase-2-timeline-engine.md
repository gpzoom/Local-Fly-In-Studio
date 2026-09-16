# Phase 2: Timeline Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, dependency-free timeline compiler and deterministic evaluator that converts a `Project`'s scene hierarchy (from Phase 1's models) into a flat, seekable timeline, plus fit-to-duration scaling — all fully unit-tested, no Cesium/React/rendering involved.

**Architecture:** Six focused modules under `src/models/timeline.ts` (types) and `src/timeline/` (easing, camera interpolation, compiler, evaluator, scaling), each pure and independently testable. The compiler converts scene hierarchy → flat `TimelineSegment[]` with crossfade overlap baked into segment boundaries; the evaluator answers "what's visible at time T" from that flat structure; scaling redistributes unlocked durations to hit a target.

**Tech Stack:** TypeScript (strict), Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-phase-2-timeline-engine-design.md`

## Global Constraints

- TypeScript strict mode (`strict: true`); no `any`.
- No new runtime dependencies — pure TypeScript over Phase 1's existing Zod-inferred model types.
- No Cesium, no canvas/DOM rendering, no React, no `MediaAssetStore`/persistence integration in this phase.
- Video clip durations (`trimEndMs - trimStartMs) / playbackRate`) are never altered by any scaling function — only still-photo/travel/hold durations are redistributed.
- `evaluateProjectTimeline` is the single source of timing/interpolation logic — no other module duplicates it.
- Camera geographic interpolation uses pure spherical/great-circle math (no Cesium), per the spec's explicit design decision.

---

### Task 1: Timeline Data Model Types

**Files:**
- Create: `src/models/timeline.ts`
- Test: `src/tests/timelineModels.test.ts`

**Interfaces:**
- Consumes: `Waypoint`, `CameraState`, `VisualTransform`, `Transition`, `StorefrontMotionPreset`, `PhotoMotionPreset`, `FitMode` from `src/models/scenes.ts`.
- Produces: `SegmentKind`, `TimelineSegment`, `CompiledTimelineSection`, `CompiledTimeline`, `EvaluatedLayer`, `EvaluatedFrame` — all consumed by every later task in this plan.

- [ ] **Step 1: Implement src/models/timeline.ts**

```ts
import type {
  Waypoint,
  CameraState,
  VisualTransform,
  Transition,
  StorefrontMotionPreset,
  PhotoMotionPreset,
  FitMode,
} from './scenes';

export type SegmentKind =
  | 'map-hold'
  | 'map-travel'
  | 'storefront'
  | 'photo'
  | 'video'
  | 'black';

export interface TimelineSegment {
  id: string;
  sourceType: 'map' | 'image' | 'video';
  sourceId: string;
  sectionId: string;
  itemId?: string;
  kind: SegmentKind;
  startMs: number;
  endMs: number;
  transitionIn?: Transition;

  fromWaypoint?: Waypoint;
  toWaypoint?: Waypoint;

  startTransform?: VisualTransform;
  endTransform?: VisualTransform;
  motionPreset?: StorefrontMotionPreset | PhotoMotionPreset;

  trimStartMs?: number;
  trimEndMs?: number;
  playbackRate?: number;
  fitMode?: FitMode;
  audioEnabled?: boolean;
}

export interface CompiledTimelineSection {
  id: string;
  type: 'map' | 'storefront' | 'interior-tour';
  startMs: number;
  endMs: number;
}

export interface CompiledTimeline {
  segments: TimelineSegment[];
  totalDurationMs: number;
  sections: CompiledTimelineSection[];
}

export interface EvaluatedLayer {
  sourceType: 'map' | 'image' | 'video';
  sourceId: string;
  localTimeMs: number;
  opacity: number;
  transform?: VisualTransform;
  camera?: CameraState;
}

export interface EvaluatedFrame {
  projectTimeMs: number;
  layers: EvaluatedLayer[];
  activeSectionId: string;
  activeItemId?: string;
}
```

- [ ] **Step 2: Write a sanity test proving the types are usable**

`src/tests/timelineModels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { CompiledTimeline, EvaluatedFrame, TimelineSegment } from '../models/timeline';

describe('timeline model types', () => {
  it('allows constructing a valid TimelineSegment and CompiledTimeline', () => {
    const segment: TimelineSegment = {
      id: 'seg-1',
      sourceType: 'image',
      sourceId: 'asset-1',
      sectionId: 'storefront-1',
      kind: 'storefront',
      startMs: 0,
      endMs: 2500,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
      endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
      motionPreset: 'push-in',
    };
    const timeline: CompiledTimeline = {
      segments: [segment],
      totalDurationMs: 2500,
      sections: [{ id: 'storefront-1', type: 'storefront', startMs: 0, endMs: 2500 }],
    };
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.totalDurationMs).toBe(2500);
  });

  it('allows constructing a valid EvaluatedFrame with two layers', () => {
    const frame: EvaluatedFrame = {
      projectTimeMs: 1000,
      layers: [
        { sourceType: 'image', sourceId: 'a', localTimeMs: 500, opacity: 0.5 },
        { sourceType: 'image', sourceId: 'b', localTimeMs: 0, opacity: 0.5 },
      ],
      activeSectionId: 'interior-1',
    };
    expect(frame.layers).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run tests and build, verify pass**

Run: `npm run test -- timelineModels.test.ts` — expect 2 tests passing.
Run: `npm run build` — expect success (this is the real check for a types-only file).

- [ ] **Step 4: Commit**

```bash
git add src/models/timeline.ts src/tests/timelineModels.test.ts
git commit -m "feat: add timeline data model types"
```

---

### Task 2: Easing Functions

**Files:**
- Create: `src/timeline/easing.ts`
- Test: `src/tests/easing.test.ts`

**Interfaces:**
- Consumes: `EasingPreset` from `src/models/scenes.ts`.
- Produces: `type EasingFunction = (t: number) => number`; named exports `linear`, `accelerate`, `decelerate`, `smooth`, `cinematic`; `getEasingFunction(preset: EasingPreset): EasingFunction`.

- [ ] **Step 1: Write the failing test**

`src/tests/easing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { linear, accelerate, decelerate, smooth, cinematic, getEasingFunction } from '../timeline/easing';

const PRESETS = [
  ['linear', linear] as const,
  ['accelerate', accelerate] as const,
  ['decelerate', decelerate] as const,
  ['smooth', smooth] as const,
  ['cinematic', cinematic] as const,
];

describe('easing functions', () => {
  it.each(PRESETS)('%s maps 0 to 0 and 1 to 1', (_name, fn) => {
    expect(fn(0)).toBeCloseTo(0, 10);
    expect(fn(1)).toBeCloseTo(1, 10);
  });

  it.each(PRESETS)('%s is monotonically non-decreasing', (_name, fn) => {
    let prev = fn(0);
    for (let t = 0.05; t <= 1; t += 0.05) {
      const curr = fn(t);
      expect(curr).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = curr;
    }
  });

  it('accelerate starts slower than linear and decelerate starts faster', () => {
    expect(accelerate(0.25)).toBeLessThan(linear(0.25));
    expect(decelerate(0.25)).toBeGreaterThan(linear(0.25));
  });

  it('getEasingFunction resolves each preset to its named function', () => {
    expect(getEasingFunction('linear')(0.5)).toBeCloseTo(linear(0.5));
    expect(getEasingFunction('cinematic')(0.5)).toBeCloseTo(cinematic(0.5));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- easing.test.ts`
Expected: FAIL — cannot resolve `../timeline/easing`.

- [ ] **Step 3: Implement src/timeline/easing.ts**

```ts
import type { EasingPreset } from '../models/scenes';

export type EasingFunction = (t: number) => number;

export const linear: EasingFunction = (t) => t;

export const accelerate: EasingFunction = (t) => t * t;

export const decelerate: EasingFunction = (t) => 1 - (1 - t) * (1 - t);

export const smooth: EasingFunction = (t) => t * t * (3 - 2 * t);

export const cinematic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const EASING_FUNCTIONS: Record<EasingPreset, EasingFunction> = {
  linear,
  accelerate,
  decelerate,
  smooth,
  cinematic,
};

export function getEasingFunction(preset: EasingPreset): EasingFunction {
  return EASING_FUNCTIONS[preset];
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- easing.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline/easing.ts src/tests/easing.test.ts
git commit -m "feat: add easing functions"
```

---

### Task 3: Camera Interpolation

**Files:**
- Create: `src/timeline/cameraInterpolation.ts`
- Test: `src/tests/cameraInterpolation.test.ts`

**Interfaces:**
- Consumes: `CameraState` from `src/models/scenes.ts`.
- Produces: `interpolateCameraState(from: CameraState, to: CameraState, t: number): CameraState`.

- [ ] **Step 1: Write the failing test**

`src/tests/cameraInterpolation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpolateCameraState } from '../timeline/cameraInterpolation';
import type { CameraState } from '../models/scenes';

function makeCamera(overrides: Partial<CameraState> = {}): CameraState {
  return { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0, ...overrides };
}

describe('interpolateCameraState', () => {
  it('interpolates heading via the shortest path (350 -> 10 goes through 360, not backward through 180)', () => {
    const from = makeCamera({ heading: 350 });
    const to = makeCamera({ heading: 10 });
    expect(interpolateCameraState(from, to, 0.5).heading).toBeCloseTo(0, 5);
    expect(interpolateCameraState(from, to, 1).heading).toBeCloseTo(10, 5);
    expect(interpolateCameraState(from, to, 0).heading).toBeCloseTo(350, 5);
  });

  it('interpolates height, pitch, and roll linearly', () => {
    const from = makeCamera({ height: 1000, pitch: -10, roll: 0 });
    const to = makeCamera({ height: 3000, pitch: -30, roll: 10 });
    const mid = interpolateCameraState(from, to, 0.5);
    expect(mid.height).toBeCloseTo(2000, 5);
    expect(mid.pitch).toBeCloseTo(-20, 5);
    expect(mid.roll).toBeCloseTo(5, 5);
  });

  it('interpolates surface position along the great circle for two equatorial points', () => {
    const from = makeCamera({ latitude: 0, longitude: -10 });
    const to = makeCamera({ latitude: 0, longitude: 10 });
    const mid = interpolateCameraState(from, to, 0.5);
    expect(mid.latitude).toBeCloseTo(0, 5);
    expect(mid.longitude).toBeCloseTo(0, 5);
  });

  it('bulges the great-circle path toward the pole for two points on the same parallel', () => {
    // Two points at 45N, 40 degrees of longitude apart. A great circle between
    // two points on a parallel (other than the equator) bulges toward the
    // nearer pole, so the midpoint's latitude must exceed 45N — a naive
    // linear lat/lon interpolation (constant 45N) would not produce this.
    const from = makeCamera({ latitude: 45, longitude: -20 });
    const to = makeCamera({ latitude: 45, longitude: 20 });
    const mid = interpolateCameraState(from, to, 0.5);
    expect(mid.latitude).toBeGreaterThan(45);
    expect(mid.longitude).toBeCloseTo(0, 5);
  });

  it('falls back to linear interpolation when from and to are the same point', () => {
    const from = makeCamera({ latitude: 12, longitude: 34 });
    const to = makeCamera({ latitude: 12, longitude: 34 });
    const mid = interpolateCameraState(from, to, 0.5);
    expect(mid.latitude).toBeCloseTo(12, 5);
    expect(mid.longitude).toBeCloseTo(34, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- cameraInterpolation.test.ts`
Expected: FAIL — cannot resolve `../timeline/cameraInterpolation`.

- [ ] **Step 3: Implement src/timeline/cameraInterpolation.ts**

```ts
import type { CameraState } from '../models/scenes';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function haversineAngularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function slerpSurface(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
  f: number,
): { latitude: number; longitude: number } {
  const lat1 = lat1Deg * DEG_TO_RAD;
  const lon1 = lon1Deg * DEG_TO_RAD;
  const lat2 = lat2Deg * DEG_TO_RAD;
  const lon2 = lon2Deg * DEG_TO_RAD;

  const d = haversineAngularDistance(lat1, lon1, lat2, lon2);
  const isDegenerate = d < 1e-9 || Math.abs(Math.PI - d) < 1e-9;

  if (isDegenerate) {
    return {
      latitude: lat1Deg + (lat2Deg - lat1Deg) * f,
      longitude: lon1Deg + (lon2Deg - lon1Deg) * f,
    };
  }

  const sinD = Math.sin(d);
  const A = Math.sin((1 - f) * d) / sinD;
  const B = Math.sin(f * d) / sinD;

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  return {
    latitude: Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD_TO_DEG,
    longitude: Math.atan2(y, x) * RAD_TO_DEG,
  };
}

function shortestAngleLerp(fromDeg: number, toDeg: number, f: number): number {
  const delta = (((toDeg - fromDeg + 180) % 360) + 360) % 360 - 180;
  return fromDeg + delta * f;
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function interpolateCameraState(from: CameraState, to: CameraState, t: number): CameraState {
  const { latitude, longitude } = slerpSurface(from.latitude, from.longitude, to.latitude, to.longitude, t);

  return {
    latitude,
    longitude,
    height: from.height + (to.height - from.height) * t,
    heading: normalizeDegrees(shortestAngleLerp(from.heading, to.heading, t)),
    pitch: from.pitch + (to.pitch - from.pitch) * t,
    roll: from.roll + (to.roll - from.roll) * t,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- cameraInterpolation.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline/cameraInterpolation.ts src/tests/cameraInterpolation.test.ts
git commit -m "feat: add pure spherical camera interpolation"
```

---

### Task 4: Timeline Compiler

**Files:**
- Create: `src/timeline/compiler.ts`
- Test: `src/tests/compiler.test.ts`

**Interfaces:**
- Consumes: `Project` from `src/models/project.ts`; `MapScene`, `StorefrontScene`, `InteriorTourScene`, `InteriorTourItem`, `Waypoint`, `Transition` from `src/models/scenes.ts`; `TimelineSegment`, `CompiledTimeline`, `CompiledTimelineSection`, `SegmentKind` from `src/models/timeline.ts`; `makeMinimalProject` from `src/tests/fixtures.ts`.
- Produces: `compileProjectTimeline(project: Project): CompiledTimeline` — consumed by Task 5 (evaluator tests) and Task 6 (`fitProjectToDuration`).

**Design note carried from the spec:** every waypoint contributes exactly one `map-hold` segment (even if `holdDurationMs` is 0 — a zero-length segment is harmless, it simply never matches any query time); every waypoint after the first also contributes a `map-travel` segment. Crossfade transitions overlap segments by subtracting the transition's `durationMs` from the incoming segment's natural start time (the outgoing segment's `endMs` is untouched). `fade-black` inserts a synthetic `kind: 'black'` segment of the transition's full `durationMs` between the two sides, with zero overlap on either side. `cut` has zero overlap and no synthetic segment. The transition connecting Map→Storefront is `StorefrontScene.transitionIn`; Storefront→first-interior-item is `StorefrontScene.transitionOut`; interior item N→N+1 is item N's own `transitionToNext`.

- [ ] **Step 1: Write the failing tests**

`src/tests/compiler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compileProjectTimeline } from '../timeline/compiler';
import { makeMinimalProject } from './fixtures';
import type { MapScene, InteriorTourScene, StorefrontScene, Waypoint } from '../models/scenes';

function makeWaypoint(overrides: Partial<Waypoint> & { id: string }): Waypoint {
  return {
    type: 'absolute',
    name: overrides.id,
    camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
    travelDurationMs: 0,
    holdDurationMs: 0,
    travelDurationLocked: false,
    holdDurationLocked: false,
    easing: 'cinematic',
    ...overrides,
  } as Waypoint;
}

describe('compileProjectTimeline', () => {
  it('gives waypoint zero no incoming travel and totals travel+hold durations', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    mapScene.waypoints = [
      makeWaypoint({ id: 'earth', holdDurationMs: 1000 }),
      makeWaypoint({ id: 'business', travelDurationMs: 1800, holdDurationMs: 600 }),
    ];
    const timeline = compileProjectTimeline(project);
    const mapSegments = timeline.segments.filter((s) => s.sectionId === mapScene.id);
    expect(mapSegments[0].kind).toBe('map-hold');
    expect(mapSegments[0].startMs).toBe(0);
    expect(mapSegments[0].endMs).toBe(1000);
    expect(mapSegments.some((s) => s.kind === 'map-travel' && s.startMs === 0)).toBe(false);
    const mapSection = timeline.sections.find((s) => s.id === mapScene.id)!;
    expect(mapSection.endMs - mapSection.startMs).toBe(1000 + 1800 + 600);
  });

  it('applies crossfade overlap between two 4s photos with a 0.5s transition, matching 4 + 4 - 0.5 = 7.5s', () => {
    const project = makeMinimalProject();
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items = [
      {
        id: 'p1', type: 'photo', assetId: 'a1', durationMs: 4000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'push-in', transitionToNext: { type: 'crossfade', durationMs: 500 },
      },
      {
        id: 'p2', type: 'photo', assetId: 'a2', durationMs: 4000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'pull-out', transitionToNext: { type: 'cut', durationMs: 0 },
      },
    ];
    const timeline = compileProjectTimeline(project);
    const p1 = timeline.segments.find((s) => s.itemId === 'p1')!;
    const p2 = timeline.segments.find((s) => s.itemId === 'p2')!;
    expect(p2.startMs).toBe(p1.endMs - 500);
    expect(p2.endMs - p1.startMs).toBe(7500);
  });

  it('does not overlap segments joined by a cut transition', () => {
    const project = makeMinimalProject();
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items[0] = { ...interiorScene.items[0], transitionToNext: { type: 'cut', durationMs: 0 } };
    interiorScene.items.push({
      id: 'p2', type: 'photo', assetId: 'a2', durationMs: 3000, durationLocked: false,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
      motionPreset: 'pull-out', transitionToNext: { type: 'cut', durationMs: 0 },
    });
    const timeline = compileProjectTimeline(project);
    const items = timeline.segments.filter((s) => s.sectionId === interiorScene.id);
    const p1 = items.find((s) => s.itemId === 'photo-1')!;
    const p2 = items.find((s) => s.itemId === 'p2')!;
    expect(p2.startMs).toBe(p1.endMs);
  });

  it('computes video effective duration as (trimEnd - trimStart) / playbackRate', () => {
    const project = makeMinimalProject();
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items = [{
      id: 'v1', type: 'video', assetId: 'video-1', trimStartMs: 1000, trimEndMs: 5000, playbackRate: 2,
      audioEnabled: false, fitMode: 'cover', transitionToNext: { type: 'cut', durationMs: 0 },
    }];
    const timeline = compileProjectTimeline(project);
    const videoSegment = timeline.segments.find((s) => s.itemId === 'v1')!;
    expect(videoSegment.endMs - videoSegment.startMs).toBe(2000);
  });

  it('preserves mixed photo/video ordering', () => {
    const project = makeMinimalProject();
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items = [
      {
        id: 'p1', type: 'photo', assetId: 'a1', durationMs: 1000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'push-in', transitionToNext: { type: 'cut', durationMs: 0 },
      },
      {
        id: 'v1', type: 'video', assetId: 'video-1', trimStartMs: 0, trimEndMs: 2000, playbackRate: 1,
        audioEnabled: false, fitMode: 'cover', transitionToNext: { type: 'cut', durationMs: 0 },
      },
      {
        id: 'p2', type: 'photo', assetId: 'a2', durationMs: 1000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'pull-out', transitionToNext: { type: 'cut', durationMs: 0 },
      },
    ];
    const timeline = compileProjectTimeline(project);
    const order = timeline.segments.filter((s) => s.sectionId === interiorScene.id).map((s) => s.itemId);
    expect(order).toEqual(['p1', 'v1', 'p2']);
  });

  it('inserts a black segment for a fade-black transition without overlapping either side', () => {
    const project = makeMinimalProject();
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    storefrontScene.transitionOut = { type: 'fade-black', durationMs: 300 };
    const timeline = compileProjectTimeline(project);
    const black = timeline.segments.find((s) => s.kind === 'black')!;
    expect(black.endMs - black.startMs).toBe(300);
    const nextSegment = timeline.segments.find((s) => s.startMs === black.endMs && s.kind !== 'black');
    expect(nextSegment).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- compiler.test.ts`
Expected: FAIL — cannot resolve `../timeline/compiler`.

- [ ] **Step 3: Implement src/timeline/compiler.ts**

```ts
import type { Project } from '../models/project';
import type {
  MapScene,
  StorefrontScene,
  InteriorTourScene,
  InteriorTourItem,
  Waypoint,
  Transition,
} from '../models/scenes';
import type { TimelineSegment, CompiledTimeline, CompiledTimelineSection, SegmentKind } from '../models/timeline';

interface PendingUnit {
  sectionId: string;
  itemId?: string;
  kind: SegmentKind;
  sourceType: 'map' | 'image' | 'video';
  sourceId: string;
  durationMs: number;
  incomingTransition?: Transition;
  fromWaypoint?: Waypoint;
  toWaypoint?: Waypoint;
  startTransform?: TimelineSegment['startTransform'];
  endTransform?: TimelineSegment['endTransform'];
  motionPreset?: TimelineSegment['motionPreset'];
  trimStartMs?: number;
  trimEndMs?: number;
  playbackRate?: number;
  fitMode?: TimelineSegment['fitMode'];
  audioEnabled?: boolean;
}

function videoEffectiveDurationMs(item: Extract<InteriorTourItem, { type: 'video' }>): number {
  return (item.trimEndMs - item.trimStartMs) / item.playbackRate;
}

function buildMapUnits(scene: MapScene): PendingUnit[] {
  const units: PendingUnit[] = [];
  scene.waypoints.forEach((waypoint, index) => {
    if (index > 0) {
      const prev = scene.waypoints[index - 1];
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

function buildStorefrontUnits(scene: StorefrontScene): PendingUnit[] {
  return [{
    sectionId: scene.id,
    kind: 'storefront',
    sourceType: 'image',
    sourceId: scene.assetId,
    durationMs: scene.durationMs,
    incomingTransition: scene.transitionIn,
    startTransform: scene.startTransform,
    endTransform: scene.endTransform,
    motionPreset: scene.motionPreset,
  }];
}

function buildInteriorTourUnits(scene: InteriorTourScene, incomingTransition: Transition | undefined): PendingUnit[] {
  return scene.items.map((item, index) => {
    const transitionIn = index === 0 ? incomingTransition : scene.items[index - 1].transitionToNext;
    if (item.type === 'photo') {
      return {
        sectionId: scene.id,
        itemId: item.id,
        kind: 'photo' as const,
        sourceType: 'image' as const,
        sourceId: item.assetId,
        durationMs: item.durationMs,
        incomingTransition: transitionIn,
        startTransform: item.startTransform,
        endTransform: item.endTransform,
        motionPreset: item.motionPreset,
      };
    }
    return {
      sectionId: scene.id,
      itemId: item.id,
      kind: 'video' as const,
      sourceType: 'video' as const,
      sourceId: item.assetId,
      durationMs: videoEffectiveDurationMs(item),
      incomingTransition: transitionIn,
      trimStartMs: item.trimStartMs,
      trimEndMs: item.trimEndMs,
      playbackRate: item.playbackRate,
      fitMode: item.fitMode,
      audioEnabled: item.audioEnabled,
    };
  });
}

export function compileProjectTimeline(project: Project): CompiledTimeline {
  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');

  const units: PendingUnit[] = [];
  if (mapScene) units.push(...buildMapUnits(mapScene));
  if (storefrontScene) units.push(...buildStorefrontUnits(storefrontScene));
  if (interiorScene) units.push(...buildInteriorTourUnits(interiorScene, storefrontScene?.transitionOut));

  const segments: TimelineSegment[] = [];
  let cursorMs = 0;
  let segmentCounter = 0;

  for (const unit of units) {
    const transition = unit.incomingTransition;

    if (transition?.type === 'fade-black' && transition.durationMs > 0) {
      segments.push({
        id: `black-${segmentCounter++}`,
        sourceType: 'image',
        sourceId: '__black__',
        sectionId: unit.sectionId,
        kind: 'black',
        startMs: cursorMs,
        endMs: cursorMs + transition.durationMs,
      });
      cursorMs += transition.durationMs;
    }

    const overlapMs = transition?.type === 'crossfade' ? transition.durationMs : 0;
    const startMs = cursorMs - overlapMs;
    const endMs = startMs + unit.durationMs;

    segments.push({
      id: `seg-${segmentCounter++}`,
      sourceType: unit.sourceType,
      sourceId: unit.sourceId,
      sectionId: unit.sectionId,
      itemId: unit.itemId,
      kind: unit.kind,
      startMs,
      endMs,
      transitionIn: unit.incomingTransition,
      fromWaypoint: unit.fromWaypoint,
      toWaypoint: unit.toWaypoint,
      startTransform: unit.startTransform,
      endTransform: unit.endTransform,
      motionPreset: unit.motionPreset,
      trimStartMs: unit.trimStartMs,
      trimEndMs: unit.trimEndMs,
      playbackRate: unit.playbackRate,
      fitMode: unit.fitMode,
      audioEnabled: unit.audioEnabled,
    });

    cursorMs = endMs;
  }

  const sections: CompiledTimelineSection[] = [];
  for (const scene of [mapScene, storefrontScene, interiorScene]) {
    if (!scene) continue;
    const sceneSegments = segments.filter((s) => s.sectionId === scene.id);
    if (sceneSegments.length === 0) continue;
    sections.push({
      id: scene.id,
      type: scene.type,
      startMs: Math.min(...sceneSegments.map((s) => s.startMs)),
      endMs: Math.max(...sceneSegments.map((s) => s.endMs)),
    });
  }

  return { segments, totalDurationMs: cursorMs, sections };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- compiler.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline/compiler.ts src/tests/compiler.test.ts
git commit -m "feat: add timeline compiler with crossfade overlap accounting"
```

---

### Task 5: Master Evaluator

**Files:**
- Create: `src/timeline/evaluator.ts`
- Test: `src/tests/evaluator.test.ts`

**Interfaces:**
- Consumes: `CompiledTimeline`, `EvaluatedFrame`, `EvaluatedLayer`, `TimelineSegment` from `src/models/timeline.ts`; `getEasingFunction` from `src/timeline/easing.ts`; `interpolateCameraState` from `src/timeline/cameraInterpolation.ts`; `CameraState`, `VisualTransform` from `src/models/scenes.ts`; `compileProjectTimeline` from `src/timeline/compiler.ts` (test only); `makeMinimalProject` from `src/tests/fixtures.ts` (test only).
- Produces: `evaluateProjectTimeline(timeline: CompiledTimeline, timeMs: number): EvaluatedFrame` — the single timing/interpolation entry point every later phase (playback, scrubbing, export) must call.

**Design note carried from the spec:** for `map-hold`/`map-travel` segments whose waypoint(s) are `type: 'destination-relative'`, `camera` is left `undefined` — resolving a relative camera against an actual `Destination` requires the destination resolver (Phase 3) and is out of scope here. Only `'absolute'` waypoints produce an interpolated `camera` in this phase.

- [ ] **Step 1: Write the failing tests**

`src/tests/evaluator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateProjectTimeline } from '../timeline/evaluator';
import { compileProjectTimeline } from '../timeline/compiler';
import { makeMinimalProject } from './fixtures';
import type { InteriorTourScene, MapScene, StorefrontScene } from '../models/scenes';

describe('evaluateProjectTimeline', () => {
  it('returns exactly one layer with full opacity outside any crossfade window', () => {
    const project = makeMinimalProject();
    const timeline = compileProjectTimeline(project);
    const frame = evaluateProjectTimeline(timeline, 10);
    expect(frame.layers).toHaveLength(1);
    expect(frame.layers[0].opacity).toBe(1);
  });

  it('interpolates a photo transform at the midpoint of its segment', () => {
    const project = makeMinimalProject();
    const timeline = compileProjectTimeline(project);
    const interiorSection = timeline.sections.find((s) => s.type === 'interior-tour')!;
    const midMs = (interiorSection.startMs + interiorSection.endMs) / 2;
    const frame = evaluateProjectTimeline(timeline, midMs);
    expect(frame.layers[0].transform).toBeDefined();
  });

  it('returns two layers with complementary opacity during a crossfade overlap', () => {
    const project = makeMinimalProject();
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items = [
      {
        id: 'p1', type: 'photo', assetId: 'a1', durationMs: 4000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'push-in', transitionToNext: { type: 'crossfade', durationMs: 500 },
      },
      {
        id: 'p2', type: 'photo', assetId: 'a2', durationMs: 4000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'pull-out', transitionToNext: { type: 'cut', durationMs: 0 },
      },
    ];
    const timeline = compileProjectTimeline(project);
    const p1 = timeline.segments.find((s) => s.itemId === 'p1')!;
    const midOverlapMs = p1.endMs - 250;
    const frame = evaluateProjectTimeline(timeline, midOverlapMs);
    expect(frame.layers).toHaveLength(2);
    expect(frame.layers[0].opacity + frame.layers[1].opacity).toBeCloseTo(1, 5);
    expect(frame.layers[0].opacity).toBeCloseTo(0.5, 1);
  });

  it('resolves the correct activeSectionId at an arbitrary seek into each scene', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    mapScene.waypoints = [
      {
        id: 'earth', name: 'earth', type: 'absolute',
        camera: { longitude: 0, latitude: 0, height: 1e7, heading: 0, pitch: -90, roll: 0 },
        travelDurationMs: 0, holdDurationMs: 1000, travelDurationLocked: false, holdDurationLocked: false, easing: 'cinematic',
      },
      {
        id: 'business', name: 'business', type: 'absolute',
        camera: { longitude: 1, latitude: 1, height: 500, heading: 0, pitch: -30, roll: 0 },
        travelDurationMs: 1800, holdDurationMs: 600, travelDurationLocked: false, holdDurationLocked: false, easing: 'cinematic',
      },
    ];
    const timeline = compileProjectTimeline(project);
    const mapSection = timeline.sections.find((s) => s.type === 'map')!;
    const storefrontSection = timeline.sections.find((s) => s.type === 'storefront')!;
    const interiorSection = timeline.sections.find((s) => s.type === 'interior-tour')!;
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;

    expect(evaluateProjectTimeline(timeline, mapSection.startMs + 10).activeSectionId).toBe(mapScene.id);
    expect(
      evaluateProjectTimeline(timeline, (storefrontSection.startMs + storefrontSection.endMs) / 2).activeSectionId,
    ).toBe(storefrontScene.id);
    expect(evaluateProjectTimeline(timeline, interiorSection.endMs - 1).activeSectionId).toBe(interiorSection.id);
  });

  it('clamps out-of-range times to the timeline bounds', () => {
    const project = makeMinimalProject();
    const timeline = compileProjectTimeline(project);
    const early = evaluateProjectTimeline(timeline, -500);
    const late = evaluateProjectTimeline(timeline, timeline.totalDurationMs + 500);
    expect(early.projectTimeMs).toBe(0);
    expect(late.projectTimeMs).toBe(timeline.totalDurationMs);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- evaluator.test.ts`
Expected: FAIL — cannot resolve `../timeline/evaluator`.

- [ ] **Step 3: Implement src/timeline/evaluator.ts**

```ts
import type { CompiledTimeline, EvaluatedFrame, EvaluatedLayer, TimelineSegment } from '../models/timeline';
import { getEasingFunction } from './easing';
import { interpolateCameraState } from './cameraInterpolation';
import type { VisualTransform } from '../models/scenes';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function interpolateTransform(from: VisualTransform, to: VisualTransform, t: number): VisualTransform {
  return {
    centerX: from.centerX + (to.centerX - from.centerX) * t,
    centerY: from.centerY + (to.centerY - from.centerY) * t,
    scale: from.scale + (to.scale - from.scale) * t,
    rotation: (from.rotation ?? 0) + ((to.rotation ?? 0) - (from.rotation ?? 0)) * t,
  };
}

function evaluateSegmentLayer(segment: TimelineSegment, timeMs: number): EvaluatedLayer {
  const localTimeMs = timeMs - segment.startMs;
  const durationMs = segment.endMs - segment.startMs;
  const rawT = durationMs > 0 ? clamp(localTimeMs / durationMs, 0, 1) : 0;

  if (segment.kind === 'map-hold') {
    const camera = segment.fromWaypoint?.type === 'absolute' ? segment.fromWaypoint.camera : undefined;
    return { sourceType: 'map', sourceId: segment.sourceId, localTimeMs, opacity: 1, camera };
  }

  if (segment.kind === 'map-travel') {
    const from = segment.fromWaypoint!;
    const to = segment.toWaypoint!;
    const eased = getEasingFunction(to.easing)(rawT);
    const camera =
      from.type === 'absolute' && to.type === 'absolute'
        ? interpolateCameraState(from.camera, to.camera, eased)
        : undefined;
    return { sourceType: 'map', sourceId: segment.sourceId, localTimeMs, opacity: 1, camera };
  }

  if (segment.kind === 'storefront' || segment.kind === 'photo') {
    const transform =
      segment.startTransform && segment.endTransform
        ? interpolateTransform(segment.startTransform, segment.endTransform, rawT)
        : segment.startTransform;
    return { sourceType: segment.sourceType, sourceId: segment.sourceId, localTimeMs, opacity: 1, transform };
  }

  if (segment.kind === 'video') {
    const videoLocalMs = (segment.trimStartMs ?? 0) + localTimeMs * (segment.playbackRate ?? 1);
    return { sourceType: 'video', sourceId: segment.sourceId, localTimeMs: videoLocalMs, opacity: 1 };
  }

  return { sourceType: 'image', sourceId: '__black__', localTimeMs, opacity: 1 };
}

function isActiveAt(segment: TimelineSegment, timeMs: number, totalDurationMs: number): boolean {
  if (timeMs < segment.startMs) return false;
  if (timeMs < segment.endMs) return true;
  return timeMs === segment.endMs && segment.endMs === totalDurationMs;
}

export function evaluateProjectTimeline(timeline: CompiledTimeline, timeMs: number): EvaluatedFrame {
  const clampedTimeMs = clamp(timeMs, 0, timeline.totalDurationMs);
  const activeSegments = timeline.segments
    .filter((s) => isActiveAt(s, clampedTimeMs, timeline.totalDurationMs))
    .sort((a, b) => a.startMs - b.startMs);

  if (activeSegments.length === 0) {
    return { projectTimeMs: clampedTimeMs, layers: [], activeSectionId: timeline.sections[0]?.id ?? '' };
  }

  const layers: EvaluatedLayer[] = activeSegments.map((segment) => evaluateSegmentLayer(segment, clampedTimeMs));

  if (activeSegments.length === 2) {
    const [outgoing, incoming] = activeSegments;
    const overlapStart = incoming.startMs;
    const overlapEnd = outgoing.endMs;
    const overlapDurationMs = overlapEnd - overlapStart;
    const overlapT = overlapDurationMs > 0 ? clamp((clampedTimeMs - overlapStart) / overlapDurationMs, 0, 1) : 1;
    layers[0].opacity = 1 - overlapT;
    layers[1].opacity = overlapT;
  }

  const primary = activeSegments[activeSegments.length - 1];
  return {
    projectTimeMs: clampedTimeMs,
    layers,
    activeSectionId: primary.sectionId,
    activeItemId: primary.itemId,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- evaluator.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline/evaluator.ts src/tests/evaluator.test.ts
git commit -m "feat: add deterministic master timeline evaluator"
```

---

### Task 6: Timeline Scaling

**Files:**
- Create: `src/timeline/scaling.ts`
- Test: `src/tests/scaling.test.ts`

**Interfaces:**
- Consumes: `Project` from `src/models/project.ts`; `MapScene`, `InteriorTourScene`, `Waypoint`, `InteriorTourItem` from `src/models/scenes.ts`; `compileProjectTimeline` from `src/timeline/compiler.ts`.
- Produces: `class TimelineScalingError extends Error` with `readonly requestedMs: number` and `readonly minimumPossibleMs: number`; `fitMapToDuration(mapScene: MapScene, targetMs: number): MapScene`; `fitInteriorTourToDuration(tourScene: InteriorTourScene, targetMs: number): InteriorTourScene`; `fitProjectToDuration(project: Project, targetMs: number): Project`.

- [ ] **Step 1: Write the failing tests**

`src/tests/scaling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fitMapToDuration, fitInteriorTourToDuration, fitProjectToDuration, TimelineScalingError } from '../timeline/scaling';
import { compileProjectTimeline } from '../timeline/compiler';
import { makeMinimalProject } from './fixtures';
import type { MapScene, StorefrontScene, InteriorTourScene, Waypoint } from '../models/scenes';

function makeWaypoint(overrides: Partial<Waypoint> & { id: string }): Waypoint {
  return {
    type: 'absolute',
    name: overrides.id,
    camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
    travelDurationMs: 0,
    holdDurationMs: 0,
    travelDurationLocked: false,
    holdDurationLocked: false,
    easing: 'cinematic',
    ...overrides,
  } as Waypoint;
}

describe('fitMapToDuration', () => {
  it('redistributes unlocked durations proportionally to hit the target', () => {
    const mapScene: MapScene = {
      id: 'map-1',
      type: 'map',
      waypoints: [
        makeWaypoint({ id: 'w0', holdDurationMs: 1000 }),
        makeWaypoint({ id: 'w1', travelDurationMs: 2000, holdDurationMs: 1000 }),
      ],
    };
    const fitted = fitMapToDuration(mapScene, 8000);
    const total = fitted.waypoints.reduce((sum, wp, i) => sum + (i > 0 ? wp.travelDurationMs : 0) + wp.holdDurationMs, 0);
    expect(total).toBe(8000);
    expect(fitted.waypoints[1].travelDurationMs).toBe(2 * fitted.waypoints[0].holdDurationMs);
  });

  it('leaves locked durations untouched', () => {
    const mapScene: MapScene = {
      id: 'map-1',
      type: 'map',
      waypoints: [
        makeWaypoint({ id: 'w0', holdDurationMs: 1000, holdDurationLocked: true }),
        makeWaypoint({ id: 'w1', travelDurationMs: 2000, holdDurationMs: 1000 }),
      ],
    };
    const fitted = fitMapToDuration(mapScene, 6000);
    expect(fitted.waypoints[0].holdDurationMs).toBe(1000);
  });

  it('throws TimelineScalingError with minimumPossibleMs when locked durations exceed the target', () => {
    const mapScene: MapScene = {
      id: 'map-1',
      type: 'map',
      waypoints: [makeWaypoint({ id: 'w0', holdDurationMs: 5000, holdDurationLocked: true })],
    };
    expect(() => fitMapToDuration(mapScene, 1000)).toThrow(TimelineScalingError);
    try {
      fitMapToDuration(mapScene, 1000);
    } catch (err) {
      expect((err as TimelineScalingError).minimumPossibleMs).toBe(5000);
    }
  });
});

describe('fitInteriorTourToDuration', () => {
  it('never alters video clip durations', () => {
    const tourScene: InteriorTourScene = {
      id: 'tour-1',
      type: 'interior-tour',
      defaultPhotoDurationMs: 4000,
      defaultTransition: { type: 'crossfade', durationMs: 500 },
      items: [
        {
          id: 'v1', type: 'video', assetId: 'video-1', trimStartMs: 0, trimEndMs: 5000, playbackRate: 1,
          audioEnabled: false, fitMode: 'cover', transitionToNext: { type: 'cut', durationMs: 0 },
        },
        {
          id: 'p1', type: 'photo', assetId: 'a1', durationMs: 4000, durationLocked: false,
          startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
          motionPreset: 'push-in', transitionToNext: { type: 'cut', durationMs: 0 },
        },
      ],
    };
    const fitted = fitInteriorTourToDuration(tourScene, 12000);
    const video = fitted.items.find((i) => i.id === 'v1')!;
    expect(video.type).toBe('video');
    if (video.type === 'video') {
      expect(video.trimEndMs - video.trimStartMs).toBe(5000);
      expect(video.playbackRate).toBe(1);
    }
  });

  it('throws when video plus locked photo durations alone exceed the target', () => {
    const tourScene: InteriorTourScene = {
      id: 'tour-1',
      type: 'interior-tour',
      defaultPhotoDurationMs: 4000,
      defaultTransition: { type: 'crossfade', durationMs: 500 },
      items: [
        {
          id: 'v1', type: 'video', assetId: 'video-1', trimStartMs: 0, trimEndMs: 10000, playbackRate: 1,
          audioEnabled: false, fitMode: 'cover', transitionToNext: { type: 'cut', durationMs: 0 },
        },
      ],
    };
    expect(() => fitInteriorTourToDuration(tourScene, 5000)).toThrow(TimelineScalingError);
  });
});

describe('fitProjectToDuration', () => {
  it('splits the target proportionally between Map+Storefront and Interior Tour, then within Map+Storefront', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;

    mapScene.waypoints = [
      {
        type: 'absolute', name: 'w0', camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
        travelDurationMs: 0, holdDurationMs: 1000, travelDurationLocked: false, holdDurationLocked: false, easing: 'cinematic',
      },
      {
        type: 'absolute', name: 'w1', camera: { longitude: 1, latitude: 1, height: 500, heading: 0, pitch: -30, roll: 0 },
        travelDurationMs: 1000, holdDurationMs: 0, travelDurationLocked: false, holdDurationLocked: false, easing: 'cinematic',
      },
    ]; // map total: 2000ms, all unlocked
    storefrontScene.durationMs = 2000; // unlocked
    storefrontScene.durationLocked = false;
    interiorScene.items = [interiorScene.items[0]]; // one unlocked photo, durationMs: 4000 from the fixture

    // current total = 2000 (map) + 2000 (storefront) + 4000 (interior) = 8000ms
    const fitted = fitProjectToDuration(project, 16000);

    const fittedMap = fitted.scenes.find((s): s is MapScene => s.type === 'map')!;
    const fittedStorefront = fitted.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    const fittedInterior = fitted.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;

    // Map+Storefront keeps its current 50% share of the total (4000/8000), scaled to 8000ms of the 16000ms target;
    // within that, Storefront keeps its current 50% share of Map+Storefront (2000/4000), so each lands at 4000ms.
    expect(fittedStorefront.durationMs).toBe(4000);
    const fittedMapTotalMs = fittedMap.waypoints.reduce((sum, wp, i) => sum + (i > 0 ? wp.travelDurationMs : 0) + wp.holdDurationMs, 0);
    expect(fittedMapTotalMs).toBe(4000);
    // Interior Tour gets the remaining 8000ms (its one unlocked photo doubles from 4000 to 8000).
    expect(fittedInterior.items[0].type).toBe('photo');
    if (fittedInterior.items[0].type === 'photo') {
      expect(fittedInterior.items[0].durationMs).toBe(8000);
    }

    const fittedTimeline = compileProjectTimeline(fitted);
    expect(fittedTimeline.totalDurationMs).toBe(16000);
  });

  it('keeps a locked Storefront duration exact and gives Map the remainder of the Map+Storefront split', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;

    mapScene.waypoints = [
      {
        type: 'absolute', name: 'w0', camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
        travelDurationMs: 0, holdDurationMs: 2000, travelDurationLocked: false, holdDurationLocked: false, easing: 'cinematic',
      },
    ]; // map total: 2000ms, unlocked
    storefrontScene.durationMs = 2000;
    storefrontScene.durationLocked = true; // locked — must remain exactly 2000ms
    interiorScene.items = [interiorScene.items[0]];

    const fitted = fitProjectToDuration(project, 20000);
    const fittedStorefront = fitted.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    expect(fittedStorefront.durationMs).toBe(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- scaling.test.ts`
Expected: FAIL — cannot resolve `../timeline/scaling`.

- [ ] **Step 3: Implement src/timeline/scaling.ts**

```ts
import type { Project } from '../models/project';
import type { MapScene, StorefrontScene, InteriorTourScene, Waypoint, InteriorTourItem } from '../models/scenes';
import { compileProjectTimeline } from './compiler';

export class TimelineScalingError extends Error {
  constructor(
    message: string,
    readonly requestedMs: number,
    readonly minimumPossibleMs: number,
  ) {
    super(message);
    this.name = 'TimelineScalingError';
  }
}

function videoEffectiveDurationMs(item: Extract<InteriorTourItem, { type: 'video' }>): number {
  return (item.trimEndMs - item.trimStartMs) / item.playbackRate;
}

export function fitMapToDuration(mapScene: MapScene, targetMs: number): MapScene {
  let lockedSum = 0;
  let unlockedSum = 0;
  mapScene.waypoints.forEach((wp, i) => {
    if (i > 0) {
      if (wp.travelDurationLocked) lockedSum += wp.travelDurationMs;
      else unlockedSum += wp.travelDurationMs;
    }
    if (wp.holdDurationLocked) lockedSum += wp.holdDurationMs;
    else unlockedSum += wp.holdDurationMs;
  });

  if (lockedSum >= targetMs) {
    throw new TimelineScalingError(
      `Cannot fit map fly-in to ${targetMs}ms: locked durations alone total ${lockedSum}ms.`,
      targetMs,
      lockedSum,
    );
  }

  const availableForUnlocked = targetMs - lockedSum;
  const scaleFactor = unlockedSum > 0 ? availableForUnlocked / unlockedSum : 1;

  const waypoints: Waypoint[] = mapScene.waypoints.map((wp, i) => ({
    ...wp,
    travelDurationMs:
      i > 0 && !wp.travelDurationLocked ? Math.round(wp.travelDurationMs * scaleFactor) : wp.travelDurationMs,
    holdDurationMs: !wp.holdDurationLocked ? Math.round(wp.holdDurationMs * scaleFactor) : wp.holdDurationMs,
  }));

  return { ...mapScene, waypoints };
}

export function fitInteriorTourToDuration(tourScene: InteriorTourScene, targetMs: number): InteriorTourScene {
  const videoSum = tourScene.items
    .filter((item): item is Extract<InteriorTourItem, { type: 'video' }> => item.type === 'video')
    .reduce((sum, item) => sum + videoEffectiveDurationMs(item), 0);

  const photos = tourScene.items.filter(
    (item): item is Extract<InteriorTourItem, { type: 'photo' }> => item.type === 'photo',
  );
  const lockedPhotoSum = photos.filter((p) => p.durationLocked).reduce((sum, p) => sum + p.durationMs, 0);
  const unlockedPhotoSum = photos.filter((p) => !p.durationLocked).reduce((sum, p) => sum + p.durationMs, 0);
  const lockedSum = videoSum + lockedPhotoSum;

  if (lockedSum >= targetMs) {
    throw new TimelineScalingError(
      `Cannot fit interior tour to ${targetMs}ms: video clips and locked photo durations alone total ${lockedSum}ms.`,
      targetMs,
      lockedSum,
    );
  }

  const availableForUnlockedPhotos = targetMs - lockedSum;
  const scaleFactor = unlockedPhotoSum > 0 ? availableForUnlockedPhotos / unlockedPhotoSum : 1;

  const items: InteriorTourItem[] = tourScene.items.map((item) => {
    if (item.type === 'video') return item;
    if (item.durationLocked) return item;
    return { ...item, durationMs: Math.round(item.durationMs * scaleFactor) };
  });

  return { ...tourScene, items };
}

export function fitProjectToDuration(project: Project, targetMs: number): Project {
  const currentTimeline = compileProjectTimeline(project);
  const currentTotalMs = currentTimeline.totalDurationMs;
  const currentMapSection = currentTimeline.sections.find((s) => s.type === 'map');
  const currentStorefrontSection = currentTimeline.sections.find((s) => s.type === 'storefront');
  const currentMapMs = currentMapSection ? currentMapSection.endMs - currentMapSection.startMs : 0;
  const currentStorefrontMs = currentStorefrontSection ? currentStorefrontSection.endMs - currentStorefrontSection.startMs : 0;
  const currentMapPlusStorefrontMs = currentMapMs + currentStorefrontMs;

  const targetMapPlusStorefrontMs = currentTotalMs > 0 ? targetMs * (currentMapPlusStorefrontMs / currentTotalMs) : 0;
  const targetInteriorMs = targetMs - targetMapPlusStorefrontMs;

  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  const storefrontTargetMs = storefrontScene
    ? storefrontScene.durationLocked
      ? storefrontScene.durationMs
      : Math.round(
          targetMapPlusStorefrontMs * (currentMapPlusStorefrontMs > 0 ? currentStorefrontMs / currentMapPlusStorefrontMs : 0),
        )
    : 0;
  const mapTargetMs = Math.max(targetMapPlusStorefrontMs - storefrontTargetMs, 0);

  const scenes = project.scenes.map((scene) => {
    if (scene.type === 'map') return fitMapToDuration(scene, mapTargetMs);
    if (scene.type === 'storefront') return { ...scene, durationMs: storefrontTargetMs };
    if (scene.type === 'interior-tour') return fitInteriorTourToDuration(scene, Math.max(targetInteriorMs, 0));
    return scene;
  });

  return { ...project, scenes };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- scaling.test.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Run the full test suite and build**

Run: `npm run test` — expect all suites (Phase 1's 10 files + this plan's 6 new files = 16 files) passing.
Run: `npm run build` — expect success.

- [ ] **Step 6: Commit**

```bash
git add src/timeline/scaling.ts src/tests/scaling.test.ts
git commit -m "feat: add timeline scaling with locked-duration support"
```

---

## Phase 2 Completion Check

Phase 2 is done when all of the following hold:

- `npm run test` passes with all 16 test files green (Phase 1's 10 + this plan's `timelineModels`, `easing`, `cameraInterpolation`, `compiler`, `evaluator`, `scaling`).
- `npm run build` succeeds.
- No new entries were added to `package.json` dependencies.
- Every commit from Tasks 1–6 is present in git history.

This satisfies the Phase 2 spec's acceptance criteria in full, and unblocks Phase 3 (media ingestion + destination resolution), which is independent of the timeline engine, and Phase 4 (Cesium + UI + playback), which directly consumes `compileProjectTimeline`, `evaluateProjectTimeline`, and the scaling functions built here.
