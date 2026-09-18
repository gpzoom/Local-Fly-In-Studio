import type { MediaAsset } from '../models/media';
import type { MediaAssetStore } from './MediaAssetStore';
import { createMediaAssetStore } from './createMediaAssetStore';
import { isHeic, convertHeicToJpeg } from './imageDecoder';
import { extractVideoMetadata } from './videoMetadata';

export interface MediaRelinkComparison {
  filenameMatches: boolean;
  sizeMatches: boolean;
  typeMatches: boolean;
  durationMatches: boolean;
}

export interface RelinkResult {
  updatedAsset: MediaAsset;
  comparison: MediaRelinkComparison;
}

export interface RelinkMediaAssetDependencies {
  mediaAssetStore: MediaAssetStore;
  isHeic: typeof isHeic;
  convertHeicToJpeg: typeof convertHeicToJpeg;
  extractVideoMetadata: typeof extractVideoMetadata;
}

async function heicToJpegFile(
  file: File,
  doConvertHeicToJpeg: RelinkMediaAssetDependencies['convertHeicToJpeg'],
): Promise<File> {
  const result = await doConvertHeicToJpeg(file);
  if (!result.ok) {
    throw new Error(result.error);
  }
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([result.blob], newName, { type: 'image/jpeg' });
}

export async function relinkMediaAsset(
  originalAsset: MediaAsset,
  file: File,
  overrides: Partial<RelinkMediaAssetDependencies> = {},
): Promise<RelinkResult> {
  const deps: RelinkMediaAssetDependencies = {
    mediaAssetStore: overrides.mediaAssetStore ?? (await createMediaAssetStore()),
    isHeic: overrides.isHeic ?? isHeic,
    convertHeicToJpeg: overrides.convertHeicToJpeg ?? convertHeicToJpeg,
    extractVideoMetadata: overrides.extractVideoMetadata ?? extractVideoMetadata,
  };

  if (originalAsset.kind === 'image') {
    // finalFile is what's actually stored, so the comparison must be against it, not the
    // raw picked file — otherwise every HEIC relink of an already-JPEG-converted asset
    // would report a spurious type/filename mismatch even though the stored bytes match.
    const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
    const stored = await deps.mediaAssetStore.replace(originalAsset.id, finalFile);
    const updatedAsset: MediaAsset = {
      ...originalAsset,
      filename: stored.filename,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      captureTime: undefined,
      gps: undefined,
    };
    return {
      updatedAsset,
      comparison: {
        filenameMatches: finalFile.name === originalAsset.filename,
        sizeMatches: finalFile.size === originalAsset.sizeBytes,
        typeMatches: finalFile.type === originalAsset.mimeType,
        durationMatches: true,
      },
    };
  }

  const videoMeta = await deps.extractVideoMetadata(file);
  const stored = await deps.mediaAssetStore.replace(originalAsset.id, file);
  const updatedAsset: MediaAsset = {
    ...originalAsset,
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    width: videoMeta.width,
    height: videoMeta.height,
    durationMs: videoMeta.durationMs,
    captureTime: undefined,
    gps: undefined,
  };
  return {
    updatedAsset,
    comparison: {
      filenameMatches: file.name === originalAsset.filename,
      sizeMatches: file.size === originalAsset.sizeBytes,
      typeMatches: file.type === originalAsset.mimeType,
      durationMatches: videoMeta.durationMs === originalAsset.durationMs,
    },
  };
}
