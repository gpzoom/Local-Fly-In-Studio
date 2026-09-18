import { useState } from 'react';
import type { Project } from '../../models/project';
import type { InteriorPhotoItem, InteriorTourScene, PhotoMotionPreset, TransitionType } from '../../models/scenes';
import type { MediaRelinkComparison } from '../../media/relinkMediaAsset';

const PHOTO_MOTION_PRESETS: PhotoMotionPreset[] = ['push-in', 'pull-out', 'pan-left-right', 'pan-right-left'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface InteriorPhotoInspectorProps {
  project: Project;
  sceneId: string;
  itemId: string;
  updateProject: (updater: (project: Project) => Project) => void;
  isMissing: boolean;
  onRelink: (file: File) => Promise<MediaRelinkComparison | null>;
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

export function InteriorPhotoInspector({
  project,
  sceneId,
  itemId,
  updateProject,
  isMissing,
  onRelink,
}: InteriorPhotoInspectorProps) {
  const [relinkNote, setRelinkNote] = useState<string | null>(null);
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

  async function handleRelinkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const comparison = await onRelink(file);
    // null means the relink itself failed — StudioView already surfaced that via its own
    // error banner, so there's no comparison to report here.
    if (!comparison) return;
    setRelinkNote(describeMismatches(comparison));
  }

  if (isMissing) {
    return (
      <div className="inspector interior-photo-inspector">
        <h3>Interior Photo</h3>
        <p role="alert">Interior photo is missing.</p>
        <label>
          Relink file
          <input type="file" accept="image/*" onChange={(e) => void handleRelinkFile(e)} />
        </label>
      </div>
    );
  }

  return (
    <div className="inspector interior-photo-inspector">
      <h3>Interior Photo</h3>

      {relinkNote && <p role="status">{relinkNote}</p>}

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
