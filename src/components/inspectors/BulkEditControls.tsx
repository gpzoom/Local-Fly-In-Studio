// src/components/inspectors/BulkEditControls.tsx
import { useState } from 'react';
import {
  setAllPhotoDurations,
  setAllTransitionTypes,
  setAllTransitionDurations,
  regeneratePhotoMotion,
} from '../../timeline/bulkEdit';
import type { Project } from '../../models/project';
import type { InteriorTourScene, TransitionType } from '../../models/scenes';

const TRANSITION_TYPES: TransitionType[] = ['cut', 'crossfade', 'fade-black'];

interface BulkEditControlsProps {
  project: Project;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function BulkEditControls({ project, updateProject }: BulkEditControlsProps) {
  const [photoDurationMs, setPhotoDurationMs] = useState('4000');
  const [transitionType, setTransitionType] = useState<TransitionType>('crossfade');
  const [transitionDurationMs, setTransitionDurationMs] = useState('500');

  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');

  function updateInteriorScene(updater: (scene: InteriorTourScene) => InteriorTourScene) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((s) => (s.type === 'interior-tour' ? updater(s) : s)),
    }));
  }

  function applySetAllPhotoDurations() {
    const durationMs = Math.max(0, Number(photoDurationMs) || 0);
    updateInteriorScene((scene) => setAllPhotoDurations(scene, durationMs));
  }

  function applySetAllTransitionTypes() {
    updateInteriorScene((scene) => setAllTransitionTypes(scene, transitionType));
  }

  function applySetAllTransitionDurations() {
    const durationMs = Math.max(0, Number(transitionDurationMs) || 0);
    updateInteriorScene((scene) => setAllTransitionDurations(scene, durationMs));
  }

  function applyRegeneratePhotoMotion() {
    updateInteriorScene((scene) => regeneratePhotoMotion(scene));
  }

  return (
    <div className="inspector bulk-edit-controls">
      <h3>Bulk Edit — Interior Tour</h3>

      <label>
        Photo duration (ms)
        <input
          type="number"
          min="0"
          value={photoDurationMs}
          onChange={(e) => setPhotoDurationMs(e.target.value)}
        />
      </label>
      <div className="bulk-edit-controls-actions">
        <button type="button" disabled={!interiorScene} onClick={applySetAllPhotoDurations}>
          Set All Photo Durations
        </button>
      </div>

      <fieldset>
        <legend>Transition to next</legend>
        <select value={transitionType} onChange={(e) => setTransitionType(e.target.value as TransitionType)}>
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <div className="bulk-edit-controls-actions">
          <button type="button" disabled={!interiorScene} onClick={applySetAllTransitionTypes}>
            Set All Transitions
          </button>
        </div>

        <input
          type="number"
          min="0"
          value={transitionDurationMs}
          onChange={(e) => setTransitionDurationMs(e.target.value)}
        />
        <div className="bulk-edit-controls-actions">
          <button type="button" disabled={!interiorScene} onClick={applySetAllTransitionDurations}>
            Set All Transition Durations
          </button>
        </div>
      </fieldset>

      <div className="bulk-edit-controls-actions">
        <button type="button" disabled={!interiorScene} onClick={applyRegeneratePhotoMotion}>
          Regenerate Photo Motion
        </button>
      </div>
    </div>
  );
}
