# Phase 6d: Media Relinking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when a project's media asset is unreachable in browser storage, show a clear "is missing" message with an inline relink control (plus a timeline marker) in Studio, and let the user supply a replacement file that overwrites the same asset id without disturbing anything else in the project.

**Architecture:** A new `MediaAssetStore.replace(id, file)` method overwrites a blob in place. A pure `checkMissingMediaAssets` function scans a project's assets against the store once, on Studio open. A pure-ish `relinkMediaAsset` function (dependency-injected, mirroring `createDraft.ts`'s pattern) performs the actual relink and produces a non-blocking filename/size/type/duration comparison. `StudioView` wires both into a `missingAssetIds` state set and a `handleRelink` callback, threaded into the three media-referencing inspectors and the timeline blocks.

**Tech Stack:** TypeScript, Zod, React, `idb` / OPFS (existing `MediaAssetStore` abstraction), Vitest (`environment: 'node'`, no jsdom).

**Spec:** `docs/superpowers/specs/2026-09-18-phase-6d-media-relinking-design.md`

## Global Constraints

- Missing-asset detection runs exactly once, when a project is opened in Studio — never continuously, never re-triggered by every edit.
- The filename/size/type/duration comparison shown after a relink is always non-blocking — a mismatch is an informational note, never a rejection.
- The relink control lives inline in each affected inspector (Storefront / Interior Photo / Interior Video) — no separate consolidated "Missing Media" panel this phase.
- Relinking overwrites the existing asset's blob in place via `MediaAssetStore.replace(id, file)`. No `StorefrontScene.assetId`/`InteriorTourItem.assetId` reference ever changes as part of a relink.
- `src/export/exportRunner.ts` is NOT modified this phase — it keeps hard-failing an export attempted while an asset is genuinely still missing.
- No new runtime dependency may be added.
- `captureTime`/`gps` are dropped (`undefined`) on a relinked `MediaAsset` — never re-extracted from the replacement file.
- Cross-kind relinking (e.g. a video file picked for a photo slot) is prevented structurally by each inspector's file-input `accept` attribute, not by `relinkMediaAsset` itself.
- This project's Vitest suite runs with `environment: 'node'` (no jsdom, established since Phase 1) — `StudioView.tsx`, the three inspectors, and the timeline components get no Vitest coverage; verified via `npx tsc -b` plus a real-browser Playwright pass.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/media/MediaAssetStore.ts` (modified) | Interface gains `replace(id, file): Promise<StoredMediaAsset>` |
| `src/media/indexedDbStore.ts` (modified) | Implements `replace` by overwriting the IndexedDB record at the given id |
| `src/media/opfsStore.ts` (modified) | Implements `replace` by overwriting the OPFS file at the given id |
| `src/tests/indexedDbStore.test.ts` / `src/tests/opfsStore.test.ts` (modified) | New `replace` coverage |
| `src/media/checkMissingMediaAssets.ts` (new) | Pure: `Project` + store → `Set<string>` of missing asset ids |
| `src/tests/checkMissingMediaAssets.test.ts` (new) | Coverage for the above |
| `src/media/relinkMediaAsset.ts` (new) | Dependency-injected: original asset + replacement file → updated asset + comparison |
| `src/tests/relinkMediaAsset.test.ts` (new) | Coverage for the above |
| `src/components/studio/StudioView.tsx` (modified) | `missingAssetIds` state (populated once on mount) + `handleRelink`; threads both into inspectors and the timeline |
| `src/components/inspectors/StorefrontInspector.tsx` / `InteriorPhotoInspector.tsx` / `InteriorVideoInspector.tsx` (modified) | `isMissing`/`onRelink` props; render the missing message + file input instead of normal controls when missing |
| `src/components/timeline/InteriorItemBlocks.tsx` / `TimelineStrip.tsx` / `TimelineStrip.css` (modified) | Visual `⚠` marker on any block/button whose asset is missing |

---

### Task 1: `MediaAssetStore.replace`

**Files:**
- Modify: `src/media/MediaAssetStore.ts`
- Modify: `src/media/indexedDbStore.ts`
- Modify: `src/media/opfsStore.ts`
- Test: `src/tests/indexedDbStore.test.ts`
- Test: `src/tests/opfsStore.test.ts`

**Interfaces:**
- Produces: `MediaAssetStore.replace(id: string, file: File): Promise<StoredMediaAsset>` — consumed by Task 3 (`relinkMediaAsset`).

- [ ] **Step 1: Write the failing tests**

Add this test case inside the existing `describe('indexedDbStore', ...)` block in `src/tests/indexedDbStore.test.ts` (after the existing `'deletes a saved file'` test):

```ts
  it('replace overwrites the blob at an existing id, keeping the same id', async () => {
    const store = createIndexedDbMediaStore();
    const original = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
    const stored = await store.save(original);

    const replacement = new File([new Uint8Array([9, 9])], 'b.png', { type: 'image/png' });
    const result = await store.replace(stored.id, replacement);

    expect(result.id).toBe(stored.id);
    expect(result.filename).toBe('b.png');
    expect(result.mimeType).toBe('image/png');
    expect(result.sizeBytes).toBe(2);

    const retrieved = await store.get(stored.id);
    expect(retrieved).not.toBeNull();
    const bytes = new Uint8Array(await retrieved!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([9, 9]);
    expect(await store.exists(stored.id)).toBe(true);
  });
```

Add this test case inside the existing `describe('opfsStore', ...)` block in `src/tests/opfsStore.test.ts` (after the existing `'deletes a saved file...'` test):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/tests/indexedDbStore.test.ts src/tests/opfsStore.test.ts`
Expected: FAIL — `store.replace is not a function`

- [ ] **Step 3: Add `replace` to the interface**

In `src/media/MediaAssetStore.ts`, add one line to the `MediaAssetStore` interface (after `exists`):

```ts
export interface MediaAssetStore {
  save(file: File): Promise<StoredMediaAsset>;
  get(id: string): Promise<Blob | File | null>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  replace(id: string, file: File): Promise<StoredMediaAsset>;
}
```

- [ ] **Step 4: Implement `replace` in `indexedDbStore.ts`**

In `src/media/indexedDbStore.ts`, add a `replace` method to the object returned by `createIndexedDbMediaStore` (after the existing `exists` method):

```ts
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
```

- [ ] **Step 5: Implement `replace` in `opfsStore.ts`**

In `src/media/opfsStore.ts`, add a `replace` method to the object returned by `createOpfsMediaStore` (after the existing `exists` method):

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- src/tests/indexedDbStore.test.ts src/tests/opfsStore.test.ts`
Expected: PASS (5 tests in each file)

