# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a tested, buildable Local Fly-In Studio skeleton — Vite/React/TS scaffold, a Zod-validated project data model, and a fully functional local persistence layer (OPFS/IndexedDB media storage + IndexedDB project repository) — with zero UI/Cesium.

**Architecture:** Pure, dependency-injected modules under `src/models`, `src/persistence`, and `src/media`, each independently unit-tested with Vitest (using `fake-indexeddb` for IndexedDB and an in-memory fake directory handle for OPFS). A thin Zustand store wraps the repository. A blank React shell proves the build pipeline works end to end.

**Tech Stack:** React, TypeScript (strict), Vite, Vitest, Zod, Zustand, `idb`, `fake-indexeddb` (dev/test only).

**Spec:** `docs/superpowers/specs/2026-09-16-phase-1-foundation-design.md`

## Global Constraints

- TypeScript strict mode (`strict: true`); no `any`.
- npm is the package manager.
- `Project.schemaVersion` starts at `1` (exported as `CURRENT_SCHEMA_VERSION`).
- No Cesium, no rendering, no timeline compiler/evaluator, no EXIF/media-ingestion logic, no geocoding in this phase — models and storage only.
- Media bytes are never placed in `localStorage` or embedded as Base64 in project JSON/IndexedDB project records — only via `MediaAssetStore` (OPFS or IndexedDB blob store), referenced by `MediaAsset.storageKey`.
- Zod validates at load/import boundaries only (project load from IndexedDB, migration output) — not on every in-memory access.
- Target Node 20+ (for global `File` and `crypto.randomUUID`).

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.gitignore`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/tests/smoke.test.ts`

**Interfaces:**
- Consumes: none (first task)
- Produces: npm scripts `dev`, `build`, `test`, `lint`; a Vite+React+TS project that builds and has Vitest wired up.

- [ ] **Step 1: Initialize package.json and install dependencies**

```bash
npm init -y
npm pkg set name="local-fly-in-studio" private=true type="module"
npm install react react-dom zod zustand idb
npm install -D typescript vite @vitejs/plugin-react vitest @types/react @types/react-dom @types/node eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh prettier fake-indexeddb
```

- [ ] **Step 2: Add npm scripts**

Edit `package.json` to add:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "lint": "eslint ."
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Write tsconfig.node.json**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Write vite.config.ts with Vitest config**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 6: Write eslint.config.js**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  }
);
```

- [ ] **Step 7: Write .prettierrc**

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 100
}
```

- [ ] **Step 8: Write .gitignore additions**

```
node_modules
dist
*.local
```

- [ ] **Step 9: Write index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Local Fly-In Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Write src/App.tsx**

```tsx
export function App() {
  return <div>Local Fly-In Studio</div>;
}
```

- [ ] **Step 11: Write src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 12: Write a smoke test to verify Vitest wiring**

`src/tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest wiring', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 13: Run tests, verify pass**

Run: `npm run test`
Expected: 1 test file, 1 test passed.

- [ ] **Step 14: Run production build, verify success**

Run: `npm run build`
Expected: succeeds, `dist/` created with no TypeScript errors.

- [ ] **Step 15: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts eslint.config.js .prettierrc .gitignore index.html src/main.tsx src/App.tsx src/tests/smoke.test.ts
git commit -m "chore: scaffold Vite/React/TS project with Vitest"
```

---

### Task 2: Data Model (Zod Schemas)

**Files:**
- Create: `src/models/media.ts`
- Create: `src/models/scenes.ts`
- Create: `src/models/project.ts`
- Create: `src/tests/fixtures.ts`
- Test: `src/tests/models.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `MediaAssetSchema`/`MediaAsset` (media.ts); `WaypointSchema`/`Waypoint`, `CameraStateSchema`/`CameraState`, `RelativeCameraStateSchema`/`RelativeCameraState`, `EasingPresetSchema`/`EasingPreset`, `TransitionSchema`/`Transition`, `TransitionTypeSchema`/`TransitionType`, `VisualTransformSchema`/`VisualTransform`, `MapSceneSchema`/`MapScene`, `StorefrontSceneSchema`/`StorefrontScene`, `StorefrontMotionPresetSchema`/`StorefrontMotionPreset`, `PhotoMotionPresetSchema`/`PhotoMotionPreset`, `InteriorPhotoItemSchema`/`InteriorPhotoItem`, `InteriorVideoItemSchema`/`InteriorVideoItem`, `FitModeSchema`/`FitMode`, `InteriorTourItemSchema`/`InteriorTourItem`, `InteriorTourSceneSchema`/`InteriorTourScene`, `ProjectSceneSchema`/`ProjectScene` (scenes.ts); `CURRENT_SCHEMA_VERSION`, `DestinationSourceSchema`/`DestinationSource`, `DestinationSchema`/`Destination`, `AspectRatioSchema`/`AspectRatio`, `VideoSettingsSchema`/`VideoSettings`, `ProjectSchema`/`Project` (project.ts); `makeMinimalProject(overrides?: Partial<Project>): Project` (fixtures.ts).

- [ ] **Step 1: Write the failing model test**

`src/tests/models.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ProjectSchema } from '../models/project';
import { makeMinimalProject } from './fixtures';

