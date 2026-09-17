import { describe, it, expect, vi } from 'vitest';
import type { Viewer } from 'cesium';

vi.mock('cesium', () => ({
  Math: { toDegrees: (rad: number) => (rad * 180) / Math.PI },
}));

describe('captureCameraState', () => {
  it('converts the live viewer camera state from radians to a degrees-based CameraState', async () => {
    const { captureCameraState } = await import('../cesium/captureCameraState');

    const fakeViewer = {
      camera: {
        positionCartographic: {
          longitude: (-104.9 * Math.PI) / 180,
          latitude: (39.7 * Math.PI) / 180,
          height: 500,
        },
        heading: (90 * Math.PI) / 180,
        pitch: (-30 * Math.PI) / 180,
        roll: 0,
      },
    } as unknown as Viewer;

    const result = captureCameraState(fakeViewer);

    expect(result.longitude).toBeCloseTo(-104.9, 6);
    expect(result.latitude).toBeCloseTo(39.7, 6);
    expect(result.height).toBe(500);
    expect(result.heading).toBeCloseTo(90, 6);
    expect(result.pitch).toBeCloseTo(-30, 6);
    expect(result.roll).toBeCloseTo(0, 6);
  });
});