- [ ] **Step 7: Run the full suite**

Run: `npm run test`
Expected: PASS, all suites green

- [ ] **Step 8: Commit**

```bash
git add src/media/MediaAssetStore.ts src/media/indexedDbStore.ts src/media/opfsStore.ts src/tests/indexedDbStore.test.ts src/tests/opfsStore.test.ts
git commit -m "feat: add MediaAssetStore.replace for in-place asset relinking"
```

---

### Task 2: `checkMissingMediaAssets`

**Files:**
- Create: `src/media/checkMissingMediaAssets.ts`
- Test: `src/tests/checkMissingMediaAssets.test.ts`

**Interfaces:**
- Consumes: `MediaAssetStore.exists(storageKey): Promise<boolean>` (existing); `Project`/`MediaAsset` types (existing).
- Produces: `checkMissingMediaAssets(project: Project, mediaAssetStore: MediaAssetStore): Promise<Set<string>>` — consumed by Task 4 (`StudioView`).

- [ ] **Step 1: Write the failing test**

Create `src/tests/checkMissingMediaAssets.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/checkMissingMediaAssets.test.ts`
Expected: FAIL — `Cannot find module '../media/checkMissingMediaAssets'`

- [ ] **Step 3: Write the implementation**

Create `src/media/checkMissingMediaAssets.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/checkMissingMediaAssets.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/media/checkMissingMediaAssets.ts src/tests/checkMissingMediaAssets.test.ts
git commit -m "feat: add checkMissingMediaAssets"
```

---

### Task 3: `relinkMediaAsset`

**Files:**
- Create: `src/media/relinkMediaAsset.ts`
- Test: `src/tests/relinkMediaAsset.test.ts`