describe('ProjectSchema', () => {
  it('accepts a valid minimal project', () => {
    const project = makeMinimalProject();
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
  });

  it('rejects a project missing required fields', () => {
    const project = makeMinimalProject();
    // @ts-expect-error intentionally invalid for the test
    delete project.destination;
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(false);
  });

  it('rejects a scene with an unknown discriminant', () => {
    const project = makeMinimalProject();
    project.scenes = [{ ...project.scenes[0], type: 'not-a-real-type' } as never];
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(false);
  });

  it('rejects an interior tour item with an unknown discriminant', () => {
    const project = makeMinimalProject();
    const tourScene = project.scenes.find((s) => s.type === 'interior-tour');
    if (tourScene && tourScene.type === 'interior-tour') {
      tourScene.items = [{ ...tourScene.items[0], type: 'audio' } as never];
    }
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(false);
  });
});
```

Note: `fixtures.ts` does not exist yet, so this step is written together with Step 2 below (fixtures and schemas are the implementation this test drives).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- models.test.ts`
Expected: FAIL — cannot resolve `../models/project` or `./fixtures`.

- [ ] **Step 3: Implement src/models/media.ts**

```ts
import { z } from 'zod';

export const MediaKindSchema = z.enum(['image', 'video']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const StorageLocationSchema = z.enum(['opfs', 'indexeddb', 'session']);
export type StorageLocation = z.infer<typeof StorageLocationSchema>;

export const MediaGpsSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const MediaAssetSchema = z.object({
  id: z.string(),
  kind: MediaKindSchema,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationMs: z.number().optional(),
  captureTime: z.string().optional(),
  gps: MediaGpsSchema.optional(),
  storageLocation: StorageLocationSchema,
  storageKey: z.string(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
```

- [ ] **Step 4: Implement src/models/scenes.ts**

