import { describe, it, expect, vi } from 'vitest';
import {
  createDraft,
  NoDestinationError,
  UndecodableImageError,
  InsufficientStorageError,
  type CreateDraftDependencies,
} from '../quickCreate/createDraft';
import { ProjectSchema } from '../models/project';
import { getBuiltinProjectTemplate, BUILTIN_PROJECT_TEMPLATE_ID } from '../models/projectTemplate';
import type { ProjectTemplate } from '../models/projectTemplate';
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
    replace: vi.fn(async () => {
      throw new Error('not implemented in this fake');
    }),
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
    canDecodeNatively: vi.fn(async () => true),
    checkQuota: vi.fn(async () => ({ sufficient: true, quotaBytes: null, usageBytes: null, availableBytes: null })),
    ...overrides,
  };
}

function makeFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

const CUSTOM_TEMPLATE: ProjectTemplate = {
  id: 'template-custom-1',
  name: 'Custom Style',
  createdAt: '2026-02-01T00:00:00.000Z',
  map: {
    waypoints: [
      {
        id: 'custom-earth',
        name: 'Earth',
        type: 'absolute',
        camera: { longitude: 0, latitude: 0, height: 20_000_000, heading: 0, pitch: -90, roll: 0 },
        travelDurationMs: 0,
        holdDurationMs: 1000,
        travelDurationLocked: false,
        holdDurationLocked: false,
        easing: 'cinematic',
      },
    ],
  },
  storefront: {
    durationMs: 3000,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.1 },
    motionPreset: 'pull-out',
    transitionIn: { type: 'fade-black', durationMs: 400 },
    transitionOut: { type: 'fade-black', durationMs: 400 },
  },
  interiorTour: {
    defaultPhotoDurationMs: 5000,
    defaultTransition: { type: 'fade-black', durationMs: 300 },
  },
};

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

  it("applies the built-in template's crossfade transitions and alternates photo motion (not uniform push-in)", async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('a.jpg', 'image/jpeg'), makeFile('b.jpg', 'image/jpeg'), makeFile('c.jpg', 'image/jpeg')],
      },
      deps,
    );
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    for (const item of interiorScene.items) {
      expect(item.transitionToNext).toEqual({ type: 'crossfade', durationMs: 500 });
    }
    const motionPresets = interiorScene.items.map((i) => (i.type === 'photo' ? i.motionPreset : null));
    expect(motionPresets).toEqual(['push-in', 'pull-out', 'pan-left-right']);
  });

  it('omitting template reproduces the exact built-in map/storefront/interior defaults', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] },
      deps,
    );
    const builtin = getBuiltinProjectTemplate();
    const mapScene = project.scenes.find((s) => s.type === 'map')!;
    if (mapScene.type !== 'map') throw new Error('unreachable');
    expect(mapScene.waypoints).toEqual(builtin.map.waypoints);

    const storefrontScene = project.scenes.find((s) => s.type === 'storefront')!;
    if (storefrontScene.type !== 'storefront') throw new Error('unreachable');
    expect(storefrontScene.durationMs).toBe(builtin.storefront.durationMs);
    expect(storefrontScene.motionPreset).toBe(builtin.storefront.motionPreset);
    expect(storefrontScene.transitionIn).toEqual(builtin.storefront.transitionIn);

    expect(project.templateId).toBeUndefined();
  });

  it("uses a custom template's map/storefront/interior values instead of the built-in's", async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('a.jpg', 'image/jpeg')],
        template: CUSTOM_TEMPLATE,
      },
      deps,
    );

    const mapScene = project.scenes.find((s) => s.type === 'map')!;
    if (mapScene.type !== 'map') throw new Error('unreachable');
    expect(mapScene.waypoints).toEqual(CUSTOM_TEMPLATE.map.waypoints);

    const storefrontScene = project.scenes.find((s) => s.type === 'storefront')!;
    if (storefrontScene.type !== 'storefront') throw new Error('unreachable');
    expect(storefrontScene.durationMs).toBe(3000);
    expect(storefrontScene.motionPreset).toBe('pull-out');
    expect(storefrontScene.transitionIn).toEqual({ type: 'fade-black', durationMs: 400 });

    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(interiorScene.defaultPhotoDurationMs).toBe(5000);
    expect(interiorScene.items[0].type === 'photo' && interiorScene.items[0].durationMs).toBe(5000);
    expect(interiorScene.items[0].transitionToNext).toEqual({ type: 'fade-black', durationMs: 300 });
  });

  it("stamps a custom template's id as the draft's templateId; the built-in path leaves templateId undefined", async () => {
    const deps = makeDeps();
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [], template: CUSTOM_TEMPLATE },
      deps,
    );
    expect(project.templateId).toBe('template-custom-1');

    const builtinTemplate = getBuiltinProjectTemplate();
    expect(builtinTemplate.id).toBe(BUILTIN_PROJECT_TEMPLATE_ID);
    const builtinProject = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [], template: builtinTemplate },
      deps,
    );
    expect(builtinProject.templateId).toBeUndefined();
  });

  it('checks quota against the total size of every input file before importing anything', async () => {
    const checkQuota = vi.fn(async () => ({
      sufficient: true,
      quotaBytes: 1_000_000,
      usageBytes: 0,
      availableBytes: 1_000_000,
    }));
    const deps = makeDeps({ checkQuota });
    const storefrontPhoto = makeFile('storefront.jpg', 'image/jpeg');
    const interiorMedia = [makeFile('a.jpg', 'image/jpeg'), makeFile('b.mp4', 'video/mp4')];
    await createDraft({ storefrontPhoto, interiorMedia }, deps);

    const expectedTotal = storefrontPhoto.size + interiorMedia[0].size + interiorMedia[1].size;
    expect(checkQuota).toHaveBeenCalledWith(expectedTotal);
  });

  it('throws InsufficientStorageError and imports nothing when quota is insufficient', async () => {
    const checkQuota = vi.fn(async () => ({
      sufficient: false,
      quotaBytes: 100,
      usageBytes: 50,
      availableBytes: 50,
    }));
    const deps = makeDeps({ checkQuota });
    await expect(
      createDraft(
        { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] },
        deps,
      ),
    ).rejects.toBeInstanceOf(InsufficientStorageError);
    expect((deps.mediaStore as MediaAssetStore).save).not.toHaveBeenCalled();
  });

  it('throws UndecodableImageError when the storefront photo cannot decode natively', async () => {
    const canDecodeNatively = vi.fn(async () => false);
    const deps = makeDeps({ canDecodeNatively });
    await expect(
      createDraft(
        { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] },
        deps,
      ),
    ).rejects.toBeInstanceOf(UndecodableImageError);
  });

  it('throws UndecodableImageError when an interior photo cannot decode natively', async () => {
    // Storefront photo decodes fine; only the interior photo fails.
    const canDecodeNatively = vi.fn(async (file: File) => file.name !== 'bad.jpg');
    const deps = makeDeps({ canDecodeNatively });
    await expect(
      createDraft(
        {
          storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
          interiorMedia: [makeFile('bad.jpg', 'image/jpeg')],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(UndecodableImageError);
  });

  it('does not decode-check interior video files (only photos)', async () => {
    const canDecodeNatively = vi.fn(async () => true);
    const deps = makeDeps({ canDecodeNatively });
    await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('clip.mp4', 'video/mp4')],
      },
      deps,
    );
    expect(canDecodeNatively).toHaveBeenCalledTimes(1); // storefront photo only
  });
});
