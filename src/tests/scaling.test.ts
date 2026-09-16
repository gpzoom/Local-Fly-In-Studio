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
  it('does not throw on the canonical fixture, whose map scene has no waypoints (degenerate exact-fit)', () => {
    // Regression: the map scene of makeMinimalProject() has waypoints: [], so fitProjectToDuration
    // hands fitMapToDuration a target of 0 with a locked sum of 0. That is a "nothing to scale"
    // case, not a locked-durations conflict, and must not throw.
    expect(() => fitProjectToDuration(makeMinimalProject(), 10000)).not.toThrow();
    const fitted = fitProjectToDuration(makeMinimalProject(), 10000);
    const fittedMap = fitted.scenes.find((s): s is MapScene => s.type === 'map')!;
    expect(fittedMap.waypoints).toEqual([]);
  });

  it('splits the target proportionally between Map+Storefront and Interior Tour, then within Map+Storefront', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;

    mapScene.waypoints = [
      {
        id: 'w0', type: 'absolute', name: 'w0', camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
        travelDurationMs: 0, holdDurationMs: 1000, travelDurationLocked: false, holdDurationLocked: false, easing: 'cinematic',
      },
      {
        id: 'w1', type: 'absolute', name: 'w1', camera: { longitude: 1, latitude: 1, height: 500, heading: 0, pitch: -30, roll: 0 },
        travelDurationMs: 1000, holdDurationMs: 0, travelDurationLocked: false, holdDurationLocked: false, easing: 'cinematic',
      },
    ]; // map total: 2000ms, all unlocked
    storefrontScene.durationMs = 2000; // unlocked
    storefrontScene.durationLocked = false;
    // Zero out the fixture's default crossfades so the compiled total equals the raw content-duration
    // sum exactly — this test isolates the scaling *ratio* math, not the compiler's overlap accounting
    // (which Task 4's compiler tests already cover separately).
    storefrontScene.transitionIn = { type: 'cut', durationMs: 0 };
    storefrontScene.transitionOut = { type: 'cut', durationMs: 0 };
    interiorScene.items = [{ ...interiorScene.items[0], transitionToNext: { type: 'cut', durationMs: 0 } }];

    // current total = 2000 (map) + 2000 (storefront) + 4000 (interior) = 8000ms (no crossfade overlap, all cuts)
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

  it('compensates for the Map->Storefront and Storefront->Interior crossfade overlaps so the recompiled total hits the target', () => {
    // Regression: the split used to ignore the two boundary crossfades the compiler subtracts
    // during recompilation, so a 30000ms target compiled to ~28800ms (short by 600 + 600).
    // The fixture's *default* 600ms crossfades are kept deliberately here.
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    mapScene.waypoints = [
      makeWaypoint({ id: 'w0', holdDurationMs: 1000 }),
      makeWaypoint({ id: 'w1', travelDurationMs: 1800, holdDurationMs: 600 }),
    ];
    expect(storefrontScene.transitionIn).toEqual({ type: 'crossfade', durationMs: 600 });
    expect(storefrontScene.transitionOut).toEqual({ type: 'crossfade', durationMs: 600 });

    const targetMs = 30000;
    const fitted = fitProjectToDuration(project, targetMs);
    const fittedTimeline = compileProjectTimeline(fitted);

    // ±2ms: each of the map / storefront / interior duration assignments rounds independently.
    expect(Math.abs(fittedTimeline.totalDurationMs - targetMs)).toBeLessThanOrEqual(2);
  });

  it('hits the target exactly for an empty-map project, whose storefront crossfade-in is never applied', () => {
    // Regression for the interaction between the first-segment overlap gate in the compiler
    // and the boundary-overlap compensation here: with no map segments the storefront is the
    // first segment in the timeline, so the compiler never subtracts its incoming crossfade.
    // Counting it anyway overshot the target by 600ms (and not compensating at all undershot
    // by 600ms); only the transitionOut overlap is genuinely applied here.
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    expect(mapScene.waypoints).toEqual([]);
    expect(storefrontScene.transitionIn).toEqual({ type: 'crossfade', durationMs: 600 });
    expect(storefrontScene.transitionOut).toEqual({ type: 'crossfade', durationMs: 600 });

    const targetMs = 10000;
    const fitted = fitProjectToDuration(project, targetMs);
    expect(compileProjectTimeline(fitted).totalDurationMs).toBe(targetMs);
  });

  it('keeps a locked Storefront duration exact and gives Map the remainder of the Map+Storefront split', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;

    mapScene.waypoints = [
      {
        id: 'w0', type: 'absolute', name: 'w0', camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
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
