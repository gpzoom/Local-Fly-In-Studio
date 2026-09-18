import type { MediaAssetStore, StoredMediaAsset } from './MediaAssetStore';

export async function createOpfsMediaStore(
  root?: FileSystemDirectoryHandle
): Promise<MediaAssetStore> {
  const dir = root ?? (await navigator.storage.getDirectory());

  return {
    async save(file: File): Promise<StoredMediaAsset> {
      const id = crypto.randomUUID();
      const fileHandle = await dir.getFileHandle(id, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      return {
        id,
        storageLocation: 'opfs',
        storageKey: id,
        sizeBytes: file.size,
        mimeType: file.type,
        filename: file.name,
      };
    },

    async get(id: string): Promise<Blob | File | null> {
      try {
        const fileHandle = await dir.getFileHandle(id);
        return await fileHandle.getFile();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') {
          return null;
        }
        throw err;
      }
    },

    async delete(id: string): Promise<void> {
      try {
        await dir.removeEntry(id);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'NotFoundError')) {
          throw err;
        }
      }
    },

    async exists(id: string): Promise<boolean> {
      try {
        await dir.getFileHandle(id);
        return true;
      } catch {
        return false;
      }
    },

    async replace(id: string, file: File): Promise<StoredMediaAsset> {
      const fileHandle = await dir.getFileHandle(id, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      return {
        id,
        storageLocation: 'opfs',
        storageKey: id,
        sizeBytes: file.size,
        mimeType: file.type,
        filename: file.name,
      };
    },
  };
}
