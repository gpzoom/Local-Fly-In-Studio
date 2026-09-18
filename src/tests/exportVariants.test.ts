import { describe, it, expect } from 'vitest';
import {
  filterProjectForVariant,
  isVariantAvailable,
  EXPORT_VARIANT_LABELS,
} from '../export/exportVariants';
import { makeMinimalProject } from './fixtures';
import type { InteriorTourScene } from '../models/scenes';

describe('filterProjectForVariant', () => {
  it('returns the same project reference for the complete variant', () => {
    const project = makeMinimalProject();
    expect(filterProjectForVariant(project, 'complete')).toBe(project);
  });

  it('fly-in-only keeps only the map scene', () => {
    const project = makeMinimalProject();
    const filtered = filterProjectForVariant(project, 'fly-in-only');
    expect(filtered.scenes.map((s) => s.type)).toEqual(['map']);
  });

  it('fly-in-storefront keeps the map and storefront scenes, in original order', () => {
    const project = makeMinimalProject();
    const filtered = filterProjectForVariant(project, 'fly-in-storefront');
    expect(filtered.scenes.map((s) => s.type)).toEqual(['map', 'storefront']);
  });

  it('interior-tour-only keeps only the interior-tour scene', () => {
    const project = makeMinimalProject();
    const filtered = filterProjectForVariant(project, 'interior-tour-only');
    expect(filtered.scenes.map((s) => s.type)).toEqual(['interior-tour']);
  });

  it('preserves every other project field unchanged', () => {
    const project = makeMinimalProject();
    const filtered = filterProjectForVariant(project, 'fly-in-only');
    expect(filtered.destination).toBe(project.destination);
    expect(filtered.videoSettings).toBe(project.videoSettings);
    expect(filtered.projectName).toBe(project.projectName);
  });
});

describe('isVariantAvailable', () => {
  it('is always true for complete, fly-in-only, and fly-in-storefront, even with no scenes', () => {
    const project = makeMinimalProject({ scenes: [] });
    expect(isVariantAvailable(project, 'complete')).toBe(true);
    expect(isVariantAvailable(project, 'fly-in-only')).toBe(true);
    expect(isVariantAvailable(project, 'fly-in-storefront')).toBe(true);
  });

  it('is true for interior-tour-only when the scene has at least one item', () => {
    const project = makeMinimalProject();
    expect(isVariantAvailable(project, 'interior-tour-only')).toBe(true);
  });

  it('is false for interior-tour-only when there is no interior-tour scene', () => {
    const project = makeMinimalProject();
    const withoutInterior = {
      ...project,
      scenes: project.scenes.filter((s) => s.type !== 'interior-tour'),
    };
    expect(isVariantAvailable(withoutInterior, 'interior-tour-only')).toBe(false);
  });

  it('is false for interior-tour-only when the interior-tour scene has zero items', () => {
    const project = makeMinimalProject();
    const emptyScenes = project.scenes.map((scene) =>
      scene.type === 'interior-tour' ? ({ ...scene, items: [] } as InteriorTourScene) : scene,
    );
    const emptyProject = { ...project, scenes: emptyScenes };
    expect(isVariantAvailable(emptyProject, 'interior-tour-only')).toBe(false);
  });
});

describe('EXPORT_VARIANT_LABELS', () => {
  it('has the exact PRD label for every variant', () => {
    expect(EXPORT_VARIANT_LABELS.complete).toBe('Complete Video');
    expect(EXPORT_VARIANT_LABELS['fly-in-only']).toBe('Fly-In Only');
    expect(EXPORT_VARIANT_LABELS['fly-in-storefront']).toBe('Fly-In + Storefront');
    expect(EXPORT_VARIANT_LABELS['interior-tour-only']).toBe('Interior Tour Only');
  });
});
