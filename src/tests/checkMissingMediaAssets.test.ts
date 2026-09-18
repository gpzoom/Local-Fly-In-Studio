import { describe, it, expect, vi } from 'vitest';
import { checkMissingMediaAssets } from '../media/checkMissingMediaAssets';
import { makeMinimalProject } from './fixtures';
import type { MediaAssetStore } from '../media/MediaAssetStore';
import type { MediaAsset } from '../models/media';

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1',
    kind: 'image',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 100,
    storageLocation: 'indexeddb',
    storageKey: 'asset-1',
    ...overrides,
  };
}

function makeFakeStore(presentKeys: Set<string>): MediaAssetStore {
  return {
    save: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(async (id: string) => presentKeys.has(id)),
    replace: vi.fn(),
  };
}

describe('checkMissingMediaAssets', () => {
  it('returns an empty set when every asset exists', async () => {
    const project = makeMinimalProject({
      mediaAssets: [makeAsset({ id: 'a', storageKey: 'a' }), makeAsset({ id: 'b', storageKey: 'b' })],
    });
    const store = makeFakeStore(new Set(['a', 'b']));
    const missing = await checkMissingMediaAssets(project, store);
    expect(missing).toEqual(new Set());
  });

  it('returns the ids of assets that do not exist in the store', async () => {
    const project = makeMinimalProject({
      mediaAssets: [makeAsset({ id: 'a', storageKey: 'a' }), makeAsset({ id: 'b', storageKey: 'b' })],
    });
    const store = makeFakeStore(new Set(['a']));
    const missing = await checkMissingMediaAssets(project, store);
    expect(missing).toEqual(new Set(['b']));
  });

  it('returns every id when all assets are missing', async () => {
    const project = makeMinimalProject({
      mediaAssets: [makeAsset({ id: 'a', storageKey: 'a' }), makeAsset({ id: 'b', storageKey: 'b' })],
    });
    const store = makeFakeStore(new Set());
    const missing = await checkMissingMediaAssets(project, store);
    expect(missing).toEqual(new Set(['a', 'b']));
  });

  it('returns an empty set for a project with no media assets', async () => {
    const project = makeMinimalProject({ mediaAssets: [] });
    const store = makeFakeStore(new Set());
    const missing = await checkMissingMediaAssets(project, store);
    expect(missing).toEqual(new Set());
  });

  it('checks existence by storageKey but reports the asset id', async () => {
    const project = makeMinimalProject({
      mediaAssets: [makeAsset({ id: 'asset-id-1', storageKey: 'store-key-1' })],
    });
    const store = makeFakeStore(new Set());
    const missing = await checkMissingMediaAssets(project, store);
    expect(missing).toEqual(new Set(['asset-id-1']));
    expect(store.exists).toHaveBeenCalledWith('store-key-1');
  });
});
