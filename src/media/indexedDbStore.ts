import { getDb } from '../persistence/db';
import type { MediaAssetStore, StoredMediaAsset } from './MediaAssetStore';

type StoredMediaRecord = {
  id: string;
  blob: Blob;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export function createIndexedDbMediaStore(): MediaAssetStore {
  return {
    async save(file: File): Promise<StoredMediaAsset> {
      const id = crypto.randomUUID();
      const db = await getDb();
      const record: StoredMediaRecord = {
        id,
        blob: file,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      };
      await db.put('mediaAssets', record);
      return {
        id,
        storageLocation: 'indexeddb',
        storageKey: id,
        sizeBytes: file.size,
        mimeType: file.type,
        filename: file.name,
      };
    },

    async get(id: string): Promise<Blob | File | null> {
      const db = await getDb();
      const raw = await db.get('mediaAssets', id);
      if (!raw) return null;
      const record = raw as unknown as StoredMediaRecord;
      return record.blob;
    },

    async delete(id: string): Promise<void> {
      const db = await getDb();
      await db.delete('mediaAssets', id);
    },

    async exists(id: string): Promise<boolean> {
      const db = await getDb();
      const raw = await db.get('mediaAssets', id);
      return raw !== undefined;
    },

    async replace(id: string, file: File): Promise<StoredMediaAsset> {
      const db = await getDb();
      const record: StoredMediaRecord = {
        id,
        blob: file,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      };
      await db.put('mediaAssets', record);
      return {
        id,
        storageLocation: 'indexeddb',
        storageKey: id,
        sizeBytes: file.size,
        mimeType: file.type,
        filename: file.name,
      };
    },
  };
}
