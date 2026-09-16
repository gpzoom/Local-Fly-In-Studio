import { detectStorageCapabilities } from './storageCapabilities';
import { createOpfsMediaStore } from './opfsStore';
import { createIndexedDbMediaStore } from './indexedDbStore';
import type { MediaAssetStore } from './MediaAssetStore';

export async function createMediaAssetStore(): Promise<MediaAssetStore> {
  const { opfsSupported } = await detectStorageCapabilities();
  if (opfsSupported) {
    return createOpfsMediaStore();
  }
  return createIndexedDbMediaStore();
}
