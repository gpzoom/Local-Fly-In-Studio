import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import { createMediaAssetStore } from '../media/createMediaAssetStore';
import { extractImageMetadata, type ExtractedMediaMetadata } from '../media/metadata';
import { isHeic, convertHeicToJpeg, canDecodeNatively } from '../media/imageDecoder';
import { resolveFromPhotoGps } from '../destination/resolver';
import { extractVideoMetadata } from '../media/videoMetadata';
import { checkQuota } from '../media/storageCapabilities';
import { getBuiltinProjectTemplate, BUILTIN_PROJECT_TEMPLATE_ID, type ProjectTemplate } from '../models/projectTemplate';
import { regeneratePhotoMotion } from '../timeline/bulkEdit';
import { CURRENT_SCHEMA_VERSION, type Project, type Destination } from '../models/project';
import type {
  ProjectScene,
  StorefrontScene,
  InteriorTourItem,
  InteriorTourScene,
  MapScene,
  Transition,
} from '../models/scenes';
import type { MediaAsset } from '../models/media';

export class NoDestinationError extends Error {
  constructor() {
    super('Could not determine a destination for this storefront photo — no GPS data found.');
    this.name = 'NoDestinationError';
  }
}

export class UndecodableImageError extends Error {
  constructor(filename: string) {
    super(`Could not decode "${filename}" as an image. Try a different photo.`);
    this.name = 'UndecodableImageError';
  }
}

export class InsufficientStorageError extends Error {
  constructor(neededBytes: number, availableBytes: number) {
    super(
      `These files need about ${formatBytes(neededBytes)} but only ${formatBytes(availableBytes)} of storage is available. Free up space or choose fewer/smaller files.`,
    );
    this.name = 'InsufficientStorageError';
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface CreateDraftInput {
  storefrontPhoto: File;
  interiorMedia: File[];
  destinationOverride?: Destination;
  template?: ProjectTemplate;
}

export interface CreateDraftDependencies {
  mediaStore: MediaAssetStore;
  extractImageMetadata: typeof extractImageMetadata;
  extractVideoMetadata: typeof extractVideoMetadata;
  resolveFromPhotoGps: typeof resolveFromPhotoGps;
  isHeic: typeof isHeic;
  convertHeicToJpeg: typeof convertHeicToJpeg;
  canDecodeNatively: typeof canDecodeNatively;
  checkQuota: typeof checkQuota;
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
  if (!(await deps.canDecodeNatively(finalFile))) {
    throw new UndecodableImageError(finalFile.name);
  }
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

function createDefaultStorefrontScene(assetId: string, template: ProjectTemplate): StorefrontScene {
  return {
    id: `storefront-${crypto.randomUUID()}`,
    type: 'storefront',
    assetId,
    ...template.storefront,
  };
}

interface ImportedInteriorItem {
  item: InteriorTourItem;
  mediaAsset: MediaAsset;
}

async function importInteriorPhoto(
  file: File,
  index: number,
  defaultPhotoDurationMs: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem> {
  const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
  if (!(await deps.canDecodeNatively(finalFile))) {
    throw new UndecodableImageError(finalFile.name);
  }
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
    durationMs: defaultPhotoDurationMs,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.08 },
    // Placeholder — overwritten for every photo item by regeneratePhotoMotion in createDraft.
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
  defaultPhotoDurationMs: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem[]> {
  const results: ImportedInteriorItem[] = [];
  for (const [index, file] of files.entries()) {
    const isVideo = file.type.startsWith('video/');
    results.push(
      isVideo
        ? await importInteriorVideo(file, index, deps)
        : await importInteriorPhoto(file, index, defaultPhotoDurationMs, deps),
    );
  }
  return results;
}

function applyDefaultInteriorOrdering(items: InteriorTourItem[]): InteriorTourItem[] {
  // Import order is already the default order — no reordering needed.
  // Returns a fresh array so callers can treat ordering as an explicit step.
  return [...items];
}

function applyDefaultTransitions(items: InteriorTourItem[], defaultTransition: Transition): void {
  for (const item of items) {
    // A fresh object per item — a shared reference would let 4b's editing UI change
    // one item's transition and silently change every other item's too.
    item.transitionToNext = { ...defaultTransition };
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
    canDecodeNatively: overrides.canDecodeNatively ?? canDecodeNatively,
    checkQuota: overrides.checkQuota ?? checkQuota,
  };

  // Fail fast, before any file is read or written: a project this large won't fit regardless
  // of which specific file turns out to be the problem.
  const totalBytes = input.storefrontPhoto.size + input.interiorMedia.reduce((sum, f) => sum + f.size, 0);
  const quota = await deps.checkQuota(totalBytes);
  if (!quota.sufficient) {
    throw new InsufficientStorageError(totalBytes, quota.availableBytes ?? 0);
  }

  const resolvedTemplate = input.template ?? getBuiltinProjectTemplate();

  const metadata = await deps.extractImageMetadata(input.storefrontPhoto);
  const destination = input.destinationOverride ?? deps.resolveFromPhotoGps(metadata);
  if (!destination) {
    throw new NoDestinationError();
  }

  const storefrontAsset = await importStorefrontAsset(input.storefrontPhoto, metadata, deps);
  const mapScene: MapScene = {
    id: `map-${destination.source}-${crypto.randomUUID()}`,
    type: 'map',
    waypoints: resolvedTemplate.map.waypoints,
  };
  const storefrontScene = createDefaultStorefrontScene(storefrontAsset.id, resolvedTemplate);

  const imported = await createInteriorItems(
    input.interiorMedia,
    resolvedTemplate.interiorTour.defaultPhotoDurationMs,
    deps,
  );
  const orderedItems = applyDefaultInteriorOrdering(imported.map((i) => i.item));
  applyDefaultTransitions(orderedItems, resolvedTemplate.interiorTour.defaultTransition);

  const scenes: ProjectScene[] = [mapScene, storefrontScene];
  const mediaAssets: MediaAsset[] = [storefrontAsset, ...imported.map((i) => i.mediaAsset)];

  if (orderedItems.length > 0) {
    const interiorScene: InteriorTourScene = {
      id: `interior-${crypto.randomUUID()}`,
      type: 'interior-tour',
      items: orderedItems,
      defaultPhotoDurationMs: resolvedTemplate.interiorTour.defaultPhotoDurationMs,
      defaultTransition: resolvedTemplate.interiorTour.defaultTransition,
    };
    scenes.push(regeneratePhotoMotion(interiorScene));
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
    templateId: resolvedTemplate.id === BUILTIN_PROJECT_TEMPLATE_ID ? undefined : resolvedTemplate.id,
  };
}
