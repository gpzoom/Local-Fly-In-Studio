import { describe, it, expect } from 'vitest';
import { findWaypointSegmentStartMs } from '../timeline/findWaypointSegmentStartMs';
import { compileProjectTimeline } from '../timeline/compiler';
import { makeMinimalProject } from './fixtures';
import type { MapScene, Waypoint } from '../models/scenes';

function makeWaypoint(overrides: Partial<Waypoint> & { id: string }): Waypoint {
  return {
    type: 'absolute',
    name: overrides.id,
    camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -30, roll: 0 },
    travelDurationMs: 0,
    holdDurationMs: 1000,
    travelDurationLocked: false,
    holdDurationLocked: false,
    easing: 'cinematic',
    ...overrides,
  } as Waypoint;
}

const mapScene: MapScene = {
  id: 'map-1',
  type: 'map',
  waypoints: [
    makeWaypoint({ id: 'w0', holdDurationMs: 1000 }),
    makeWaypoint({ id: 'w1', travelDurationMs: 2000, holdDurationMs: 500 }),
  ],
};

describe('findWaypointSegmentStartMs', () => {
  it('returns the hold segment start for the first waypoint (no preceding travel segment)', () => {
    const project = makeMinimalProject({ scenes: [mapScene] });
    const timeline = compileProjectTimeline(project);

    expect(findWaypointSegmentStartMs(timeline, 'w0')).toBe(0);
  });

  it('returns the travel segment start for a waypoint reached by travel', () => {
    const project = makeMinimalProject({ scenes: [mapScene] });
    const timeline = compileProjectTimeline(project);

    // w0's hold segment occupies 0-1000ms; w1's travel segment starts right after.
    expect(findWaypointSegmentStartMs(timeline, 'w1')).toBe(1000);
  });

  it('returns undefined for a waypoint id not present in the timeline', () => {
    const project = makeMinimalProject({ scenes: [mapScene] });
    const timeline = compileProjectTimeline(project);

    expect(findWaypointSegmentStartMs(timeline, 'nonexistent')).toBeUndefined();
  });
});
