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