```ts
import { z } from 'zod';

export const CameraStateSchema = z.object({
  longitude: z.number(),
  latitude: z.number(),
  height: z.number(),
  heading: z.number(),
  pitch: z.number(),
  roll: z.number(),
});
export type CameraState = z.infer<typeof CameraStateSchema>;

export const RelativeCameraStateSchema = z.object({
  headingDeg: z.number(),
  pitchDeg: z.number(),
  distanceMeters: z.number(),
  heightMeters: z.number(),
});
export type RelativeCameraState = z.infer<typeof RelativeCameraStateSchema>;

export const EasingPresetSchema = z.enum([
  'cinematic',
  'smooth',
  'linear',
  'accelerate',
  'decelerate',
]);
export type EasingPreset = z.infer<typeof EasingPresetSchema>;

const WaypointBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  travelDurationMs: z.number().nonnegative(),
  holdDurationMs: z.number().nonnegative(),
  travelDurationLocked: z.boolean(),
  holdDurationLocked: z.boolean(),
  easing: EasingPresetSchema,
});

export const AbsoluteWaypointSchema = WaypointBaseSchema.extend({
  type: z.literal('absolute'),
  camera: CameraStateSchema,
});

export const DestinationRelativeWaypointSchema = WaypointBaseSchema.extend({
  type: z.literal('destination-relative'),
  relativeCamera: RelativeCameraStateSchema,
});

export const WaypointSchema = z.discriminatedUnion('type', [
  AbsoluteWaypointSchema,
  DestinationRelativeWaypointSchema,
]);
export type Waypoint = z.infer<typeof WaypointSchema>;

export const TransitionTypeSchema = z.enum(['cut', 'crossfade', 'fade-black']);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

export const TransitionSchema = z.object({
  type: TransitionTypeSchema,
  durationMs: z.number().nonnegative(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const VisualTransformSchema = z.object({
  centerX: z.number(),
  centerY: z.number(),
  scale: z.number(),
  rotation: z.number().optional(),
});
export type VisualTransform = z.infer<typeof VisualTransformSchema>;

export const MapSceneSchema = z.object({
  id: z.string(),
  type: z.literal('map'),
  waypoints: z.array(WaypointSchema),
});
export type MapScene = z.infer<typeof MapSceneSchema>;

export const StorefrontMotionPresetSchema = z.enum([
  'none',
  'push-in',
  'pull-out',
  'pan-left',
  'pan-right',
  'custom',
]);
export type StorefrontMotionPreset = z.infer<typeof StorefrontMotionPresetSchema>;

export const StorefrontSceneSchema = z.object({
  id: z.string(),
  type: z.literal('storefront'),
  assetId: z.string(),
  durationMs: z.number().nonnegative(),
  durationLocked: z.boolean(),
  startTransform: VisualTransformSchema,
  endTransform: VisualTransformSchema,
  entranceTarget: z.object({ x: z.number(), y: z.number() }).optional(),
  motionPreset: StorefrontMotionPresetSchema,
  transitionIn: TransitionSchema,
  transitionOut: TransitionSchema,
});
export type StorefrontScene = z.infer<typeof StorefrontSceneSchema>;

export const PhotoMotionPresetSchema = z.enum([
  'push-in',
  'pull-out',
  'pan-left-right',
  'pan-right-left',
]);
export type PhotoMotionPreset = z.infer<typeof PhotoMotionPresetSchema>;

export const InteriorPhotoItemSchema = z.object({
  id: z.string(),
  type: z.literal('photo'),
  assetId: z.string(),
  durationMs: z.number().nonnegative(),
  durationLocked: z.boolean(),
  startTransform: VisualTransformSchema,
  endTransform: VisualTransformSchema,
  motionPreset: PhotoMotionPresetSchema,
  transitionToNext: TransitionSchema,
});
export type InteriorPhotoItem = z.infer<typeof InteriorPhotoItemSchema>;

export const FitModeSchema = z.enum(['cover', 'contain']);
export type FitMode = z.infer<typeof FitModeSchema>;

export const InteriorVideoItemSchema = z.object({
  id: z.string(),
  type: z.literal('video'),
  assetId: z.string(),
  trimStartMs: z.number().nonnegative(),
  trimEndMs: z.number().nonnegative(),
  playbackRate: z.number().positive(),
  audioEnabled: z.boolean(),
  fitMode: FitModeSchema,
  transitionToNext: TransitionSchema,
});
export type InteriorVideoItem = z.infer<typeof InteriorVideoItemSchema>;

export const InteriorTourItemSchema = z.discriminatedUnion('type', [
  InteriorPhotoItemSchema,
  InteriorVideoItemSchema,
]);
export type InteriorTourItem = z.infer<typeof InteriorTourItemSchema>;

export const InteriorTourSceneSchema = z.object({
  id: z.string(),
  type: z.literal('interior-tour'),
  items: z.array(InteriorTourItemSchema),
  defaultPhotoDurationMs: z.number().nonnegative(),
  defaultTransition: TransitionSchema,
});
export type InteriorTourScene = z.infer<typeof InteriorTourSceneSchema>;

export const ProjectSceneSchema = z.discriminatedUnion('type', [
  MapSceneSchema,
  StorefrontSceneSchema,
  InteriorTourSceneSchema,
]);
export type ProjectScene = z.infer<typeof ProjectSceneSchema>;
```

- [ ] **Step 5: Implement src/models/project.ts**

```ts
import { z } from 'zod';
import { MediaAssetSchema } from './media';
import { ProjectSceneSchema } from './scenes';

export const CURRENT_SCHEMA_VERSION = 1;

export const DestinationSourceSchema = z.enum([
  'photo-gps',
  'device-location',
  'address',
  'manual',
]);
export type DestinationSource = z.infer<typeof DestinationSourceSchema>;

export const DestinationSchema = z.object({
  source: DestinationSourceSchema,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  businessName: z.string().optional(),
  originalAddress: z.string().optional(),
  matchedAddress: z.string().optional(),
});
export type Destination = z.infer<typeof DestinationSchema>;

export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1']);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

export const VideoSettingsSchema = z.object({
  aspectRatio: AspectRatioSchema,
  widthPx: z.number().positive(),
  heightPx: z.number().positive(),
  fps: z.union([z.literal(30), z.literal(60)]),
});
export type VideoSettings = z.infer<typeof VideoSettingsSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.string(),
  projectName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  destination: DestinationSchema,
  scenes: z.array(ProjectSceneSchema),
  mediaAssets: z.array(MediaAssetSchema),
  videoSettings: VideoSettingsSchema,
  templateId: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
```

- [ ] **Step 6: Implement src/tests/fixtures.ts**

