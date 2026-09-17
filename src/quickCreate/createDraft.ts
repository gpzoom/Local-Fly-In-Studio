import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import { createMediaAssetStore } from '../media/createMediaAssetStore';
import { extractImageMetadata, type ExtractedMediaMetadata } from '../media/metadata';
import { isHeic, convertHeicToJpeg } from '../media/imageDecoder';
import { resolveFromPhotoGps } from '../destination/resolver';
import { extractVideoMetadata } from '../media/videoMetadata';
import { createMapSceneFromTemplate } from '../persistence/templates';
import { CURRENT_SCHEMA_VERSION, type Project, type Destination } from '../models/project';
import type { ProjectScene, StorefrontScene, InteriorTourItem, Transition } from '../models/scenes';
import type { MediaAsset } from '../models/media';

export class NoDestinationError extends Error {
  constructor() {
    super('Could not determine a destination for this storefront photo — no GPS data found.');
    this.name = 'NoDestinationError';
  }
}

export interface CreateDraftInput {
  storefrontPhoto: File;
  interiorMedia: File[];
  destinationOverride?: Destination;
}

export interface CreateDraftDependencies {
  mediaStore: MediaAssetStore;
  extractImageMetadata: typeof extractImageMetadata;
  extractVideoMetadata: typeof extractVideoMetadata;
  resolveFromPhotoGps: typeof resolveFromPhotoGps;
  isHeic: typeof isHeic;
  convertHeicToJpeg: typeof convertHeicToJpeg;
}

async function heicToJpegFile(
  file: File,
  doConvertHeicToJpeg: CreateDraftDependencies['convertHeicToJpeg'],
): Promise<File> {
  const result = await doConvertHeicToJpeg(file);
  if (!result.ok) {
    throw new Error(result.error);
  }
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([result.blob], newName, { type: 'image/jpeg' });
}

