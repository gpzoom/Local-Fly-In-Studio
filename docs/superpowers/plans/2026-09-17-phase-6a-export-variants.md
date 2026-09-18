# Phase 6a: Export Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user export a project as Complete Video, Fly-In Only, Fly-In + Storefront, or Interior Tour Only, reusing the existing Phase 5 compositor/recording pipeline unchanged.

**Architecture:** A new pure module filters a `Project`'s `scenes` array down to the scene types a variant needs before the existing `compileProjectTimeline` ever sees it — the compiler, evaluator, compositor, and audio graph all stay untouched. `ExportPanel` gains a variant picker on its idle screen; `runExport` gains one optional field.

**Tech Stack:** TypeScript, Vitest (`environment: 'node'`) for the new pure module, React for the panel UI change — no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-17-phase-6a-export-variants-design.md`

## Global Constraints

- No new npm dependency.
- The variant picker lives inside the existing `ExportPanel` (one panel, one flow) — not separate buttons/entry points.
- `filterProjectForVariant`/`isVariantAvailable` must be pure (no browser APIs) so they get real Vitest coverage; `compiler.ts`, `evaluator.ts`, `frameCompositor.ts`, and `audioGraph.ts` are NOT modified by this plan.
- Omitting `variant` from `ExportOptions` must reproduce today's Complete Video behavior exactly (existing callers/tests stay valid unmodified).
- Interior Tour Only must be disabled (not just failing at export time) when the project has no interior-tour scene, or one with zero items.
- Complete Video's downloaded filename is unchanged (`${projectName}.${extension}`); the 3 new variants append `` ` - ${label}` `` using the same label text the picker shows.
- Every file must leave `npx tsc -b` clean and every Vitest suite passing (existing suites unmodified, all new ones green).

---

### Task 1: Export variant filtering module

**Files:**
- Create: `src/export/exportVariants.ts`
- Test: `src/tests/exportVariants.test.ts`

**Interfaces:**
- Consumes: `Project` (`src/models/project.ts`, existing), `InteriorTourScene`/`ProjectScene` (`src/models/scenes.ts`, existing — `ProjectScene['type']` is `'map' | 'storefront' | 'interior-tour'`; `InteriorTourScene` has `items: InteriorTourItem[]`). `makeMinimalProject` test fixture (`src/tests/fixtures.ts`, existing — builds a `Project` with one `map`, one `storefront`, and one `interior-tour` scene containing exactly one photo item).
- Produces: `export type ExportVariant = 'complete' | 'fly-in-only' | 'fly-in-storefront' | 'interior-tour-only';`, `export const EXPORT_VARIANTS: readonly ExportVariant[]` (PRD order), `export const EXPORT_VARIANT_LABELS: Record<ExportVariant, string>`, `export function filterProjectForVariant(project: Project, variant: ExportVariant): Project`, `export function isVariantAvailable(project: Project, variant: ExportVariant): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/exportVariants.test.ts
import { describe, it, expect } from 'vitest';
import {
  filterProjectForVariant,
  isVariantAvailable,
  EXPORT_VARIANT_LABELS,
} from '../export/exportVariants';
import { makeMinimalProject } from './fixtures';
import type { InteriorTourScene } from '../models/scenes';

describe('filterProjectForVariant', () => {
  it('returns the same project reference for the complete variant', () => {
    const project = makeMinimalProject();
    expect(filterProjectForVariant(project, 'complete')).toBe(project);
  });

  it('fly-in-only keeps only the map scene', () => {
    const project = makeMinimalProject();
    const filtered = filterProjectForVariant(project, 'fly-in-only');
    expect(filtered.scenes.map((s) => s.type)).toEqual(['map']);
  });

  it('fly-in-storefront keeps the map and storefront scenes, in original order', () => {
    const project = makeMinimalProject();
    const filtered = filterProjectForVariant(project, 'fly-in-storefront');
    expect(filtered.scenes.map((s) => s.type)).toEqual(['map', 'storefront']);
  });

  it('interior-tour-only keeps only the interior-tour scene', () => {
    const project = makeMinimalProject();
    const filtered = filterProjectForVariant(project, 'interior-tour-only');
    expect(filtered.scenes.map((s) => s.type)).toEqual(['interior-tour']);
  });

  it('preserves every other project field unchanged', () => {
    const project = makeMinimalProject();
    const filtered = filterProjectForVariant(project, 'fly-in-only');
    expect(filtered.destination).toBe(project.destination);
    expect(filtered.videoSettings).toBe(project.videoSettings);
    expect(filtered.projectName).toBe(project.projectName);
  });
});

