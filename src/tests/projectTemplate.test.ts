import { describe, it, expect } from 'vitest';
import { ProjectTemplateSchema, BUILTIN_PROJECT_TEMPLATE_ID, getBuiltinProjectTemplate } from '../models/projectTemplate';
import { createMapSceneFromTemplate } from '../persistence/templates';
import type { Destination } from '../models/project';

describe('getBuiltinProjectTemplate', () => {
  it('validates against ProjectTemplateSchema', () => {
    expect(() => ProjectTemplateSchema.parse(getBuiltinProjectTemplate())).not.toThrow();
  });

  it('has id BUILTIN_PROJECT_TEMPLATE_ID', () => {
    expect(getBuiltinProjectTemplate().id).toBe(BUILTIN_PROJECT_TEMPLATE_ID);
  });

  it('produces map waypoints identical to createMapSceneFromTemplate, regardless of destination (destination-independence)', () => {
    const destinationA: Destination = { source: 'photo-gps', latitude: 39.5, longitude: -104.9 };
    const destinationB: Destination = { source: 'manual', latitude: -12, longitude: 170 };
    const builtin = getBuiltinProjectTemplate();
    expect(builtin.map.waypoints).toEqual(createMapSceneFromTemplate(destinationA).waypoints);
    expect(builtin.map.waypoints).toEqual(createMapSceneFromTemplate(destinationB).waypoints);
  });

  it("matches today's createDraft.ts storefront literals exactly (regression guard)", () => {
    const builtin = getBuiltinProjectTemplate();
    expect(builtin.storefront).toEqual({
      durationMs: 2500,
      durationLocked: false,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
      endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
      motionPreset: 'push-in',
      transitionIn: { type: 'crossfade', durationMs: 600 },
      transitionOut: { type: 'crossfade', durationMs: 600 },
    });
  });

  it("matches today's createDraft.ts interior-tour literals exactly (regression guard)", () => {
    const builtin = getBuiltinProjectTemplate();
    expect(builtin.interiorTour).toEqual({
      defaultPhotoDurationMs: 4000,
      defaultTransition: { type: 'crossfade', durationMs: 500 },
    });
  });
});
