import { describe, it, expect, vi } from 'vitest';
import { createDraft, NoDestinationError, type CreateDraftDependencies } from '../quickCreate/createDraft';
import { ProjectSchema } from '../models/project';
import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import type { VideoMetadata } from '../media/videoMetadata';

function makeFakeMediaStore(): MediaAssetStore {
  let counter = 0;
  return {
    save: vi.fn(async (file: File): Promise<StoredMediaAsset> => {
      counter += 1;
      return {
        id: `asset-${counter}`,
        storageLocation: 'indexeddb',
        storageKey: `key-${counter}`,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        filename: file.name,
      };
    }),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
  };
}

function makeDeps(overrides: Partial<CreateDraftDependencies> = {}): Partial<CreateDraftDependencies> {
  return {
    mediaStore: makeFakeMediaStore(),
    extractImageMetadata: vi.fn(async () => ({ latitude: 39.5, longitude: -104.9 })),
    resolveFromPhotoGps: vi.fn((metadata) =>
      typeof metadata.latitude === 'number' && typeof metadata.longitude === 'number'
        ? { source: 'photo-gps' as const, latitude: metadata.latitude, longitude: metadata.longitude }
        : null,
    ),
    isHeic: vi.fn(() => false),
    convertHeicToJpeg: vi.fn(async () => ({ ok: true as const, blob: new Blob() })),
    extractVideoMetadata: vi.fn(async (): Promise<VideoMetadata> => ({ durationMs: 6000, width: 1920, height: 1080 })),
    ...overrides,
  };
}

function makeFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

describe('createDraft', () => {
  it('produces a valid Project from a photo-GPS destination and mixed interior media', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('room.jpg', 'image/jpeg'), makeFile('clip.mp4', 'video/mp4')],
      },
      deps,
    );

    expect(() => ProjectSchema.parse(project)).not.toThrow();
    expect(project.destination).toEqual({ source: 'photo-gps', latitude: 39.5, longitude: -104.9 });
    expect(project.scenes.map((s) => s.type)).toEqual(['map', 'storefront', 'interior-tour']);
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(interiorScene.items).toHaveLength(2);
    expect(interiorScene.items[0].type).toBe('photo');
    expect(interiorScene.items[1].type).toBe('video');
  });

  it('throws NoDestinationError when the photo has no GPS and no override is supplied', async () => {
    const deps = makeDeps({ extractImageMetadata: vi.fn(async () => ({})) });
    await expect(
      createDraft({ storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] }, deps),
    ).rejects.toBeInstanceOf(NoDestinationError);
  });

  it('uses destinationOverride and never calls resolveFromPhotoGps when it is supplied', async () => {
    const deps = makeDeps({ extractImageMetadata: vi.fn(async () => ({})) });
    const override = { source: 'manual' as const, latitude: 1, longitude: 2 };
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [], destinationOverride: override },
      deps,
    );
    expect(project.destination).toEqual(override);
    expect(deps.resolveFromPhotoGps).not.toHaveBeenCalled();
  });

  it('produces a valid two-scene Project (no interior-tour scene) when interiorMedia is empty', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] },
      deps,
    );
    expect(() => ProjectSchema.parse(project)).not.toThrow();
    expect(project.scenes.map((s) => s.type)).toEqual(['map', 'storefront']);
  });

  it('applies default push-in motion to every photo item and crossfade transitions to every item', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('a.jpg', 'image/jpeg'), makeFile('b.jpg', 'image/jpeg')],
      },
      deps,
    );
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    for (const item of interiorScene.items) {
      expect(item.transitionToNext).toEqual({ type: 'crossfade', durationMs: 500 });
      if (item.type === 'photo') {
        expect(item.motionPreset).toBe('push-in');
      }
    }
  });

  it('keeps import order as the default interior item order', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('first.jpg', 'image/jpeg'), makeFile('second.mp4', 'video/mp4'), makeFile('third.jpg', 'image/jpeg')],
      },
      deps,
    );
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(interiorScene.items.map((i) => i.type)).toEqual(['photo', 'video', 'photo']);
  });
});
