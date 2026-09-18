# Phase 6c: Project Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save a project's map waypoints, storefront styling, and interior-tour defaults as a named, reusable template, and pick a saved (or the built-in) template when starting a new Quick Create draft.

**Architecture:** A new `ProjectTemplate` model (composed from existing `scenes.ts` schemas) and an IndexedDB-backed repository mirroring `projectRepository.ts`'s exact CRUD pattern. A pure `buildTemplateFromProject` function extracts a template from an existing project's scenes. `createDraft.ts` is generalized to build its map/storefront/interior-tour scenes from a resolved `ProjectTemplate` (the built-in one by default, or a caller-supplied one) instead of hardcoded literals — this also fixes `applyDefaultPhotoMotion`'s always-push-in bug by replacing it with Phase 6b's `regeneratePhotoMotion`. Two small UI additions (a "Style" picker in Quick Create, a "Save as Template" control in Studio) wire the new repository and `createDraft` input together.

**Tech Stack:** TypeScript, Zod, React, `idb` (existing IndexedDB wrapper), Vitest (`environment: 'node'`, no jsdom), `fake-indexeddb` for repository tests.

**Spec:** `docs/superpowers/specs/2026-09-17-phase-6c-project-templates-design.md`

## Global Constraints

- No new runtime dependency may be added this phase.
- `DB_VERSION` in `src/persistence/db.ts` must move from `1` to `2` — IndexedDB's `upgrade()` callback only fires when the requested version exceeds the database's stored version, so this bump is what makes the new `templates` store actually get created for installs that already have a version-1 database on disk. This is additive only — no existing data is migrated or touched.
- Templates apply only at Quick Create time, to a brand-new draft. Studio-side re-apply to an already-created project is out of scope.
- No template rename/delete/management UI this phase — only create (`saveProjectTemplate`) and read (`listProjectTemplates`, `getProjectTemplate`).
- No validation or warning is added for templates built from absolute (non-`destination-relative`) waypoints — this is a documented, accepted limitation, not a bug to fix.
- Motion assignment always uses `regeneratePhotoMotion`'s fixed alternating cycle (`push-in` → `pull-out` → `pan-left-right` → `pan-right-left`) — a `ProjectTemplate` does not carry its own motion sequence data.
- Every persistence function must mirror `src/persistence/projectRepository.ts`'s exact pattern: `Schema.parse(...)` before every write (defense in depth); `listX()` uses per-record `Schema.safeParse` with skip-and-`console.warn` on failure, never letting one corrupt record make the whole list unreachable.
- This project's Vitest config runs with `environment: 'node'` (no jsdom, established since Phase 1) — React components are never unit-tested here. `StorefrontStep.tsx`'s new picker and the new `SaveTemplateControls.tsx` are verified via `npx tsc -b` plus a real-browser Playwright pass, not Vitest.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/models/projectTemplate.ts` (new) | `ProjectTemplateSchema`/`ProjectTemplate` type; `BUILTIN_PROJECT_TEMPLATE_ID`; `getBuiltinProjectTemplate()` |
| `src/tests/projectTemplate.test.ts` (new) | Coverage for the above |
| `src/tests/fixtures.ts` (modified) | Adds `makeMinimalProjectTemplate()`, mirroring the existing `makeMinimalProject()` |
| `src/persistence/db.ts` (modified) | Adds the `templates` object store; bumps `DB_VERSION` to `2` |
| `src/persistence/projectTemplateRepository.ts` (new) | `saveProjectTemplate` / `listProjectTemplates` / `getProjectTemplate` |
| `src/tests/projectTemplateRepository.test.ts` (new) | CRUD + corrupt-record-skip coverage |
| `src/timeline/buildTemplateFromProject.ts` (new) | Pure: `Project` → `ProjectTemplate` (or a typed error) |
| `src/tests/buildTemplateFromProject.test.ts` (new) | Coverage for the above |
| `src/quickCreate/createDraft.ts` (modified) | Resolves a `ProjectTemplate` (input or built-in) and builds every scene from it instead of hardcoded literals; replaces `applyDefaultPhotoMotion` with `regeneratePhotoMotion` |
| `src/tests/createDraft.test.ts` (modified) | Updated motion-alternation test; new custom-template, built-in-fallback, and `templateId`-stamping tests |
| `src/components/quick-create/StorefrontStep.tsx` (modified) | Adds the "Style" `<select>`; `onNext` gains a `templateId: string \| null` parameter |
| `src/components/quick-create/QuickCreateWizard.tsx` (modified) | Resolves the actual `ProjectTemplate` object and passes it into `createDraft` |
| `src/components/studio/SaveTemplateControls.tsx` (new) | Name input + "Save as Template" button, styled like `BulkEditControls`/`ScalingControls` |
| `src/components/studio/StudioView.tsx` (modified) | Renders `SaveTemplateControls` |
| `src/components/studio/StudioView.css` (modified) | Adds `.save-template-controls-actions` to the shared actions-row selector |

`src/persistence/templates.ts` (`createMapSceneFromTemplate`) is read but **not modified** — it remains the destination-agnostic waypoint generator that `getBuiltinProjectTemplate()` calls internally.

---

### Task 1: `ProjectTemplate` model and the built-in template

**Files:**
- Create: `src/models/projectTemplate.ts`
- Create: `src/tests/projectTemplate.test.ts`
- Modify: `src/tests/fixtures.ts`

**Interfaces:**
- Consumes: `WaypointSchema`, `VisualTransformSchema`, `StorefrontMotionPresetSchema`, `TransitionSchema` from `src/models/scenes.ts` (all already exported); `createMapSceneFromTemplate(destination: Destination): MapScene` from `src/persistence/templates.ts` (unmodified); `Destination` from `src/models/project.ts`.
- Produces: `ProjectTemplateSchema`, `type ProjectTemplate`, `BUILTIN_PROJECT_TEMPLATE_ID: string`, `getBuiltinProjectTemplate(): ProjectTemplate` — consumed by every later task.

- [ ] **Step 1: Write the failing test**

Create `src/tests/projectTemplate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ProjectTemplateSchema, BUILTIN_PROJECT_TEMPLATE_ID, getBuiltinProjectTemplate } from '../models/projectTemplate';
import { createMapSceneFromTemplate } from '../persistence/templates';
import type { Destination } from '../models/project';

