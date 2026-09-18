# Phase 6a: Export Variants — Design Spec

Date: 2026-09-17
Status: Approved for implementation planning

## Context

Local Fly-In Studio's full product scope is defined in:

- `../../../Local Fly-In Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up)
- `../../../Claude Code Build Prompt — Local Fly-In Studio v3.0.md`

Phases 1-5 are complete and merged: data model/persistence, the timeline
engine, media ingestion, the Cesium viewer + Quick Create flow, the Studio
desktop editor, and the Output Compositor + Export pipeline (Export
Complete Video only, via `runExport`/`ExportPanel`).

Phase 6 as a whole covers several independent subsystems (templates, bulk
edit, media relinking, the remaining export variants, polish, README).
This spec covers only the first of those: **the 3 remaining export
variants** from PRD §49 — Fly-In Only, Fly-In + Storefront, and Interior
Tour Only. The other Phase 6 subsystems are separate specs.

## Goal

Let the user export a project as one of 4 variants instead of only
Complete Video:

- **Complete Video** (existing) — map + storefront + interior tour.
- **Fly-In Only** — map scene only.
- **Fly-In + Storefront** — map + storefront scenes, no interior tour.
  Per the PRD, useful when the interior footage will be finished
  separately in an NLE (DaVinci Resolve, etc.).
- **Interior Tour Only** — interior tour scene only.

All 4 variants reuse the exact same compositor/recording pipeline built in
Phase 5 (`compositeFrame`, `runExport`, `MediaRecorder`, the Web Audio
graph) — nothing about how a frame is drawn or recorded changes. The only
new work is deciding, per variant, what to feed that pipeline.

## Scope decisions

- **Variant picker lives in the existing `ExportPanel`**, not as separate
  buttons/entry points. One panel, one flow — decided during
  brainstorming.
- **Filter the `Project` before compiling**, rather than modifying
  `compileProjectTimeline` or post-processing a `CompiledTimeline`. The
  compiler already treats "scene absent" as "build nothing for it" (a
  storefront's `transitionOut` is only ever consumed as the interior
  tour's incoming transition, so excluding the interior tour means it is
  simply never referenced — no dangling fade-to-black, no re-basing of
  timestamps needed). This keeps `compiler.ts`/`evaluator.ts`/
  `frameCompositor.ts`/`audioGraph.ts` completely unmodified.
- **Interior Tour Only is conditionally available.** A project always has
  a map and storefront scene (Quick Create requires both), but the
  interior tour is optional — a draft can be created with zero interior
  media. The panel disables that radio option (with an inline reason)
  rather than letting the user pick it and fail at export time.

Out of scope for this spec (left for other Phase 6 specs or future work):
templates, bulk edit, media relinking, resolution/fps choices beyond what
Phase 5 already supports, any change to the underlying compositor/audio
pipeline itself.

## `src/export/exportVariants.ts`

```ts
export type ExportVariant =
  | 'complete'
  | 'fly-in-only'
  | 'fly-in-storefront'
  | 'interior-tour-only';

export const EXPORT_VARIANT_LABELS: Record<ExportVariant, string> = {
  complete: 'Complete Video',
  'fly-in-only': 'Fly-In Only',
  'fly-in-storefront': 'Fly-In + Storefront',
  'interior-tour-only': 'Interior Tour Only',
};

export function filterProjectForVariant(project: Project, variant: ExportVariant): Project

