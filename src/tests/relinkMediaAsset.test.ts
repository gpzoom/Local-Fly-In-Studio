import { describe, it, expect, vi } from 'vitest';
import { relinkMediaAsset } from '../media/relinkMediaAsset';
import type { MediaAsset } from '../models/media';
import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import type { VideoMetadata } from '../media/videoMetadata';

function makeImageAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1',
    kind: 'image',
    filename: 'original.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    storageLocation: 'indexeddb',
    storageKey: 'asset-1',
    ...overrides,
  };
}

function makeVideoAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-2',
    kind: 'video',
    filename: 'original.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 5000,
    width: 1920,
    height: 1080,
    durationMs: 6000,
    storageLocation: 'indexeddb',
    storageKey: 'asset-2',
    ...overrides,
  };
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

function makeFakeStore(): MediaAssetStore {
  return {
    save: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    replace: vi.fn(
      async (id: string, file: File): Promise<StoredMediaAsset> => ({
        id,
        storageLocation: 'indexeddb',
        storageKey: id,
        sizeBytes: file.size,
        mimeType: file.type,
        filename: file.name,
      }),
    ),
  };
}

describe('relinkMediaAsset', () => {
  it('relinks an image asset, preserving its id and comparing filename/size/type', async () => {
    const original = makeImageAsset();
    const store = makeFakeStore();
    const replacement = makeFile('new.jpg', 'image/jpeg', 1000);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => false),
    });

    expect(store.replace).toHaveBeenCalledWith('asset-1', replacement);
    expect(result.updatedAsset.id).toBe('asset-1');
    expect(result.updatedAsset.filename).toBe('new.jpg');
    expect(result.updatedAsset.mimeType).toBe('image/jpeg');
    expect(result.updatedAsset.sizeBytes).toBe(1000);
    expect(result.comparison).toEqual({
      filenameMatches: false,
      sizeMatches: true,
      typeMatches: true,
      durationMatches: true,
    });
  });

  it('converts a HEIC replacement to JPEG before storing, and compares against the converted file', async () => {
    const original = makeImageAsset({ filename: 'converted.jpg', mimeType: 'image/jpeg' });
    const store = makeFakeStore();
    const heicFile = makeFile('converted.heic', 'image/heic', 2000);
    const convertedBlob = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });

    const result = await relinkMediaAsset(original, heicFile, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => true),
      convertHeicToJpeg: vi.fn(async () => ({ ok: true as const, blob: convertedBlob })),
    });

    expect(store.replace).toHaveBeenCalledWith(
      'asset-1',
      expect.objectContaining({ name: 'converted.jpg', type: 'image/jpeg' }),
    );
    expect(result.comparison.filenameMatches).toBe(true);
    expect(result.comparison.typeMatches).toBe(true);
    expect(result.comparison.sizeMatches).toBe(true);
  });

  it('relinks a video asset, extracting new metadata and comparing duration', async () => {
    const original = makeVideoAsset();
    const store = makeFakeStore();
    const replacement = makeFile('original.mp4', 'video/mp4', 5000);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      extractVideoMetadata: vi.fn(
        async (): Promise<VideoMetadata> => ({ durationMs: 7000, width: 1280, height: 720 }),
      ),
    });

    expect(store.replace).toHaveBeenCalledWith('asset-2', replacement);
    expect(result.updatedAsset.width).toBe(1280);
    expect(result.updatedAsset.height).toBe(720);
    expect(result.updatedAsset.durationMs).toBe(7000);
    expect(result.comparison).toEqual({
      filenameMatches: true,
      sizeMatches: true,
      typeMatches: true,
      durationMatches: false,
    });
  });

  it('reports sizeMatches: false when the replacement size differs', async () => {
    const original = makeImageAsset();
    const store = makeFakeStore();
    const replacement = makeFile('original.jpg', 'image/jpeg', 9999);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => false),
    });

    expect(result.comparison.sizeMatches).toBe(false);
    expect(result.comparison.filenameMatches).toBe(true);
    expect(result.comparison.typeMatches).toBe(true);
  });

  it('reports typeMatches: false when the replacement mime type differs', async () => {
    const original = makeImageAsset();
    const store = makeFakeStore();
    const replacement = makeFile('original.jpg', 'image/png', 1000);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => false),
    });

    expect(result.comparison.typeMatches).toBe(false);
    expect(result.comparison.filenameMatches).toBe(true);
    expect(result.comparison.sizeMatches).toBe(true);
  });

  it('drops captureTime and gps on the updated asset', async () => {
    const original = makeImageAsset({
      captureTime: '2026-01-01T00:00:00.000Z',
      gps: { latitude: 1, longitude: 2 },
    });
    const store = makeFakeStore();
    const replacement = makeFile('original.jpg', 'image/jpeg', 1000);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => false),
    });

    expect(result.updatedAsset.captureTime).toBeUndefined();
    expect(result.updatedAsset.gps).toBeUndefined();
  });
});
