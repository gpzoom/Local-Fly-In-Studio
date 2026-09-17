import type { Project } from '../../models/project';
import type { FitMode, InteriorTourScene, InteriorVideoItem, TransitionType } from '../../models/scenes';

const FIT_MODES: FitMode[] = ['cover', 'contain'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface InteriorVideoInspectorProps {
  project: Project;
  sceneId: string;
  itemId: string;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function InteriorVideoInspector({ project, sceneId, itemId, updateProject }: InteriorVideoInspectorProps) {
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

  return (
    <div className="inspector interior-video-inspector">
      <h3>Interior Video</h3>

      <label>
        Trim start (ms)
        <input
          type="number"
          value={item.trimStartMs}
          onChange={(e) => updateItem({ trimStartMs: Number(e.target.value) })}
        />
      </label>
      <label>
        Trim end (ms)
        <input
          type="number"
          value={item.trimEndMs}
          onChange={(e) => updateItem({ trimEndMs: Number(e.target.value) })}
        />
      </label>
      <label>
        Playback rate
        <input
          type="number"
          step="0.1"
          min="0.1"
          value={item.playbackRate}
          onChange={(e) => updateItem({ playbackRate: Number(e.target.value) })}
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
          value={item.transitionToNext.durationMs}
          onChange={(e) =>
            updateItem({ transitionToNext: { ...item.transitionToNext, durationMs: Number(e.target.value) } })
          }
        />
      </fieldset>
    </div>
  );
}