```ts
import type { Project } from '../models/project';
import { CURRENT_SCHEMA_VERSION } from '../models/project';

export function makeMinimalProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: 'test-project-1',
    projectName: 'Test Project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    destination: {
      source: 'manual',
      latitude: 0,
      longitude: 0,
    },
    scenes: [
      {
        id: 'map-1',
        type: 'map',
        waypoints: [],
      },
      {
        id: 'storefront-1',
        type: 'storefront',
        assetId: 'asset-storefront',
        durationMs: 2500,
        durationLocked: false,
        startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
        endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
        motionPreset: 'push-in',
        transitionIn: { type: 'crossfade', durationMs: 600 },
        transitionOut: { type: 'crossfade', durationMs: 600 },
      },
      {
        id: 'interior-1',
        type: 'interior-tour',
        items: [
          {
            id: 'photo-1',
            type: 'photo',
            assetId: 'asset-photo-1',
            durationMs: 4000,
            durationLocked: false,
            startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
            endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.08 },
            motionPreset: 'push-in',
            transitionToNext: { type: 'crossfade', durationMs: 500 },
          },
        ],
        defaultPhotoDurationMs: 4000,
        defaultTransition: { type: 'crossfade', durationMs: 500 },
      },
    ],
    mediaAssets: [],
    videoSettings: {
      aspectRatio: '16:9',
      widthPx: 1920,
      heightPx: 1080,
      fps: 30,
    },
    ...overrides,
  };
}
```

- [ ] **Step 7: Run tests, verify pass**

Run: `npm run test -- models.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 8: Commit**

```bash
git add src/models/media.ts src/models/scenes.ts src/models/project.ts src/tests/fixtures.ts src/tests/models.test.ts
git commit -m "feat: add Zod project data model and test fixtures"
```

---

### Task 3: Schema Migration Registry

**Files:**
- Create: `src/persistence/migrations.ts`
- Test: `src/tests/migrations.test.ts`

**Interfaces:**
- Consumes: `CURRENT_SCHEMA_VERSION` from `src/models/project.ts`.
- Produces: `type Migration = { fromVersion: number; toVersion: number; migrate: (data: Record<string, unknown>) => Record<string, unknown> }`; `registerMigration(migration: Migration): void`; `migrateProjectData(data: Record<string, unknown>): Record<string, unknown>`; `resetMigrationsForTesting(): void`.

- [ ] **Step 1: Write the failing test**

`src/tests/migrations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerMigration,
  migrateProjectData,
  resetMigrationsForTesting,
} from '../persistence/migrations';

