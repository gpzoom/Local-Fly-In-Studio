import { describe, it, expect } from 'vitest';
import { getDeviceLocation, type GetCurrentPosition } from '../destination/geolocation';

describe('getDeviceLocation', () => {
  it('resolves latitude/longitude on success', async () => {
    const fakeGeo: GetCurrentPosition = {
      getCurrentPosition: (success) => {
        success({
          coords: { latitude: 37.7749, longitude: -122.4194 },
        } as GeolocationPosition);
      },
    };

    const result = await getDeviceLocation(fakeGeo);
    expect(result).toEqual({ latitude: 37.7749, longitude: -122.4194 });
  });

  it('rejects with the browser error on permission denial', async () => {
    const permissionDeniedError = { code: 1, message: 'User denied Geolocation' } as GeolocationPositionError;
    const fakeGeo: GetCurrentPosition = {
      getCurrentPosition: (_success, error) => {
        error?.(permissionDeniedError);
      },
    };

    await expect(getDeviceLocation(fakeGeo)).rejects.toBe(permissionDeniedError);
  });

  it('rejects when the browser reports a timeout error', async () => {
    const timeoutError = { code: 3, message: 'Timeout expired' } as GeolocationPositionError;
    const fakeGeo: GetCurrentPosition = {
      getCurrentPosition: (_success, error) => {
        error?.(timeoutError);
      },
    };

    await expect(getDeviceLocation(fakeGeo, 1000)).rejects.toBe(timeoutError);
  });
});
