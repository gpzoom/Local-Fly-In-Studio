# Phase 1: Foundation — Design Spec

Date: 2026-09-16
Status: Approved for implementation planning

## Context

Local Fly-In Studio is a new web app (React/TypeScript/Vite/CesiumJS) for
generating cinematic location videos for local businesses, combining a
geographic fly-in, a storefront handoff, and an interior tour into one
deterministic, seekable timeline. Full product scope is defined in:

- `../../../Local-Fly-In-Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up — see parent directory)
- `../../../Claude Code Build Prompt — Local-Fly-In-Studio v3.0.md`

The project is too large for a single spec/plan/implementation cycle. It has
been decomposed into six phases:

1. **Foundation** (this spec) — scaffold, data model, persistence. No UI, no Cesium.
2. Timeline engine core — compiler, evaluator, easing, camera interpolation, scaling.
3. Media ingestion + destination resolution — EXIF/GPS, HEIC, Census geocoder.
4. Cesium map + Quick Create/Studio UI + playback.
5. Compositor + export (canvas capture, MediaRecorder, audio).
6. Templates, bulk edit, relinking, polish, README.

Each phase gets its own spec → plan → implementation cycle. This document
covers Phase 1 only.

## Goal

A working, tested, buildable skeleton: project scaffold, typed data model,
and a fully functional local persistence layer (project metadata +
media assets). Nothing renders yet. Success is proven by automated tests,
not visual inspection.

## Tech Setup

- Vite + React + TypeScript (`strict: true`) + Vitest
- npm as package manager
- ESLint + Prettier, minimal non-opinionated config
- Scaffolded into the existing repo root (already git-initialized, `main`
  branch, tracking `origin/main`)

## Folder Structure (Phase 1 subset)

```
src/
  models/
    project.ts       Project, Destination, VideoSettings
    scenes.ts         MapScene, StorefrontScene, InteriorTourScene, Waypoint,
                       CameraState, InteriorTourItem (Photo/Video), Transition,
                       VisualTransform
    media.ts          MediaAsset, MediaAssetReference
    timeline.ts        placeholder types only (real logic is Phase 2)
  store/
    projectStore.ts   Zustand store: createProject/loadProject/saveProject/
                       currentProject
  media/
    MediaAssetStore.ts  interface: save/get/delete/exists
    opfsStore.ts         OPFS-backed implementation
    indexedDbStore.ts    IndexedDB-backed fallback implementation
  persistence/
    projectRepository.ts  project metadata CRUD (IndexedDB via idb)
    migrations.ts          schemaVersion migration registry
  tests/
```

## Data Model

Zod schemas + inferred TypeScript types, matching the shapes defined in the
PRD/build prompt sections 40 ("Media Asset Model") and the "PROJECT MODEL" /
"DESTINATION MODEL" / scene-type sections of the build prompt:

- `Project` — `schemaVersion` (starts at `1`), `id`, `projectName`,
  `createdAt`/`updatedAt`, `destination`, `scenes[]`, `mediaAssets[]`,
  `videoSettings`, optional `templateId`
- `Destination` — `source` discriminated union
  (`photo-gps`/`device-location`/`address`/`manual`), lat/lng, optional
  business name/address fields
- `ProjectScene` — discriminated union of `MapScene` (with `Waypoint[]`),
  `StorefrontScene`, `InteriorTourScene` (with `InteriorTourItem[]`)
- `Waypoint` / `CameraState` — per build prompt "WAYPOINT MODEL" / "CAMERA
  STATE"
- `InteriorTourItem` — discriminated union of `InteriorPhotoItem` /
  `InteriorVideoItem`
- `Transition`, `VisualTransform` — shared value types
- `MediaAsset` — per PRD section 40, with `storageLocation` discriminated
  union (`opfs`/`indexeddb`/`session`)

All models are validated with Zod at load/import boundaries only (project
load, project import, media-store read of stored JSON) — not re-validated
on every in-memory access.

## Persistence Layer

**MediaAssetStore** — common interface:

```ts
interface MediaAssetStore {
  save(file: File): Promise<StoredMediaAsset>;
  get(id: string): Promise<Blob | File | null>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
}
```

Two real backends, chosen once at startup via capability detection:

- `opfsStore.ts` — uses `navigator.storage.getDirectory()`; the preferred
  backend for actual media bytes.
- `indexedDbStore.ts` — fallback when OPFS is unavailable, stores blobs
  directly in IndexedDB.

A `navigator.storage.estimate()` wrapper provides quota info before large
saves (actual "warn the user" UI is a later phase — Phase 1 just exposes
the capability and a testable quota-check function).

**projectRepository.ts** — project metadata/structure (not media bytes)
persisted to IndexedDB via `idb`, keyed by project id. CRUD: save, load,
list, delete.

**migrations.ts** — a migration registry keyed by `schemaVersion`. At
Phase 1 there is only v1 (no real migrations needed yet), but the
mechanism itself is exercised by a test using a synthetic v0→v1 migration
to prove the registry/runner works before it's needed for real.

**localStorage** — only last-open-project-id and trivial UI prefs. No
media, no project structure.

## Zustand Store

`projectStore.ts` is a thin wrapper over `projectRepository`:
`createProject()`, `loadProject(id)`, `saveProject()`, `currentProject`
state. No scene-editing actions in this phase — those arrive with the UI
in Phase 4.

## Testing (Vitest)

- Zod schema validation: valid project round-trips, invalid project
  (missing fields, wrong discriminant) rejected with useful errors
- Migration registry: synthetic v0→v1 migration runs correctly; unknown
  future version fails clearly
- `opfsStore` round-trip: save → get → exists → delete, in an environment
  where OPFS is available (Vitest browser-mode or a mock/polyfill —
  resolved during implementation if OPFS isn't testable under Node)
- `indexedDbStore` round-trip: same, using `fake-indexeddb` or equivalent
  test double
- Quota-check helper: returns a clear "likely insufficient" signal given a
  mocked low-quota `navigator.storage.estimate()`
- `projectRepository`: save/load/list/delete round-trip

## Out of Scope for Phase 1

Cesium, any rendering, the timeline compiler/evaluator, EXIF/media
ingestion logic, HEIC handling, geocoding, and any UI beyond a blank App
shell sufficient to prove the Vite build runs.

## Acceptance Criteria

- `npm run dev` boots a blank app with no console errors
- `npm run test` passes (all Phase 1 tests above)
- `npm run build` succeeds (production build)
- A manual check (script or test) proves an asset can be saved to OPFS (or
  the IndexedDB fallback, if OPFS is unavailable in the dev environment)
  and read back correctly
