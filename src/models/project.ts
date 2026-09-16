import { z } from 'zod';
import { MediaAssetSchema } from './media';
import { ProjectSceneSchema } from './scenes';

export const CURRENT_SCHEMA_VERSION = 1;

export const DestinationSourceSchema = z.enum([
  'photo-gps',
  'device-location',
  'address',
  'manual',
]);
export type DestinationSource = z.infer<typeof DestinationSourceSchema>;

export const DestinationSchema = z.object({
  source: DestinationSourceSchema,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  businessName: z.string().optional(),
  originalAddress: z.string().optional(),
  matchedAddress: z.string().optional(),
});
export type Destination = z.infer<typeof DestinationSchema>;

export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1']);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

export const VideoSettingsSchema = z.object({
  aspectRatio: AspectRatioSchema,
  widthPx: z.number().positive(),
  heightPx: z.number().positive(),
  fps: z.union([z.literal(30), z.literal(60)]),
});
export type VideoSettings = z.infer<typeof VideoSettingsSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.string(),
  projectName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  destination: DestinationSchema,
  scenes: z.array(ProjectSceneSchema),
  mediaAssets: z.array(MediaAssetSchema),
  videoSettings: VideoSettingsSchema,
  templateId: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
