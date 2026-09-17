import { describe, it, expect } from 'vitest';
import { createMapSceneFromTemplate } from '../persistence/templates';
import { MapSceneSchema } from '../models/scenes';
import type { Destination } from '../models/project';

describe('createMapSceneFromTemplate', () => {
  const destination: Destination = { source: 'photo-gps', latitude: 39.5, longitude: -104.9 };

  it('produces 6 waypoints: Earth (absolute) followed by 5 destination-relative stops', () => {
    const scene = createMapSceneFromTemplate(destination);
    expect(scene.type).toBe('map');
    expect(scene.waypoints).toHaveLength(6);
    expect(scene.waypoints[0].type).toBe('absolute');
    expect(scene.waypoints[0].name).toBe('Earth');
    for (const wp of scene.waypoints.slice(1)) {
      expect(wp.type).toBe('destination-relative');
    }
    expect(scene.waypoints.slice(1).map((w) => w.name)).toEqual([
      'Region',
      'Metro',
      'City',
      'Neighborhood',
      'Business',
    ]);
  });

  it('uses the PRD default timings', () => {
    const scene = createMapSceneFromTemplate(destination);
    const [earth, region, metro, city, neighborhood, business] = scene.waypoints;
    expect(earth.holdDurationMs).toBe(1000);
    expect(region.travelDurationMs).toBe(1500);
    expect(metro.travelDurationMs).toBe(1400);
    expect(city.travelDurationMs).toBe(1300);
    expect(neighborhood.travelDurationMs).toBe(1300);
    expect(business.travelDurationMs).toBe(1800);
    expect(business.holdDurationMs).toBe(600);
  });

  it('produces a valid MapScene even when the destination has no coordinates yet', () => {
    const unresolved: Destination = { source: 'address', latitude: null, longitude: null, originalAddress: '123 Main St' };
    const scene = createMapSceneFromTemplate(unresolved);
    expect(() => MapSceneSchema.parse(scene)).not.toThrow();
  });

  it('validates against MapSceneSchema for a resolved destination', () => {
    const scene = createMapSceneFromTemplate(destination);
    expect(() => MapSceneSchema.parse(scene)).not.toThrow();
  });
});
