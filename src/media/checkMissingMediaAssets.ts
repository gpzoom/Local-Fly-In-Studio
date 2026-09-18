import type { Project } from '../models/project';
import type { MediaAssetStore } from './MediaAssetStore';

export async function checkMissingMediaAssets(
  project: Project,
  mediaAssetStore: MediaAssetStore,
): Promise<Set<string>> {
  const missing = new Set<string>();
  for (const asset of project.mediaAssets) {
    const exists = await mediaAssetStore.exists(asset.storageKey);
    if (!exists) missing.add(asset.id);
  }
  return missing;
}
