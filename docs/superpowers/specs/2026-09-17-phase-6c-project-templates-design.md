# Phase 6c: Project Templates — Design Spec

Date: 2026-09-17
Status: Approved for implementation planning

## Context

Local Fly-In Studio's full product scope is defined in:

- `../../../Local Fly-In Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up)
- `../../../Claude Code Build Prompt — Local Fly-In Studio v3.0.md`

Phases 1-6b are complete and merged: data model/persistence, the timeline
engine, media ingestion, the Cesium viewer + Quick Create flow, the Studio
desktop editor (including bulk-edit for Interior Tour items), and the
Output Compositor + Export pipeline (all 4 export variants).

This spec covers PRD §46 ("Templates") and §47 ("Default Draft Template"):
letting a user save a project's non-media configuration as a named,
reusable template, and apply a saved (or the one built-in) template when
starting a new Quick Create draft.

**Investigation finding, documented here so it isn't rediscovered:**
`src/persistence/templates.ts` (`createMapSceneFromTemplate`) and
`Project.templateId` already exist, but they are NOT the PRD §46 feature.
`createMapSceneFromTemplate` is the hardcoded "Standard Local Business
Fly-In" map-waypoint generator used internally by `createDraft.ts` — the
PRD §47 *default* draft template, not a user-facing save/apply system.
`templateId` is declared on `Project` but genuinely unused anywhere in the
codebase (confirmed by grep). This phase builds the actual save/apply
system on top of, and additive to, that existing generator.

## Goal

1. A user can save the current project's map waypoints, storefront
   styling, and interior-tour defaults as a named, reusable template from
   Studio.
2. A user can pick a template — the built-in default, or any saved one —
   when starting a new Quick Create draft, and the draft is built from
   that template's values instead of always using the hardcoded defaults.

Scope decisions, made during brainstorming:

- **Templates apply only at Quick Create time**, to a brand-new draft.
  Re-applying a template to an already-created project in Studio (with
  its ambiguous overwrite-vs-merge semantics) is out of scope — to
  restyle an existing project, start a new draft from the template
  instead.
- **Create + apply only this phase.** No rename/delete/management UI for
  saved templates. A mis-saved template can be superseded by saving a new
  one with a better name; deletion is a cheap follow-up once the core
  mechanism exists.
- **Known limitation, accepted rather than guarded against:** a template's
  map waypoints are only meaningfully reusable across destinations when
  they are `destination-relative` (as the built-in's 5 stops are). If a
  user saves a template from a project containing a manually-`Captured`,
  truly-absolute waypoint (a real lat/lon locked via Studio's Capture
  button), that literal location is baked into the template and will not
  make sense for a different business. No validation or warning is added
  for this; it is documented behavior, to be revisited if it proves
  confusing in practice.
- **`applyDefaultPhotoMotion`'s existing bug gets fixed as part of this
  phase.** Today every interior photo defaults to `'push-in'` regardless
  of position — a quirk noted during Phase 6b, not the PRD's described
  "automatically alternated" motion. Since the PRD explicitly lists
  "motion sequence" as part of a template's Interior Tour component, this
  phase replaces that hardcoded assignment with Phase 6b's existing
  `regeneratePhotoMotion` helper, applied once at draft-creation time —
  fixing the quirk for every draft (built-in template included) as a
  natural side effect of correctly building this feature, not a
  separately-scoped change.

Out of scope: template management (rename/delete), Studio-side re-apply
to an existing project, per-template custom motion sequences (motion
assignment always uses the same alternating cycle via
`regeneratePhotoMotion` — a template does not carry its own motion
sequence data).

## `src/models/projectTemplate.ts`

```ts
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
```

`WaypointSchema`, `VisualTransformSchema`, `StorefrontMotionPresetSchema`,
`TransitionSchema` are all existing exports from `src/models/scenes.ts` —
this schema is composed entirely from types that already exist, deliberately
mirroring the relevant subsets of `MapScene`, `StorefrontScene`, and
`InteriorTourScene` field-for-field so there is no translation layer
between "what a scene has" and "what a template stores."

```ts
export const BUILTIN_PROJECT_TEMPLATE_ID = 'builtin-standard-business-tour';

export function getBuiltinProjectTemplate(): ProjectTemplate
```

`getBuiltinProjectTemplate()` synthesizes the built-in "Standard Local
Business Tour" as a `ProjectTemplate` — not a persisted row. Its
`map.waypoints` come from calling the existing
`createMapSceneFromTemplate(destination)` (from
`src/persistence/templates.ts`, unmodified) with a placeholder destination
and taking `.waypoints` — that function's output waypoints do not actually
depend on the destination passed in (only the returned scene's `id` does;
every waypoint is either the destination-agnostic "Earth" absolute stop or
a `destination-relative` stop), so this is a safe, side-effect-free way to
reuse the existing generator rather than duplicating its 5-stop timing
data. Its `storefront`/`interiorTour` fields are today's exact hardcoded
values from `createDraft.ts`'s `createDefaultStorefrontScene` and the
interior-tour scene literal (`durationMs: 2500`/`durationLocked: false`/
etc. for storefront; `defaultPhotoDurationMs: 4000`/
`defaultTransition: { type: 'crossfade', durationMs: 500 }` for interior
tour) — reproduced as constants, not computed, so this file has no
dependency on `createDraft.ts`.

## `src/persistence/db.ts` (modified)

```ts
interface LocalFlyInStudioDB extends DBSchema {
  projects: { key: string; value: Record<string, unknown> };
  mediaAssets: { key: string; value: Record<string, unknown> };
  templates: { key: string; value: Record<string, unknown> };
}

