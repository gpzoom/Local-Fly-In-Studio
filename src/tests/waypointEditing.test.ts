import { describe, it, expect } from 'vitest';
import { replaceWaypointCamera, computeDoorTargetTransform } from '../timeline/waypointEditing';
import type { CameraState, VisualTransform, Waypoint } from '../models/scenes';

describe('replaceWaypointCamera', () => {
  it('converts a destination-relative waypoint to absolute with the given camera, preserving non-camera fields', () => {
    const waypoint: Waypoint = {
      id: 'w1',
      name: 'Neighborhood',
      type: 'destination-relative',
      relativeCamera: { headingDeg: 45, pitchDeg: -20, distanceMeters: 500, heightMeters: 100 },
      travelDurationMs: 2000,
      holdDurationMs: 1000,
      travelDurationLocked: true,
      holdDurationLocked: false,
      easing: 'smooth',
    };
    const camera: CameraState = { longitude: -104.9, latitude: 39.7, height: 300, heading: 10, pitch: -25, roll: 0 };

    const result = replaceWaypointCamera(waypoint, camera);

    expect(result).toEqual({
      id: 'w1',
      name: 'Neighborhood',
      type: 'absolute',
      camera,
      travelDurationMs: 2000,
      holdDurationMs: 1000,
      travelDurationLocked: true,
      holdDurationLocked: false,
      easing: 'smooth',
    });
  });

  it('overwrites the camera on an already-absolute waypoint, dropping nothing else', () => {
    const waypoint: Waypoint = {
      id: 'w2',
      name: 'City',
      type: 'absolute',
      camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
      travelDurationMs: 0,
      holdDurationMs: 500,
      travelDurationLocked: false,
      holdDurationLocked: true,
      easing: 'linear',
    };
    const camera: CameraState = { longitude: 5, latitude: 5, height: 200, heading: 90, pitch: -10, roll: 0 };

    const result = replaceWaypointCamera(waypoint, camera);

    expect(result.type).toBe('absolute');
    expect(result).not.toHaveProperty('relativeCamera');
    if (result.type === 'absolute') {
      expect(result.camera).toEqual(camera);
    }
    expect(result.holdDurationLocked).toBe(true);
    expect(result.name).toBe('City');
  });
});

describe('computeDoorTargetTransform', () => {
  it('repositions centerX/centerY to the normalized point, preserving scale and rotation', () => {
    const current: VisualTransform = { centerX: 0.5, centerY: 0.5, scale: 1.2, rotation: 5 };

    const result = computeDoorTargetTransform(current, { x: 0.3, y: 0.7 });

    expect(result).toEqual({ centerX: 0.3, centerY: 0.7, scale: 1.2, rotation: 5 });
  });

  it('clamps out-of-range normalized coordinates to [0, 1]', () => {
    const current: VisualTransform = { centerX: 0.5, centerY: 0.5, scale: 1 };

    const result = computeDoorTargetTransform(current, { x: -0.02, y: 1.05 });

    expect(result.centerX).toBe(0);
    expect(result.centerY).toBe(1);
  });
});
