import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { getDb } from '../persistence/db';
import { createIndexedDbMediaStore } from '../media/indexedDbStore';

afterEach(async () => {
  const db = await getDb();
  await db.clear('mediaAssets');
});

describe('indexedDbStore', () => {
  it('saves a file and returns metadata', async () => {
    const store = createIndexedDbMediaStore();
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });

    const stored = await store.save(file);

    expect(stored.storageLocation).toBe('indexeddb');
    expect(stored.filename).toBe('photo.jpg');
    expect(stored.mimeType).toBe('image/jpeg');
    expect(stored.sizeBytes).toBe(3);
  });

  it('round-trips saved bytes through get', async () => {
    const store = createIndexedDbMediaStore();
    const file = new File([new Uint8Array([9, 9, 9])], 'clip.mp4', { type: 'video/mp4' });

    const stored = await store.save(file);
    const retrieved = await store.get(stored.id);

    expect(retrieved).not.toBeNull();
    const bytes = new Uint8Array(await retrieved!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([9, 9, 9]);
  });

  it('reports existence correctly', async () => {
    const store = createIndexedDbMediaStore();
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
    const stored = await store.save(file);

    expect(await store.exists(stored.id)).toBe(true);
    expect(await store.exists('never-saved')).toBe(false);
  });

  it('deletes a saved file', async () => {
    const store = createIndexedDbMediaStore();
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
    const stored = await store.save(file);

    await store.delete(stored.id);

    expect(await store.exists(stored.id)).toBe(false);
    expect(await store.get(stored.id)).toBeNull();
  });
});
