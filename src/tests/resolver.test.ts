import { describe, it, expect } from 'vitest';
import {
  resolveFromPhotoGps,
  resolveFromDeviceLocation,
  resolveFromAddress,
  resolveManual,
} from '../destination/resolver';
import type { GeocodingProvider } from '../destination/censusGeocoder';
import type { GetCurrentPosition } from '../destination/geolocation';

describe('resolveFromPhotoGps', () => {
  it('returns a photo-gps Destination when coordinates are present', () => {
    const destination = resolveFromPhotoGps({ latitude: 40.7128, longitude: -74.006 });
    expect(destination).toEqual({ source: 'photo-gps', latitude: 40.7128, longitude: -74.006 });
  });

  it('returns null when metadata has no coordinates', () => {
    expect(resolveFromPhotoGps({})).toBeNull();
  });

  it('returns null when only latitude is present (both are required, not just one)', () => {
    expect(resolveFromPhotoGps({ latitude: 40.7128 })).toBeNull();
  });
});

describe('resolveFromDeviceLocation', () => {
  it('returns a device-location Destination from the injected geolocation source', async () => {
    const fakeGeo: GetCurrentPosition = {
      getCurrentPosition: (success) => {
        success({ coords: { latitude: 37.7749, longitude: -122.4194 } } as GeolocationPosition);
      },
    };
    const destination = await resolveFromDeviceLocation(fakeGeo);
    expect(destination).toEqual({ source: 'device-location', latitude: 37.7749, longitude: -122.4194 });
  });
});

describe('resolveFromAddress', () => {
  it('returns an address Destination with matched coordinates on success', async () => {
    const fakeGeocoder: GeocodingProvider = {
      geocode: async () => ({ matchedAddress: '123 MAIN ST', latitude: 40.7128, longitude: -74.006 }),
    };
    const destination = await resolveFromAddress('123 Main St', fakeGeocoder);
    expect(destination).toEqual({
      source: 'address',
      latitude: 40.7128,
      longitude: -74.006,
      originalAddress: '123 Main St',
      matchedAddress: '123 MAIN ST',
    });
  });

  it('returns a null-coordinate address Destination when the geocoder finds no match', async () => {
    const fakeGeocoder: GeocodingProvider = { geocode: async () => null };
    const destination = await resolveFromAddress('nowhere', fakeGeocoder);
    expect(destination).toEqual({
      source: 'address',
      latitude: null,
      longitude: null,
      originalAddress: 'nowhere',
    });
  });
});

describe('resolveManual', () => {
  it('returns a manual Destination with the given coordinates', () => {
    expect(resolveManual(51.5074, -0.1278)).toEqual({ source: 'manual', latitude: 51.5074, longitude: -0.1278 });
  });
});