describe('isVariantAvailable', () => {
  it('is always true for complete, fly-in-only, and fly-in-storefront, even with no scenes', () => {
    const project = makeMinimalProject({ scenes: [] });
    expect(isVariantAvailable(project, 'complete')).toBe(true);
    expect(isVariantAvailable(project, 'fly-in-only')).toBe(true);
    expect(isVariantAvailable(project, 'fly-in-storefront')).toBe(true);
  });

  it('is true for interior-tour-only when the scene has at least one item', () => {
    const project = makeMinimalProject();
    expect(isVariantAvailable(project, 'interior-tour-only')).toBe(true);
  });

  it('is false for interior-tour-only when there is no interior-tour scene', () => {
    const project = makeMinimalProject();
    const withoutInterior = {
      ...project,
      scenes: project.scenes.filter((s) => s.type !== 'interior-tour'),
    };
    expect(isVariantAvailable(withoutInterior, 'interior-tour-only')).toBe(false);
  });

  it('is false for interior-tour-only when the interior-tour scene has zero items', () => {
    const project = makeMinimalProject();
    const emptyScenes = project.scenes.map((scene) =>
      scene.type === 'interior-tour' ? ({ ...scene, items: [] } as InteriorTourScene) : scene,
    );
    const emptyProject = { ...project, scenes: emptyScenes };
    expect(isVariantAvailable(emptyProject, 'interior-tour-only')).toBe(false);
  });
});

