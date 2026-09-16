import { z } from 'zod';

export const CameraStateSchema = z.object({
  longitude: z.number(),
  latitude: z.number(),
  height: z.number(),
  heading: z.number(),
  pitch: z.number(),
  roll: z.number(),
});
export type CameraState = z.infer<typeof CameraStateSchema>;

export const RelativeCameraStateSchema = z.object({
  headingDeg: z.number(),
  pitchDeg: z.number(),
  distanceMeters: z.number(),
  heightMeters: z.number(),
});
export type RelativeCameraState = z.infer<typeof RelativeCameraStateSchema>;

export const EasingPresetSchema = z.enum([
  'cinematic',
  'smooth',
  'linear',
  'accelerate',
  'decelerate',
]);
export type EasingPreset = z.infer<typeof EasingPresetSchema>;

const WaypointBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  travelDurationMs: z.number().nonnegative(),
  holdDurationMs: z.number().nonnegative(),
  travelDurationLocked: z.boolean(),
  holdDurationLocked: z.boolean(),
  easing: EasingPresetSchema,
});

export const AbsoluteWaypointSchema = WaypointBaseSchema.extend({
  type: z.literal('absolute'),
  camera: CameraStateSchema,
});

export const DestinationRelativeWaypointSchema = WaypointBaseSchema.extend({
  type: z.literal('destination-relative'),
  relativeCamera: RelativeCameraStateSchema,
});

export const WaypointSchema = z.discriminatedUnion('type', [
  AbsoluteWaypointSchema,
  DestinationRelativeWaypointSchema,
]);
export type Waypoint = z.infer<typeof WaypointSchema>;

export const TransitionTypeSchema = z.enum(['cut', 'crossfade', 'fade-black']);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

export const TransitionSchema = z.object({
  type: TransitionTypeSchema,
  durationMs: z.number().nonnegative(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const VisualTransformSchema = z.object({
  centerX: z.number(),
  centerY: z.number(),
  scale: z.number(),
  rotation: z.number().optional(),
});
export type VisualTransform = z.infer<typeof VisualTransformSchema>;

export const MapSceneSchema = z.object({
  id: z.string(),
  type: z.literal('map'),
  waypoints: z.array(WaypointSchema),
});
export type MapScene = z.infer<typeof MapSceneSchema>;

export const StorefrontMotionPresetSchema = z.enum([
  'none',
  'push-in',
  'pull-out',
  'pan-left',
  'pan-right',
  'custom',
]);
export type StorefrontMotionPreset = z.infer<typeof StorefrontMotionPresetSchema>;

export const StorefrontSceneSchema = z.object({
  id: z.string(),
  type: z.literal('storefront'),
  assetId: z.string(),
  durationMs: z.number().nonnegative(),
  durationLocked: z.boolean(),
  startTransform: VisualTransformSchema,
  endTransform: VisualTransformSchema,
  entranceTarget: z.object({ x: z.number(), y: z.number() }).optional(),
  motionPreset: StorefrontMotionPresetSchema,
  transitionIn: TransitionSchema,
  transitionOut: TransitionSchema,
});
export type StorefrontScene = z.infer<typeof StorefrontSceneSchema>;

export const PhotoMotionPresetSchema = z.enum([
  'push-in',
  'pull-out',
  'pan-left-right',
  'pan-right-left',
]);
export type PhotoMotionPreset = z.infer<typeof PhotoMotionPresetSchema>;

export const InteriorPhotoItemSchema = z.object({
  id: z.string(),
  type: z.literal('photo'),
  assetId: z.string(),
  durationMs: z.number().nonnegative(),
  durationLocked: z.boolean(),
  startTransform: VisualTransformSchema,
  endTransform: VisualTransformSchema,
  motionPreset: PhotoMotionPresetSchema,
  transitionToNext: TransitionSchema,
});
export type InteriorPhotoItem = z.infer<typeof InteriorPhotoItemSchema>;

export const FitModeSchema = z.enum(['cover', 'contain']);
export type FitMode = z.infer<typeof FitModeSchema>;

export const InteriorVideoItemSchema = z.object({
  id: z.string(),
  type: z.literal('video'),
  assetId: z.string(),
  trimStartMs: z.number().nonnegative(),
  trimEndMs: z.number().nonnegative(),
  playbackRate: z.number().positive(),
  audioEnabled: z.boolean(),
  fitMode: FitModeSchema,
  transitionToNext: TransitionSchema,
});
export type InteriorVideoItem = z.infer<typeof InteriorVideoItemSchema>;

export const InteriorTourItemSchema = z.discriminatedUnion('type', [
  InteriorPhotoItemSchema,
  InteriorVideoItemSchema,
]);
export type InteriorTourItem = z.infer<typeof InteriorTourItemSchema>;

export const InteriorTourSceneSchema = z.object({
  id: z.string(),
  type: z.literal('interior-tour'),
  items: z.array(InteriorTourItemSchema),
  defaultPhotoDurationMs: z.number().nonnegative(),
  defaultTransition: TransitionSchema,
});
export type InteriorTourScene = z.infer<typeof InteriorTourSceneSchema>;

export const ProjectSceneSchema = z.discriminatedUnion('type', [
  MapSceneSchema,
  StorefrontSceneSchema,
  InteriorTourSceneSchema,
]);
export type ProjectScene = z.infer<typeof ProjectSceneSchema>;
