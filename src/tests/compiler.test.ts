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

  it('reports totalDurationMs as the true maximum segment end, not the last cursor position, when a crossfade duration exceeds the incoming segment\'s own duration', () => {
    const project = makeMinimalProject();
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    storefrontScene.transitionIn = { type: 'cut', durationMs: 0 };
    storefrontScene.transitionOut = { type: 'cut', durationMs: 0 };
    storefrontScene.durationMs = 2000;
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items = [
      {
        id: 'p1', type: 'photo', assetId: 'a1', durationMs: 4000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'push-in', transitionToNext: { type: 'crossfade', durationMs: 5000 },
      },
      {
        id: 'p2', type: 'photo', assetId: 'a2', durationMs: 1000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'pull-out', transitionToNext: { type: 'cut', durationMs: 0 },
      },
    ];
    const timeline = compileProjectTimeline(project);
    const p1 = timeline.segments.find((s) => s.itemId === 'p1')!;
    const p2 = timeline.segments.find((s) => s.itemId === 'p2')!;
    // p2's incoming crossfade (5000ms) exceeds its own duration (1000ms), so p2 both
    // starts and ends before p1 does. A naive "last processed cursor" total would
    // report p2.endMs (an earlier, smaller time) instead of the true maximum.
    expect(p2.endMs).toBeLessThan(p1.endMs);
    const trueMaxEndMs = Math.max(...timeline.segments.map((s) => s.endMs));
    expect(timeline.totalDurationMs).toBe(trueMaxEndMs);
    expect(timeline.totalDurationMs).toBe(p1.endMs);
  });

  it('never applies crossfade overlap to the first emitted segment, so no segment starts before 0', () => {
    // The canonical fixture's map scene has no waypoints, so the storefront (whose
    // transitionIn is a 600ms crossfade) is the first segment ever emitted. There is
    // nothing before it to crossfade from, so its overlap must not be subtracted —
    // otherwise it starts at -600 and its first 600ms of content becomes unreachable.
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    expect(mapScene.waypoints).toEqual([]);
    expect(storefrontScene.transitionIn).toEqual({ type: 'crossfade', durationMs: 600 });

    const timeline = compileProjectTimeline(project);
    const storefront = timeline.segments.find((s) => s.kind === 'storefront')!;
    expect(storefront.startMs).toBe(0);
    // The full storefront content is present — its duration is not clipped by the overlap.
    expect(storefront.endMs - storefront.startMs).toBe(storefrontScene.durationMs);
    expect(timeline.segments.every((s) => s.startMs >= 0)).toBe(true);
  });

  it('returns segments sorted by startMs even when a crossfade reorders emission', () => {
    const project = makeMinimalProject();
    const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront')!;
    storefrontScene.transitionIn = { type: 'cut', durationMs: 0 };
    storefrontScene.transitionOut = { type: 'cut', durationMs: 0 };
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items = [
      {
        id: 'p1', type: 'photo', assetId: 'a1', durationMs: 4000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'push-in', transitionToNext: { type: 'crossfade', durationMs: 5000 },
      },
      {
        id: 'p2', type: 'photo', assetId: 'a2', durationMs: 1000, durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 }, endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'pull-out', transitionToNext: { type: 'cut', durationMs: 0 },
      },
    ];
    const timeline = compileProjectTimeline(project);
    const starts = timeline.segments.map((s) => s.startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
