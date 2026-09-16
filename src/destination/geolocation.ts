export interface DeviceLocationResult {
  latitude: number;
  longitude: number;
}

export type GetCurrentPosition = Pick<Geolocation, 'getCurrentPosition'>;

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
