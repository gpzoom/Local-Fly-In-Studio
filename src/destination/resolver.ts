import type { Destination } from '../models/project';
import type { ExtractedMediaMetadata } from '../media/metadata';
import { censusGeocoderProvider, type GeocodingProvider } from './censusGeocoder';
import { getDeviceLocation, type GetCurrentPosition } from './geolocation';

export function resolveFromPhotoGps(metadata: ExtractedMediaMetadata): Destination | null {
  if (typeof metadata.latitude !== 'number' || typeof metadata.longitude !== 'number') {
    return null;
  }
  return {
    source: 'photo-gps',
    latitude: metadata.latitude,
    longitude: metadata.longitude,
  };
}

export async function resolveFromDeviceLocation(geo?: GetCurrentPosition): Promise<Destination> {
  const location = await getDeviceLocation(geo);
  return {
    source: 'device-location',
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

export async function resolveFromAddress(
  address: string,
  geocoder: GeocodingProvider = censusGeocoderProvider,
): Promise<Destination> {
  const result = await geocoder.geocode(address);
  if (!result) {
    return {
      source: 'address',
      latitude: null,
      longitude: null,
      originalAddress: address,
    };
  }
  return {
    source: 'address',
    latitude: result.latitude,
    longitude: result.longitude,
    originalAddress: address,
    matchedAddress: result.matchedAddress,
  };
}

export function resolveManual(latitude: number, longitude: number): Destination {
  return {
    source: 'manual',
    latitude,
    longitude,
  };
}
