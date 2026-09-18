import { describe, it, expect } from 'vitest';
import { createOpfsMediaStore } from '../media/opfsStore';

class FakeFileHandle {
  constructor(
    private store: Map<string, Blob>,
    private name: string
  ) {}

  async createWritable() {
    const chunks: BlobPart[] = [];
    return {
      write: async (data: BlobPart) => {
        chunks.push(data);
      },
      close: async () => {
        this.store.set(this.name, new Blob(chunks));
      },
    };
  }

  async getFile(): Promise<File> {
    const blob = this.store.get(this.name);
    if (!blob) throw new DOMException('not found', 'NotFoundError');
    return new File([blob], this.name);
  }
}

class FakeDirectoryHandle {
  private files = new Map<string, Blob>();

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create) {
        throw new DOMException('not found', 'NotFoundError');
      }
      this.files.set(name, new Blob());
    }
    return new FakeFileHandle(this.files, name);
  }

  async removeEntry(name: string) {
    if (!this.files.has(name)) {
      throw new DOMException('not found', 'NotFoundError');
    }
    this.files.delete(name);
  }
}

function makeFakeRoot() {
  return new FakeDirectoryHandle() as unknown as FileSystemDirectoryHandle;
}

describe('opfsStore', () => {
  it('saves a file and returns metadata', async () => {
    const store = await createOpfsMediaStore(makeFakeRoot());
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });

    const stored = await store.save(file);

    expect(stored.storageLocation).toBe('opfs');
    expect(stored.filename).toBe('photo.jpg');
    expect(stored.sizeBytes).toBe(3);
  });

  it('round-trips saved bytes through get', async () => {
    const store = await createOpfsMediaStore(makeFakeRoot());
    const file = new File([new Uint8Array([9, 9, 9])], 'clip.mp4', { type: 'video/mp4' });

    const stored = await store.save(file);
    const retrieved = await store.get(stored.id);

    expect(retrieved).not.toBeNull();
    const bytes = new Uint8Array(await retrieved!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([9, 9, 9]);
  });

  it('returns null from get for a missing id', async () => {
    const store = await createOpfsMediaStore(makeFakeRoot());
    expect(await store.get('never-saved')).toBeNull();
  });

  it('reports existence correctly', async () => {
    const store = await createOpfsMediaStore(makeFakeRoot());
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
    const stored = await store.save(file);

    expect(await store.exists(stored.id)).toBe(true);
    expect(await store.exists('never-saved')).toBe(false);
  });

  it('deletes a saved file without throwing on a repeat delete', async () => {
    const store = await createOpfsMediaStore(makeFakeRoot());
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
    const stored = await store.save(file);

    await store.delete(stored.id);
    expect(await store.exists(stored.id)).toBe(false);
    await expect(store.delete(stored.id)).resolves.toBeUndefined();
  });

  it('replace overwrites the blob at an existing id, keeping the same id', async () => {
    const store = await createOpfsMediaStore(makeFakeRoot());
    const original = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
    const stored = await store.save(original);

    const replacement = new File([new Uint8Array([9, 9])], 'b.png', { type: 'image/png' });
    const result = await store.replace(stored.id, replacement);

    expect(result.id).toBe(stored.id);
    expect(result.filename).toBe('b.png');
    expect(result.sizeBytes).toBe(2);

    const retrieved = await store.get(stored.id);
    expect(retrieved).not.toBeNull();
    const bytes = new Uint8Array(await retrieved!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([9, 9]);
    expect(await store.exists(stored.id)).toBe(true);
  });
});
