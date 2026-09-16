export interface DeviceLocationResult {
  latitude: number;
  longitude: number;
}

export type GetCurrentPosition = Pick<Geolocation, 'getCurrentPosition'>;

// NOTE: unlike its sibling resolver functions (censusGeocode/resolveFromAddress and everything
// in media/), this function REJECTS on failure (permission denied, timeout) instead of resolving
// to a null/empty result. This is deliberate, so callers can distinguish failure modes.
export async function getDeviceLocation(
  geo: GetCurrentPosition = navigator.geolocation,
  timeoutMs = 10000,
): Promise<DeviceLocationResult> {
  return new Promise<DeviceLocationResult>((resolve, reject) => {
    geo.getCurrentPosition(
      (position) => {
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      (error) => {
        reject(error);
      },
      { timeout: timeoutMs },
    );
  });
}
