import { describe, it, expect, vi, afterEach } from 'vitest';
import * as capabilities from '../media/storageCapabilities';
import * as opfs from '../media/opfsStore';
import * as indexedDb from '../media/indexedDbStore';
import { createMediaAssetStore } from '../media/createMediaAssetStore';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMediaAssetStore', () => {
  it('uses the OPFS backend when OPFS is supported', async () => {
    const sentinel = { save: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn() };
    vi.spyOn(capabilities, 'detectStorageCapabilities').mockResolvedValue({
      opfsSupported: true,
    });
    const opfsSpy = vi.spyOn(opfs, 'createOpfsMediaStore').mockResolvedValue(sentinel);
    const indexedDbSpy = vi.spyOn(indexedDb, 'createIndexedDbMediaStore');

    const store = await createMediaAssetStore();

    expect(store).toBe(sentinel);
    expect(opfsSpy).toHaveBeenCalled();
    expect(indexedDbSpy).not.toHaveBeenCalled();
  });

  it('uses the IndexedDB backend when OPFS is unsupported', async () => {
    const sentinel = { save: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn() };
    vi.spyOn(capabilities, 'detectStorageCapabilities').mockResolvedValue({
      opfsSupported: false,
    });
    const opfsSpy = vi.spyOn(opfs, 'createOpfsMediaStore');
    const indexedDbSpy = vi.spyOn(indexedDb, 'createIndexedDbMediaStore').mockReturnValue(sentinel);

    const store = await createMediaAssetStore();

    expect(store).toBe(sentinel);
    expect(indexedDbSpy).toHaveBeenCalled();
    expect(opfsSpy).not.toHaveBeenCalled();
  });
});
