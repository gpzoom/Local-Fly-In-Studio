import type { CameraState, RelativeCameraState } from '../models/scenes';
import type { Destination } from '../models/project';

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Standard spherical-earth "destination point given start point, bearing, and
 * distance" formula — the same great-circle approximation already used by
 * cameraInterpolation.ts, kept consistent rather than introducing full WGS84
 * ellipsoid precision this MVP-level cinematic camera doesn't need.
 */
function destinationPoint(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  distanceMeters: number,
): { latitude: number; longitude: number } {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDeg);
  const lat1 = toRadians(latDeg);
  const lon1 = toRadians(lonDeg);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { latitude: toDegrees(lat2), longitude: toDegrees(lon2) };
}

/**
 * Resolves a destination-relative waypoint's camera into an absolute
 * CameraState. The camera sits `distanceMeters` from the destination, in the
 * direction opposite `headingDeg` (so that heading `headingDeg` looks back
 * toward the destination), at `heightMeters` above the ellipsoid. Returns
 * null when the destination has no coordinates yet — callers must leave the
 * waypoint destination-relative (unresolved) rather than guessing a camera
 * position.
 */
export function resolveRelativeCameraState(
  relative: RelativeCameraState,
  destination: Destination,
): CameraState | null {
  if (destination.latitude === null || destination.longitude === null) {
    return null;
  }

  const cameraBearingFromDestination = relative.headingDeg + 180;
  const position = destinationPoint(
    destination.latitude,
    destination.longitude,
    cameraBearingFromDestination,
    relative.distanceMeters,
  );

  return {
    latitude: position.latitude,
    longitude: position.longitude,
    height: relative.heightMeters,
    heading: relative.headingDeg,
    pitch: relative.pitchDeg,
    roll: 0,
  };
}
