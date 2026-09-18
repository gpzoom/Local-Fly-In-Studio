import { z } from 'zod';
import {
  WaypointSchema,
  VisualTransformSchema,
  StorefrontMotionPresetSchema,
  TransitionSchema,
} from './scenes';
import { createMapSceneFromTemplate } from '../persistence/templates';
import type { Destination } from './project';

export const ProjectTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  map: z.object({
    waypoints: z.array(WaypointSchema),
  }),
  storefront: z.object({
    durationMs: z.number().nonnegative(),
    durationLocked: z.boolean(),
    startTransform: VisualTransformSchema,
    endTransform: VisualTransformSchema,
    motionPreset: StorefrontMotionPresetSchema,
    transitionIn: TransitionSchema,
    transitionOut: TransitionSchema,
  }),
  interiorTour: z.object({
    defaultPhotoDurationMs: z.number().nonnegative(),
    defaultTransition: TransitionSchema,
  }),
});
export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>;

export const BUILTIN_PROJECT_TEMPLATE_ID = 'builtin-standard-business-tour';

// createMapSceneFromTemplate's output waypoints do not depend on the destination
// passed in (only the returned MapScene's own `id` does) — this placeholder is
// never surfaced anywhere, it only satisfies that function's signature.
const PLACEHOLDER_DESTINATION: Destination = {
  source: 'manual',
  latitude: 0,
  longitude: 0,
};

export function getBuiltinProjectTemplate(): ProjectTemplate {
  return {
    id: BUILTIN_PROJECT_TEMPLATE_ID,
    name: 'Standard Local Business Tour',
    createdAt: '2026-01-01T00:00:00.000Z',
    map: {
      waypoints: createMapSceneFromTemplate(PLACEHOLDER_DESTINATION).waypoints,
    },
    storefront: {
      durationMs: 2500,
      durationLocked: false,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
      endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
      motionPreset: 'push-in',
      transitionIn: { type: 'crossfade', durationMs: 600 },
      transitionOut: { type: 'crossfade', durationMs: 600 },
    },
    interiorTour: {
      defaultPhotoDurationMs: 4000,
      defaultTransition: { type: 'crossfade', durationMs: 500 },
    },
  };
}