describe('getBuiltinProjectTemplate', () => {
  it('validates against ProjectTemplateSchema', () => {
    expect(() => ProjectTemplateSchema.parse(getBuiltinProjectTemplate())).not.toThrow();
  });

  it('has id BUILTIN_PROJECT_TEMPLATE_ID', () => {
    expect(getBuiltinProjectTemplate().id).toBe(BUILTIN_PROJECT_TEMPLATE_ID);
  });

  it('produces map waypoints identical to createMapSceneFromTemplate, regardless of destination (destination-independence)', () => {
    const destinationA: Destination = { source: 'photo-gps', latitude: 39.5, longitude: -104.9 };
    const destinationB: Destination = { source: 'manual', latitude: -12, longitude: 170 };
    const builtin = getBuiltinProjectTemplate();
    expect(builtin.map.waypoints).toEqual(createMapSceneFromTemplate(destinationA).waypoints);
    expect(builtin.map.waypoints).toEqual(createMapSceneFromTemplate(destinationB).waypoints);
  });

  it("matches today's createDraft.ts storefront literals exactly (regression guard)", () => {
    const builtin = getBuiltinProjectTemplate();
    expect(builtin.storefront).toEqual({
      durationMs: 2500,
      durationLocked: false,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
      endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
      motionPreset: 'push-in',
      transitionIn: { type: 'crossfade', durationMs: 600 },
      transitionOut: { type: 'crossfade', durationMs: 600 },
    });
  });

  it("matches today's createDraft.ts interior-tour literals exactly (regression guard)", () => {
    const builtin = getBuiltinProjectTemplate();
    expect(builtin.interiorTour).toEqual({
      defaultPhotoDurationMs: 4000,
      defaultTransition: { type: 'crossfade', durationMs: 500 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/projectTemplate.test.ts`
Expected: FAIL — `Cannot find module '../models/projectTemplate'`

- [ ] **Step 3: Write the implementation**

Create `src/models/projectTemplate.ts`:

```ts
import { z } from 'zod';
import {
  WaypointSchema,
  VisualTransformSchema,
  StorefrontMotionPresetSchema,
  TransitionSchema,
} from './scenes';
import { createMapSceneFromTemplate } from '../persistence/templates';
import type { Destination } from './project';

export const ProjectTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  map: z.object({
    waypoints: z.array(WaypointSchema),
  }),
  storefront: z.object({
    durationMs: z.number().nonnegative(),
    durationLocked: z.boolean(),
    startTransform: VisualTransformSchema,
    endTransform: VisualTransformSchema,
    motionPreset: StorefrontMotionPresetSchema,
    transitionIn: TransitionSchema,
    transitionOut: TransitionSchema,
  }),
  interiorTour: z.object({
    defaultPhotoDurationMs: z.number().nonnegative(),
    defaultTransition: TransitionSchema,
  }),
});
export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>;

export const BUILTIN_PROJECT_TEMPLATE_ID = 'builtin-standard-business-tour';

// createMapSceneFromTemplate's output waypoints do not depend on the destination
// passed in (only the returned MapScene's own `id` does) — this placeholder is
// never surfaced anywhere, it only satisfies that function's signature.
const PLACEHOLDER_DESTINATION: Destination = {
  source: 'manual',
  latitude: 0,
  longitude: 0,
};

export function getBuiltinProjectTemplate(): ProjectTemplate {
  return {
    id: BUILTIN_PROJECT_TEMPLATE_ID,
    name: 'Standard Local Business Tour',
    createdAt: '2026-01-01T00:00:00.000Z',
    map: {
      waypoints: createMapSceneFromTemplate(PLACEHOLDER_DESTINATION).waypoints,
    },
    storefront: {
      durationMs: 2500,
      durationLocked: false,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
      endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
      motionPreset: 'push-in',
      transitionIn: { type: 'crossfade', durationMs: 600 },
      transitionOut: { type: 'crossfade', durationMs: 600 },
    },
    interiorTour: {
      defaultPhotoDurationMs: 4000,
      defaultTransition: { type: 'crossfade', durationMs: 500 },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/projectTemplate.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Add the `ProjectTemplate` fixture**

`makeMinimalProjectTemplate` deliberately uses values different from the built-in's on every field (storefront `durationMs: 3000` not `2500`, `motionPreset: 'pull-out'` not `'push-in'`, interior `defaultPhotoDurationMs: 5000` not `4000`, etc.) so later tests can assert "a custom template's values, not the built-in's" without ambiguity.

Add to the end of `src/tests/fixtures.ts`:

```ts
import type { ProjectTemplate } from '../models/projectTemplate';

export function makeMinimalProjectTemplate(overrides: Partial<ProjectTemplate> = {}): ProjectTemplate {
  return {
    id: 'test-template-1',
    name: 'Test Template',
    createdAt: '2026-01-01T00:00:00.000Z',
    map: {
      waypoints: [],
    },
    storefront: {
      durationMs: 3000,
      durationLocked: false,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
      endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.1 },
      motionPreset: 'pull-out',
      transitionIn: { type: 'crossfade', durationMs: 400 },
      transitionOut: { type: 'crossfade', durationMs: 400 },
    },
    interiorTour: {
      defaultPhotoDurationMs: 5000,
      defaultTransition: { type: 'fade-black', durationMs: 300 },
    },
    ...overrides,
  };
}
```

(Place the new `import` alongside the existing `import type { Project } from '../models/project';` line at the top of the file — do not duplicate the `import` block.)

- [ ] **Step 6: Run the full suite to verify nothing broke**

Run: `npm run test`
Expected: PASS, all suites green

- [ ] **Step 7: Commit**

```bash
git add src/models/projectTemplate.ts src/tests/projectTemplate.test.ts src/tests/fixtures.ts
git commit -m "feat: add ProjectTemplate model and built-in template"
```

---

### Task 2: `templates` IndexedDB store and `projectTemplateRepository`

**Files:**
- Modify: `src/persistence/db.ts`
- Create: `src/persistence/projectTemplateRepository.ts`
- Create: `src/tests/projectTemplateRepository.test.ts`

**Interfaces:**
- Consumes: `ProjectTemplateSchema`, `type ProjectTemplate` (Task 1); `makeMinimalProjectTemplate` (Task 1, `fixtures.ts`); `getDb()` from `src/persistence/db.ts`.
- Produces: `saveProjectTemplate(template: ProjectTemplate): Promise<void>`, `listProjectTemplates(): Promise<ProjectTemplate[]>`, `getProjectTemplate(id: string): Promise<ProjectTemplate | null>` — consumed by Task 5 (Quick Create picker) and Task 6 (Save as Template).

- [ ] **Step 1: Write the failing test**

Create `src/tests/projectTemplateRepository.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDb } from '../persistence/db';
import { saveProjectTemplate, listProjectTemplates, getProjectTemplate } from '../persistence/projectTemplateRepository';
import { makeMinimalProjectTemplate } from './fixtures';

afterEach(async () => {
  const db = await getDb();
  await db.clear('templates');
});

describe('projectTemplateRepository', () => {
  it('saves and loads a template by id', async () => {
    const template = makeMinimalProjectTemplate({ id: 'tmpl-a' });
    await saveProjectTemplate(template);
    const loaded = await getProjectTemplate('tmpl-a');
    expect(loaded).toEqual(template);
  });

  it('returns null for a missing template', async () => {
    const loaded = await getProjectTemplate('does-not-exist');
    expect(loaded).toBeNull();
  });

  it('lists all saved templates', async () => {
    await saveProjectTemplate(makeMinimalProjectTemplate({ id: 'tmpl-b' }));
    await saveProjectTemplate(makeMinimalProjectTemplate({ id: 'tmpl-c' }));
    const all = await listProjectTemplates();
    const ids = all.map((t) => t.id).sort();
    expect(ids).toEqual(['tmpl-b', 'tmpl-c']);
  });

  it('skips a corrupt stored record instead of throwing', async () => {
    const db = await getDb();
    await db.put('templates', { id: 'corrupt', name: 'Bad' }); // missing required fields
    await saveProjectTemplate(makeMinimalProjectTemplate({ id: 'tmpl-d' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const all = await listProjectTemplates();
    expect(all.map((t) => t.id)).toEqual(['tmpl-d']);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/projectTemplateRepository.test.ts`
Expected: FAIL — `Cannot find module '../persistence/projectTemplateRepository'` (and/or "object store 'templates' not found" once that resolves)

- [ ] **Step 3: Add the `templates` store to `db.ts`**

Replace the full contents of `src/persistence/db.ts` with:

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface LocalFlyInStudioDB extends DBSchema {
  projects: { key: string; value: Record<string, unknown> };
  mediaAssets: { key: string; value: Record<string, unknown> };
  templates: { key: string; value: Record<string, unknown> };
}

const DB_NAME = 'local-fly-in-studio';
const DB_VERSION = 2;

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
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}
```

- [ ] **Step 4: Implement `projectTemplateRepository.ts`**

Create `src/persistence/projectTemplateRepository.ts`:

```ts
import { getDb } from './db';
import { ProjectTemplateSchema, type ProjectTemplate } from '../models/projectTemplate';

export async function saveProjectTemplate(template: ProjectTemplate): Promise<void> {
  // Defense in depth: never let a schema-invalid template reach the store, where it
  // would otherwise be skipped by listProjectTemplates and fail loudly in getProjectTemplate.
  ProjectTemplateSchema.parse(template);
  const db = await getDb();
  await db.put('templates', template);
}

export async function getProjectTemplate(id: string): Promise<ProjectTemplate | null> {
  const db = await getDb();
  const raw = await db.get('templates', id);
  if (!raw) return null;
  return ProjectTemplateSchema.parse(raw);
}

export async function listProjectTemplates(): Promise<ProjectTemplate[]> {
  const db = await getDb();
  const all = await db.getAll('templates');
  const templates: ProjectTemplate[] = [];
  for (const raw of all) {
    const parsed = ProjectTemplateSchema.safeParse(raw);
    if (parsed.success) {
      templates.push(parsed.data);
      continue;
    }
    // One corrupt record must never make the whole list unreachable — skip it so the
    // remaining templates still load.
    console.warn('Skipping unreadable stored template', parsed.error);
  }
  return templates;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- src/tests/projectTemplateRepository.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full suite to verify the `DB_VERSION` bump broke nothing**

Run: `npm run test`
Expected: PASS, all suites green (existing `projectRepository.test.ts` / `indexedDbStore.test.ts` suites are unaffected — the bump only adds a store)

- [ ] **Step 7: Commit**

```bash
git add src/persistence/db.ts src/persistence/projectTemplateRepository.ts src/tests/projectTemplateRepository.test.ts
git commit -m "feat: add templates IndexedDB store and projectTemplateRepository"
```

---

### Task 3: `buildTemplateFromProject`

**Files:**
- Create: `src/timeline/buildTemplateFromProject.ts`
- Create: `src/tests/buildTemplateFromProject.test.ts`

**Interfaces:**
- Consumes: `type ProjectTemplate` (Task 1); `type Project` from `src/models/project.ts`; `type MapScene, StorefrontScene, InteriorTourScene` from `src/models/scenes.ts`; `makeMinimalProject` (existing fixture — already produces a project with all 3 scene types).
- Produces: `type TemplateBuildError = { reason: 'missing-map' } | { reason: 'missing-storefront' } | { reason: 'missing-interior-tour' }`; `buildTemplateFromProject(project: Project, name: string): { ok: true; template: ProjectTemplate } | { ok: false; error: TemplateBuildError }` — consumed by Task 6 (`SaveTemplateControls`).

- [ ] **Step 1: Write the failing test**

Create `src/tests/buildTemplateFromProject.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTemplateFromProject } from '../timeline/buildTemplateFromProject';
import { makeMinimalProject } from './fixtures';

describe('buildTemplateFromProject', () => {
  it('builds a ProjectTemplate from a complete project, extracting only template-relevant fields', () => {
    const project = makeMinimalProject();
    const result = buildTemplateFromProject(project, 'My Template');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const mapScene = project.scenes.find((s) => s.type === 'map')!;
    if (mapScene.type !== 'map') throw new Error('unreachable');
    expect(result.template.map).toEqual({ waypoints: mapScene.waypoints });

    const storefrontScene = project.scenes.find((s) => s.type === 'storefront')!;
    if (storefrontScene.type !== 'storefront') throw new Error('unreachable');
    expect(result.template.storefront).toEqual({
      durationMs: storefrontScene.durationMs,
      durationLocked: storefrontScene.durationLocked,
      startTransform: storefrontScene.startTransform,
      endTransform: storefrontScene.endTransform,
      motionPreset: storefrontScene.motionPreset,
      transitionIn: storefrontScene.transitionIn,
      transitionOut: storefrontScene.transitionOut,
    });
    expect(result.template.storefront).not.toHaveProperty('assetId');
    expect(result.template.storefront).not.toHaveProperty('entranceTarget');

    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(result.template.interiorTour).toEqual({
      defaultPhotoDurationMs: interiorScene.defaultPhotoDurationMs,
      defaultTransition: interiorScene.defaultTransition,
    });
    expect(result.template).not.toHaveProperty('items');

    expect(result.template.name).toBe('My Template');
    expect(typeof result.template.id).toBe('string');
    expect(typeof result.template.createdAt).toBe('string');
  });

  it('returns a missing-map error when the project has no map scene', () => {
    const project = makeMinimalProject({
      scenes: makeMinimalProject().scenes.filter((s) => s.type !== 'map'),
    });
    const result = buildTemplateFromProject(project, 'X');
    expect(result).toEqual({ ok: false, error: { reason: 'missing-map' } });
  });

  it('returns a missing-storefront error when the project has no storefront scene', () => {
    const project = makeMinimalProject({
      scenes: makeMinimalProject().scenes.filter((s) => s.type !== 'storefront'),
    });
    const result = buildTemplateFromProject(project, 'X');
    expect(result).toEqual({ ok: false, error: { reason: 'missing-storefront' } });
  });

  it('returns a missing-interior-tour error when the project has no interior-tour scene', () => {
    const project = makeMinimalProject({
      scenes: makeMinimalProject().scenes.filter((s) => s.type !== 'interior-tour'),
    });
    const result = buildTemplateFromProject(project, 'X');
    expect(result).toEqual({ ok: false, error: { reason: 'missing-interior-tour' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/buildTemplateFromProject.test.ts`
Expected: FAIL — `Cannot find module '../timeline/buildTemplateFromProject'`

- [ ] **Step 3: Write the implementation**

Create `src/timeline/buildTemplateFromProject.ts`:

```ts
import type { Project } from '../models/project';
import type { MapScene, StorefrontScene, InteriorTourScene } from '../models/scenes';
import type { ProjectTemplate } from '../models/projectTemplate';

export type TemplateBuildError =
  | { reason: 'missing-map' }
  | { reason: 'missing-storefront' }
  | { reason: 'missing-interior-tour' };

export function buildTemplateFromProject(
  project: Project,
  name: string,
): { ok: true; template: ProjectTemplate } | { ok: false; error: TemplateBuildError } {
  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  if (!mapScene) return { ok: false, error: { reason: 'missing-map' } };

  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  if (!storefrontScene) return { ok: false, error: { reason: 'missing-storefront' } };

  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');
  if (!interiorScene) return { ok: false, error: { reason: 'missing-interior-tour' } };

  const template: ProjectTemplate = {
    id: `template-${crypto.randomUUID()}`,
    name,
    createdAt: new Date().toISOString(),
    map: {
      waypoints: mapScene.waypoints,
    },
    storefront: {
      durationMs: storefrontScene.durationMs,
      durationLocked: storefrontScene.durationLocked,
      startTransform: storefrontScene.startTransform,
      endTransform: storefrontScene.endTransform,
      motionPreset: storefrontScene.motionPreset,
      transitionIn: storefrontScene.transitionIn,
      transitionOut: storefrontScene.transitionOut,
    },
    interiorTour: {
      defaultPhotoDurationMs: interiorScene.defaultPhotoDurationMs,
      defaultTransition: interiorScene.defaultTransition,
    },
  };

  return { ok: true, template };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/buildTemplateFromProject.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/timeline/buildTemplateFromProject.ts src/tests/buildTemplateFromProject.test.ts
git commit -m "feat: add buildTemplateFromProject pure function"
```

---

### Task 4: Generalize `createDraft.ts` to build scenes from a resolved template

**Files:**
- Modify: `src/quickCreate/createDraft.ts`
- Modify: `src/tests/createDraft.test.ts`

**Interfaces:**
- Consumes: `getBuiltinProjectTemplate`, `BUILTIN_PROJECT_TEMPLATE_ID`, `type ProjectTemplate` (Task 1); `regeneratePhotoMotion(scene: InteriorTourScene): InteriorTourScene` (Phase 6b, `src/timeline/bulkEdit.ts`, unmodified).
- Produces: `CreateDraftInput` gains `template?: ProjectTemplate`; `Project.templateId` is now stamped (a saved template's `id`, or `undefined` for the built-in) — consumed by Task 5 (`QuickCreateWizard`).

- [ ] **Step 1: Update the test file (failing first)**

Replace the full contents of `src/tests/createDraft.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createDraft, NoDestinationError, type CreateDraftDependencies } from '../quickCreate/createDraft';
import { ProjectSchema } from '../models/project';
import { getBuiltinProjectTemplate, BUILTIN_PROJECT_TEMPLATE_ID } from '../models/projectTemplate';
import type { ProjectTemplate } from '../models/projectTemplate';
import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import type { VideoMetadata } from '../media/videoMetadata';

function makeFakeMediaStore(): MediaAssetStore {
  let counter = 0;
  return {
    save: vi.fn(async (file: File): Promise<StoredMediaAsset> => {
      counter += 1;
      return {
        id: `asset-${counter}`,
        storageLocation: 'indexeddb',
        storageKey: `key-${counter}`,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        filename: file.name,
      };
    }),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
  };
}

function makeDeps(overrides: Partial<CreateDraftDependencies> = {}): Partial<CreateDraftDependencies> {
  return {
    mediaStore: makeFakeMediaStore(),
    extractImageMetadata: vi.fn(async () => ({ latitude: 39.5, longitude: -104.9 })),
    resolveFromPhotoGps: vi.fn((metadata) =>
      typeof metadata.latitude === 'number' && typeof metadata.longitude === 'number'
        ? { source: 'photo-gps' as const, latitude: metadata.latitude, longitude: metadata.longitude }
        : null,
    ),
    isHeic: vi.fn(() => false),
    convertHeicToJpeg: vi.fn(async () => ({ ok: true as const, blob: new Blob() })),
    extractVideoMetadata: vi.fn(async (): Promise<VideoMetadata> => ({ durationMs: 6000, width: 1920, height: 1080 })),
    ...overrides,
  };
}

function makeFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

const CUSTOM_TEMPLATE: ProjectTemplate = {
  id: 'template-custom-1',
  name: 'Custom Style',
  createdAt: '2026-02-01T00:00:00.000Z',
  map: {
    waypoints: [
      {
        id: 'custom-earth',
        name: 'Earth',
        type: 'absolute',
        camera: { longitude: 0, latitude: 0, height: 20_000_000, heading: 0, pitch: -90, roll: 0 },
        travelDurationMs: 0,
        holdDurationMs: 1000,
        travelDurationLocked: false,
        holdDurationLocked: false,
        easing: 'cinematic',
      },
    ],
  },
  storefront: {
    durationMs: 3000,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.1 },
    motionPreset: 'pull-out',
    transitionIn: { type: 'fade-black', durationMs: 400 },
    transitionOut: { type: 'fade-black', durationMs: 400 },
  },
  interiorTour: {
    defaultPhotoDurationMs: 5000,
    defaultTransition: { type: 'fade-black', durationMs: 300 },
  },
};

describe('createDraft', () => {
  it('produces a valid Project from a photo-GPS destination and mixed interior media', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('room.jpg', 'image/jpeg'), makeFile('clip.mp4', 'video/mp4')],
      },
      deps,
    );

    expect(() => ProjectSchema.parse(project)).not.toThrow();
    expect(project.destination).toEqual({ source: 'photo-gps', latitude: 39.5, longitude: -104.9 });
    expect(project.scenes.map((s) => s.type)).toEqual(['map', 'storefront', 'interior-tour']);
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(interiorScene.items).toHaveLength(2);
    expect(interiorScene.items[0].type).toBe('photo');
    expect(interiorScene.items[1].type).toBe('video');
  });

  it('throws NoDestinationError when the photo has no GPS and no override is supplied', async () => {
    const deps = makeDeps({ extractImageMetadata: vi.fn(async () => ({})) });
    await expect(
      createDraft({ storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] }, deps),
    ).rejects.toBeInstanceOf(NoDestinationError);
  });

  it('uses destinationOverride and never calls resolveFromPhotoGps when it is supplied', async () => {
    const deps = makeDeps({ extractImageMetadata: vi.fn(async () => ({})) });
    const override = { source: 'manual' as const, latitude: 1, longitude: 2 };
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [], destinationOverride: override },
      deps,
    );
    expect(project.destination).toEqual(override);
    expect(deps.resolveFromPhotoGps).not.toHaveBeenCalled();
  });

  it('produces a valid two-scene Project (no interior-tour scene) when interiorMedia is empty', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] },
      deps,
    );
    expect(() => ProjectSchema.parse(project)).not.toThrow();
    expect(project.scenes.map((s) => s.type)).toEqual(['map', 'storefront']);
  });

  it('keeps import order as the default interior item order', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('first.jpg', 'image/jpeg'), makeFile('second.mp4', 'video/mp4'), makeFile('third.jpg', 'image/jpeg')],
      },
      deps,
    );
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(interiorScene.items.map((i) => i.type)).toEqual(['photo', 'video', 'photo']);
  });

  it("applies the built-in template's crossfade transitions and alternates photo motion (not uniform push-in)", async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('a.jpg', 'image/jpeg'), makeFile('b.jpg', 'image/jpeg'), makeFile('c.jpg', 'image/jpeg')],
      },
      deps,
    );
    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    for (const item of interiorScene.items) {
      expect(item.transitionToNext).toEqual({ type: 'crossfade', durationMs: 500 });
    }
    const motionPresets = interiorScene.items.map((i) => (i.type === 'photo' ? i.motionPreset : null));
    expect(motionPresets).toEqual(['push-in', 'pull-out', 'pan-left-right']);
  });

  it('omitting template reproduces the exact built-in map/storefront/interior defaults', async () => {
    const deps = makeDeps();
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [] },
      deps,
    );
    const builtin = getBuiltinProjectTemplate();
    const mapScene = project.scenes.find((s) => s.type === 'map')!;
    if (mapScene.type !== 'map') throw new Error('unreachable');
    expect(mapScene.waypoints).toEqual(builtin.map.waypoints);

    const storefrontScene = project.scenes.find((s) => s.type === 'storefront')!;
    if (storefrontScene.type !== 'storefront') throw new Error('unreachable');
    expect(storefrontScene.durationMs).toBe(builtin.storefront.durationMs);
    expect(storefrontScene.motionPreset).toBe(builtin.storefront.motionPreset);
    expect(storefrontScene.transitionIn).toEqual(builtin.storefront.transitionIn);

    expect(project.templateId).toBeUndefined();
  });

  it("uses a custom template's map/storefront/interior values instead of the built-in's", async () => {
    const deps = makeDeps();
    const project = await createDraft(
      {
        storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'),
        interiorMedia: [makeFile('a.jpg', 'image/jpeg')],
        template: CUSTOM_TEMPLATE,
      },
      deps,
    );

    const mapScene = project.scenes.find((s) => s.type === 'map')!;
    if (mapScene.type !== 'map') throw new Error('unreachable');
    expect(mapScene.waypoints).toEqual(CUSTOM_TEMPLATE.map.waypoints);

    const storefrontScene = project.scenes.find((s) => s.type === 'storefront')!;
    if (storefrontScene.type !== 'storefront') throw new Error('unreachable');
    expect(storefrontScene.durationMs).toBe(3000);
    expect(storefrontScene.motionPreset).toBe('pull-out');
    expect(storefrontScene.transitionIn).toEqual({ type: 'fade-black', durationMs: 400 });

    const interiorScene = project.scenes.find((s) => s.type === 'interior-tour')!;
    if (interiorScene.type !== 'interior-tour') throw new Error('unreachable');
    expect(interiorScene.defaultPhotoDurationMs).toBe(5000);
    expect(interiorScene.items[0].type === 'photo' && interiorScene.items[0].durationMs).toBe(5000);
    expect(interiorScene.items[0].transitionToNext).toEqual({ type: 'fade-black', durationMs: 300 });
  });

  it("stamps a custom template's id as the draft's templateId; the built-in path leaves templateId undefined", async () => {
    const deps = makeDeps();
    const project = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [], template: CUSTOM_TEMPLATE },
      deps,
    );
    expect(project.templateId).toBe('template-custom-1');

    const builtinTemplate = getBuiltinProjectTemplate();
    expect(builtinTemplate.id).toBe(BUILTIN_PROJECT_TEMPLATE_ID);
    const builtinProject = await createDraft(
      { storefrontPhoto: makeFile('storefront.jpg', 'image/jpeg'), interiorMedia: [], template: builtinTemplate },
      deps,
    );
    expect(builtinProject.templateId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify the new/changed cases fail**

Run: `npm run test -- src/tests/createDraft.test.ts`
Expected: FAIL — the motion-alternation, custom-template, and `templateId` tests fail against the current `createDraft.ts` (which has no `template` input and always assigns `push-in`)

- [ ] **Step 3: Rewrite `createDraft.ts`**

Replace the full contents of `src/quickCreate/createDraft.ts` with:

```ts
import type { MediaAssetStore, StoredMediaAsset } from '../media/MediaAssetStore';
import { createMediaAssetStore } from '../media/createMediaAssetStore';
import { extractImageMetadata, type ExtractedMediaMetadata } from '../media/metadata';
import { isHeic, convertHeicToJpeg } from '../media/imageDecoder';
import { resolveFromPhotoGps } from '../destination/resolver';
import { extractVideoMetadata } from '../media/videoMetadata';
import { getBuiltinProjectTemplate, BUILTIN_PROJECT_TEMPLATE_ID, type ProjectTemplate } from '../models/projectTemplate';
import { regeneratePhotoMotion } from '../timeline/bulkEdit';
import { CURRENT_SCHEMA_VERSION, type Project, type Destination } from '../models/project';
import type {
  ProjectScene,
  StorefrontScene,
  InteriorTourItem,
  InteriorTourScene,
  MapScene,
  Transition,
} from '../models/scenes';
import type { MediaAsset } from '../models/media';

export class NoDestinationError extends Error {
  constructor() {
    super('Could not determine a destination for this storefront photo — no GPS data found.');
    this.name = 'NoDestinationError';
  }
}

export interface CreateDraftInput {
  storefrontPhoto: File;
  interiorMedia: File[];
  destinationOverride?: Destination;
  template?: ProjectTemplate;
}

export interface CreateDraftDependencies {
  mediaStore: MediaAssetStore;
  extractImageMetadata: typeof extractImageMetadata;
  extractVideoMetadata: typeof extractVideoMetadata;
  resolveFromPhotoGps: typeof resolveFromPhotoGps;
  isHeic: typeof isHeic;
  convertHeicToJpeg: typeof convertHeicToJpeg;
}

async function heicToJpegFile(
  file: File,
  doConvertHeicToJpeg: CreateDraftDependencies['convertHeicToJpeg'],
): Promise<File> {
  const result = await doConvertHeicToJpeg(file);
  if (!result.ok) {
    throw new Error(result.error);
  }
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([result.blob], newName, { type: 'image/jpeg' });
}

async function importStorefrontAsset(
  file: File,
  metadata: ExtractedMediaMetadata,
  deps: CreateDraftDependencies,
): Promise<MediaAsset> {
  const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
  const stored = await deps.mediaStore.save(finalFile);
  const gps =
    typeof metadata.latitude === 'number' && typeof metadata.longitude === 'number'
      ? { latitude: metadata.latitude, longitude: metadata.longitude }
      : undefined;
  return {
    id: stored.id,
    kind: 'image',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    captureTime: metadata.captureTime,
    gps,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
}

function createDefaultStorefrontScene(assetId: string, template: ProjectTemplate): StorefrontScene {
  return {
    id: `storefront-${crypto.randomUUID()}`,
    type: 'storefront',
    assetId,
    ...template.storefront,
  };
}

interface ImportedInteriorItem {
  item: InteriorTourItem;
  mediaAsset: MediaAsset;
}

async function importInteriorPhoto(
  file: File,
  index: number,
  defaultPhotoDurationMs: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem> {
  const finalFile = deps.isHeic(file) ? await heicToJpegFile(file, deps.convertHeicToJpeg) : file;
  const stored: StoredMediaAsset = await deps.mediaStore.save(finalFile);
  const mediaAsset: MediaAsset = {
    id: stored.id,
    kind: 'image',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
  const item: InteriorTourItem = {
    id: `interior-item-${index}-${stored.id}`,
    type: 'photo',
    assetId: stored.id,
    durationMs: defaultPhotoDurationMs,
    durationLocked: false,
    startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
    endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.08 },
    // Placeholder — overwritten for every photo item by regeneratePhotoMotion in createDraft.
    motionPreset: 'push-in',
    transitionToNext: { type: 'cut', durationMs: 0 },
  };
  return { item, mediaAsset };
}

async function importInteriorVideo(
  file: File,
  index: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem> {
  const stored = await deps.mediaStore.save(file);
  const videoMeta = await deps.extractVideoMetadata(file);
  const mediaAsset: MediaAsset = {
    id: stored.id,
    kind: 'video',
    filename: stored.filename,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    width: videoMeta.width,
    height: videoMeta.height,
    durationMs: videoMeta.durationMs,
    storageLocation: stored.storageLocation,
    storageKey: stored.storageKey,
  };
  const item: InteriorTourItem = {
    id: `interior-item-${index}-${stored.id}`,
    type: 'video',
    assetId: stored.id,
    trimStartMs: 0,
    trimEndMs: videoMeta.durationMs,
    playbackRate: 1,
    audioEnabled: false,
    fitMode: 'cover',
    transitionToNext: { type: 'cut', durationMs: 0 },
  };
  return { item, mediaAsset };
}

async function createInteriorItems(
  files: File[],
  defaultPhotoDurationMs: number,
  deps: CreateDraftDependencies,
): Promise<ImportedInteriorItem[]> {
  const results: ImportedInteriorItem[] = [];
  for (const [index, file] of files.entries()) {
    const isVideo = file.type.startsWith('video/');
    results.push(
      isVideo
        ? await importInteriorVideo(file, index, deps)
        : await importInteriorPhoto(file, index, defaultPhotoDurationMs, deps),
    );
  }
  return results;
}

function applyDefaultInteriorOrdering(items: InteriorTourItem[]): InteriorTourItem[] {
  // Import order is already the default order — no reordering needed.
  // Returns a fresh array so callers can treat ordering as an explicit step.
  return [...items];
}

function applyDefaultTransitions(items: InteriorTourItem[], defaultTransition: Transition): void {
  for (const item of items) {
    // A fresh object per item — a shared reference would let 4b's editing UI change
    // one item's transition and silently change every other item's too.
    item.transitionToNext = { ...defaultTransition };
  }
}

export async function createDraft(
  input: CreateDraftInput,
  overrides: Partial<CreateDraftDependencies> = {},
): Promise<Project> {
  const deps: CreateDraftDependencies = {
    mediaStore: overrides.mediaStore ?? (await createMediaAssetStore()),
    extractImageMetadata: overrides.extractImageMetadata ?? extractImageMetadata,
    extractVideoMetadata: overrides.extractVideoMetadata ?? extractVideoMetadata,
    resolveFromPhotoGps: overrides.resolveFromPhotoGps ?? resolveFromPhotoGps,
    isHeic: overrides.isHeic ?? isHeic,
    convertHeicToJpeg: overrides.convertHeicToJpeg ?? convertHeicToJpeg,
  };

  const resolvedTemplate = input.template ?? getBuiltinProjectTemplate();

  const metadata = await deps.extractImageMetadata(input.storefrontPhoto);
  const destination = input.destinationOverride ?? deps.resolveFromPhotoGps(metadata);
  if (!destination) {
    throw new NoDestinationError();
  }

  const storefrontAsset = await importStorefrontAsset(input.storefrontPhoto, metadata, deps);
  const mapScene: MapScene = {
    id: `map-${destination.source}-${crypto.randomUUID()}`,
    type: 'map',
    waypoints: resolvedTemplate.map.waypoints,
  };
  const storefrontScene = createDefaultStorefrontScene(storefrontAsset.id, resolvedTemplate);

  const imported = await createInteriorItems(
    input.interiorMedia,
    resolvedTemplate.interiorTour.defaultPhotoDurationMs,
    deps,
  );
  const orderedItems = applyDefaultInteriorOrdering(imported.map((i) => i.item));
  applyDefaultTransitions(orderedItems, resolvedTemplate.interiorTour.defaultTransition);

  const scenes: ProjectScene[] = [mapScene, storefrontScene];
  const mediaAssets: MediaAsset[] = [storefrontAsset, ...imported.map((i) => i.mediaAsset)];

  if (orderedItems.length > 0) {
    const interiorScene: InteriorTourScene = {
      id: `interior-${crypto.randomUUID()}`,
      type: 'interior-tour',
      items: orderedItems,
      defaultPhotoDurationMs: resolvedTemplate.interiorTour.defaultPhotoDurationMs,
      defaultTransition: resolvedTemplate.interiorTour.defaultTransition,
    };
    scenes.push(regeneratePhotoMotion(interiorScene));
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `project-${crypto.randomUUID()}`,
    projectName: destination.businessName ?? 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    destination,
    scenes,
    mediaAssets,
    videoSettings: { aspectRatio: '16:9', widthPx: 1920, heightPx: 1080, fps: 30 },
    templateId: resolvedTemplate.id === BUILTIN_PROJECT_TEMPLATE_ID ? undefined : resolvedTemplate.id,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/createDraft.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm run test`
Expected: PASS, all suites green

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/quickCreate/createDraft.ts src/tests/createDraft.test.ts
git commit -m "feat: build createDraft scenes from a resolved ProjectTemplate

Replaces the hardcoded map/storefront/interior-tour literals with a
resolved ProjectTemplate (input, or the built-in default), and fixes
applyDefaultPhotoMotion's always-push-in bug by using Phase 6b's
regeneratePhotoMotion instead."
```

---

### Task 5: Quick Create "Style" picker

**Files:**
- Modify: `src/components/quick-create/StorefrontStep.tsx`
- Modify: `src/components/quick-create/QuickCreateWizard.tsx`

**Interfaces:**
- Consumes: `getBuiltinProjectTemplate`, `BUILTIN_PROJECT_TEMPLATE_ID` (Task 1); `listProjectTemplates`, `getProjectTemplate` (Task 2); `createDraft`'s `template?: ProjectTemplate` input (Task 4).
- Produces: `StorefrontStepProps.onNext: (file: File, templateId: string | null) => void` — `templateId` is `null` for "use the built-in", otherwise a saved template's id.

No automated test for this task — React components, no jsdom (Global Constraints). Verified via `npx tsc -b` and the Task 7 real-browser pass.

- [ ] **Step 1: Rewrite `StorefrontStep.tsx`**

Replace the full contents of `src/components/quick-create/StorefrontStep.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { listProjectTemplates } from '../../persistence/projectTemplateRepository';
import { BUILTIN_PROJECT_TEMPLATE_ID } from '../../models/projectTemplate';

interface StorefrontStepProps {
  onNext: (file: File, templateId: string | null) => void;
}

interface TemplateOption {
  id: string;
  name: string;
}

const BUILTIN_OPTION: TemplateOption = { id: BUILTIN_PROJECT_TEMPLATE_ID, name: 'Standard Local Business Tour' };

export function StorefrontStep({ onNext }: StorefrontStepProps) {
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([BUILTIN_OPTION]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(BUILTIN_PROJECT_TEMPLATE_ID);

  useEffect(() => {
    let cancelled = false;
    void listProjectTemplates().then((templates) => {
      if (cancelled) return;
      setTemplateOptions([BUILTIN_OPTION, ...templates.map((t) => ({ id: t.id, name: t.name }))]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Object URLs are not garbage collected — revoke the previous preview when a new
  // photo is picked, and whatever is outstanding when this step goes away.
  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    },
    [],
  );

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const nextUrl = URL.createObjectURL(file);
    previewUrlRef.current = nextUrl;
    setSelected(file);
    setPreviewUrl(nextUrl);
  }

  return (
    <div className="quick-create-step">
      <h2>1. Storefront</h2>
      <label>
        Style
        <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
          {templateOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <label className="quick-create-photo-input">
        <Camera size={20} />
        <span>Take / Select Photo</span>
        <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} />
      </label>
      {previewUrl && <img className="quick-create-thumbnail" src={previewUrl} alt="Selected storefront" />}
      <button
        type="button"
        disabled={!selected}
        onClick={() =>
          selected &&
          onNext(selected, selectedTemplateId === BUILTIN_PROJECT_TEMPLATE_ID ? null : selectedTemplateId)
        }
      >
        Next
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update `QuickCreateWizard.tsx`**

Replace the full contents of `src/components/quick-create/QuickCreateWizard.tsx` with:

```tsx
import { useCallback, useState } from 'react';
import './QuickCreateWizard.css';
import { StorefrontStep } from './StorefrontStep';
import { InteriorTourStep } from './InteriorTourStep';
import { NoDestinationFallback } from './NoDestinationFallback';
import { createDraft, NoDestinationError } from '../../quickCreate/createDraft';
import { useProjectStore } from '../../store/projectStore';
import { getBuiltinProjectTemplate } from '../../models/projectTemplate';
import { getProjectTemplate } from '../../persistence/projectTemplateRepository';
import type { Destination, Project } from '../../models/project';

type WizardStep = 'storefront' | 'interior' | 'no-destination' | 'creating';

interface QuickCreateWizardProps {
  onDraftReady: (project: Project) => void;
}

export function QuickCreateWizard({ onDraftReady }: QuickCreateWizardProps) {
  const [step, setStep] = useState<WizardStep>('storefront');
  const [storefrontPhoto, setStorefrontPhoto] = useState<File | null>(null);
  // null means "use the built-in template" — set from StorefrontStep's Style picker.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  // Source of truth for the interior selection. Living here (rather than inside
  // InteriorTourStep) means the user's files survive any step transition that
  // unmounts the step — including a no-destination retry that fails for a second,
  // unrelated reason and lands back on 'interior'.
  const [interiorMedia, setInteriorMedia] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createProject = useProjectStore((state) => state.createProject);

  const runCreateDraft = useCallback(
    async (destinationOverride?: Destination) => {
      if (!storefrontPhoto) return;
      setStep('creating');
      setError(null);
      try {
        const template = selectedTemplateId
          ? (await getProjectTemplate(selectedTemplateId)) ?? getBuiltinProjectTemplate()
          : getBuiltinProjectTemplate();
        const project = await createDraft({ storefrontPhoto, interiorMedia, destinationOverride, template });
        await createProject(project);
        onDraftReady(project);
      } catch (err) {
        if (err instanceof NoDestinationError) {
          setStep('no-destination');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not create the draft.');
        setStep('interior');
      }
    },
    [storefrontPhoto, interiorMedia, selectedTemplateId, createProject, onDraftReady],
  );

  if (step === 'storefront') {
    return (
      <StorefrontStep
        onNext={(file, templateId) => {
          setStorefrontPhoto(file);
          setSelectedTemplateId(templateId);
          setStep('interior');
        }}
      />
    );
  }

  if (step === 'no-destination') {
    return (
      <NoDestinationFallback
        onResolved={(destination) => {
          void runCreateDraft(destination);
        }}
      />
    );
  }

  return (
    <div>
      <InteriorTourStep
        files={interiorMedia}
        onFilesChange={setInteriorMedia}
        onCreateDraft={() => void runCreateDraft()}
        onBack={() => setStep('storefront')}
        submitting={step === 'creating'}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

(A previously-selected saved template can be deleted before the draft is actually created — there is no delete UI this phase, but a future one could race with an in-flight wizard. `getProjectTemplate(id) ?? getBuiltinProjectTemplate()` falls back to the built-in rather than throwing, keeping the wizard resilient to that even though it cannot happen with this phase's own UI.)

- [ ] **Step 3: Run the full suite**

Run: `npm run test`
Expected: PASS, all suites green (no new Vitest coverage for these two files — no jsdom)

- [ ] **Step 4: Type-check**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/quick-create/StorefrontStep.tsx src/components/quick-create/QuickCreateWizard.tsx
git commit -m "feat: add Style template picker to Quick Create"
```

---

### Task 6: "Save as Template" in Studio

**Files:**
- Create: `src/components/studio/SaveTemplateControls.tsx`
- Modify: `src/components/studio/StudioView.tsx`
- Modify: `src/components/studio/StudioView.css`

**Interfaces:**
- Consumes: `buildTemplateFromProject` (Task 3); `saveProjectTemplate` (Task 2); `type Project` from `src/models/project.ts`.
- Produces: `SaveTemplateControls` rendered inside `StudioView`, alongside `ScalingControls`/`BulkEditControls`.

No automated test for this task — React components, no jsdom (Global Constraints). Verified via `npx tsc -b` and the Task 7 real-browser pass.

- [ ] **Step 1: Create `SaveTemplateControls.tsx`**

Create `src/components/studio/SaveTemplateControls.tsx`:

```tsx
// src/components/studio/SaveTemplateControls.tsx
import { useState } from 'react';
import { buildTemplateFromProject } from '../../timeline/buildTemplateFromProject';
import { saveProjectTemplate } from '../../persistence/projectTemplateRepository';
import type { Project } from '../../models/project';
import type { TemplateBuildError } from '../../timeline/buildTemplateFromProject';

const ERROR_MESSAGES: Record<TemplateBuildError['reason'], string> = {
  'missing-map': 'This project has no Map scene to save into a template.',
  'missing-storefront': 'This project has no Storefront scene to save into a template.',
  'missing-interior-tour': 'This project has no Interior Tour scene to save into a template.',
};

interface SaveTemplateControlsProps {
  project: Project;
}

export function SaveTemplateControls({ project }: SaveTemplateControlsProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setConfirmation(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a name for the template.');
      return;
    }
    const result = buildTemplateFromProject(project, trimmedName);
    if (!result.ok) {
      setError(ERROR_MESSAGES[result.error.reason]);
      return;
    }
    await saveProjectTemplate(result.template);
    setConfirmation(`Saved template "${result.template.name}".`);
    setName('');
  }

  return (
    <div className="inspector save-template-controls">
      <h3>Save as Template</h3>
      <label>
        Template name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="save-template-controls-actions">
        <button type="button" onClick={() => void handleSave()}>
          Save as Template
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {confirmation && <p role="status">{confirmation}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `StudioView.tsx`**

In `src/components/studio/StudioView.tsx`, add the import alongside the existing `BulkEditControls` import:

```ts
import { SaveTemplateControls } from './SaveTemplateControls';
```

Then render it immediately after `<BulkEditControls project={project} updateProject={updateProject} />` (which is followed by the `exportOpen && ...` block):

```tsx
      <BulkEditControls project={project} updateProject={updateProject} />

      <SaveTemplateControls project={project} />

      {exportOpen && viewerRef.current && (
```

- [ ] **Step 3: Extend the shared actions-row selector in `StudioView.css`**

In `src/components/studio/StudioView.css`, change:

```css
.waypoint-inspector-actions,
.scaling-controls-actions,
.bulk-edit-controls-actions {
  display: flex;
  gap: 8px;
}
```

to:

```css
.waypoint-inspector-actions,
.scaling-controls-actions,
.bulk-edit-controls-actions,
.save-template-controls-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm run test`
Expected: PASS, all suites green

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/SaveTemplateControls.tsx src/components/studio/StudioView.tsx src/components/studio/StudioView.css
git commit -m "feat: add Save as Template control to Studio"
```

---

### Task 7: Real-browser verification

**Files:** none (verification only — no code changes in this task).

This project's Vitest suite runs with `environment: 'node'` (no jsdom), so `StorefrontStep.tsx`'s picker and `SaveTemplateControls.tsx` have no automated coverage (Global Constraints). This task is the required real-browser pass the spec's Testing section calls for.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)

- [ ] **Step 2: Verify the built-in path is unchanged**

In a browser, open the app, start a Quick Create draft, leave "Style" on "Standard Local Business Tour", pick a storefront photo and at least one interior photo, and finish the draft. Open the resulting project in Studio and confirm: a Map scene with 6 waypoints exists, the Storefront scene's duration reads 2500ms-equivalent (2.5s) in its inspector, and the Interior Tour photo's motion preset is `push-in` for the first photo (open the Waypoint/Interior inspector to check, or rely on Task 4's Vitest coverage for the exact value and just confirm the draft completes without error here).

- [ ] **Step 3: Save a template from a populated project**

In Studio (same project from Step 2, or a fresh one with all three scene types present), scroll to "Save as Template", type a distinctive name (e.g. "Photo Test Template"), click "Save as Template". Confirm the `role="status"` confirmation message appears and no `role="alert"` error is shown.

- [ ] **Step 4: Confirm the saved template appears in Quick Create and applies distinct values**

Start a new Quick Create draft. Confirm the "Style" `<select>` on the Storefront step now lists both "Standard Local Business Tour" and the name saved in Step 3. Select the saved template, complete the draft with a **different** storefront photo. Open the resulting project's Storefront inspector and confirm its duration matches the value from the *source* project used in Step 3 (not necessarily 2500ms/2.5s — whatever that project's actual storefront duration was), demonstrating the applied template's values differ from the built-in's `2500` default whenever the source project's storefront duration differs from it.

- [ ] **Step 5: Confirm a missing-scene project shows the specific error**

If reachable via the current UI (e.g. a draft created with no interior photos, which per Task 4/existing behavior produces only `['map', 'storefront']` scenes), open that project in Studio and click "Save as Template" with a name filled in. Confirm the `role="alert"` message reads the Interior Tour-specific text ("This project has no Interior Tour scene to save into a template.").

- [ ] **Step 6: Report**

Report PASS/FAIL for each of Steps 2–5 against the spec's Acceptance Criteria. Any FAIL blocks the final whole-branch review from being considered clean — file it as an Important finding instead.

---

## Self-Review Notes

- **Spec coverage:** `ProjectTemplateSchema`/`getBuiltinProjectTemplate` → Task 1. `db.ts`/`projectTemplateRepository.ts` → Task 2. `buildTemplateFromProject` → Task 3. `createDraft.ts` (template resolution + `regeneratePhotoMotion` fix + `templateId` stamping) → Task 4. `StorefrontStep.tsx`/`QuickCreateWizard.tsx` → Task 5. `SaveTemplateControls.tsx`/`StudioView.tsx`/`StudioView.css` → Task 6. Real-browser verification of the UI-only pieces → Task 7. All spec sections are covered.
- **Placeholder scan:** no TBD/TODO; every step has real, complete code.
- **Type consistency:** `ProjectTemplate`'s `storefront`/`interiorTour` field names (`durationMs`, `durationLocked`, `startTransform`, `endTransform`, `motionPreset`, `transitionIn`, `transitionOut`, `defaultPhotoDurationMs`, `defaultTransition`) are identical across Task 1 (`projectTemplate.ts`), Task 3 (`buildTemplateFromProject.ts`), and Task 4 (`createDraft.ts`'s spread usage) — verified by re-reading all three. `TemplateBuildError`'s three reasons (`missing-map`/`missing-storefront`/`missing-interior-tour`) match between Task 3's definition and Task 6's `ERROR_MESSAGES` record exactly. `onNext`'s new signature (`(file: File, templateId: string | null) => void`) matches between Task 5's `StorefrontStep` and its `QuickCreateWizard` caller.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-17-phase-6c-project-templates.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
