import type { InteriorTourScene, PhotoMotionPreset, TransitionType } from '../models/scenes';

const PHOTO_MOTION_CYCLE: PhotoMotionPreset[] = ['push-in', 'pull-out', 'pan-left-right', 'pan-right-left'];

export function setAllPhotoDurations(scene: InteriorTourScene, durationMs: number): InteriorTourScene {
  return {
    ...scene,
    items: scene.items.map((item) =>
      item.type === 'photo' && !item.durationLocked ? { ...item, durationMs } : item,
    ),
  };
}

export function setAllTransitionTypes(scene: InteriorTourScene, type: TransitionType): InteriorTourScene {
  return {
    ...scene,
    items: scene.items.map((item) => ({
      ...item,
      transitionToNext: { ...item.transitionToNext, type },
    })),
  };
}

export function setAllTransitionDurations(scene: InteriorTourScene, durationMs: number): InteriorTourScene {
  return {
    ...scene,
    items: scene.items.map((item) => ({
      ...item,
      transitionToNext: { ...item.transitionToNext, durationMs },
    })),
  };
}

export function regeneratePhotoMotion(scene: InteriorTourScene): InteriorTourScene {
  let photoIndex = 0;
  return {
    ...scene,
    items: scene.items.map((item) => {
      if (item.type !== 'photo') return item;
      const motionPreset = PHOTO_MOTION_CYCLE[photoIndex % PHOTO_MOTION_CYCLE.length];
      photoIndex += 1;
      return { ...item, motionPreset };
    }),
  };
}
