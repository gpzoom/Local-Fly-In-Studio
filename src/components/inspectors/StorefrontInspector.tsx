import type { Project } from '../../models/project';
import type { StorefrontMotionPreset, StorefrontScene, TransitionType } from '../../models/scenes';

const MOTION_PRESETS: StorefrontMotionPreset[] = ['none', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'custom'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface StorefrontInspectorProps {
  project: Project;
  sceneId: string;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function StorefrontInspector({ project, sceneId, updateProject }: StorefrontInspectorProps) {
  const scene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront' && s.id === sceneId);
  if (!scene) return null;

  function updateScene(patch: Partial<StorefrontScene>) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => (s.id === sceneId && s.type === 'storefront' ? { ...s, ...patch } : s)),
    }));
  }

  return (
    <div className="inspector storefront-inspector">
      <h3>Storefront</h3>

      <label>
        Duration (ms)
        <input
          type="number"
          value={scene.durationMs}
          onChange={(e) => updateScene({ durationMs: Number(e.target.value) })}
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
          value={scene.transitionIn.durationMs}
          onChange={(e) =>
            updateScene({ transitionIn: { ...scene.transitionIn, durationMs: Number(e.target.value) } })
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
          value={scene.transitionOut.durationMs}
          onChange={(e) =>
            updateScene({ transitionOut: { ...scene.transitionOut, durationMs: Number(e.target.value) } })
          }
        />
      </fieldset>

      <p className="inspector-hint">Click the storefront image in the preview above to set the door target.</p>
    </div>
  );
}
