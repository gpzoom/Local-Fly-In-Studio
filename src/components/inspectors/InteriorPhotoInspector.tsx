import type { Project } from '../../models/project';
import type { InteriorPhotoItem, InteriorTourScene, PhotoMotionPreset, TransitionType } from '../../models/scenes';

const PHOTO_MOTION_PRESETS: PhotoMotionPreset[] = ['push-in', 'pull-out', 'pan-left-right', 'pan-right-left'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface InteriorPhotoInspectorProps {
  project: Project;
  sceneId: string;
  itemId: string;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function InteriorPhotoInspector({ project, sceneId, itemId, updateProject }: InteriorPhotoInspectorProps) {
  const scene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour' && s.id === sceneId);
  const item = scene?.items.find((i): i is InteriorPhotoItem => i.id === itemId && i.type === 'photo');
  if (!scene || !item) return null;

  function updateItem(patch: Partial<InteriorPhotoItem>) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => {
        if (s.id !== sceneId || s.type !== 'interior-tour') return s;
        return {
          ...s,
          items: s.items.map((i) => (i.id === itemId && i.type === 'photo' ? { ...i, ...patch } : i)),
        };
      }),
    }));
  }

  return (
    <div className="inspector interior-photo-inspector">
      <h3>Interior Photo</h3>

      <label>
        Duration (ms)
        <input
          type="number"
          min="0"
          value={item.durationMs}
          onChange={(e) => updateItem({ durationMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={item.durationLocked}
          onChange={(e) => updateItem({ durationLocked: e.target.checked })}
        />
        Lock duration
      </label>

      <label>
        Motion preset
        <select
          value={item.motionPreset}
          onChange={(e) => updateItem({ motionPreset: e.target.value as PhotoMotionPreset })}
        >
          {PHOTO_MOTION_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
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
          min="0"
          value={item.transitionToNext.durationMs}
          onChange={(e) =>
            updateItem({
              transitionToNext: { ...item.transitionToNext, durationMs: Math.max(0, Number(e.target.value) || 0) },
            })
          }
        />
      </fieldset>
    </div>
  );
}