**Interfaces:**
- Consumes: `MediaAssetStore.replace` (Task 1); `isHeic`/`convertHeicToJpeg` from `src/media/imageDecoder.ts` (existing, unmodified); `extractVideoMetadata` from `src/media/videoMetadata.ts` (existing, unmodified); `createMediaAssetStore` from `src/media/createMediaAssetStore.ts` (existing, unmodified, used only as the default when no override is given — mirrors `createDraft.ts`'s dependency-resolution pattern).
- Produces: `MediaRelinkComparison`, `RelinkResult`, `RelinkMediaAssetDependencies` types; `relinkMediaAsset(originalAsset: MediaAsset, file: File, overrides?: Partial<RelinkMediaAssetDependencies>): Promise<RelinkResult>` — consumed by Task 4 (`StudioView`).

- [ ] **Step 1: Write the failing test**

Create `src/tests/relinkMediaAsset.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { relinkMediaAsset } from '../media/relinkMediaAsset';
import type { MediaAsset } from '../models/media';
import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import type { VideoMetadata } from '../media/videoMetadata';

function makeImageAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1',
    kind: 'image',
    filename: 'original.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    storageLocation: 'indexeddb',
    storageKey: 'asset-1',
    ...overrides,
  };
}

function makeVideoAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-2',
    kind: 'video',
    filename: 'original.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 5000,
    width: 1920,
    height: 1080,
    durationMs: 6000,
    storageLocation: 'indexeddb',
    storageKey: 'asset-2',
    ...overrides,
  };
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

function makeFakeStore(): MediaAssetStore {
  return {
    save: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    replace: vi.fn(
      async (id: string, file: File): Promise<StoredMediaAsset> => ({
        id,
        storageLocation: 'indexeddb',
        storageKey: id,
        sizeBytes: file.size,
        mimeType: file.type,
        filename: file.name,
      }),
    ),
  };
}

describe('relinkMediaAsset', () => {
  it('relinks an image asset, preserving its id and comparing filename/size/type', async () => {
    const original = makeImageAsset();
    const store = makeFakeStore();
    const replacement = makeFile('new.jpg', 'image/jpeg', 1000);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => false),
    });

    expect(store.replace).toHaveBeenCalledWith('asset-1', replacement);
    expect(result.updatedAsset.id).toBe('asset-1');
    expect(result.updatedAsset.filename).toBe('new.jpg');
    expect(result.updatedAsset.mimeType).toBe('image/jpeg');
    expect(result.updatedAsset.sizeBytes).toBe(1000);
    expect(result.comparison).toEqual({
      filenameMatches: false,
      sizeMatches: true,
      typeMatches: true,
      durationMatches: true,
    });
  });

  it('converts a HEIC replacement to JPEG before storing, and compares against the converted file', async () => {
    const original = makeImageAsset({ filename: 'converted.jpg', mimeType: 'image/jpeg' });
    const store = makeFakeStore();
    const heicFile = makeFile('converted.heic', 'image/heic', 2000);
    const convertedBlob = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });

    const result = await relinkMediaAsset(original, heicFile, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => true),
      convertHeicToJpeg: vi.fn(async () => ({ ok: true, blob: convertedBlob })),
    });

    expect(store.replace).toHaveBeenCalledWith(
      'asset-1',
      expect.objectContaining({ name: 'converted.jpg', type: 'image/jpeg' }),
    );
    expect(result.comparison.filenameMatches).toBe(true);
    expect(result.comparison.typeMatches).toBe(true);
    expect(result.comparison.sizeMatches).toBe(true);
  });

  it('relinks a video asset, extracting new metadata and comparing duration', async () => {
    const original = makeVideoAsset();
    const store = makeFakeStore();
    const replacement = makeFile('original.mp4', 'video/mp4', 5000);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      extractVideoMetadata: vi.fn(
        async (): Promise<VideoMetadata> => ({ durationMs: 7000, width: 1280, height: 720 }),
      ),
    });

    expect(store.replace).toHaveBeenCalledWith('asset-2', replacement);
    expect(result.updatedAsset.width).toBe(1280);
    expect(result.updatedAsset.height).toBe(720);
    expect(result.updatedAsset.durationMs).toBe(7000);
    expect(result.comparison).toEqual({
      filenameMatches: true,
      sizeMatches: true,
      typeMatches: true,
      durationMatches: false,
    });
  });

  it('reports sizeMatches: false when the replacement size differs', async () => {
    const original = makeImageAsset();
    const store = makeFakeStore();
    const replacement = makeFile('original.jpg', 'image/jpeg', 9999);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => false),
    });

    expect(result.comparison.sizeMatches).toBe(false);
    expect(result.comparison.filenameMatches).toBe(true);
    expect(result.comparison.typeMatches).toBe(true);
  });

  it('reports typeMatches: false when the replacement mime type differs', async () => {
    const original = makeImageAsset();
    const store = makeFakeStore();
    const replacement = makeFile('original.jpg', 'image/png', 1000);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => false),
    });

    expect(result.comparison.typeMatches).toBe(false);
    expect(result.comparison.filenameMatches).toBe(true);
    expect(result.comparison.sizeMatches).toBe(true);
  });

  it('drops captureTime and gps on the updated asset', async () => {
    const original = makeImageAsset({
      captureTime: '2026-01-01T00:00:00.000Z',
      gps: { latitude: 1, longitude: 2 },
    });
    const store = makeFakeStore();
    const replacement = makeFile('original.jpg', 'image/jpeg', 1000);

    const result = await relinkMediaAsset(original, replacement, {
      mediaAssetStore: store,
      isHeic: vi.fn(() => false),
    });

    expect(result.updatedAsset.captureTime).toBeUndefined();
    expect(result.updatedAsset.gps).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/relinkMediaAsset.test.ts`
Expected: FAIL — `Cannot find module '../media/relinkMediaAsset'`

- [ ] **Step 3: Write the implementation**

Create `src/media/relinkMediaAsset.ts`:

```ts
import type { MediaAsset } from '../models/media';
import type { MediaAssetStore } from './MediaAssetStore';
import { createMediaAssetStore } from './createMediaAssetStore';
import { isHeic, convertHeicToJpeg } from './imageDecoder';
import { extractVideoMetadata } from './videoMetadata';

export interface MediaRelinkComparison {
  filenameMatches: boolean;
  sizeMatches: boolean;
  typeMatches: boolean;
  durationMatches: boolean;
}

export interface RelinkResult {
  updatedAsset: MediaAsset;
  comparison: MediaRelinkComparison;
}

export interface RelinkMediaAssetDependencies {
  mediaAssetStore: MediaAssetStore;
  isHeic: typeof isHeic;
  convertHeicToJpeg: typeof convertHeicToJpeg;
  extractVideoMetadata: typeof extractVideoMetadata;
}

async function heicToJpegFile(
  file: File,
  doConvertHeicToJpeg: RelinkMediaAssetDependencies['convertHeicToJpeg'],
): Promise<File> {
  const result = await doConvertHeicToJpeg(file);
  if (!result.ok) {
    throw new Error(result.error);
  }
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([result.blob], newName, { type: 'image/jpeg' });
}

export async function relinkMediaAsset(
  originalAsset: MediaAsset,
  file: File,
  overrides: Partial<RelinkMediaAssetDependencies> = {},
): Promise<RelinkResult> {
  const deps: RelinkMediaAssetDependencies = {
    mediaAssetStore: overrides.mediaAssetStore ?? (await createMediaAssetStore()),
    isHeic: overrides.isHeic ?? isHeic,
    convertHeicToJpeg: overrides.convertHeicToJpeg ?? convertHeicToJpeg,
    extractVideoMetadata: overrides.extractVideoMetadata ?? extractVideoMetadata,
  };

  if (originalAsset.kind === 'image') {
    // finalFile is what's actually stored, so the comparison must be against it, not the
    // raw picked file — otherwise every HEIC relink of an already-JPEG-converted asset
    // would report a spurious type/filename mismatch even though the stored bytes match.
    const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
    const stored = await deps.mediaAssetStore.replace(originalAsset.id, finalFile);
    const updatedAsset: MediaAsset = {
      ...originalAsset,
      filename: stored.filename,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      captureTime: undefined,
      gps: undefined,
    };
    return {
      updatedAsset,
      comparison: {
        filenameMatches: finalFile.name === originalAsset.filename,
        sizeMatches: finalFile.size === originalAsset.sizeBytes,
        typeMatches: finalFile.type === originalAsset.mimeType,
        durationMatches: true,
      },
    };
  }

  const videoMeta = await deps.extractVideoMetadata(file);
  const stored = await deps.mediaAssetStore.replace(originalAsset.id, file);
  const updatedAsset: MediaAsset = {
    ...originalAsset,
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    width: videoMeta.width,
    height: videoMeta.height,
    durationMs: videoMeta.durationMs,
    captureTime: undefined,
    gps: undefined,
  };
  return {
    updatedAsset,
    comparison: {
      filenameMatches: file.name === originalAsset.filename,
      sizeMatches: file.size === originalAsset.sizeBytes,
      typeMatches: file.type === originalAsset.mimeType,
      durationMatches: videoMeta.durationMs === originalAsset.durationMs,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/relinkMediaAsset.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm run test`
Expected: PASS, all suites green

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/media/relinkMediaAsset.ts src/tests/relinkMediaAsset.test.ts
git commit -m "feat: add relinkMediaAsset"
```

---

### Task 4: Studio wiring — missing detection, relink handler, inspector UI

**Files:**
- Modify: `src/components/studio/StudioView.tsx`
- Modify: `src/components/inspectors/StorefrontInspector.tsx`
- Modify: `src/components/inspectors/InteriorPhotoInspector.tsx`
- Modify: `src/components/inspectors/InteriorVideoInspector.tsx`

**Interfaces:**
- Consumes: `checkMissingMediaAssets` (Task 2); `relinkMediaAsset`, `type MediaRelinkComparison` (Task 3); `createMediaAssetStore`, `type MediaAssetStore` (existing, unmodified).
- Produces: each inspector's new `isMissing: boolean` / `onRelink: (file: File) => Promise<MediaRelinkComparison>` props — consumed by Task 5's `StudioView` edit only insofar as `missingAssetIds` (state added here) is reused there; the inspector prop shapes themselves are not touched again.

No automated test for this task — React components, no jsdom (Global Constraints). Verified via `npx tsc -b` and the Task 6 real-browser pass.

- [ ] **Step 1: Rewrite `StudioView.tsx`**

Replace the full contents of `src/components/studio/StudioView.tsx` with:

```tsx
// src/components/studio/StudioView.tsx
import { useEffect, useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import './StudioView.css';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { computeDoorTargetTransform } from '../../timeline/waypointEditing';
import type { PlaybackController } from '../../timeline/playbackController';
import { TimelineStrip } from '../timeline/TimelineStrip';
import { PreviewStage } from '../preview/PreviewStage';
import { WaypointInspector } from '../inspectors/WaypointInspector';
import { StorefrontInspector } from '../inspectors/StorefrontInspector';
import { InteriorPhotoInspector } from '../inspectors/InteriorPhotoInspector';
import { InteriorVideoInspector } from '../inspectors/InteriorVideoInspector';
import { ScalingControls } from '../inspectors/ScalingControls';
import { BulkEditControls } from '../inspectors/BulkEditControls';
import { SaveTemplateControls } from './SaveTemplateControls';
import { ExportPanel } from './ExportPanel';
import { createMediaAssetStore } from '../../media/createMediaAssetStore';
import { checkMissingMediaAssets } from '../../media/checkMissingMediaAssets';
import { relinkMediaAsset, type MediaRelinkComparison } from '../../media/relinkMediaAsset';
import type { MediaAssetStore } from '../../media/MediaAssetStore';
import type { Project } from '../../models/project';
import type { EvaluatedLayer } from '../../models/timeline';
import type { InteriorTourScene, StorefrontScene } from '../../models/scenes';

interface StudioViewProps {
  onBack: () => void;
}

export function StudioView({ onBack }: StudioViewProps) {
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateProjectAction = useProjectStore((state) => state.updateProject);
  const saveProjectAction = useProjectStore((state) => state.saveProject);
  const selection = useUiStore((state) => state.selection);

  const viewerRef = useRef<Viewer | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const mediaStoreRef = useRef<MediaAssetStore | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [missingAssetIds, setMissingAssetIds] = useState<Set<string>>(new Set());

  if (!currentProject) return null;
  // Bind a non-null local so nested function declarations below (which are hoisted,
  // so TS can't carry the guard's narrowing of `currentProject` into their bodies)
  // see a definitely-non-null Project.
  const project = currentProject;

  // Latest-project ref so the mount-keyed missing-asset scan below can read the current
  // project without listing the whole (identity-changing-on-every-edit) `project` object
  // as a dependency — the scan is meant to run once per opened project, not on every edit.
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!mediaStoreRef.current) {
        mediaStoreRef.current = await createMediaAssetStore();
      }
      const missing = await checkMissingMediaAssets(projectRef.current, mediaStoreRef.current);
      if (!cancelled) setMissingAssetIds(missing);
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  function updateProject(updater: (project: Project) => Project) {
    updateProjectAction(updater);
    setIsDirty(true);
  }

  async function handleRelink(assetId: string, file: File): Promise<MediaRelinkComparison> {
    const originalAsset = project.mediaAssets.find((a) => a.id === assetId);
    if (!originalAsset) {
      throw new Error(`No media asset found with id ${assetId}`);
    }
    if (!mediaStoreRef.current) {
      mediaStoreRef.current = await createMediaAssetStore();
    }
    const result = await relinkMediaAsset(originalAsset, file, { mediaAssetStore: mediaStoreRef.current });
    updateProject((current) => ({
      ...current,
      mediaAssets: current.mediaAssets.map((a) => (a.id === assetId ? result.updatedAsset : a)),
    }));
    setMissingAssetIds((current) => {
      const next = new Set(current);
      next.delete(assetId);
      return next;
    });
    return result.comparison;
  }

  async function handleSave() {
    setError(null);
    // Stamp the save time so ProjectList's "updated …" column reflects reality.
    updateProject((current) => ({ ...current, updatedAt: new Date().toISOString() }));
    try {
      await saveProjectAction();
      setIsDirty(false);
    } catch (err) {
      // A failed save must never be silent: isDirty stays true and the Back button warns
      // about unsaved changes, but the user needs to know the write itself did not land.
      setError(err instanceof Error ? err.message : 'Could not save the project.');
    }
  }

  function handleBack() {
    if (isDirty && !window.confirm('You have unsaved changes. Discard them and go back?')) return;
    onBack();
  }

  function handleSeek(timeMs: number) {
    controllerRef.current?.seek(timeMs);
  }

  function handleOverlayClick(normalized: { x: number; y: number }, layer: EvaluatedLayer) {
    if (selection?.type !== 'storefront') return;
    const storefrontScene = project.scenes.find(
      (s): s is StorefrontScene => s.type === 'storefront' && s.id === selection.sceneId,
    );
    if (!storefrontScene || layer.sourceId !== storefrontScene.assetId) return;

    const newEndTransform = computeDoorTargetTransform(storefrontScene.endTransform, normalized);
    updateProject((project) => ({
      ...project,
      scenes: project.scenes.map((s) =>
        s.id === storefrontScene.id && s.type === 'storefront' ? { ...s, endTransform: newEndTransform } : s,
      ),
    }));
  }

  function renderInspector() {
    if (!selection) return null;

    if (selection.type === 'waypoint') {
      return (
        <WaypointInspector
          project={project}
          sceneId={selection.sceneId}
          waypointId={selection.waypointId}
          updateProject={updateProject}
          viewerRef={viewerRef}
        />
      );
    }
    if (selection.type === 'storefront') {
      const storefrontScene = project.scenes.find(
        (s): s is StorefrontScene => s.type === 'storefront' && s.id === selection.sceneId,
      );
      if (!storefrontScene) return null;
      return (
        <StorefrontInspector
          project={project}
          sceneId={selection.sceneId}
          updateProject={updateProject}
          isMissing={missingAssetIds.has(storefrontScene.assetId)}
          onRelink={(file) => handleRelink(storefrontScene.assetId, file)}
        />
      );
    }
    if (selection.type === 'interior-item') {
      const interiorScene = project.scenes.find(
        (s): s is InteriorTourScene => s.type === 'interior-tour' && s.id === selection.sceneId,
      );
      const item = interiorScene?.items.find((i) => i.id === selection.itemId);
      if (item?.type === 'photo') {
        return (
          <InteriorPhotoInspector
            project={project}
            sceneId={selection.sceneId}
            itemId={selection.itemId}
            updateProject={updateProject}
            isMissing={missingAssetIds.has(item.assetId)}
            onRelink={(file) => handleRelink(item.assetId, file)}
          />
        );
      }
      if (item?.type === 'video') {
        return (
          <InteriorVideoInspector
            project={project}
            sceneId={selection.sceneId}
            itemId={selection.itemId}
            updateProject={updateProject}
            isMissing={missingAssetIds.has(item.assetId)}
            onRelink={(file) => handleRelink(item.assetId, file)}
          />
        );
      }
    }
    return null;
  }

  return (
    <div className="studio-view">
      <div className="studio-header">
        <button type="button" onClick={handleBack}>
          Back
        </button>
        <h2>{project.projectName}</h2>
        <div className="studio-header-actions">
          <button type="button" disabled={!viewerReady} onClick={() => setExportOpen(true)}>
            Export
          </button>
          <button type="button" disabled={!isDirty} onClick={() => void handleSave()}>
            Save
          </button>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <TimelineStrip project={project} onSeek={handleSeek} updateProject={updateProject} missingAssetIds={missingAssetIds} />

      <PreviewStage
        project={project}
        onOverlayClick={handleOverlayClick}
        onViewerReady={(viewer) => {
          viewerRef.current = viewer;
          setViewerReady(true);
        }}
        onControllerReady={(controller) => {
          controllerRef.current = controller;
        }}
      />

      <div className="studio-inspector">{renderInspector()}</div>

      <ScalingControls project={project} updateProject={updateProject} />

      <BulkEditControls project={project} updateProject={updateProject} />

      <SaveTemplateControls project={project} />

      {exportOpen && viewerRef.current && (
        <ExportPanel project={project} viewer={viewerRef.current} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}
```

Note: this step already includes the `missingAssetIds={missingAssetIds}` prop on `<TimelineStrip>` — `TimelineStrip`'s prop type itself is added in Task 5; until Task 5 lands, `npx tsc -b` will report an excess-property error on this line. That's expected and resolved by Task 5's edit, which happens immediately after this task in the plan's execution order.

- [ ] **Step 2: Rewrite `StorefrontInspector.tsx`**

Replace the full contents of `src/components/inspectors/StorefrontInspector.tsx` with:

```tsx
import { useState } from 'react';
import type { Project } from '../../models/project';
import type { StorefrontMotionPreset, StorefrontScene, TransitionType } from '../../models/scenes';
import type { MediaRelinkComparison } from '../../media/relinkMediaAsset';

const MOTION_PRESETS: StorefrontMotionPreset[] = ['none', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'custom'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface StorefrontInspectorProps {
  project: Project;
  sceneId: string;
  updateProject: (updater: (project: Project) => Project) => void;
  isMissing: boolean;
  onRelink: (file: File) => Promise<MediaRelinkComparison>;
}

function describeMismatches(comparison: MediaRelinkComparison): string | null {
  const mismatches: string[] = [];
  if (!comparison.filenameMatches) mismatches.push('filename');
  if (!comparison.sizeMatches) mismatches.push('size');
  if (!comparison.typeMatches) mismatches.push('type');
  if (!comparison.durationMatches) mismatches.push('duration');
  if (mismatches.length === 0) return null;
  return `Relinked. Note: ${mismatches.join(', ')} differs from the original.`;
}

export function StorefrontInspector({
  project,
  sceneId,
  updateProject,
  isMissing,
  onRelink,
}: StorefrontInspectorProps) {
  const [relinkNote, setRelinkNote] = useState<string | null>(null);
  const scene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront' && s.id === sceneId);
  if (!scene) return null;

  function updateScene(patch: Partial<StorefrontScene>) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => (s.id === sceneId && s.type === 'storefront' ? { ...s, ...patch } : s)),
    }));
  }

  async function handleRelinkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const comparison = await onRelink(file);
    setRelinkNote(describeMismatches(comparison));
  }

  if (isMissing) {
    return (
      <div className="inspector storefront-inspector">
        <h3>Storefront</h3>
        <p role="alert">Storefront image is missing.</p>
        <label>
          Relink file
          <input type="file" accept="image/*" onChange={(e) => void handleRelinkFile(e)} />
        </label>
      </div>
    );
  }

  return (
    <div className="inspector storefront-inspector">
      <h3>Storefront</h3>

      {relinkNote && <p role="status">{relinkNote}</p>}

      <label>
        Duration (ms)
        <input
          type="number"
          min="0"
          value={scene.durationMs}
          onChange={(e) => updateScene({ durationMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={scene.durationLocked}
          onChange={(e) => updateScene({ durationLocked: e.target.checked })}
        />
        Lock duration
      </label>

      <label>
        Motion preset
        <select
          value={scene.motionPreset}
          onChange={(e) => updateScene({ motionPreset: e.target.value as StorefrontMotionPreset })}
        >
          {MOTION_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Transition in</legend>
        <select
          value={scene.transitionIn.type}
          onChange={(e) =>
            updateScene({ transitionIn: { ...scene.transitionIn, type: e.target.value as TransitionType } })
          }
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          value={scene.transitionIn.durationMs}
          onChange={(e) =>
            updateScene({
              transitionIn: { ...scene.transitionIn, durationMs: Math.max(0, Number(e.target.value) || 0) },
            })
          }
        />
      </fieldset>

      <fieldset>
        <legend>Transition out</legend>
        <select
          value={scene.transitionOut.type}
          onChange={(e) =>
            updateScene({ transitionOut: { ...scene.transitionOut, type: e.target.value as TransitionType } })
          }
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          value={scene.transitionOut.durationMs}
          onChange={(e) =>
            updateScene({
              transitionOut: { ...scene.transitionOut, durationMs: Math.max(0, Number(e.target.value) || 0) },
            })
          }
        />
      </fieldset>

      <p className="inspector-hint">Click the storefront image in the preview above to set the door target.</p>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `InteriorPhotoInspector.tsx`**

Replace the full contents of `src/components/inspectors/InteriorPhotoInspector.tsx` with:

```tsx
import { useState } from 'react';
import type { Project } from '../../models/project';
import type { InteriorPhotoItem, InteriorTourScene, PhotoMotionPreset, TransitionType } from '../../models/scenes';
import type { MediaRelinkComparison } from '../../media/relinkMediaAsset';

const PHOTO_MOTION_PRESETS: PhotoMotionPreset[] = ['push-in', 'pull-out', 'pan-left-right', 'pan-right-left'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface InteriorPhotoInspectorProps {
  project: Project;
  sceneId: string;
  itemId: string;
  updateProject: (updater: (project: Project) => Project) => void;
  isMissing: boolean;
  onRelink: (file: File) => Promise<MediaRelinkComparison>;
}

function describeMismatches(comparison: MediaRelinkComparison): string | null {
  const mismatches: string[] = [];
  if (!comparison.filenameMatches) mismatches.push('filename');
  if (!comparison.sizeMatches) mismatches.push('size');
  if (!comparison.typeMatches) mismatches.push('type');
  if (!comparison.durationMatches) mismatches.push('duration');
  if (mismatches.length === 0) return null;
  return `Relinked. Note: ${mismatches.join(', ')} differs from the original.`;
}

export function InteriorPhotoInspector({
  project,
  sceneId,
  itemId,
  updateProject,
  isMissing,
  onRelink,
}: InteriorPhotoInspectorProps) {
  const [relinkNote, setRelinkNote] = useState<string | null>(null);
  const scene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour' && s.id === sceneId);
  const item = scene?.items.find((i): i is InteriorPhotoItem => i.id === itemId && i.type === 'photo');
  if (!scene || !item) return null;

  function updateItem(patch: Partial<InteriorPhotoItem>) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => {
        if (s.id !== sceneId || s.type !== 'interior-tour') return s;
        return {
          ...s,
          items: s.items.map((i) => (i.id === itemId && i.type === 'photo' ? { ...i, ...patch } : i)),
        };
      }),
    }));
  }

  async function handleRelinkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const comparison = await onRelink(file);
    setRelinkNote(describeMismatches(comparison));
  }

  if (isMissing) {
    return (
      <div className="inspector interior-photo-inspector">
        <h3>Interior Photo</h3>
        <p role="alert">Interior photo is missing.</p>
        <label>
          Relink file
          <input type="file" accept="image/*" onChange={(e) => void handleRelinkFile(e)} />
        </label>
      </div>
    );
  }

  return (
    <div className="inspector interior-photo-inspector">
      <h3>Interior Photo</h3>

      {relinkNote && <p role="status">{relinkNote}</p>}

      <label>
        Duration (ms)
        <input
          type="number"
          min="0"
          value={item.durationMs}
          onChange={(e) => updateItem({ durationMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={item.durationLocked}
          onChange={(e) => updateItem({ durationLocked: e.target.checked })}
        />
        Lock duration
      </label>

      <label>
        Motion preset
        <select
          value={item.motionPreset}
          onChange={(e) => updateItem({ motionPreset: e.target.value as PhotoMotionPreset })}
        >
          {PHOTO_MOTION_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Transition to next</legend>
        <select
          value={item.transitionToNext.type}
          onChange={(e) =>
            updateItem({ transitionToNext: { ...item.transitionToNext, type: e.target.value as TransitionType } })
          }
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          value={item.transitionToNext.durationMs}
          onChange={(e) =>
            updateItem({
              transitionToNext: { ...item.transitionToNext, durationMs: Math.max(0, Number(e.target.value) || 0) },
            })
          }
        />
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `InteriorVideoInspector.tsx`**

Replace the full contents of `src/components/inspectors/InteriorVideoInspector.tsx` with:

```tsx
import { useState } from 'react';
import type { Project } from '../../models/project';
import type { FitMode, InteriorTourScene, InteriorVideoItem, TransitionType } from '../../models/scenes';
import type { MediaRelinkComparison } from '../../media/relinkMediaAsset';

const FIT_MODES: FitMode[] = ['cover', 'contain'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface InteriorVideoInspectorProps {
  project: Project;
  sceneId: string;
  itemId: string;
  updateProject: (updater: (project: Project) => Project) => void;
  isMissing: boolean;
  onRelink: (file: File) => Promise<MediaRelinkComparison>;
}

function describeMismatches(comparison: MediaRelinkComparison): string | null {
  const mismatches: string[] = [];
  if (!comparison.filenameMatches) mismatches.push('filename');
  if (!comparison.sizeMatches) mismatches.push('size');
  if (!comparison.typeMatches) mismatches.push('type');
  if (!comparison.durationMatches) mismatches.push('duration');
  if (mismatches.length === 0) return null;
  return `Relinked. Note: ${mismatches.join(', ')} differs from the original.`;
}

export function InteriorVideoInspector({
  project,
  sceneId,
  itemId,
  updateProject,
  isMissing,
  onRelink,
}: InteriorVideoInspectorProps) {
  const [relinkNote, setRelinkNote] = useState<string | null>(null);
  const scene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour' && s.id === sceneId);
  const item = scene?.items.find((i): i is InteriorVideoItem => i.id === itemId && i.type === 'video');
  if (!scene || !item) return null;

  function updateItem(patch: Partial<InteriorVideoItem>) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => {
        if (s.id !== sceneId || s.type !== 'interior-tour') return s;
        return {
          ...s,
          items: s.items.map((i) => (i.id === itemId && i.type === 'video' ? { ...i, ...patch } : i)),
        };
      }),
    }));
  }

  async function handleRelinkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const comparison = await onRelink(file);
    setRelinkNote(describeMismatches(comparison));
  }

  if (isMissing) {
    return (
      <div className="inspector interior-video-inspector">
        <h3>Interior Video</h3>
        <p role="alert">Interior video is missing.</p>
        <label>
          Relink file
          <input type="file" accept="video/*" onChange={(e) => void handleRelinkFile(e)} />
        </label>
      </div>
    );
  }

  return (
    <div className="inspector interior-video-inspector">
      <h3>Interior Video</h3>

      {relinkNote && <p role="status">{relinkNote}</p>}

      <label>
        Trim start (ms)
        <input
          type="number"
          min="0"
          value={item.trimStartMs}
          onChange={(e) => updateItem({ trimStartMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        Trim end (ms)
        <input
          type="number"
          min="0"
          value={item.trimEndMs}
          onChange={(e) => updateItem({ trimEndMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        Playback rate
        <input
          type="number"
          step="0.1"
          min="0.1"
          value={item.playbackRate}
          onChange={(e) => updateItem({ playbackRate: Math.max(0.1, Number(e.target.value) || 0.1) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={item.audioEnabled}
          onChange={(e) => updateItem({ audioEnabled: e.target.checked })}
        />
        Audio enabled
      </label>
      <label>
        Fit mode
        <select value={item.fitMode} onChange={(e) => updateItem({ fitMode: e.target.value as FitMode })}>
          {FIT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Transition to next</legend>
        <select
          value={item.transitionToNext.type}
          onChange={(e) =>
            updateItem({ transitionToNext: { ...item.transitionToNext, type: e.target.value as TransitionType } })
          }
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          value={item.transitionToNext.durationMs}
          onChange={(e) =>
            updateItem({
              transitionToNext: { ...item.transitionToNext, durationMs: Math.max(0, Number(e.target.value) || 0) },
            })
          }
        />
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 5: Commit** (deliberately after Task 5 lands — see Task 5's note)

This task's changes reference `TimelineStrip`'s `missingAssetIds` prop, which does not exist until Task 5. Do not run `npx tsc -b` or commit yet — proceed directly to Task 5, then run the type-check and commit both together as directed there. (If executing via the subagent-driven-development skill's one-task-per-dispatch model, treat Tasks 4 and 5 as a single combined dispatch for this reason — see the note at the top of Task 5.)

---

### Task 5: Timeline missing-media markers

**Files:**
- Modify: `src/components/timeline/InteriorItemBlocks.tsx`
- Modify: `src/components/timeline/TimelineStrip.tsx`
- Modify: `src/components/timeline/TimelineStrip.css`

**Interfaces:**
- Consumes: `missingAssetIds: Set<string>` (state added to `StudioView` in Task 4; already passed into `<TimelineStrip>` by Task 4's rewrite).
- Produces: `TimelineStripProps.missingAssetIds: Set<string>` (satisfies the prop Task 4's `StudioView` already passes); `InteriorItemBlocksProps.missingAssetIds: Set<string>`.

**Note:** Task 4's `StudioView.tsx` rewrite already passes `missingAssetIds={missingAssetIds}` to `<TimelineStrip>`, which does not yet accept that prop — `npx tsc -b` will fail between Task 4 and this task. Dispatch/execute Task 4 and Task 5 back-to-back as one unit (one combined review is fine, since Task 4's diff alone does not type-check standalone); run the full verification (Step 4 below) only after both are applied.

No automated test for this task — React components, no jsdom (Global Constraints). Verified via `npx tsc -b` and the Task 6 real-browser pass.

- [ ] **Step 1: Rewrite `InteriorItemBlocks.tsx`**

Replace the full contents of `src/components/timeline/InteriorItemBlocks.tsx` with:

```tsx
// src/components/timeline/InteriorItemBlocks.tsx
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUiStore } from '../../store/uiStore';
import type { Project } from '../../models/project';
import type { InteriorTourScene, InteriorTourItem } from '../../models/scenes';
import type { CompiledTimeline } from '../../models/timeline';

interface InteriorItemBlocksProps {
  interiorScene: InteriorTourScene;
  timeline: CompiledTimeline;
  updateProject: (updater: (project: Project) => Project) => void;
  onSeek: (timeMs: number) => void;
  missingAssetIds: Set<string>;
}

function itemEffectiveDurationMs(item: InteriorTourItem): number {
  if (item.type === 'photo') return item.durationMs;
  return (item.trimEndMs - item.trimStartMs) / item.playbackRate;
}

function findItemSegmentStartMs(timeline: CompiledTimeline, itemId: string): number | undefined {
  return timeline.segments.find((segment) => segment.itemId === itemId)?.startMs;
}

interface SortableItemBlockProps {
  item: InteriorTourItem;
  widthPercent: number;
  isSelected: boolean;
  isMissing: boolean;
  onClick: () => void;
}

function SortableItemBlock({ item, widthPercent, isSelected, isMissing, onClick }: SortableItemBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });

  const classNames = ['timeline-block'];
  if (isSelected) classNames.push('timeline-block--selected');
  if (isMissing) classNames.push('timeline-block--missing');

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={classNames.join(' ')}
      style={{ width: `${widthPercent}%`, transform: CSS.Transform.toString(transform), transition }}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {isMissing ? '⚠ ' : ''}
      {item.type === 'photo' ? 'Photo' : 'Video'}
    </button>
  );
}

export function InteriorItemBlocks({
  interiorScene,
  timeline,
  updateProject,
  onSeek,
  missingAssetIds,
}: InteriorItemBlocksProps) {
  const select = useUiStore((state) => state.select);
  const selection = useUiStore((state) => state.selection);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const totalMs = interiorScene.items.reduce((sum, item) => sum + itemEffectiveDurationMs(item), 0);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = interiorScene.items.findIndex((item) => item.id === active.id);
    const newIndex = interiorScene.items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(interiorScene.items, oldIndex, newIndex);
    updateProject((project) => ({
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === interiorScene.id ? { ...scene, items: reordered } : scene,
      ),
    }));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={interiorScene.items.map((item) => item.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="interior-item-blocks">
          {interiorScene.items.map((item) => {
            const widthPercent = totalMs > 0 ? (itemEffectiveDurationMs(item) / totalMs) * 100 : 0;
            const isSelected =
              selection?.type === 'interior-item' &&
              selection.sceneId === interiorScene.id &&
              selection.itemId === item.id;

            return (
              <SortableItemBlock
                key={item.id}
                item={item}
                widthPercent={widthPercent}
                isSelected={isSelected}
                isMissing={missingAssetIds.has(item.assetId)}
                onClick={() => {
                  select({ type: 'interior-item', sceneId: interiorScene.id, itemId: item.id });
                  const startMs = findItemSegmentStartMs(timeline, item.id);
                  if (startMs !== undefined) onSeek(startMs);
                }}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 2: Rewrite `TimelineStrip.tsx`**

Replace the full contents of `src/components/timeline/TimelineStrip.tsx` with:

```tsx
import { useMemo } from 'react';
import './TimelineStrip.css';
import { compileProjectTimeline } from '../../timeline/compiler';
import { useUiStore } from '../../store/uiStore';
import { WaypointBlocks } from './WaypointBlocks';
import { InteriorItemBlocks } from './InteriorItemBlocks';
import type { Project } from '../../models/project';
import type { MapScene, StorefrontScene, InteriorTourScene } from '../../models/scenes';

interface TimelineStripProps {
  project: Project;
  onSeek: (timeMs: number) => void;
  updateProject: (updater: (project: Project) => Project) => void;
  missingAssetIds: Set<string>;
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

export function TimelineStrip({ project, onSeek, updateProject, missingAssetIds }: TimelineStripProps) {
  const timeline = useMemo(() => compileProjectTimeline(project), [project]);
  const expandedSection = useUiStore((state) => state.expandedSection);
  const toggleExpanded = useUiStore((state) => state.toggleExpanded);
  const select = useUiStore((state) => state.select);

  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');

  const mapSection = timeline.sections.find((s) => s.type === 'map');
  const storefrontSection = timeline.sections.find((s) => s.type === 'storefront');
  const interiorSection = timeline.sections.find((s) => s.type === 'interior-tour');

  const storefrontMissing = storefrontScene ? missingAssetIds.has(storefrontScene.assetId) : false;

  return (
    <div className="timeline-strip">
      <div className="timeline-sections">
        {mapScene && mapSection && (
          <button
            type="button"
            aria-expanded={expandedSection === 'map'}
            onClick={() => toggleExpanded('map')}
          >
            Map Fly-In ({seconds(mapSection.endMs - mapSection.startMs)}s)
          </button>
        )}
        {storefrontScene && (
          <button
            type="button"
            className={storefrontMissing ? 'timeline-section--missing' : undefined}
            onClick={() => {
              select({ type: 'storefront', sceneId: storefrontScene.id });
              // Move the playhead into the storefront section too, so the storefront image
              // is actually on screen and clickable for setting the door target.
              if (storefrontSection) onSeek(storefrontSection.startMs);
            }}
          >
            {storefrontMissing ? '⚠ ' : ''}
            Storefront ({storefrontSection ? seconds(storefrontSection.endMs - storefrontSection.startMs) : 0}s)
          </button>
        )}
        {interiorScene && interiorSection && (
          <button
            type="button"
            aria-expanded={expandedSection === 'interior-tour'}
            onClick={() => toggleExpanded('interior-tour')}
          >
            Interior Tour ({seconds(interiorSection.endMs - interiorSection.startMs)}s)
          </button>
        )}
      </div>
      {expandedSection === 'map' && mapScene && (
        <WaypointBlocks mapScene={mapScene} timeline={timeline} onSeek={onSeek} />
      )}
      {expandedSection === 'interior-tour' && interiorScene && (
        <InteriorItemBlocks
          interiorScene={interiorScene}
          timeline={timeline}
          updateProject={updateProject}
          onSeek={onSeek}
          missingAssetIds={missingAssetIds}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the missing-marker CSS rule**

In `src/components/timeline/TimelineStrip.css`, add this rule at the end of the file:

```css
.timeline-block--missing,
.timeline-section--missing {
  border-left: 3px solid #d64545;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm run test`
Expected: PASS, all suites green (no new Vitest coverage for these files or Task 4's — no jsdom)

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: no errors (this is the first point at which Task 4 + Task 5's combined changes type-check cleanly — see Task 5's note)

- [ ] **Step 6: Commit** (covers both Task 4 and Task 5's files together, per the note above)

```bash
git add src/components/studio/StudioView.tsx src/components/inspectors/StorefrontInspector.tsx src/components/inspectors/InteriorPhotoInspector.tsx src/components/inspectors/InteriorVideoInspector.tsx src/components/timeline/InteriorItemBlocks.tsx src/components/timeline/TimelineStrip.tsx src/components/timeline/TimelineStrip.css
git commit -m "feat: wire missing-media detection, relink UI, and timeline markers into Studio"
```

---

### Task 6: Real-browser verification

**Files:** none (verification only — no code changes in this task).

This project's Vitest suite runs with `environment: 'node'` (no jsdom), so none of Task 4/5's UI changes have automated coverage (Global Constraints). This task is the required real-browser pass.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)

- [ ] **Step 2: Create a project and delete one interior photo's underlying blob**

In a browser, complete a Quick Create draft with a storefront photo and at least 2 interior photos, so it lands in Studio. Use `browser_evaluate` to open the app's IndexedDB database (`local-fly-in-studio`, `mediaAssets` object store) and delete the record whose id matches one interior photo item's `assetId` (found via the project's data, e.g. by inspecting `useProjectStore.getState().currentProject` if exposed, or by checking `IndexedDB` directly for the `mediaAssets` store's keys and cross-referencing against the visible interior items in order).

- [ ] **Step 3: Confirm the missing state appears everywhere it should, and nowhere else**

Reload the app and reopen the project (matching the "once on open" detection timing). Confirm: the affected interior photo's timeline block shows the `⚠` prefix and the red left-border styling; clicking that block's inspector shows "Interior photo is missing." plus a file input, with none of the normal duration/motion/transition controls visible; the *other* interior photo (not deleted) shows no marker and its inspector opens normally; the Storefront section button shows no marker; Save, Back, and every other Studio control still work normally (nothing else is blocked).

- [ ] **Step 4: Relink it and confirm the state clears**

Pick a different image file as the replacement (different filename and/or size than the deleted original, so a mismatch is expected). Confirm: the inspector immediately switches back to its normal editing controls (no longer showing the missing message), a `role="status"` note appears mentioning at least one mismatched field, and the timeline block's `⚠`/border marker is gone. Reload the app and reopen the project again — confirm the item still shows no missing marker (the relink persisted, and a fresh detection pass on the new open still finds it present).

- [ ] **Step 5: Confirm export still behaves as before for a genuinely still-missing asset**

Using a *separate* project (or the same one with a different item deleted from IndexedDB and left unlinked), attempt an Export. Confirm it still fails with the existing "Could not load N media asset(s) for export" error (from `exportRunner.ts`, unmodified per Global Constraints) rather than silently producing a broken video — this task does not change that behavior, it only gives the user a way to fix the gap in Studio before trying again.

- [ ] **Step 6: Report**

Report PASS/FAIL for each of Steps 3-5 against the spec's Acceptance Criteria. Any FAIL blocks the final whole-branch review from being considered clean — file it as an Important finding instead.

---

## Self-Review Notes

- **Spec coverage:** `MediaAssetStore.replace` → Task 1. `checkMissingMediaAssets` → Task 2. `relinkMediaAsset` (including the HEIC-conversion-before-comparison rationale, and dropping `captureTime`/`gps`) → Task 3. `StudioView`'s `missingAssetIds` state + `handleRelink` + all three inspectors' `isMissing`/`onRelink` UI → Task 4. Timeline `⚠` markers on both interior item blocks and the Storefront button → Task 5. Real-browser verification (including confirming `exportRunner.ts` is genuinely unmodified) → Task 6. All spec sections are covered.
- **Placeholder scan:** no TBD/TODO; every step has real, complete code.
- **Type consistency:** `MediaRelinkComparison`'s four fields (`filenameMatches`, `sizeMatches`, `typeMatches`, `durationMatches`) are identical across Task 3 (`relinkMediaAsset.ts`, where they're produced) and Task 4 (all three inspectors' `describeMismatches` helper, where they're consumed) — verified by re-reading both. `onRelink`'s signature (`(file: File) => Promise<MediaRelinkComparison>`) matches between each inspector's prop type and `StudioView`'s `handleRelink`-binding call sites. `missingAssetIds: Set<string>` is threaded with the same type through `StudioView` → `TimelineStrip` → `InteriorItemBlocks` → `SortableItemBlock`, and through `StudioView` → each inspector's `isMissing` boolean (via `.has(...)`, not the raw set). `MediaAssetStore.replace`'s signature (`(id: string, file: File) => Promise<StoredMediaAsset>`) matches between Task 1's interface, both Task 1 implementations, and Task 3's usage.
- **Cross-task dependency ordering:** Task 4 and Task 5 are interdependent (Task 4's `StudioView.tsx` passes a prop `TimelineStrip` doesn't accept until Task 5) — flagged explicitly in both tasks' text with a combined-dispatch note, rather than left as a silent gap a reviewer or implementer would have to discover by running `tsc` and being confused.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-18-phase-6d-media-relinking.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
