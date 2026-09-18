# Phase 6d: Media Relinking — Design Spec

Date: 2026-09-18
Status: Approved for implementation planning

## Context

Local Fly-In Studio's full product scope is defined in:

- `../../../Local Fly-In Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up)
- `../../../Claude Code Build Prompt — Local Fly-In Studio v3.0.md`

Phases 1-6c are complete and merged: data model/persistence, the timeline
engine, media ingestion, the Cesium viewer + Quick Create flow, the Studio
desktop editor (bulk-edit, project templates), and the Output Compositor +
Export pipeline (all 4 export variants).

This spec covers PRD §43 ("Media Relinking"): a project's browser-stored
media (IndexedDB or OPFS, depending on what the browser supports) can
become unreachable — cleared site data, a different browser profile, an
imported project JSON with no accompanying media blobs (PRD §45). When
that happens today, `PreviewStage.tsx` silently skips the missing layer
(blank frame, no indication to the user) and `exportRunner.ts` fails the
entire export with a listed error. Neither gives the user a way to *fix*
the project. PRD §43's requirement: "Do not fail the whole project because
one clip is missing" — Studio needs to detect a missing asset, tell the
user plainly, and let them supply a replacement file without disturbing
anything else in the project.

**Investigation finding:** `MediaAsset.id` (what `StorefrontScene.assetId`
and `InteriorTourItem.assetId` reference) and `MediaAsset.storageKey`
(what the underlying store is keyed by) are always equal today, in both
`indexedDbStore.ts` and `opfsStore.ts`. A relinked file can therefore
overwrite the blob at the *existing* id — no scene or item ever needs to
change which asset id it points at.

## Goal

1. When a project is opened in Studio, detect which of its media assets
   are no longer resolvable in the browser's storage.
2. Show a clear "is missing" message with a relink control on any
   inspector (Storefront / Interior Photo / Interior Video) for an item
   whose asset is missing, and a lightweight visual marker on that item's
   timeline block/button — without blocking editing of anything else in
   the project.
3. Let the user pick a replacement file; save it under the same asset id
   (no scene reference changes needed); non-blockingly note when the
   replacement's filename/size/type/duration differ from what was
   expected.

Scope decisions, made during brainstorming:

- **Detection runs once, when the project is opened in Studio** — not
  continuously, not re-triggered on every edit. Matches the PRD's own
  acceptance script ("Reload app → Reopen project → Verify media persists
  or is clearly marked for relinking").
- **The filename/size/type/duration comparison is non-blocking.** A
  mismatch is shown as an informational, transient note — never rejected.
  A real-world relink often involves a re-exported or re-compressed file
  that legitimately differs from the original while still being correct.
- **The relink control lives inline in each inspector** (matching the
  PRD's own example UI, `Interior video is missing. [ RELINK FILE ]`),
  not a separate consolidated "Missing Media" panel. A small marker on
  the corresponding timeline block/button covers discoverability without
  the cost of building and maintaining a second, parallel UI surface.
- **Overwrite in place (Approach A), not save-new-and-rewire (Approach
  B).** `MediaAssetStore` gains a `replace(id, file)` method that writes
  the new blob under the existing id. Only the `MediaAsset` record's
  filename/mimeType/sizeBytes/(width/height/durationMs for video) change;
  every scene/item reference to that id remains valid untouched.
- **`exportRunner.ts` is unmodified.** It still hard-fails if an export is
  attempted while an asset is genuinely still missing — correct, since a
  real export cannot proceed without every clip. Relinking is meant to
  happen in Studio *before* exporting, not to change what export does
  with an unresolved gap.

Out of scope: a consolidated "Missing Media" management panel; persisting
comparison-mismatch history on the `MediaAsset` record; continuous/live
re-scanning after the initial on-open check; relinking Map waypoints
(waypoints never reference media).

## `src/media/checkMissingMediaAssets.ts` (new)

```ts
export async function checkMissingMediaAssets(
  project: Project,
  mediaAssetStore: MediaAssetStore,
): Promise<Set<string>>
```

For each `MediaAsset` in `project.mediaAssets`, calls
`mediaAssetStore.exists(asset.storageKey)`. Returns the set of
`MediaAsset.id` values (not `storageKey` — `id` is what
`StorefrontScene.assetId`/`InteriorTourItem.assetId` actually reference)
whose asset does not exist. An empty `mediaAssets` array or an all-present
project returns an empty set.

## `src/media/MediaAssetStore.ts` (modified) + `indexedDbStore.ts` /
## `opfsStore.ts` (modified)

`MediaAssetStore` gains one new method, alongside the existing
`save`/`get`/`delete`/`exists`:

```ts
replace(id: string, file: File): Promise<StoredMediaAsset>
```

Same shape and return value as `save()`, but writes to the caller-supplied
`id` instead of minting a fresh `crypto.randomUUID()`:

- `indexedDbStore.ts`: `db.put('mediaAssets', { id, blob: file, filename:
  file.name, mimeType: file.type, sizeBytes: file.size })` — `id` is the
  object store's `keyPath`, so this overwrites the existing record in
  place.
- `opfsStore.ts`: `dir.getFileHandle(id, { create: true })` (same call
  `save()` already makes, just with the given `id` instead of a freshly
  minted one) then write and close, identical to `save()`'s body
  otherwise.

## `src/media/relinkMediaAsset.ts` (new)

```ts
export interface MediaRelinkComparison {
  filenameMatches: boolean;
  sizeMatches: boolean;
  typeMatches: boolean;    // replacement File.type vs the original MediaAsset.mimeType
  durationMatches: boolean; // always true for image assets; for video assets, compares
                             // the replacement's newly-extracted duration vs the original's
}

