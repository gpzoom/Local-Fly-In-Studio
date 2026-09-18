import { describe, it, expect } from 'vitest';
import {
  setAllPhotoDurations,
  setAllTransitionTypes,
  setAllTransitionDurations,
  regeneratePhotoMotion,
} from '../timeline/bulkEdit';
import type { InteriorTourScene, InteriorPhotoItem, InteriorVideoItem } from '../models/scenes';

function makePhoto(overrides: Partial<InteriorPhotoItem> = {}): InteriorPhotoItem {
  return {
    id: 'photo-default',
    type: 'photo',
    assetId: 'asset-photo',
    durationMs: 4000,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.08 },
    motionPreset: 'push-in',
    transitionToNext: { type: 'crossfade', durationMs: 500 },
    ...overrides,
  };
}

function makeVideo(overrides: Partial<InteriorVideoItem> = {}): InteriorVideoItem {
  return {
    id: 'video-default',
    type: 'video',
    assetId: 'asset-video',
    trimStartMs: 0,
    trimEndMs: 5000,
    playbackRate: 1,
    audioEnabled: true,
    fitMode: 'contain',
    transitionToNext: { type: 'cut', durationMs: 0 },
    ...overrides,
  };
}

function makeScene(items: InteriorTourScene['items']): InteriorTourScene {
  return {
    id: 'interior-1',
    type: 'interior-tour',
    items,
    defaultPhotoDurationMs: 4000,
    defaultTransition: { type: 'crossfade', durationMs: 500 },
  };
}

describe('setAllPhotoDurations', () => {
  it('sets durationMs on every unlocked photo', () => {
    const scene = makeScene([makePhoto({ id: 'p1', durationMs: 1000 }), makePhoto({ id: 'p2', durationMs: 2000 })]);
    const result = setAllPhotoDurations(scene, 5000);
    expect(result.items.map((i) => (i.type === 'photo' ? i.durationMs : null))).toEqual([5000, 5000]);
  });

  it('skips photos with durationLocked: true', () => {
    const scene = makeScene([
      makePhoto({ id: 'p1', durationMs: 1000, durationLocked: true }),
      makePhoto({ id: 'p2', durationMs: 2000, durationLocked: false }),
    ]);
    const result = setAllPhotoDurations(scene, 5000);
    expect(result.items.map((i) => (i.type === 'photo' ? i.durationMs : null))).toEqual([1000, 5000]);
  });

  it('leaves video items untouched', () => {
    const scene = makeScene([makePhoto({ id: 'p1' }), makeVideo({ id: 'v1' })]);
    const result = setAllPhotoDurations(scene, 9999);
    const video = result.items.find((i) => i.id === 'v1');
    expect(video).toEqual(makeVideo({ id: 'v1' }));
  });
});

describe('setAllTransitionTypes', () => {
  it('sets transitionToNext.type on every item, photo and video alike', () => {
    const scene = makeScene([
      makePhoto({ id: 'p1', transitionToNext: { type: 'cut', durationMs: 0 } }),
      makeVideo({ id: 'v1', transitionToNext: { type: 'crossfade', durationMs: 500 } }),
    ]);
    const result = setAllTransitionTypes(scene, 'fade-black');
    expect(result.items.map((i) => i.transitionToNext.type)).toEqual(['fade-black', 'fade-black']);
  });

  it("preserves each item's existing transition duration", () => {
    const scene = makeScene([makePhoto({ id: 'p1', transitionToNext: { type: 'cut', durationMs: 250 } })]);
    const result = setAllTransitionTypes(scene, 'crossfade');
    expect(result.items[0].transitionToNext.durationMs).toBe(250);
  });
});

describe('setAllTransitionDurations', () => {
  it('sets transitionToNext.durationMs on every item', () => {
    const scene = makeScene([
      makePhoto({ id: 'p1', transitionToNext: { type: 'crossfade', durationMs: 500 } }),
      makeVideo({ id: 'v1', transitionToNext: { type: 'cut', durationMs: 0 } }),
    ]);
    const result = setAllTransitionDurations(scene, 800);
    expect(result.items.map((i) => i.transitionToNext.durationMs)).toEqual([800, 800]);
  });

  it("preserves each item's existing transition type", () => {
    const scene = makeScene([makePhoto({ id: 'p1', transitionToNext: { type: 'fade-black', durationMs: 500 } })]);
    const result = setAllTransitionDurations(scene, 100);
    expect(result.items[0].transitionToNext.type).toBe('fade-black');
  });
});

describe('regeneratePhotoMotion', () => {
  it('cycles through the 4 photo motion presets in order across photo items', () => {
    const scene = makeScene([
      makePhoto({ id: 'p1', motionPreset: 'push-in' }),
      makePhoto({ id: 'p2', motionPreset: 'push-in' }),
      makePhoto({ id: 'p3', motionPreset: 'push-in' }),
      makePhoto({ id: 'p4', motionPreset: 'push-in' }),
      makePhoto({ id: 'p5', motionPreset: 'push-in' }),
    ]);
    const result = regeneratePhotoMotion(scene);
    expect(result.items.map((i) => (i.type === 'photo' ? i.motionPreset : null))).toEqual([
      'push-in',
      'pull-out',
      'pan-left-right',
      'pan-right-left',
      'push-in',
    ]);
  });

  it('skips video items when counting for the cycle (only photos advance the cycle index)', () => {
    const scene = makeScene([
      makePhoto({ id: 'p1', motionPreset: 'push-in' }),
      makeVideo({ id: 'v1' }),
      makePhoto({ id: 'p2', motionPreset: 'push-in' }),
    ]);
    const result = regeneratePhotoMotion(scene);
    expect(result.items.map((i) => (i.type === 'photo' ? i.motionPreset : 'video'))).toEqual([
      'push-in',
      'video',
      'pull-out',
    ]);
  });

  it('leaves video items completely untouched', () => {
    const scene = makeScene([makeVideo({ id: 'v1' })]);
    const result = regeneratePhotoMotion(scene);
    expect(result.items[0]).toEqual(makeVideo({ id: 'v1' }));
  });
});
