export interface StoredMediaAsset {
  id: string;
  storageLocation: 'opfs' | 'indexeddb';
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
  filename: string;
}

export interface MediaAssetStore {
  save(file: File): Promise<StoredMediaAsset>;
  get(id: string): Promise<Blob | File | null>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
}
