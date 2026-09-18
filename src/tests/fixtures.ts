import type { Project } from '../models/project';
import type { ProjectTemplate } from '../models/projectTemplate';
import { CURRENT_SCHEMA_VERSION } from '../models/project';

export function makeMinimalProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: 'test-project-1',
    projectName: 'Test Project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    destination: {
      source: 'manual',
      latitude: 0,
      longitude: 0,
    },
    scenes: [
      {
        id: 'map-1',
        type: 'map',
        waypoints: [],
      },
      {
        id: 'storefront-1',
        type: 'storefront',
        assetId: 'asset-storefront',
        durationMs: 2500,
        durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
        endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'push-in',
        transitionIn: { type: 'crossfade', durationMs: 600 },
        transitionOut: { type: 'crossfade', durationMs: 600 },
      },
      {
        id: 'interior-1',
        type: 'interior-tour',
        items: [
          {
            id: 'photo-1',
            type: 'photo',
            assetId: 'asset-photo-1',
            durationMs: 4000,
            durationLocked: false,
            startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
            endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.08 },
            motionPreset: 'push-in',
            transitionToNext: { type: 'crossfade', durationMs: 500 },
          },
        ],
        defaultPhotoDurationMs: 4000,
        defaultTransition: { type: 'crossfade', durationMs: 500 },
      },
    ],
    mediaAssets: [],
    videoSettings: {
      aspectRatio: '16:9',
      widthPx: 1920,
      heightPx: 1080,
      fps: 30,
    },
    ...overrides,
  };
}

export function makeMinimalProjectTemplate(overrides: Partial<ProjectTemplate> = {}): ProjectTemplate {
  return {
    id: 'test-template-1',
    name: 'Test Template',
    createdAt: '2026-01-01T00:00:00.000Z',
    map: {
      waypoints: [],
    },
    storefront: {
      durationMs: 3000,
      durationLocked: false,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
      endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.1 },
      motionPreset: 'pull-out',
      transitionIn: { type: 'crossfade', durationMs: 400 },
      transitionOut: { type: 'crossfade', durationMs: 400 },
    },
    interiorTour: {
      defaultPhotoDurationMs: 5000,
      defaultTransition: { type: 'fade-black', durationMs: 300 },
    },
    ...overrides,
  };
}