export function isVariantAvailable(project: Project, variant: ExportVariant): boolean
```

- `filterProjectForVariant`: for `'complete'`, returns `project` unchanged
  (identity — no clone needed since nothing downstream mutates it). For
  every other variant, returns a shallow clone of `project` whose `scenes`
  array is filtered to only the scene `type`s that variant needs:
  `fly-in-only` → `['map']`; `fly-in-storefront` → `['map',
  'storefront']`; `interior-tour-only` → `['interior-tour']`. Every other
  field of `Project` (destination, mediaAssets, videoSettings, etc.) is
  passed through unchanged — `compileProjectTimeline` only ever reads
  `project.scenes` and `project.destination`, both still present and
  correct for the filtered scenes.
- `isVariantAvailable`: `true` for every variant except
  `'interior-tour-only'`, which requires `project.scenes` to contain an
  `interior-tour` scene with a non-empty `items` array. This is a pure
  function of project content — no browser APIs, no async.

Both functions are pure and get full Vitest coverage (no DI needed — they
touch no browser API).

## `src/export/exportRunner.ts` (modified)

`ExportOptions` gains one new optional field:

```ts
export interface ExportOptions {
  // ...existing fields unchanged...
  variant?: ExportVariant;
}
```

`runExport` calls `filterProjectForVariant(options.project, options.variant
?? 'complete')` once, at the very top (before `compileProjectTimeline`),
and uses the filtered project for the rest of the function exactly as it
already uses `project` today — every other line of `runExport` is
unchanged. Omitting `variant` reproduces today's Complete Video behavior
exactly, so existing callers and the Phase 5 real-browser verification
remain valid without modification.

No changes to `compileProjectTimeline`, `evaluateProjectTimeline`,
`compositeFrame`, or `createExportAudioGraph` — none of them are variant-
aware, and none need to be. A variant with no video segments (Fly-In Only,
Fly-In + Storefront) naturally produces an empty `videoEntries` array,
which `createExportAudioGraph` already handles gracefully (returns a valid
audio graph with zero source nodes — covered by an existing Phase 5 test).

## `src/components/studio/ExportPanel.tsx` (modified)

The `idle` phase gains a variant picker (a radio group) above the existing
read-only `videoSettings` display, defaulting to `'complete'`:

- One radio input per `ExportVariant`, labeled via
  `EXPORT_VARIANT_LABELS`, in PRD order (Complete Video, Fly-In Only,
  Fly-In + Storefront, Interior Tour Only).
- The `interior-tour-only` radio is `disabled` when
  `isVariantAvailable(project, 'interior-tour-only')` is `false`, with a
  short inline note directly under it: "This project has no Interior Tour
  content." — computed once (same `useState` lazy-init pattern the
  capabilities check already uses), not re-checked per click.
- Selecting a variant does NOT re-run `checkExportCapabilities` — that
  check is about browser support, unrelated to project content, and stays
  a one-time on-mount check as it is today.
- `handleStart` passes the selected `variant` into `runExport`'s options.
- Filename: Complete Video keeps today's exact filename
  (`${project.projectName}.${extension}`, unchanged, so no existing
  behavior shifts) — the 3 new variants append a suffix using the same
  label text the picker shows:
  `` `${project.projectName} - ${EXPORT_VARIANT_LABELS[variant]}.${extension}` ``,
  e.g. `"My Business - Fly-In Only.mp4"`.

No other part of `ExportPanel`'s state machine (`recording`/`done`/
`error`) changes.

## Testing

- **`exportVariants.ts`**: real Vitest coverage using plain fixture
  `Project` objects (one with an interior tour scene containing items, one
  without, one with an interior tour scene present but `items: []`).
  Cases: each variant's `filterProjectForVariant` output has exactly the
  expected `scenes` types and nothing else (and `'complete'` returns the
  literal same object reference, not a clone); `isVariantAvailable`
  returns `true` for `'complete'`/`'fly-in-only'`/`'fly-in-storefront'`
  regardless of interior tour content, and `false` for
  `'interior-tour-only'` on both the no-scene and empty-items fixtures,
  `true` on the with-items fixture.
- **`exportRunner.ts`**'s new `variant` handling and **`ExportPanel.tsx`**'s
  new picker: not unit-tested, same reason as the rest of these two files
  (no jsdom/real `MediaRecorder`/Cesium) — verified via `npx tsc -b` and a
  real-browser Playwright pass: export each of the 4 variants on a project
  that has interior tour content and confirm each downloaded file has a
  duration/content matching only its intended scenes; confirm Interior
  Tour Only is disabled with the stated reason on a project that has none.

## Acceptance Criteria

- `exportVariants.test.ts` passes, alongside every existing test
  unmodified.
- `npm run build` succeeds; no new runtime dependency was added.
- Exporting Complete Video produces byte-for-byte the same behavior as
  before this phase (same filename convention, same content).
- Exporting Fly-In Only, Fly-In + Storefront, and Interior Tour Only each
  produce a real, playable file containing only their intended scene(s),
  with the correct total duration for that subset.
- Interior Tour Only is disabled with a specific, visible reason on a
  project with no interior tour content, and becomes enabled once such
  content exists.

## Out of scope

Templates, bulk edit, media relinking, any resolution/fps change, any
change to `compositeFrame`/`createExportAudioGraph`/the recording
mechanism itself. These remain exactly as Phase 5 built them.
