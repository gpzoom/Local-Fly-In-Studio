import type { Project } from '../models/project';
import type { MapScene, StorefrontScene, InteriorTourScene, Waypoint, InteriorTourItem } from '../models/scenes';
import { compileProjectTimeline } from './compiler';

export class TimelineScalingError extends Error {
  constructor(
    message: string,
    readonly requestedMs: number,
    readonly minimumPossibleMs: number,
  ) {
    super(message);
    this.name = 'TimelineScalingError';
  }
}

function videoEffectiveDurationMs(item: Extract<InteriorTourItem, { type: 'video' }>): number {
  return (item.trimEndMs - item.trimStartMs) / item.playbackRate;
}

export function fitMapToDuration(mapScene: MapScene, targetMs: number): MapScene {
  let lockedSum = 0;
  let unlockedSum = 0;
  mapScene.waypoints.forEach((wp, i) => {
    if (i > 0) {
      if (wp.travelDurationLocked) lockedSum += wp.travelDurationMs;
      else unlockedSum += wp.travelDurationMs;
    }
    if (wp.holdDurationLocked) lockedSum += wp.holdDurationMs;
    else unlockedSum += wp.holdDurationMs;
  });

  // Strictly greater: an exact fit (including the degenerate 0 === 0 case of a map scene
  // with no waypoints) is not a conflict — there is simply nothing left to scale.
  if (lockedSum > targetMs) {
    throw new TimelineScalingError(
      `Cannot fit map fly-in to ${targetMs}ms: locked durations alone total ${lockedSum}ms.`,
      targetMs,
      lockedSum,
    );
  }

  const availableForUnlocked = targetMs - lockedSum;
  const scaleFactor = unlockedSum > 0 ? availableForUnlocked / unlockedSum : 1;

  const waypoints: Waypoint[] = mapScene.waypoints.map((wp, i) => ({
    ...wp,
    travelDurationMs:
      i > 0 && !wp.travelDurationLocked ? Math.round(wp.travelDurationMs * scaleFactor) : wp.travelDurationMs,
    holdDurationMs: !wp.holdDurationLocked ? Math.round(wp.holdDurationMs * scaleFactor) : wp.holdDurationMs,
  }));

  return { ...mapScene, waypoints };
}

export function fitInteriorTourToDuration(tourScene: InteriorTourScene, targetMs: number): InteriorTourScene {
  const videoSum = tourScene.items
    .filter((item): item is Extract<InteriorTourItem, { type: 'video' }> => item.type === 'video')
    .reduce((sum, item) => sum + videoEffectiveDurationMs(item), 0);

  const photos = tourScene.items.filter(
    (item): item is Extract<InteriorTourItem, { type: 'photo' }> => item.type === 'photo',
  );
  const lockedPhotoSum = photos.filter((p) => p.durationLocked).reduce((sum, p) => sum + p.durationMs, 0);
  const unlockedPhotoSum = photos.filter((p) => !p.durationLocked).reduce((sum, p) => sum + p.durationMs, 0);
  const lockedSum = videoSum + lockedPhotoSum;

  // Strictly greater: an exact fit (including the degenerate "nothing to scale" case) is
  // not a conflict.
  if (lockedSum > targetMs) {
    throw new TimelineScalingError(
      `Cannot fit interior tour to ${targetMs}ms: video clips and locked photo durations alone total ${lockedSum}ms.`,
      targetMs,
      lockedSum,
    );
  }

  const availableForUnlockedPhotos = targetMs - lockedSum;
  const scaleFactor = unlockedPhotoSum > 0 ? availableForUnlockedPhotos / unlockedPhotoSum : 1;

  const items: InteriorTourItem[] = tourScene.items.map((item) => {
    if (item.type === 'video') return item;
    if (item.durationLocked) return item;
    return { ...item, durationMs: Math.round(item.durationMs * scaleFactor) };
  });

  return { ...tourScene, items };
}

export function fitProjectToDuration(project: Project, targetMs: number): Project {
  const currentTimeline = compileProjectTimeline(project);
  const currentTotalMs = currentTimeline.totalDurationMs;
  const currentMapSection = currentTimeline.sections.find((s) => s.type === 'map');
  const currentStorefrontSection = currentTimeline.sections.find((s) => s.type === 'storefront');
  const currentMapMs = currentMapSection ? currentMapSection.endMs - currentMapSection.startMs : 0;
  const currentStorefrontMs = currentStorefrontSection ? currentStorefrontSection.endMs - currentStorefrontSection.startMs : 0;
  const currentMapPlusStorefrontMs = currentMapMs + currentStorefrontMs;

  const targetMapPlusStorefrontMs = currentTotalMs > 0 ? targetMs * (currentMapPlusStorefrontMs / currentTotalMs) : 0;
  const targetInteriorMs = targetMs - targetMapPlusStorefrontMs;

  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  const storefrontTargetMs = storefrontScene
    ? storefrontScene.durationLocked
      ? storefrontScene.durationMs
      : Math.round(
          targetMapPlusStorefrontMs * (currentMapPlusStorefrontMs > 0 ? currentStorefrontMs / currentMapPlusStorefrontMs : 0),
        )
    : 0;
  const mapTargetMs = Math.max(targetMapPlusStorefrontMs - storefrontTargetMs, 0);

  const scenes = project.scenes.map((scene) => {
    if (scene.type === 'map') return fitMapToDuration(scene, mapTargetMs);
    if (scene.type === 'storefront') return { ...scene, durationMs: storefrontTargetMs };
    if (scene.type === 'interior-tour') return fitInteriorTourToDuration(scene, Math.max(targetInteriorMs, 0));
    return scene;
  });

  return { ...project, scenes };
}
