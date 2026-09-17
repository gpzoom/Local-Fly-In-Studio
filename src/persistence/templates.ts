import type { Destination } from '../models/project';
import type { MapScene, Waypoint } from '../models/scenes';

// A factory, not a shared constant: each MapScene must own its waypoint objects so
// editing one draft's Earth waypoint (4b) cannot mutate every other draft's.
function createEarthOverviewWaypoint(): Waypoint {
  return {
    id: 'template-earth',
    name: 'Earth',
    type: 'absolute',
    camera: { longitude: 0, latitude: 0, height: 20_000_000, heading: 0, pitch: -90, roll: 0 },
    travelDurationMs: 0,
    holdDurationMs: 1000,
    travelDurationLocked: false,
    holdDurationLocked: false,
    easing: 'cinematic',
  };
}

interface RelativeStop {
  id: string;
  name: string;
  travelDurationMs: number;
  holdDurationMs: number;
  headingDeg: number;
  pitchDeg: number;
  distanceMeters: number;
  heightMeters: number;
}

// Suggested defaults per the PRD's "Standard Local Business Fly-In" template.
// distanceMeters/heightMeters/headingDeg/pitchDeg are not specified by the PRD
// numerically — these are sensible cinematic defaults (decreasing zoom level
// from region to business); every value here is user-adjustable in Studio (4b).
const RELATIVE_STOPS: RelativeStop[] = [
  { id: 'template-region', name: 'Region', travelDurationMs: 1500, holdDurationMs: 0, headingDeg: 0, pitchDeg: -45, distanceMeters: 300_000, heightMeters: 200_000 },
  { id: 'template-metro', name: 'Metro', travelDurationMs: 1400, holdDurationMs: 0, headingDeg: 0, pitchDeg: -45, distanceMeters: 80_000, heightMeters: 50_000 },
  { id: 'template-city', name: 'City', travelDurationMs: 1300, holdDurationMs: 0, headingDeg: 0, pitchDeg: -40, distanceMeters: 20_000, heightMeters: 12_000 },
  { id: 'template-neighborhood', name: 'Neighborhood', travelDurationMs: 1300, holdDurationMs: 0, headingDeg: 0, pitchDeg: -35, distanceMeters: 3_000, heightMeters: 1_800 },
  { id: 'template-business', name: 'Business', travelDurationMs: 1800, holdDurationMs: 600, headingDeg: 0, pitchDeg: -25, distanceMeters: 400, heightMeters: 220 },
];

export function createMapSceneFromTemplate(destination: Destination): MapScene {
  const waypoints: Waypoint[] = [
    createEarthOverviewWaypoint(),
    ...RELATIVE_STOPS.map(
      (stop): Waypoint => ({
        id: stop.id,
        name: stop.name,
        type: 'destination-relative',
        relativeCamera: {
          headingDeg: stop.headingDeg,
          pitchDeg: stop.pitchDeg,
          distanceMeters: stop.distanceMeters,
          heightMeters: stop.heightMeters,
        },
        travelDurationMs: stop.travelDurationMs,
        holdDurationMs: stop.holdDurationMs,
        travelDurationLocked: false,
        holdDurationLocked: false,
        easing: 'cinematic',
      }),
    ),
  ];

  return {
    id: `map-${destination.source}-${crypto.randomUUID()}`,
    type: 'map',
    waypoints,
  };
}
