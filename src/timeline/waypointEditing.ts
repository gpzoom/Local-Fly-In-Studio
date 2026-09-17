import type { CameraState, VisualTransform, Waypoint } from '../models/scenes';

/**
 * A freely-navigated captured camera position is inherently absolute, not defined
 * relative to the destination — so a manual "Replace" always produces an absolute
 * waypoint, even when the original was destination-relative.
 */
export function replaceWaypointCamera(waypoint: Waypoint, camera: CameraState): Waypoint {
  return {
    id: waypoint.id,
    name: waypoint.name,
    type: 'absolute',
    camera,
    travelDurationMs: waypoint.travelDurationMs,
    holdDurationMs: waypoint.holdDurationMs,
    travelDurationLocked: waypoint.travelDurationLocked,
    holdDurationLocked: waypoint.holdDurationLocked,
    easing: waypoint.easing,
  };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function computeDoorTargetTransform(
  current: VisualTransform,
  normalized: { x: number; y: number },
): VisualTransform {
  return {
    ...current,
    centerX: clamp01(normalized.x),
    centerY: clamp01(normalized.y),
  };
}
