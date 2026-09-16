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