describe('EXPORT_VARIANT_LABELS', () => {
  it('has the exact PRD label for every variant', () => {
    expect(EXPORT_VARIANT_LABELS.complete).toBe('Complete Video');
    expect(EXPORT_VARIANT_LABELS['fly-in-only']).toBe('Fly-In Only');
    expect(EXPORT_VARIANT_LABELS['fly-in-storefront']).toBe('Fly-In + Storefront');
    expect(EXPORT_VARIANT_LABELS['interior-tour-only']).toBe('Interior Tour Only');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- exportVariants`
Expected: FAIL (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/export/exportVariants.ts
import type { Project } from '../models/project';
import type { InteriorTourScene, ProjectScene } from '../models/scenes';

export type ExportVariant = 'complete' | 'fly-in-only' | 'fly-in-storefront' | 'interior-tour-only';

/** PRD order (§49): Complete Video, Fly-In Only, Fly-In + Storefront, Interior Tour Only. */
export const EXPORT_VARIANTS: readonly ExportVariant[] = [
  'complete',
  'fly-in-only',
  'fly-in-storefront',
  'interior-tour-only',
];

export const EXPORT_VARIANT_LABELS: Record<ExportVariant, string> = {
  complete: 'Complete Video',
  'fly-in-only': 'Fly-In Only',
  'fly-in-storefront': 'Fly-In + Storefront',
  'interior-tour-only': 'Interior Tour Only',
};

const VARIANT_SCENE_TYPES: Record<Exclude<ExportVariant, 'complete'>, ProjectScene['type'][]> = {
  'fly-in-only': ['map'],
  'fly-in-storefront': ['map', 'storefront'],
  'interior-tour-only': ['interior-tour'],
};

export function filterProjectForVariant(project: Project, variant: ExportVariant): Project {
  if (variant === 'complete') return project;
  const allowedTypes = VARIANT_SCENE_TYPES[variant];
  return { ...project, scenes: project.scenes.filter((scene) => allowedTypes.includes(scene.type)) };
}

export function isVariantAvailable(project: Project, variant: ExportVariant): boolean {
  if (variant !== 'interior-tour-only') return true;
  const interiorScene = project.scenes.find(
    (scene): scene is InteriorTourScene => scene.type === 'interior-tour',
  );
  return !!interiorScene && interiorScene.items.length > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- exportVariants`
Expected: PASS, all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/export/exportVariants.ts src/tests/exportVariants.test.ts
git commit -m "feat: add export variant filtering"
```

---

### Task 2: Wire `variant` into the export runner

**Files:**
- Modify: `src/export/exportRunner.ts`

**Interfaces:**
- Consumes: `ExportVariant`, `filterProjectForVariant` (Task 1, `src/export/exportVariants.ts`).
- Produces: `ExportOptions` gains `variant?: ExportVariant`. Task 3 (`ExportPanel`) passes this field.

Not unit-tested (same reason as the rest of this file — no jsdom/real `MediaRecorder`/Cesium in this Vitest environment) — verified via `npx tsc -b` here and the real-browser pass in Task 4.

- [ ] **Step 1: Add the import**

In `src/export/exportRunner.ts`, add to the imports (after the existing `createExportAudioGraph` import):

```ts
import { filterProjectForVariant, type ExportVariant } from './exportVariants';
```

- [ ] **Step 2: Add `variant` to `ExportOptions`**

Change:

```ts
export interface ExportOptions {
  project: Project;
  viewer: Viewer;
  outputCanvas: HTMLCanvasElement;
  mediaAssetStore: MediaAssetStore;
  onProgress: (elapsedMs: number, totalMs: number) => void;
  signal: AbortSignal;
  selectMimeType?: () => CodecSelection | null;
```

to:

```ts
export interface ExportOptions {
  project: Project;
  viewer: Viewer;
  outputCanvas: HTMLCanvasElement;
  mediaAssetStore: MediaAssetStore;
  onProgress: (elapsedMs: number, totalMs: number) => void;
  signal: AbortSignal;
  variant?: ExportVariant;
  selectMimeType?: () => CodecSelection | null;
```

(the rest of the interface — `now?`, `requestAnimationFrame?`, `cancelAnimationFrame?`, `AudioContextCtor?` — is unchanged).

- [ ] **Step 3: Filter the project before anything else uses it**

Change the start of `runExport` from:

```ts
export async function runExport(options: ExportOptions): Promise<Blob> {
  const {
    project,
    viewer,
    outputCanvas,
    mediaAssetStore,
    onProgress,
    signal,
    selectMimeType = selectExportMimeType,
    now = () => performance.now(),
    requestAnimationFrame: raf = (cb: FrameRequestCallback) => globalThis.requestAnimationFrame(cb),
    cancelAnimationFrame: caf = (handle: number) => globalThis.cancelAnimationFrame(handle),
    AudioContextCtor,
  } = options;

  const codec = selectMimeType();
  if (!codec) {
    throw new Error('No supported video format is available in this browser.');
  }

  const timeline = compileProjectTimeline(project);
```

to:

```ts
export async function runExport(options: ExportOptions): Promise<Blob> {
  const {
    project: rawProject,
    viewer,
    outputCanvas,
    mediaAssetStore,
    onProgress,
    signal,
    variant,
    selectMimeType = selectExportMimeType,
    now = () => performance.now(),
    requestAnimationFrame: raf = (cb: FrameRequestCallback) => globalThis.requestAnimationFrame(cb),
    cancelAnimationFrame: caf = (handle: number) => globalThis.cancelAnimationFrame(handle),
    AudioContextCtor,
  } = options;

  // Every later reference to `project` in this function is deliberately the FILTERED project —
  // renaming the destructured field to `rawProject` here means nothing below needs to change.
  const project = filterProjectForVariant(rawProject, variant ?? 'complete');

  const codec = selectMimeType();
  if (!codec) {
    throw new Error('No supported video format is available in this browser.');
  }

  const timeline = compileProjectTimeline(project);
```

Every other line in the file (media resolution, audio graph, the recording loop, cleanup) already refers to `project` by that name and needs no further change — they now transparently operate on the filtered project.

- [ ] **Step 4: Verify compilation and the full test suite**

Run: `npx tsc -b && npm test`
Expected: clean compile, all suites (existing + Task 1's new one) passing.

- [ ] **Step 5: Commit**

```bash
git add src/export/exportRunner.ts
git commit -m "feat: filter the export by variant before compiling the timeline"
```

---

### Task 3: Variant picker in the Export panel

**Files:**
- Modify: `src/components/studio/ExportPanel.tsx`
- Modify: `src/components/studio/ExportPanel.css`

**Interfaces:**
- Consumes: `ExportVariant`, `EXPORT_VARIANTS`, `EXPORT_VARIANT_LABELS`, `isVariantAvailable` (Task 1, `src/export/exportVariants.ts`); `ExportOptions.variant` (Task 2, `src/export/exportRunner.ts`).
- Produces: nothing new for later tasks — this is the final source-code integration point for this plan.

Not unit-tested (same reason as the rest of this file) — verified via `npx tsc -b` here and the real-browser pass in Task 4.

- [ ] **Step 1: Add the import and `variant` state**

In `src/components/studio/ExportPanel.tsx`, add to the imports (after the existing `runExport` import):

```ts
import {
  EXPORT_VARIANTS,
  EXPORT_VARIANT_LABELS,
  isVariantAvailable,
  type ExportVariant,
} from '../../export/exportVariants';
```

Change the state declarations from:

```tsx
  const [state, setState] = useState<ExportPanelState>(() => ({
    phase: 'idle',
    capabilities: checkExportCapabilities(viewer.scene.canvas),
  }));
```

to:

```tsx
  const [state, setState] = useState<ExportPanelState>(() => ({
    phase: 'idle',
    capabilities: checkExportCapabilities(viewer.scene.canvas),
  }));
  const [variant, setVariant] = useState<ExportVariant>('complete');
```

- [ ] **Step 2: Pass `variant` into `runExport` and derive the filename from it**

Change:

```tsx
      const mediaAssetStore = await createMediaAssetStore();
      const blob = await runExport({
        project,
        viewer,
        outputCanvas: canvasRef.current,
        mediaAssetStore,
        onProgress: (elapsedMs, totalMs) => {
          if (!mountedRef.current) return;
          const second = Math.floor(elapsedMs / 1000);
          if (second === lastReportedSecond) return;
          lastReportedSecond = second;
          setState({ phase: 'recording', elapsedMs, totalMs });
        },
        signal: abortController.signal,
      });
      const url = URL.createObjectURL(blob);
      if (!mountedRef.current) {
        // The component unmounted while the export was finishing (its own cleanup effect
        // already ran and revoked whatever was in objectUrlRef at that time, so it will
        // never see this URL), so nothing else will ever revoke it unless we do it here.
        URL.revokeObjectURL(url);
        return;
      }
      objectUrlRef.current = url;
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      setState({ phase: 'done', url, filename: `${project.projectName}.${extension}` });
```

to:

```tsx
      const mediaAssetStore = await createMediaAssetStore();
      const blob = await runExport({
        project,
        viewer,
        outputCanvas: canvasRef.current,
        mediaAssetStore,
        variant,
        onProgress: (elapsedMs, totalMs) => {
          if (!mountedRef.current) return;
          const second = Math.floor(elapsedMs / 1000);
          if (second === lastReportedSecond) return;
          lastReportedSecond = second;
          setState({ phase: 'recording', elapsedMs, totalMs });
        },
        signal: abortController.signal,
      });
      const url = URL.createObjectURL(blob);
      if (!mountedRef.current) {
        // The component unmounted while the export was finishing (its own cleanup effect
        // already ran and revoked whatever was in objectUrlRef at that time, so it will
        // never see this URL), so nothing else will ever revoke it unless we do it here.
        URL.revokeObjectURL(url);
        return;
      }
      objectUrlRef.current = url;
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      // Complete Video keeps today's exact filename unchanged; the 3 new variants append the
      // same label text the picker shows, so the UI and the downloaded filename always agree.
      const filename =
        variant === 'complete'
          ? `${project.projectName}.${extension}`
          : `${project.projectName} - ${EXPORT_VARIANT_LABELS[variant]}.${extension}`;
      setState({ phase: 'done', url, filename });
```

- [ ] **Step 3: Add the variant picker to the idle-phase render**

Change:

```tsx
        {state.phase === 'idle' && (
          <div className="export-panel-body">
            <p>
              Exporting at {project.videoSettings.widthPx}&times;{project.videoSettings.heightPx},{' '}
              {project.videoSettings.fps}fps
            </p>
            {state.capabilities.blockingIssues.length > 0 && (
              <ul className="export-panel-issues">
                {state.capabilities.blockingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <button type="button" disabled={!state.capabilities.canRecord} onClick={() => void handleStart()}>
              Start
            </button>
          </div>
        )}
```

to:

```tsx
        {state.phase === 'idle' && (
          <div className="export-panel-body">
            <p>
              Exporting at {project.videoSettings.widthPx}&times;{project.videoSettings.heightPx},{' '}
              {project.videoSettings.fps}fps
            </p>
            <fieldset className="export-panel-variant-picker">
              <legend>What to export</legend>
              {EXPORT_VARIANTS.map((v) => {
                const available = isVariantAvailable(project, v);
                return (
                  <label key={v} className="export-panel-variant-option">
                    <input
                      type="radio"
                      name="export-variant"
                      value={v}
                      checked={variant === v}
                      disabled={!available}
                      onChange={() => setVariant(v)}
                    />
                    {EXPORT_VARIANT_LABELS[v]}
                    {!available && (
                      <span className="export-panel-variant-unavailable">
                        This project has no Interior Tour content.
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
            {state.capabilities.blockingIssues.length > 0 && (
              <ul className="export-panel-issues">
                {state.capabilities.blockingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <button type="button" disabled={!state.capabilities.canRecord} onClick={() => void handleStart()}>
              Start
            </button>
          </div>
        )}
```

- [ ] **Step 4: Add the picker's CSS**

In `src/components/studio/ExportPanel.css`, add after the existing `.export-panel-canvas` rule:

```css
.export-panel-variant-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px 10px;
}

.export-panel-variant-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.export-panel-variant-unavailable {
  color: #888;
  font-size: 11px;
  margin-left: 4px;
}
```

- [ ] **Step 5: Verify compilation and the full test suite**

Run: `npx tsc -b && npm test`
Expected: clean compile, all suites (existing + Task 1's new one) passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/ExportPanel.tsx src/components/studio/ExportPanel.css
git commit -m "feat: add export variant picker to ExportPanel"
```

---

### Task 4: Real-browser end-to-end verification

**Files:** none (verification only — no source changes expected; fix forward in the relevant file from Tasks 1-3 if this surfaces a real bug).

This task exercises what Tasks 2/3 could not unit-test: that each variant actually produces a correctly-scoped recorded file, and that the availability gating behaves correctly in a real browser. Run `npm run dev` first and navigate to it with `browser_navigate` (Playwright MCP tools).

- [ ] **Step 1: Confirm a clean baseline**

Run: `npx tsc -b && npm test && npm run build`
Expected: clean compile, full suite green, successful production build. Confirm `package.json`/`package-lock.json` are untouched.

- [ ] **Step 2: Create a project with interior tour content and verify all 4 variants**

Using the Playwright tools: create (via Quick Create) a project with a storefront photo and at least one interior photo (a synthetic JPEG generated via `browser_evaluate` — draw onto a canvas and `canvas.toBlob(..., 'image/jpeg')` — is sufficient; no video/audio is needed for this task). Open Studio, click Export. Use `browser_snapshot` to confirm all 4 variant radios are visible, in PRD order, "Complete Video" selected by default, and all 4 are enabled (since this project has interior tour content).

For each of the 4 variants in turn: select it, click Start, wait for the `done` phase, and via `browser_evaluate` fetch the resulting blob URL and confirm its size is greater than 0. Confirm the downloaded filename shown matches the spec's convention (bare `<projectName>.<ext>` for Complete Video; `<projectName> - <Label>.<ext>` for the other 3). Confirm each variant's elapsed recording time (visible in the `recording` phase) is roughly proportional to what that variant should contain — the Fly-In Only and Fly-In + Storefront exports should be visibly shorter than Complete Video (no interior tour duration), and Interior Tour Only should be visibly shorter than Complete Video too (no map/storefront duration).

- [ ] **Step 3: Verify Interior Tour Only's gating on a project with no interior content**

Create a second project via Quick Create with a storefront photo but zero interior media (skip the interior tour step's file input entirely, if the flow allows creating a draft with no interior items — confirm this is possible; if the wizard requires at least one interior file, note that in your report and instead test gating by using `browser_evaluate` to directly manipulate the in-memory project's `scenes` array via the app's Zustand store to remove the interior-tour scene's items, if `window`-exposed, or by constructing a project through the IndexedDB layer directly — use whichever approach the app's actual architecture allows). Open Studio, click Export, and use `browser_snapshot` to confirm the "Interior Tour Only" radio is disabled and shows "This project has no Interior Tour content."

- [ ] **Step 4: Record the outcome**

If every check in Steps 2-3 passes, this task is complete — no commit needed (verification only). If any step surfaces a real defect, fix it in the relevant file from Tasks 1-3, re-run `npx tsc -b && npm test`, repeat the failed verification step, and commit the fix with a message describing what was wrong (e.g. `fix: <description>`).

---
