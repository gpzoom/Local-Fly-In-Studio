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
