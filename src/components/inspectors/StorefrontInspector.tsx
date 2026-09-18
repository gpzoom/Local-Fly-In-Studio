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