const DB_VERSION = 2;
```

The `upgrade()` callback gains a third conditional block
(`if (!db.objectStoreNames.contains('templates')) { db.createObjectStore('templates', { keyPath: 'id' }); }`),
following the exact pattern the existing two stores already use.
`DB_VERSION` must move from `1` to `2` — IndexedDB's `upgrade()` callback
only fires when the requested version exceeds the database's current
stored version, so bumping this is what makes the new store actually get
created for installs that already have version-1 databases on disk. This
is a different mechanism from, and in addition to, the per-`Project` Zod
`schemaVersion`/`migrations.ts` that already exists — this bump only adds
a store, it does not migrate any existing data.

## `src/persistence/projectTemplateRepository.ts`

```ts
export async function saveProjectTemplate(template: ProjectTemplate): Promise<void>
export async function listProjectTemplates(): Promise<ProjectTemplate[]>
export async function getProjectTemplate(id: string): Promise<ProjectTemplate | null>
```

Mirrors `projectRepository.ts` exactly: `saveProjectTemplate` calls
`ProjectTemplateSchema.parse(template)` before `db.put('templates',
template)` (defense in depth, same as `saveProject`); `listProjectTemplates`
uses per-record `safeParse` with skip-and-`console.warn` on failure (same
as `listProjects`, post-Phase-4b-review pattern — one corrupt template
must never make the whole list unreachable); `getProjectTemplate` parses
and returns `null` if not found. No `deleteProjectTemplate` this phase
(scope decision above).

## `src/timeline/buildTemplateFromProject.ts`

```ts
export type TemplateBuildError =
  | { reason: 'missing-map' }
  | { reason: 'missing-storefront' }
  | { reason: 'missing-interior-tour' };

