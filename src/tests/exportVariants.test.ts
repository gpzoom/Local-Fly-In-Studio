import { describe, it, expect } from 'vitest';
import {
  filterProjectForVariant,
  isVariantAvailable,
  EXPORT_VARIANT_LABELS,
} from '../export/exportVariants';
import { compileProjectTimeline } from '../timeline/compiler';
import { makeMinimalProject } from './fixtures';
import type { InteriorTourScene, MapScene, Waypoint } from '../models/scenes';

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

// A single absolute waypoint, used to override the shared fixture's map scene (which has
// `waypoints: []`) in tests below that need `compileProjectTimeline` to actually produce map
// content. Without this, a variant that keeps only the map scene compiles to a degenerate
// zero-duration timeline (see Finding 2 in the final review, which covers that case directly).
const NON_DEGENERATE_WAYPOINT: Waypoint = {
  id: 'wp-1',
  name: 'Start',
  type: 'absolute',
  camera: { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -45, roll: 0 },
  travelDurationMs: 3000,
  holdDurationMs: 2000,
  travelDurationLocked: false,
  holdDurationLocked: false,
  easing: 'smooth',
};

function makeProjectWithNonDegenerateMap() {
  const project = makeMinimalProject();
  const scenes = project.scenes.map((scene) =>
    scene.type === 'map' ? ({ ...scene, waypoints: [NON_DEGENERATE_WAYPOINT] } as MapScene) : scene,
  );
  return { ...project, scenes };
}

describe('compileProjectTimeline composed with filterProjectForVariant (central architectural claim)', () => {
  // This is the claim the whole feature rests on: filterProjectForVariant's filtered Project,
  // fed into the EXISTING, UNMODIFIED compileProjectTimeline from Phase 5, compiles to a sane
  // timeline for every variant. These tests exercise the real compiler, not just the filter's
  // output shape, so a future change to compiler.ts that breaks a variant fails here.

  it('interior-tour-only compiles with no lead-in and a single interior-tour section', () => {
    const filtered = filterProjectForVariant(makeMinimalProject(), 'interior-tour-only');
    const timeline = compileProjectTimeline(filtered);

    expect(timeline.segments[0].startMs).toBe(0);
    expect(timeline.segments.some((s) => s.kind === 'black')).toBe(false);
    expect(timeline.sections.map((s) => s.type)).toEqual(['interior-tour']);
  });

  it('fly-in-storefront compiles map then storefront with nothing orphaned past the last segment', () => {
    const filtered = filterProjectForVariant(makeProjectWithNonDegenerateMap(), 'fly-in-storefront');
    const timeline = compileProjectTimeline(filtered);

    expect(timeline.sections.map((s) => s.type)).toEqual(['map', 'storefront']);
    const lastSegment = timeline.segments[timeline.segments.length - 1];
    expect(timeline.totalDurationMs).toBe(lastSegment.endMs);
  });

  it('fly-in-only compiles to a single, non-degenerate map section', () => {
    const filtered = filterProjectForVariant(makeProjectWithNonDegenerateMap(), 'fly-in-only');
    const timeline = compileProjectTimeline(filtered);

    expect(timeline.sections.map((s) => s.type)).toEqual(['map']);
    expect(timeline.totalDurationMs).toBeGreaterThan(0);
  });

  it('complete variant (unfiltered) compiles more sections than the filtered variants, as a baseline', () => {
    const timeline = compileProjectTimeline(makeMinimalProject());

    // The shared fixture's map scene has no waypoints, so it contributes no section on its own,
    // but storefront + interior-tour still both compile — visibly more than the 1-2 section
    // filtered variants above, confirming filtering (not the compiler) is what shrinks the output.
    expect(timeline.sections.map((s) => s.type)).toEqual(['storefront', 'interior-tour']);
    expect(timeline.sections.length).toBeGreaterThan(1);
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
