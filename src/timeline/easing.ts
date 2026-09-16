import type { EasingPreset } from '../models/scenes';

export type EasingFunction = (t: number) => number;

export const linear: EasingFunction = (t) => t;

export const accelerate: EasingFunction = (t) => t * t;

export const decelerate: EasingFunction = (t) => 1 - (1 - t) * (1 - t);

export const smooth: EasingFunction = (t) => t * t * (3 - 2 * t);

export const cinematic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const EASING_FUNCTIONS: Record<EasingPreset, EasingFunction> = {
  linear,
  accelerate,
  decelerate,
  smooth,
  cinematic,
};

export function getEasingFunction(preset: EasingPreset): EasingFunction {
  return EASING_FUNCTIONS[preset];
}