export interface RelinkResult {
  updatedAsset: MediaAsset; // same id; filename/mimeType/sizeBytes updated, plus
                             // width/height/durationMs for a video asset
  comparison: MediaRelinkComparison;
}

export interface RelinkMediaAssetDependencies {
  mediaAssetStore: MediaAssetStore;
  isHeic: typeof isHeic;
  convertHeicToJpeg: typeof convertHeicToJpeg;
  extractVideoMetadata: typeof extractVideoMetadata;
}

export async function relinkMediaAsset(
  originalAsset: MediaAsset,
  file: File,
  deps: RelinkMediaAssetDependencies,
): Promise<RelinkResult>
```

Branches on `originalAsset.kind`:

- **`'image'`**: if `deps.isHeic(file)`, convert to JPEG first (same
  `heicToJpegFile` pattern `createDraft.ts` already uses — replace the
  filename's extension, wrap the converted blob back into a `File` with
  `image/jpeg` type) before proceeding. Calls
  `deps.mediaAssetStore.replace(originalAsset.id, finalFile)`. The
  updated `MediaAsset` carries the new `filename`/`mimeType`/`sizeBytes`
  from the store's return value; `durationMatches` is always `true`
  (nothing to compare — image assets never carry a `durationMs`).
- **`'video'`**: calls `deps.extractVideoMetadata(file)` first to get the
  replacement's `width`/`height`/`durationMs`, then
  `deps.mediaAssetStore.replace(originalAsset.id, file)`. The updated
  `MediaAsset` carries the new `filename`/`mimeType`/`sizeBytes` from the
  store plus the freshly-extracted `width`/`height`/`durationMs`.
  `durationMatches` compares the newly-extracted `durationMs` against
  `originalAsset.durationMs` (exact equality — this is purely
  informational, not a gate, so no tolerance window is needed).

In both branches: `filenameMatches` is `file.name ===
originalAsset.filename`; `sizeMatches` is `file.size ===
originalAsset.sizeBytes`; `typeMatches` is `file.type ===
originalAsset.mimeType` (comparing the replacement's actual container
type against the original's recorded `mimeType` — this is the PRD's
"expected type" check; a file of the wrong *kind* — a video picked for a
photo slot — is prevented structurally by each inspector's file-input
`accept` filter, not by this function). `captureTime`/`gps` are dropped
(`undefined`) on the returned `updatedAsset` — they are not load-bearing
for rendering, compilation, or export anywhere in the codebase, and
re-extracting them from the replacement file is out of scope.

## `src/components/studio/StudioView.tsx` (modified)

Gains:

- `missingAssetIds: Set<string>` state, populated by a mount effect that
  gets/creates a `MediaAssetStore` (same `createMediaAssetStore()`-in-a-
  ref pattern already used by `PreviewStage.tsx`/`ExportPanel.tsx`) and
  calls `checkMissingMediaAssets(project, mediaAssetStore)` once.
- `handleRelink(assetId: string, file: File)`: looks up the current
  `MediaAsset` by `assetId` in `project.mediaAssets`, calls
  `relinkMediaAsset(originalAsset, file, deps)`, then `updateProject` to
  replace that entry in `project.mediaAssets` with `result.updatedAsset`
  (matched by `id`, all other entries untouched), then removes `assetId`
  from `missingAssetIds`. Returns `result.comparison` so the calling
  inspector can render its transient note.

`missingAssetIds` and `handleRelink` are threaded into `renderInspector()`
(passed to whichever of `StorefrontInspector`/`InteriorPhotoInspector`/
`InteriorVideoInspector` is active, as `isMissing`/`onRelink` — see below)
and `missingAssetIds` is passed into `TimelineStrip`.

## `src/components/inspectors/StorefrontInspector.tsx`,
## `InteriorPhotoInspector.tsx`, `InteriorVideoInspector.tsx` (modified)

Each gains two props:

```ts
isMissing: boolean;
onRelink: (file: File) => void;
```

When `isMissing` is `true`, the inspector renders a message ("Storefront
image is missing." / "Interior photo is missing." / "Interior video is
missing.") plus a single `<input type="file">` — `accept="image/*"` for
`StorefrontInspector`/`InteriorPhotoInspector`, `accept="video/*"` for
`InteriorVideoInspector` — **instead of** its normal editing controls
(duration/motion/transform/transition fields are meaningless for an asset
that doesn't exist to preview). Picking a file calls `onRelink(file)`
immediately — no separate confirm step, per the non-blocking decision.
After `onRelink` resolves (the promise chain lives in `StudioView`, but
each inspector receives the resulting `MediaRelinkComparison` back — via
`onRelink` returning `Promise<MediaRelinkComparison>` rather than `void`),
the inspector shows a brief transient note in local component state (e.g.
"Relinked. Note: size differs from the original.") only when at least one
comparison field is `false`; this note is never persisted, and clears on
the next render once the inspector's `isMissing` prop goes back to
`false` (which happens on the same render, since `StudioView` has already
removed the id from `missingAssetIds` before the promise resolves back
into the inspector — the note therefore renders briefly alongside the
inspector's *normal* controls, not in place of them, since by the time it
has something to show, `isMissing` is already `false`).

## `src/components/timeline/InteriorItemBlocks.tsx`,
## `TimelineStrip.tsx` (modified)

`InteriorItemBlocks` gains a `missingAssetIds: Set<string>` prop, passed
through to `SortableItemBlock`, which adds a `timeline-block--missing`
CSS class (small red-tinted left border, consistent with this project's
existing minimal CSS conventions) and a `⚠` prefix on its "Photo"/"Video"
label when `missingAssetIds.has(item.assetId)`.

`TimelineStrip`'s Storefront section button gets the same treatment
(`timeline-block--missing`-equivalent class + `⚠` prefix on its label)
when `missingAssetIds.has(storefrontScene.assetId)`. `WaypointBlocks`/the
Map section are untouched — waypoints never reference media.

## Testing

- **`checkMissingMediaAssets`**: Vitest, pure — a fake `MediaAssetStore`
  whose `exists()` is driven by a test-supplied set of present ids; cases
  for zero missing, some missing, all missing, and an empty
  `mediaAssets` array.
- **`relinkMediaAsset`**: Vitest with injected fakes (mirroring
  `createDraft.test.ts`'s dependency-injection pattern) — a non-HEIC
  image relink, a HEIC image relink (asserts `convertHeicToJpeg` was
  called before `mediaAssetStore.replace`), a video relink (asserts
  `extractVideoMetadata` was called and its result populates the updated
  asset's `width`/`height`/`durationMs`), and one case per comparison
  field independently mismatching (filename, size, type, and — for a
  video asset — duration), confirming the other three fields still
  report `true` in each case.
- **`MediaAssetStore.replace`**: new cases added to the existing
  `indexedDbStore.test.ts` and `opfsStore.test.ts` suites — `replace(id,
  file)` overwrites the blob at that id; a subsequent `get(id)` returns
  the new content; `exists(id)` still reports `true`; the id itself is
  unchanged (still the one passed in, not a freshly minted one).
- **`StudioView`/inspectors/timeline markers**: no jsdom in this
  project's Vitest environment (established since Phase 1) — not unit
  tested. Verified via `npx tsc -b` plus a real-browser Playwright pass:
  create a project with an interior photo, delete that photo's
  underlying blob directly from IndexedDB via `browser_evaluate`, reopen
  the project in Studio, confirm the "is missing" message + relink
  control + timeline marker (⚠ prefix) all appear on exactly that item
  and nothing else in the project is disturbed, relink it with a
  different image file, confirm the message/marker both clear
  immediately and a mismatch note appears (the replacement will
  legitimately differ in filename/size from the deleted original).

## Acceptance Criteria

- All new pure-logic/store Vitest suites pass, alongside every existing
  test unmodified.
- `npm run build` succeeds; no new runtime dependency was added.
- A project with no missing assets shows zero relink UI anywhere and
  behaves identically to today (no behavior change on the happy path).
- A project with one or more missing assets shows the message, relink
  control, and timeline marker only for the affected item(s), without
  blocking editing of anything else in the project (other inspectors,
  timeline reordering, save, etc. all continue to work normally).
- Relinking preserves the asset's `id` — no scene or item ever needs its
  `assetId` changed — and clears the missing indication (inspector
  message, timeline marker) immediately in both places.
- A replacement whose filename/size/type/duration differ from the
  original still succeeds (non-blocking) and surfaces a transient,
  non-persisted note about the mismatch.

## Out of Scope

Changes to `exportRunner.ts` (still hard-fails on a still-missing asset —
correct, since export cannot proceed without every clip); a consolidated
"Missing Media" management panel; persisting comparison-mismatch history
on the `MediaAsset` record; continuous/live re-scanning after the initial
on-open check; relinking Map waypoints (no media reference to relink).
