import { z } from 'zod';

export const MediaKindSchema = z.enum(['image', 'video']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const StorageLocationSchema = z.enum(['opfs', 'indexeddb', 'session']);
export type StorageLocation = z.infer<typeof StorageLocationSchema>;

export const MediaGpsSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const MediaAssetSchema = z.object({
  id: z.string(),
  kind: MediaKindSchema,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationMs: z.number().optional(),
  captureTime: z.string().optional(),
  gps: MediaGpsSchema.optional(),
  storageLocation: StorageLocationSchema,
  storageKey: z.string(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
