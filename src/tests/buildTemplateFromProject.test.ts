import { describe, it, expect } from 'vitest';
import { buildTemplateFromProject } from '../timeline/buildTemplateFromProject';
import { makeMinimalProject } from './fixtures';

describe('buildTemplateFromProject', () => {
  it('builds a ProjectTemplate from a complete project, extracting only template-relevant fields', () => {
    const project = makeMinimalProject();
    const result = buildTemplateFromProject(project, 'My Template');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const mapScene = project.scenes.find((s) => s.type === 'map')!;
    if (mapScene.type !== 'map') throw new Error('unreachable');
    expect(result.template.map).toEqual({ waypoints: mapScene.waypoints });

    const storefrontScene = project.scenes.find((s) => s.type === 'storefront')!;
    if (storefrontScene.type !== 'storefront') throw new Error('unreachable');
    expect(result.template.storefront).toEqual({
      durationMs: storefrontScene.durationMs,
      durationLocked: storefrontScene.durationLocked,
      startTransform: storefrontScene.startTransform,
      endTransform: storefrontScene.endTransform,
      motionPreset: storefrontScene.motionPreset,
      transitionIn: storefrontScene.transitionIn,
      transitionOut: storefrontScene.transitionOut,
    });
    expect(result.template.storefront).not.toHaveProperty('assetId');
    expect(result.template.storefront).not.toHaveProperty('entranceTarget');

    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(result.template.interiorTour).toEqual({
      defaultPhotoDurationMs: interiorScene.defaultPhotoDurationMs,
      defaultTransition: interiorScene.defaultTransition,
    });
    expect(result.template).not.toHaveProperty('items');

    expect(result.template.name).toBe('My Template');
    expect(typeof result.template.id).toBe('string');
    expect(typeof result.template.createdAt).toBe('string');
  });

  it('returns a missing-map error when the project has no map scene', () => {
    const project = makeMinimalProject({
      scenes: makeMinimalProject().scenes.filter((s) => s.type !== 'map'),
    });
    const result = buildTemplateFromProject(project, 'X');
    expect(result).toEqual({ ok: false, error: { reason: 'missing-map' } });
  });

  it('returns a missing-storefront error when the project has no storefront scene', () => {
    const project = makeMinimalProject({
      scenes: makeMinimalProject().scenes.filter((s) => s.type !== 'storefront'),
    });
    const result = buildTemplateFromProject(project, 'X');
    expect(result).toEqual({ ok: false, error: { reason: 'missing-storefront' } });
  });

  it('returns a missing-interior-tour error when the project has no interior-tour scene', () => {
    const project = makeMinimalProject({
      scenes: makeMinimalProject().scenes.filter((s) => s.type !== 'interior-tour'),
    });
    const result = buildTemplateFromProject(project, 'X');
    expect(result).toEqual({ ok: false, error: { reason: 'missing-interior-tour' } });
  });
});