describe('migrateProjectData', () => {
  beforeEach(() => {
    resetMigrationsForTesting();
  });

  it('passes through data already at the current version', () => {
    const data = { schemaVersion: 1, projectName: 'Already Current' };
    expect(migrateProjectData(data)).toEqual(data);
  });

  it('applies a registered migration to bring data up to the current version', () => {
    registerMigration({
      fromVersion: 0,
      toVersion: 1,
      migrate: (data) => ({ ...data, schemaVersion: 1, videoSettings: { aspectRatio: '16:9' } }),
    });
    const legacy = { projectName: 'Legacy Project' };
    const migrated = migrateProjectData(legacy);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.videoSettings).toEqual({ aspectRatio: '16:9' });
  });

  it('throws a clear error when no migration path exists', () => {
    const legacy = { schemaVersion: 0, projectName: 'Stuck' };
    expect(() => migrateProjectData(legacy)).toThrow(/no migration/i);
  });

  it('throws a clear error when data claims a newer version than supported', () => {
    const future = { schemaVersion: 99, projectName: 'From the future' };
    expect(() => migrateProjectData(future)).toThrow(/newer schema version/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- migrations.test.ts`
Expected: FAIL — cannot resolve `../persistence/migrations`.

- [ ] **Step 3: Implement src/persistence/migrations.ts**

```ts
import { CURRENT_SCHEMA_VERSION } from '../models/project';

export interface Migration {
  fromVersion: number;
  toVersion: number;
  migrate: (data: Record<string, unknown>) => Record<string, unknown>;
}

let migrations: Migration[] = [];

export function registerMigration(migration: Migration): void {
  migrations.push(migration);
}

export function resetMigrationsForTesting(): void {
  migrations = [];
}

function readVersion(data: Record<string, unknown>): number {
  return typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
}

export function migrateProjectData(data: Record<string, unknown>): Record<string, unknown> {
  let current = data;
  let currentVersion = readVersion(current);

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project was created with a newer schema version (${currentVersion}) than this app supports (${CURRENT_SCHEMA_VERSION}).`
    );
  }

  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.find((m) => m.fromVersion === currentVersion);
    if (!migration) {
      throw new Error(`No migration found from schema version ${currentVersion}.`);
    }
    current = migration.migrate(current);
    currentVersion = migration.toVersion;
  }

  return current;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- migrations.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/migrations.ts src/tests/migrations.test.ts
git commit -m "feat: add project schema migration registry"
```

---

### Task 4: IndexedDB Setup and Project Repository

**Files:**
- Create: `src/persistence/db.ts`
- Create: `src/persistence/projectRepository.ts`
- Test: `src/tests/projectRepository.test.ts`

**Interfaces:**
- Consumes: `ProjectSchema`/`Project` from `src/models/project.ts`; `migrateProjectData` from `src/persistence/migrations.ts`; `makeMinimalProject` from `src/tests/fixtures.ts`.
- Produces: `getDb(): Promise<IDBPDatabase<LocalFlyInStudioDB>>` (db.ts); `saveProject(project: Project): Promise<void>`, `loadProject(id: string): Promise<Project | null>`, `listProjects(): Promise<Project[]>`, `deleteProject(id: string): Promise<void>` (projectRepository.ts).

- [ ] **Step 1: Write the failing test**

`src/tests/projectRepository.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { getDb } from '../persistence/db';
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
} from '../persistence/projectRepository';
import { makeMinimalProject } from './fixtures';

afterEach(async () => {
  const db = await getDb();
  await db.clear('projects');
});

describe('projectRepository', () => {
  it('saves and loads a project by id', async () => {
    const project = makeMinimalProject({ id: 'proj-a' });
    await saveProject(project);
    const loaded = await loadProject('proj-a');
    expect(loaded).toEqual(project);
  });

  it('returns null for a missing project', async () => {
    const loaded = await loadProject('does-not-exist');
    expect(loaded).toBeNull();
  });

  it('lists all saved projects', async () => {
    await saveProject(makeMinimalProject({ id: 'proj-b' }));
    await saveProject(makeMinimalProject({ id: 'proj-c' }));
    const all = await listProjects();
    const ids = all.map((p) => p.id).sort();
    expect(ids).toEqual(['proj-b', 'proj-c']);
  });

  it('deletes a project', async () => {
    await saveProject(makeMinimalProject({ id: 'proj-d' }));
    await deleteProject('proj-d');
    const loaded = await loadProject('proj-d');
    expect(loaded).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- projectRepository.test.ts`
Expected: FAIL — cannot resolve `../persistence/db` / `../persistence/projectRepository`.

- [ ] **Step 3: Implement src/persistence/db.ts**

```ts
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
```

- [ ] **Step 4: Implement src/persistence/projectRepository.ts**

```ts
import { getDb } from './db';
import { ProjectSchema, type Project } from '../models/project';
import { migrateProjectData } from './migrations';

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.put('projects', project as unknown as Record<string, unknown>);
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const raw = await db.get('projects', id);
  if (!raw) return null;
  const migrated = migrateProjectData(raw);
  return ProjectSchema.parse(migrated);
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const all = await db.getAll('projects');
  return all.map((raw) => ProjectSchema.parse(migrateProjectData(raw)));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('projects', id);
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm run test -- projectRepository.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/db.ts src/persistence/projectRepository.ts src/tests/projectRepository.test.ts
git commit -m "feat: add IndexedDB project repository"
```

---

### Task 5: Media Store Interface and Storage Capabilities

**Files:**
- Create: `src/media/MediaAssetStore.ts`
- Create: `src/media/storageCapabilities.ts`
- Test: `src/tests/storageCapabilities.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `interface StoredMediaAsset { id: string; storageLocation: 'opfs' | 'indexeddb'; storageKey: string; sizeBytes: number; mimeType: string; filename: string }`; `interface MediaAssetStore { save(file: File): Promise<StoredMediaAsset>; get(id: string): Promise<Blob | File | null>; delete(id: string): Promise<void>; exists(id: string): Promise<boolean> }` (MediaAssetStore.ts); `interface StorageCapabilities { opfsSupported: boolean }`, `detectStorageCapabilities(): Promise<StorageCapabilities>`, `interface QuotaCheckResult { sufficient: boolean; quotaBytes: number | null; usageBytes: number | null; availableBytes: number | null }`, `checkQuota(estimatedBytes: number): Promise<QuotaCheckResult>` (storageCapabilities.ts).

- [ ] **Step 1: Write the failing test**

`src/tests/storageCapabilities.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectStorageCapabilities, checkQuota } from '../media/storageCapabilities';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectStorageCapabilities', () => {
  it('reports OPFS supported when navigator.storage.getDirectory exists', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({}) } });
    const caps = await detectStorageCapabilities();
    expect(caps.opfsSupported).toBe(true);
  });

  it('reports OPFS unsupported when navigator.storage.getDirectory is missing', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    const caps = await detectStorageCapabilities();
    expect(caps.opfsSupported).toBe(false);
  });

  it('reports OPFS unsupported when navigator is undefined', async () => {
    vi.stubGlobal('navigator', undefined);
    const caps = await detectStorageCapabilities();
    expect(caps.opfsSupported).toBe(false);
  });
});

