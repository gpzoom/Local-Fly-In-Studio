import type { Project } from '../models/project';
import type { InteriorTourScene, ProjectScene } from '../models/scenes';

export type ExportVariant = 'complete' | 'fly-in-only' | 'fly-in-storefront' | 'interior-tour-only';

/** PRD order (§49): Complete Video, Fly-In Only, Fly-In + Storefront, Interior Tour Only. */
export const EXPORT_VARIANTS: readonly ExportVariant[] = [
  'complete',
  'fly-in-only',
  'fly-in-storefront',
  'interior-tour-only',
];

export const EXPORT_VARIANT_LABELS: Record<ExportVariant, string> = {
  complete: 'Complete Video',
  'fly-in-only': 'Fly-In Only',
  'fly-in-storefront': 'Fly-In + Storefront',
  'interior-tour-only': 'Interior Tour Only',
};

const VARIANT_SCENE_TYPES: Record<Exclude<ExportVariant, 'complete'>, ProjectScene['type'][]> = {
  'fly-in-only': ['map'],
  'fly-in-storefront': ['map', 'storefront'],
  'interior-tour-only': ['interior-tour'],
};

export function filterProjectForVariant(project: Project, variant: ExportVariant): Project {
  if (variant === 'complete') return project;
  const allowedTypes = VARIANT_SCENE_TYPES[variant];
  return { ...project, scenes: project.scenes.filter((scene) => allowedTypes.includes(scene.type)) };
}

export function isVariantAvailable(project: Project, variant: ExportVariant): boolean {
  if (variant !== 'interior-tour-only') return true;
  const interiorScene = project.scenes.find(
    (scene): scene is InteriorTourScene => scene.type === 'interior-tour',
  );
  return !!interiorScene && interiorScene.items.length > 0;
}
