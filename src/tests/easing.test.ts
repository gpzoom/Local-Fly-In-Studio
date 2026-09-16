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
