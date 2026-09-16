import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface LocalFlyInStudioDB extends DBSchema {
  projects: { key: string; value: Record<string, unknown> };
  mediaAssets: { key: string; value: Record<string, unknown> };
}

const DB_NAME = 'local-fly-in-studio';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LocalFlyInStudioDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<LocalFlyInStudioDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LocalFlyInStudioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('mediaAssets')) {
          db.createObjectStore('mediaAssets', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}
