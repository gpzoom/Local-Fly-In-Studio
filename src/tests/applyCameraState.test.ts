import { describe, it, expect, vi } from 'vitest';
import type { CameraState } from '../models/scenes';

const fromDegreesMock = vi.fn((longitude: number, latitude: number, height: number) => ({
  __fakeCartesian3: true,
  longitude,
  latitude,
  height,
}));

vi.mock('cesium', () => ({
  Cartesian3: { fromDegrees: fromDegreesMock },
  Math: { toRadians: (deg: number) => (deg * Math.PI) / 180 },
}));

describe('applyCameraState', () => {
  it('converts degrees to radians and calls viewer.camera.setView with the right destination and orientation', async () => {
    const { applyCameraState } = await import('../cesium/applyCameraState');
    const setView = vi.fn();
    const fakeViewer = { camera: { setView } } as unknown as Parameters<typeof applyCameraState>[0];

    const camera: CameraState = {
      longitude: -104.9,
      latitude: 39.7,
      height: 500,
      heading: 90,
      pitch: -30,
      roll: 0,
    };

    applyCameraState(fakeViewer, camera);

    expect(fromDegreesMock).toHaveBeenCalledWith(-104.9, 39.7, 500);
    expect(setView).toHaveBeenCalledTimes(1);
    const call = setView.mock.calls[0][0];
    expect(call.destination).toEqual({ __fakeCartesian3: true, longitude: -104.9, latitude: 39.7, height: 500 });
    expect(call.orientation.heading).toBeCloseTo((90 * Math.PI) / 180, 10);
    expect(call.orientation.pitch).toBeCloseTo((-30 * Math.PI) / 180, 10);
    expect(call.orientation.roll).toBeCloseTo(0, 10);
  });
});
