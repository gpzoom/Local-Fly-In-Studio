import type { CameraState } from '../models/scenes';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function haversineAngularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function slerpSurface(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
  f: number,
): { latitude: number; longitude: number } {
  const lat1 = lat1Deg * DEG_TO_RAD;
  const lon1 = lon1Deg * DEG_TO_RAD;
  const lat2 = lat2Deg * DEG_TO_RAD;
  const lon2 = lon2Deg * DEG_TO_RAD;

  const d = haversineAngularDistance(lat1, lon1, lat2, lon2);
  const isDegenerate = d < 1e-9 || Math.abs(Math.PI - d) < 1e-9;

  if (isDegenerate) {
    return {
      latitude: lat1Deg + (lat2Deg - lat1Deg) * f,
      longitude: lon1Deg + (lon2Deg - lon1Deg) * f,
    };
  }

  const sinD = Math.sin(d);
  const A = Math.sin((1 - f) * d) / sinD;
  const B = Math.sin(f * d) / sinD;

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  return {
    latitude: Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD_TO_DEG,
    longitude: Math.atan2(y, x) * RAD_TO_DEG,
  };
}

function shortestAngleLerp(fromDeg: number, toDeg: number, f: number): number {
  const delta = (((toDeg - fromDeg + 180) % 360) + 360) % 360 - 180;
  return fromDeg + delta * f;
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function interpolateCameraState(from: CameraState, to: CameraState, t: number): CameraState {
  const { latitude, longitude } = slerpSurface(from.latitude, from.longitude, to.latitude, to.longitude, t);

  return {
    latitude,
    longitude,
    height: from.height + (to.height - from.height) * t,
    heading: normalizeDegrees(shortestAngleLerp(from.heading, to.heading, t)),
    pitch: from.pitch + (to.pitch - from.pitch) * t,
    roll: from.roll + (to.roll - from.roll) * t,
  };
}