describe('checkQuota', () => {
  it('reports sufficient when available space exceeds the estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 1_000_000, usage: 100_000 }) },
    });
    const result = await checkQuota(500_000);
    expect(result.sufficient).toBe(true);
    expect(result.availableBytes).toBe(900_000);
  });

  it('reports insufficient when available space is below the estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 1_000_000, usage: 900_000 }) },
    });
    const result = await checkQuota(500_000);
    expect(result.sufficient).toBe(false);
  });

  it('falls back to sufficient=true when storage.estimate is unavailable', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    const result = await checkQuota(500_000);
    expect(result.sufficient).toBe(true);
    expect(result.quotaBytes).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- storageCapabilities.test.ts`
Expected: FAIL — cannot resolve `../media/storageCapabilities`.

- [ ] **Step 3: Implement src/media/MediaAssetStore.ts**

```ts
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
```

- [ ] **Step 4: Implement src/media/storageCapabilities.ts**

```ts
export interface StorageCapabilities {
  opfsSupported: boolean;
}

export async function detectStorageCapabilities(): Promise<StorageCapabilities> {
  const opfsSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function';
  return { opfsSupported };
}

export interface QuotaCheckResult {
  sufficient: boolean;
  quotaBytes: number | null;
  usageBytes: number | null;
  availableBytes: number | null;
}

export async function checkQuota(estimatedBytes: number): Promise<QuotaCheckResult> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.storage === 'undefined' ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return { sufficient: true, quotaBytes: null, usageBytes: null, availableBytes: null };
  }

  const { quota, usage } = await navigator.storage.estimate();
  if (quota === undefined || usage === undefined) {
    return { sufficient: true, quotaBytes: null, usageBytes: null, availableBytes: null };
  }

  const availableBytes = quota - usage;
  return {
    sufficient: availableBytes >= estimatedBytes,
    quotaBytes: quota,
    usageBytes: usage,
    availableBytes,
  };
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm run test -- storageCapabilities.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/media/MediaAssetStore.ts src/media/storageCapabilities.ts src/tests/storageCapabilities.test.ts
git commit -m "feat: add MediaAssetStore interface and storage capability detection"
```

---

### Task 6: IndexedDB Media Store Backend

**Files:**
- Create: `src/media/indexedDbStore.ts`
- Test: `src/tests/indexedDbStore.test.ts`

**Interfaces:**
- Consumes: `getDb` from `src/persistence/db.ts`; `MediaAssetStore`/`StoredMediaAsset` from `src/media/MediaAssetStore.ts`.
- Produces: `createIndexedDbMediaStore(): MediaAssetStore`.

- [ ] **Step 1: Write the failing test**

`src/tests/indexedDbStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- indexedDbStore.test.ts`
Expected: FAIL — cannot resolve `../media/indexedDbStore`.

- [ ] **Step 3: Implement src/media/indexedDbStore.ts**

```ts
import { getDb } from '../persistence/db';
import type { MediaAssetStore, StoredMediaAsset } from './MediaAssetStore';

interface StoredMediaRecord {
  id: string;
  blob: Blob;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

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
      await db.put('mediaAssets', record as unknown as Record<string, unknown>);
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
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- indexedDbStore.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/media/indexedDbStore.ts src/tests/indexedDbStore.test.ts
git commit -m "feat: add IndexedDB media store backend"
```

---

### Task 7: OPFS Media Store Backend

**Files:**
- Create: `src/media/opfsStore.ts`
- Test: `src/tests/opfsStore.test.ts`

**Interfaces:**
- Consumes: `MediaAssetStore`/`StoredMediaAsset` from `src/media/MediaAssetStore.ts`.
- Produces: `createOpfsMediaStore(root?: FileSystemDirectoryHandle): Promise<MediaAssetStore>`.

- [ ] **Step 1: Write the failing test**

`src/tests/opfsStore.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- opfsStore.test.ts`
Expected: FAIL — cannot resolve `../media/opfsStore`.

- [ ] **Step 3: Implement src/media/opfsStore.ts**

```ts
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
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- opfsStore.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/media/opfsStore.ts src/tests/opfsStore.test.ts
git commit -m "feat: add OPFS media store backend"
```

---

### Task 8: Media Store Factory

**Files:**
- Create: `src/media/createMediaAssetStore.ts`
- Test: `src/tests/createMediaAssetStore.test.ts`

**Interfaces:**
- Consumes: `detectStorageCapabilities` from `src/media/storageCapabilities.ts`; `createOpfsMediaStore` from `src/media/opfsStore.ts`; `createIndexedDbMediaStore` from `src/media/indexedDbStore.ts`; `MediaAssetStore` from `src/media/MediaAssetStore.ts`.
- Produces: `createMediaAssetStore(): Promise<MediaAssetStore>`.

- [ ] **Step 1: Write the failing test**

`src/tests/createMediaAssetStore.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as capabilities from '../media/storageCapabilities';
import * as opfs from '../media/opfsStore';
import * as indexedDb from '../media/indexedDbStore';
import { createMediaAssetStore } from '../media/createMediaAssetStore';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMediaAssetStore', () => {
  it('uses the OPFS backend when OPFS is supported', async () => {
    const sentinel = { save: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn() };
    vi.spyOn(capabilities, 'detectStorageCapabilities').mockResolvedValue({
      opfsSupported: true,
    });
    const opfsSpy = vi.spyOn(opfs, 'createOpfsMediaStore').mockResolvedValue(sentinel);
    const indexedDbSpy = vi.spyOn(indexedDb, 'createIndexedDbMediaStore');

    const store = await createMediaAssetStore();

    expect(store).toBe(sentinel);
    expect(opfsSpy).toHaveBeenCalled();
    expect(indexedDbSpy).not.toHaveBeenCalled();
  });

