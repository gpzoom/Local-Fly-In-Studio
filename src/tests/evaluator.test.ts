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

  it('holds the waypoint camera exactly at the start of a map-hold segment', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    const heldCamera = { longitude: 12.5, latitude: -3.25, height: 9000, heading: 42, pitch: -55, roll: 7 };
    mapScene.waypoints = [
      {
        id: 'w0', name: 'w0', type: 'absolute', camera: heldCamera,
        travelDurationMs: 0, holdDurationMs: 1000, travelDurationLocked: false, holdDurationLocked: false, easing: 'linear',
      },
    ];
    const timeline = compileProjectTimeline(project);
    const hold = timeline.segments.find((s) => s.kind === 'map-hold')!;
    expect(hold.startMs).toBe(0);

    const frame = evaluateProjectTimeline(timeline, hold.startMs);
    const layer = frame.layers.find((l) => l.kind === 'map-hold')!;
    expect(layer.camera).toEqual(heldCamera);
  });

  it('interpolates the map-travel camera through the segment easing, not raw progress', () => {
    const project = makeMinimalProject();
    const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map')!;
    // Same lat/lon on both ends so the surface slerp is a no-op and the expected midpoint
    // values for height/heading can be computed by hand.
    mapScene.waypoints = [
      {
        id: 'w0', name: 'w0', type: 'absolute',
        camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
        travelDurationMs: 0, holdDurationMs: 1000, travelDurationLocked: false, holdDurationLocked: false, easing: 'linear',
      },
      {
        id: 'w1', name: 'w1', type: 'absolute',
        camera: { longitude: 0, latitude: 0, height: 500, heading: 90, pitch: -30, roll: 0 },
        // 'accelerate' is t*t, so eased(0.5) = 0.25 — distinguishable from raw t = 0.5.
        travelDurationMs: 2000, holdDurationMs: 600, travelDurationLocked: false, holdDurationLocked: false, easing: 'accelerate',
      },
    ];
    const timeline = compileProjectTimeline(project);
    const travel = timeline.segments.find((s) => s.kind === 'map-travel')!;
    const midMs = (travel.startMs + travel.endMs) / 2;

    const frame = evaluateProjectTimeline(timeline, midMs);
    const camera = frame.layers.find((l) => l.kind === 'map-travel')!.camera!;

    // Genuinely between the endpoints, equal to neither.
    expect(camera.height).toBeGreaterThan(500);
    expect(camera.height).toBeLessThan(1000);
    expect(camera.heading).toBeGreaterThan(0);
    expect(camera.heading).toBeLessThan(90);

    // Hand-computed: eased = 0.5^2 = 0.25 -> height 1000 + (500-1000)*0.25, heading 0 + 90*0.25.
    expect(camera.height).toBeCloseTo(875, 6);
    expect(camera.heading).toBeCloseTo(22.5, 6);
    // ...and NOT the un-eased raw-progress values, which would be 750 / 45.
    expect(camera.height).not.toBeCloseTo(750, 3);
    expect(camera.heading).not.toBeCloseTo(45, 3);
    expect(camera.pitch).toBeCloseTo(-30, 6);
  });

  it('interpolates a photo transform to concrete midpoint values', () => {
    const project = makeMinimalProject();
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items = [
      {
        id: 'p1', type: 'photo', assetId: 'a1', durationMs: 4000, durationLocked: false,
        startTransform: { centerX: 0.2, centerY: 0.4, scale: 1 },
        endTransform: { centerX: 0.6, centerY: 0.8, scale: 2 },
        motionPreset: 'push-in', transitionToNext: { type: 'cut', durationMs: 0 },
      },
    ];
    const timeline = compileProjectTimeline(project);
    const photo = timeline.segments.find((s) => s.itemId === 'p1')!;
    const midMs = (photo.startMs + photo.endMs) / 2;

    const frame = evaluateProjectTimeline(timeline, midMs);
    const transform = frame.layers.find((l) => l.segmentId === photo.id)!.transform!;
    expect(transform.scale).toBeCloseTo(1.5, 6);
    expect(transform.centerX).toBeCloseTo(0.4, 6);
    expect(transform.centerY).toBeCloseTo(0.6, 6);
  });

  it('maps project time to video source time via trimStartMs + localTime * playbackRate', () => {
    const project = makeMinimalProject();
    const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour')!;
    interiorScene.items = [{
      id: 'v1', type: 'video', assetId: 'video-1', trimStartMs: 1000, trimEndMs: 5000, playbackRate: 2,
      audioEnabled: true, fitMode: 'cover', transitionToNext: { type: 'cut', durationMs: 0 },
    }];
    const timeline = compileProjectTimeline(project);
    const video = timeline.segments.find((s) => s.itemId === 'v1')!;

    const frame = evaluateProjectTimeline(timeline, video.startMs + 700);
    const layer = frame.layers.find((l) => l.kind === 'video')!;
    // 1000 (trim start) + 700 (local time) * 2 (playback rate) = 2400
    expect(layer.localTimeMs).toBe(2400);
    expect(layer.fitMode).toBe('cover');
    expect(layer.audioEnabled).toBe(true);
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
