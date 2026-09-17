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