async function importStorefrontAsset(
  file: File,
  metadata: ExtractedMediaMetadata,
  deps: CreateDraftDependencies,
): Promise<MediaAsset> {
  const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
  const stored = await deps.mediaStore.save(finalFile);
  const gps =
    typeof metadata.latitude === 'number' && typeof metadata.longitude === 'number'
      ? { latitude: metadata.latitude, longitude: metadata.longitude }
      : undefined;
  return {
    id: stored.id,
    kind: 'image',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    captureTime: metadata.captureTime,
    gps,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
}

function createDefaultStorefrontScene(assetId: string): StorefrontScene {
  return {
    id: `storefront-${crypto.randomUUID()}`,
    type: 'storefront',
    assetId,
    durationMs: 2500,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
    motionPreset: 'push-in',
    transitionIn: { type: 'crossfade', durationMs: 600 },
    transitionOut: { type: 'crossfade', durationMs: 600 },
  };
}

interface ImportedInteriorItem {
  item: InteriorTourItem;
  mediaAsset: MediaAsset;
}

async function importInteriorPhoto(
  file: File,
  index: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem> {
  const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
  const stored: StoredMediaAsset = await deps.mediaStore.save(finalFile);
  const mediaAsset: MediaAsset = {
    id: stored.id,
    kind: 'image',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
  const item: InteriorTourItem = {
    id: `interior-item-${index}-${stored.id}`,
    type: 'photo',
    assetId: stored.id,
    durationMs: 4000,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.08 },
    // Placeholder — overwritten for every photo item by applyDefaultPhotoMotion below.
    motionPreset: 'push-in',
    transitionToNext: { type: 'cut', durationMs: 0 },
  };
  return { item, mediaAsset };
}

async function importInteriorVideo(
  file: File,
  index: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem> {
  const stored = await deps.mediaStore.save(file);
  const videoMeta = await deps.extractVideoMetadata(file);
  const mediaAsset: MediaAsset = {
    id: stored.id,
    kind: 'video',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    width: videoMeta.width,
    height: videoMeta.height,
    durationMs: videoMeta.durationMs,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
  const item: InteriorTourItem = {
    id: `interior-item-${index}-${stored.id}`,
    type: 'video',
    assetId: stored.id,
    trimStartMs: 0,
    trimEndMs: videoMeta.durationMs,
    playbackRate: 1,
    audioEnabled: false,
    fitMode: 'cover',
    transitionToNext: { type: 'cut', durationMs: 0 },
  };
  return { item, mediaAsset };
}

async function createInteriorItems(
  files: File[],
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem[]> {
  const results: ImportedInteriorItem[] = [];
  for (const [index, file] of files.entries()) {
    const isVideo = file.type.startsWith('video/');
    results.push(isVideo ? await importInteriorVideo(file, index, deps) : await importInteriorPhoto(file, index, deps));
  }
  return results;
}

function applyDefaultInteriorOrdering(items: InteriorTourItem[]): InteriorTourItem[] {
  // Import order is already the default order — no reordering needed.
  // Returns a fresh array so callers can treat ordering as an explicit step.
  return [...items];
}

// Intentionally redundant with importInteriorPhoto's initial `motionPreset`: this is
// the explicit, idempotent guarantee that every photo gets the default motion, so a
// future change to that placeholder value cannot silently change the draft default.
function applyDefaultPhotoMotion(items: InteriorTourItem[]): void {
  for (const item of items) {
    if (item.type === 'photo') {
      item.motionPreset = 'push-in';
    }
  }
}

function applyDefaultTransitions(items: InteriorTourItem[]): void {
  for (const item of items) {
    // A fresh object per item — a shared reference would let 4b's editing UI change
    // one item's transition and silently change every other item's too.
    const defaultTransition: Transition = { type: 'crossfade', durationMs: 500 };
    item.transitionToNext = defaultTransition;
  }
}

export async function createDraft(
  input: CreateDraftInput,
  overrides: Partial<CreateDraftDependencies> = {},
): Promise<Project> {
  const deps: CreateDraftDependencies = {
    mediaStore: overrides.mediaStore ?? (await createMediaAssetStore()),
    extractImageMetadata: overrides.extractImageMetadata ?? extractImageMetadata,
    extractVideoMetadata: overrides.extractVideoMetadata ?? extractVideoMetadata,
    resolveFromPhotoGps: overrides.resolveFromPhotoGps ?? resolveFromPhotoGps,
    isHeic: overrides.isHeic ?? isHeic,
    convertHeicToJpeg: overrides.convertHeicToJpeg ?? convertHeicToJpeg,
  };

  const metadata = await deps.extractImageMetadata(input.storefrontPhoto);
  const destination = input.destinationOverride ?? deps.resolveFromPhotoGps(metadata);
  if (!destination) {
    throw new NoDestinationError();
  }

  const storefrontAsset = await importStorefrontAsset(input.storefrontPhoto, metadata, deps);
  const mapScene = createMapSceneFromTemplate(destination);
  const storefrontScene = createDefaultStorefrontScene(storefrontAsset.id);

  const imported = await createInteriorItems(input.interiorMedia, deps);
  const orderedItems = applyDefaultInteriorOrdering(imported.map((i) => i.item));
  applyDefaultPhotoMotion(orderedItems);
  applyDefaultTransitions(orderedItems);

  const scenes: ProjectScene[] = [mapScene, storefrontScene];
  const mediaAssets: MediaAsset[] = [storefrontAsset, ...imported.map((i) => i.mediaAsset)];

  if (orderedItems.length > 0) {
    scenes.push({
      id: `interior-${crypto.randomUUID()}`,
      type: 'interior-tour',
      items: orderedItems,
      defaultPhotoDurationMs: 4000,
      defaultTransition: { type: 'crossfade', durationMs: 500 },
    });
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `project-${crypto.randomUUID()}`,
    projectName: destination.businessName ?? 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    destination,
    scenes,
    mediaAssets,
    videoSettings: { aspectRatio: '16:9', widthPx: 1920, heightPx: 1080, fps: 30 },
  };
}