  it('uses the IndexedDB backend when OPFS is unsupported', async () => {
    const sentinel = { save: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn() };
    vi.spyOn(capabilities, 'detectStorageCapabilities').mockResolvedValue({
      opfsSupported: false,
    });
    const opfsSpy = vi.spyOn(opfs, 'createOpfsMediaStore');
    const indexedDbSpy = vi.spyOn(indexedDb, 'createIndexedDbMediaStore').mockReturnValue(sentinel);

    const store = await createMediaAssetStore();

    expect(store).toBe(sentinel);
    expect(indexedDbSpy).toHaveBeenCalled();
    expect(opfsSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- createMediaAssetStore.test.ts`
Expected: FAIL — cannot resolve `../media/createMediaAssetStore`.

- [ ] **Step 3: Implement src/media/createMediaAssetStore.ts**

```ts
import { detectStorageCapabilities } from './storageCapabilities';
import { createOpfsMediaStore } from './opfsStore';
import { createIndexedDbMediaStore } from './indexedDbStore';
import type { MediaAssetStore } from './MediaAssetStore';

export async function createMediaAssetStore(): Promise<MediaAssetStore> {
  const { opfsSupported } = await detectStorageCapabilities();
  if (opfsSupported) {
    return createOpfsMediaStore();
  }
  return createIndexedDbMediaStore();
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- createMediaAssetStore.test.ts`
Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/media/createMediaAssetStore.ts src/tests/createMediaAssetStore.test.ts
git commit -m "feat: add media store factory with OPFS/IndexedDB capability selection"
```

---

### Task 9: Zustand Project Store with Last-Open-Project Tracking

**Files:**
- Create: `src/store/lastOpenProject.ts`
- Create: `src/store/projectStore.ts`
- Test: `src/tests/lastOpenProject.test.ts`
- Test: `src/tests/projectStore.test.ts`

**Interfaces:**
- Consumes: `Project` from `src/models/project.ts`; `saveProject`, `loadProject` from `src/persistence/projectRepository.ts`; `makeMinimalProject` from `src/tests/fixtures.ts`.
- Produces: `getLastOpenProjectId(): string | null`, `setLastOpenProjectId(id: string): void` (lastOpenProject.ts); `useProjectStore` Zustand hook with state `{ currentProject: Project | null }` and actions `createProject(project: Project): Promise<void>`, `loadProject(id: string): Promise<void>`, `saveProject(): Promise<void>` (projectStore.ts). `createProject`/`loadProject` call `setLastOpenProjectId` as a side effect.

- [ ] **Step 1: Write the failing test for lastOpenProject**

`src/tests/lastOpenProject.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getLastOpenProjectId, setLastOpenProjectId } from '../store/lastOpenProject';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lastOpenProject', () => {
  it('returns null when nothing has been set', () => {
    expect(getLastOpenProjectId()).toBeNull();
  });

  it('stores and retrieves the last open project id', () => {
    setLastOpenProjectId('proj-xyz');
    expect(getLastOpenProjectId()).toBe('proj-xyz');
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => setLastOpenProjectId('proj-xyz')).not.toThrow();
    expect(getLastOpenProjectId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lastOpenProject.test.ts`
Expected: FAIL — cannot resolve `../store/lastOpenProject`.

- [ ] **Step 3: Implement src/store/lastOpenProject.ts**

```ts
const LAST_OPEN_PROJECT_KEY = 'local-fly-in-studio:last-open-project-id';

export function getLastOpenProjectId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LAST_OPEN_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setLastOpenProjectId(id: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LAST_OPEN_PROJECT_KEY, id);
  } catch {
    // Ignore storage failures (private browsing, quota, etc.) — this is a convenience only.
  }
}
```

- [ ] **Step 4: Run lastOpenProject tests, verify pass**

Run: `npm run test -- lastOpenProject.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/lastOpenProject.ts src/tests/lastOpenProject.test.ts
git commit -m "feat: add last-open-project localStorage helper"
```

- [ ] **Step 6: Write the failing test for projectStore**

`src/tests/projectStore.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../persistence/db';
import { useProjectStore } from '../store/projectStore';
import { getLastOpenProjectId } from '../store/lastOpenProject';
import { makeMinimalProject } from './fixtures';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(async () => {
  const db = await getDb();
  await db.clear('projects');
  useProjectStore.setState({ currentProject: null });
  vi.unstubAllGlobals();
});

describe('projectStore', () => {
  it('creates a project, persists it, sets it as current, and records it as last-open', async () => {
    const project = makeMinimalProject({ id: 'store-proj-1' });

    await useProjectStore.getState().createProject(project);

    expect(useProjectStore.getState().currentProject).toEqual(project);
    expect(getLastOpenProjectId()).toBe('store-proj-1');
  });

  it('loads a previously saved project by id and records it as last-open', async () => {
    const project = makeMinimalProject({ id: 'store-proj-2' });
    await useProjectStore.getState().createProject(project);
    useProjectStore.setState({ currentProject: null });

    await useProjectStore.getState().loadProject('store-proj-2');

    expect(useProjectStore.getState().currentProject).toEqual(project);
    expect(getLastOpenProjectId()).toBe('store-proj-2');
  });

  it('saves changes to the current project', async () => {
    const project = makeMinimalProject({ id: 'store-proj-3' });
    await useProjectStore.getState().createProject(project);

    const renamed = { ...project, projectName: 'Renamed' };
    useProjectStore.setState({ currentProject: renamed });
    await useProjectStore.getState().saveProject();

    useProjectStore.setState({ currentProject: null });
    await useProjectStore.getState().loadProject('store-proj-3');
    expect(useProjectStore.getState().currentProject?.projectName).toBe('Renamed');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm run test -- projectStore.test.ts`
Expected: FAIL — cannot resolve `../store/projectStore`.

- [ ] **Step 8: Implement src/store/projectStore.ts**

```ts
import { create } from 'zustand';
import type { Project } from '../models/project';
import {
  saveProject as persistProject,
  loadProject as fetchProject,
} from '../persistence/projectRepository';
import { setLastOpenProjectId } from './lastOpenProject';

interface ProjectStoreState {
  currentProject: Project | null;
  createProject: (project: Project) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  saveProject: () => Promise<void>;
}

export const useProjectStore = create<ProjectStoreState>()((set, get) => ({
  currentProject: null,

  async createProject(project: Project) {
    await persistProject(project);
    set({ currentProject: project });
    setLastOpenProjectId(project.id);
  },

  async loadProject(id: string) {
    const project = await fetchProject(id);
    set({ currentProject: project });
    if (project) {
      setLastOpenProjectId(project.id);
    }
  },

  async saveProject() {
    const { currentProject } = get();
    if (!currentProject) return;
    await persistProject(currentProject);
  },
}));
```

- [ ] **Step 9: Run tests, verify pass**

Run: `npm run test -- projectStore.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 10: Commit**

```bash
git add src/store/projectStore.ts src/tests/projectStore.test.ts
git commit -m "feat: add Zustand project store with last-open-project tracking"
```

---

### Task 10: Wire the Blank App Shell and Verify Full Build

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: nothing new (this task only verifies the assembled app).
- Produces: nothing new — verification task.

- [ ] **Step 1: Update src/App.tsx to render a recognizable root marker**

```tsx
export function App() {
  return (
    <div id="app-shell">
      <h1>Local Fly-In Studio</h1>
      <p>Foundation phase — data model and storage are wired up.</p>
    </div>
  );
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: all test files pass (smoke, models, migrations, projectRepository, storageCapabilities, indexedDbStore, opfsStore, createMediaAssetStore, lastOpenProject, projectStore).

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors, `dist/` produced.

- [ ] **Step 4: Verify the dev server boots and serves the app shell**

```bash
npm run dev -- --port 5174 --strictPort &
DEV_PID=$!
sleep 3
curl -sf http://localhost:5174/ | grep -q '<div id="root">'
RESULT=$?
kill $DEV_PID
exit $RESULT
```

Expected: exit code 0 — the dev server served `index.html` containing the root div.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: no errors (warnings acceptable).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire blank app shell and verify Phase 1 build/test pipeline"
```

---

## Phase 1 Completion Check

Phase 1 is done when all of the following hold:

- `npm run test` passes with all 10 test files green (smoke, models, migrations, projectRepository, storageCapabilities, indexedDbStore, opfsStore, createMediaAssetStore, lastOpenProject, projectStore).
- `npm run build` succeeds.
- `npm run dev` serves the blank app shell.
- Every commit from Tasks 1–10 is present in git history on `main` (or a feature branch, per user preference at execution time).

This satisfies the Phase 1 spec's acceptance criteria in full, and unblocks Phase 2 (Timeline engine core), which will consume `Project`, `Waypoint`, `EasingPreset`, and `Transition` from the models built here.
