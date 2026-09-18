import { useState } from 'react';
import type { Project } from '../../models/project';
import type { FitMode, InteriorTourScene, InteriorVideoItem, TransitionType } from '../../models/scenes';
import type { MediaRelinkComparison } from '../../media/relinkMediaAsset';

const FIT_MODES: FitMode[] = ['cover', 'contain'];
const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface InteriorVideoInspectorProps {
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

export function InteriorVideoInspector({
  project,
  sceneId,
  itemId,
  updateProject,
  isMissing,
  onRelink,
}: InteriorVideoInspectorProps) {
  const [relinkNote, setRelinkNote] = useState<string | null>(null);
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
      <div className="inspector interior-video-inspector">
        <h3>Interior Video</h3>
        <p role="alert">Interior video is missing.</p>
        <label>
          Relink file
          <input type="file" accept="video/*" onChange={(e) => void handleRelinkFile(e)} />
        </label>
      </div>
    );
  }

  return (
    <div className="inspector interior-video-inspector">
      <h3>Interior Video</h3>

      {relinkNote && <p role="status">{relinkNote}</p>}

      <label>
        Trim start (ms)
        <input
          type="number"
          min="0"
          value={item.trimStartMs}
          onChange={(e) => updateItem({ trimStartMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        Trim end (ms)
        <input
          type="number"
          min="0"
          value={item.trimEndMs}
          onChange={(e) => updateItem({ trimEndMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        Playback rate
        <input
          type="number"
          step="0.1"
          min="0.1"
          value={item.playbackRate}
          onChange={(e) => updateItem({ playbackRate: Math.max(0.1, Number(e.target.value) || 0.1) })}
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
