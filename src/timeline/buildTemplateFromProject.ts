import type { Project } from '../models/project';
import type { MapScene, StorefrontScene, InteriorTourScene } from '../models/scenes';
import type { ProjectTemplate } from '../models/projectTemplate';

export type TemplateBuildError =
  | { reason: 'missing-map' }
  | { reason: 'missing-storefront' }
  | { reason: 'missing-interior-tour' };

export function buildTemplateFromProject(
  project: Project,
  name: string,
): { ok: true; template: ProjectTemplate } | { ok: false; error: TemplateBuildError } {
  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  if (!mapScene) return { ok: false, error: { reason: 'missing-map' } };

  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  if (!storefrontScene) return { ok: false, error: { reason: 'missing-storefront' } };

  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');
  if (!interiorScene) return { ok: false, error: { reason: 'missing-interior-tour' } };

  const template: ProjectTemplate = {
    id: `template-${crypto.randomUUID()}`,
    name,
    createdAt: new Date().toISOString(),
    map: {
      waypoints: mapScene.waypoints,
    },
    storefront: {
      durationMs: storefrontScene.durationMs,
      durationLocked: storefrontScene.durationLocked,
      startTransform: storefrontScene.startTransform,
      endTransform: storefrontScene.endTransform,
      motionPreset: storefrontScene.motionPreset,
      transitionIn: storefrontScene.transitionIn,
      transitionOut: storefrontScene.transitionOut,
    },
    interiorTour: {
      defaultPhotoDurationMs: interiorScene.defaultPhotoDurationMs,
      defaultTransition: interiorScene.defaultTransition,
    },
  };

  return { ok: true, template };
}