export function buildTemplateFromProject(
  project: Project,
  name: string,
): { ok: true; template: ProjectTemplate } | { ok: false; error: TemplateBuildError }
```

A pure function: finds the project's map/storefront/interior-tour scenes
(all three required — returns the corresponding `TemplateBuildError` if
any is missing, rather than silently building a partial template),
extracts exactly the fields `ProjectTemplateSchema` needs from each (no
`assetId`, no `entranceTarget`, no interior `items` — matching the field
lists in the `projectTemplate.ts` section above), and returns a new
`ProjectTemplate` with a fresh `id` (`` `template-${crypto.randomUUID()}` ``)
and `createdAt` (`new Date().toISOString()`). Placed in `src/timeline/`
alongside `bulkEdit.ts` and `scaling.ts` — the other pure functions that
transform scene data — rather than in `models/` or `persistence/`, which
are for schemas and storage respectively, not transformations.

## `src/quickCreate/createDraft.ts` (modified)

```ts
export interface CreateDraftInput {
  storefrontPhoto: File;
  interiorMedia: File[];
  destinationOverride?: Destination;
  template?: ProjectTemplate;
}
```

`createDraft` resolves `const resolvedTemplate = input.template ??
getBuiltinProjectTemplate();` near the top (alongside its existing
destination resolution). Changes from there:

- The map scene is built as
  `{ id: `map-${destination.source}-${crypto.randomUUID()}`, type: 'map', waypoints: resolvedTemplate.map.waypoints }`
  instead of always calling `createMapSceneFromTemplate(destination)`
  directly — `createMapSceneFromTemplate` is still what produces the
  *built-in* template's waypoints (via `getBuiltinProjectTemplate`), but
  `createDraft` itself now only ever reads from the resolved template,
  whichever one it is.
- `createDefaultStorefrontScene(assetId)` stops hardcoding its fields and
  instead spreads `resolvedTemplate.storefront` alongside the
  asset-specific `id`/`type`/`assetId`.
- The interior-tour scene's `defaultPhotoDurationMs`/`defaultTransition`
  come from `resolvedTemplate.interiorTour` instead of the current
  literals; each imported photo item's initial `durationMs` uses
  `resolvedTemplate.interiorTour.defaultPhotoDurationMs` instead of the
  hardcoded `4000`; `applyDefaultTransitions` uses
  `resolvedTemplate.interiorTour.defaultTransition` instead of its current
  hardcoded `{ type: 'crossfade', durationMs: 500 }`.
- `applyDefaultPhotoMotion(orderedItems)` is removed. In its place, once
  the interior-tour scene object exists (after items/defaults are set),
  call `regeneratePhotoMotion` (from `src/timeline/bulkEdit.ts`, Phase 6b,
  unmodified) on it before pushing it into `scenes` — this is the "motion
  sequence" fix described in the scope decisions above, applied uniformly
  regardless of which template was used.
- The returned `Project` gains
  `templateId: resolvedTemplate.id === BUILTIN_PROJECT_TEMPLATE_ID ? undefined : resolvedTemplate.id`
  — the built-in template is not a persisted row, so stamping its
  synthetic id onto every draft would create a dangling reference; only a
  *saved* template's id is meaningful to record. (`templateId` remains
  optional on `Project`, unchanged.)

## `src/components/quick-create/StorefrontStep.tsx` (modified)

Gains a `<select>` above the existing photo picker, labeled "Style",
populated on mount from `[{ id: BUILTIN_PROJECT_TEMPLATE_ID, name: 'Standard Local Business Tour' }, ...(await listProjectTemplates())]`,
defaulting to the built-in entry. The selected template id flows up
through a new `onNext` parameter — `onNext: (file: File, templateId: string | null) => void`
(`null` meaning "use the built-in") — into `QuickCreateWizard`, which
resolves the actual `ProjectTemplate` object (built-in via
`getBuiltinProjectTemplate()`, or fetched via `getProjectTemplate(id)` for
a saved one) and passes it as `createDraft`'s new `template` input.

## `src/components/studio/SaveTemplateControls.tsx` (new)

Structured like `BulkEditControls`/`ScalingControls` — a text input (the
template name) and one button, rendered alongside them at the bottom of
`StudioView`. Clicking the button calls `buildTemplateFromProject(project,
name)`; on `{ ok: true }` it calls `saveProjectTemplate(template)` and
shows a brief confirmation; on `{ ok: false }` it renders a specific
message per `TemplateBuildError` reason (e.g. "This project has no
Interior Tour scene to save into a template." for `missing-interior-tour`)
via the same `role="alert"` convention `ScalingControls`/`ExportPanel`
already use. An empty/blank name is rejected client-side before calling
`buildTemplateFromProject` at all (same "clamp before it reaches the pure
function" discipline as `BulkEditControls`'s duration inputs).

## Testing

- **`buildTemplateFromProject`**: real Vitest coverage using
  `makeMinimalProject`-style fixtures — a complete project produces a
  `ProjectTemplate` with exactly the expected fields (and *not* `assetId`/
  `entranceTarget`/interior `items`); each of the three missing-scene
  cases (`missing-map`/`missing-storefront`/`missing-interior-tour`)
  returns the corresponding `TemplateBuildError` without throwing.
- **`getBuiltinProjectTemplate`**: asserts its `map.waypoints` matches
  `createMapSceneFromTemplate(...).waypoints` for an arbitrary destination
  (proving the destination-independence claim above), and that its
  storefront/interior fields match today's `createDraft.ts` literals
  exactly (a regression guard: if this test needs to change, that's a
  signal the "built-in behavior stays identical" guarantee just broke).
- **`projectTemplateRepository.ts`**: CRUD tests via `fake-indexeddb`,
  mirroring `projectRepository.test.ts` — save/list/get round-trip, and a
  corrupt stored record is skipped (not thrown) by `listProjectTemplates`.
- **`createDraft.test.ts`** gains cases: a custom `template` input
  produces storefront/interior-tour scenes using that template's values
  (not the hardcoded ones); omitting `template` reproduces today's exact
  output (byte-identical map waypoints, storefront fields, interior
  defaults) via `getBuiltinProjectTemplate()`; the resulting interior
  photos' `motionPreset` values come out alternated (matching
  `regeneratePhotoMotion`'s cycle), not uniformly `'push-in'`; a saved
  template's `id` ends up as the draft's `templateId`, while the built-in
  path leaves `templateId` `undefined`.
- **`StorefrontStep.tsx`'s new picker and `SaveTemplateControls.tsx`**:
  not unit-tested (React components, no jsdom in this project's Vitest
  environment — established precedent since Phase 4b) — verified via
  `npx tsc -b` and a real-browser Playwright pass: save a template from a
  populated project, start a new Quick Create draft, confirm the saved
  template appears in the picker (alongside the built-in), and confirm
  applying it produces map/storefront/interior defaults visibly distinct
  from the built-in's (e.g. a different storefront duration).

## Acceptance Criteria

- All new pure-logic/repository Vitest suites pass, alongside every
  existing test unmodified.
- `npm run build` succeeds; no new runtime dependency was added.
- Starting a Quick Create draft without touching the new "Style" picker
  produces an identical project to what Phase 6b's `createDraft` already
  produces today, except that interior photo motion presets now alternate
  instead of all being `'push-in'`.
- Saving a template from a real project and selecting it in a subsequent
  Quick Create draft produces a project whose map waypoints, storefront
  styling, and interior-tour defaults match the saved template, not the
  built-in.
- Attempting to save a template from a project missing a map, storefront,
  or interior-tour scene shows the specific corresponding error and saves
  nothing.

## Out of Scope

Template rename/delete/management UI, Studio-side re-apply of a template
to an existing project, per-template custom motion sequences, validation
or warnings for templates built from absolute (non-destination-relative)
waypoints.
