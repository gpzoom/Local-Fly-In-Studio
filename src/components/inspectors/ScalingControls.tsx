// src/components/inspectors/ScalingControls.tsx
import { useState } from 'react';
import { fitMapToDuration, fitInteriorTourToDuration, fitProjectToDuration, TimelineScalingError } from '../../timeline/scaling';
import type { Project } from '../../models/project';
import type { InteriorTourScene, MapScene } from '../../models/scenes';

interface ScalingControlsProps {
  project: Project;
  updateProject: (updater: (project: Project) => Project) => void;
}

export function ScalingControls({ project, updateProject }: ScalingControlsProps) {
  const [targetSeconds, setTargetSeconds] = useState('30');
  const [error, setError] = useState<string | null>(null);

  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');

  function targetMs(): number {
    return Math.round(Number(targetSeconds) * 1000);
  }

  function applyFit(kind: 'map' | 'interior' | 'project') {
    setError(null);
    // fitMapToDuration/fitInteriorTourToDuration only throw when lockedSum > targetMs, so a
    // zero (or empty) target would otherwise silently zero every unlocked duration.
    if (targetMs() <= 0) {
      setError('Target duration must be greater than 0 seconds.');
      return;
    }
    try {
      updateProject((current) => {
        if (kind === 'map') {
          const scene = current.scenes.find((s): s is MapScene => s.type === 'map');
          if (!scene) return current;
          const fitted = fitMapToDuration(scene, targetMs());
          return { ...current, scenes: current.scenes.map((s) => (s.id === scene.id ? fitted : s)) };
        }
        if (kind === 'interior') {
          const scene = current.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');
          if (!scene) return current;
          const fitted = fitInteriorTourToDuration(scene, targetMs());
          return { ...current, scenes: current.scenes.map((s) => (s.id === scene.id ? fitted : s)) };
        }
        return fitProjectToDuration(current, targetMs());
      });
    } catch (err) {
      if (err instanceof TimelineScalingError) {
        setError(err.message);
        return;
      }
      throw err;
    }
  }

  return (
    <div className="inspector scaling-controls">
      <h3>Timeline Scaling</h3>
      <label>
        Target duration (seconds)
        <input type="number" value={targetSeconds} onChange={(e) => setTargetSeconds(e.target.value)} />
      </label>
      <div className="scaling-controls-actions">
        <button type="button" disabled={!mapScene} onClick={() => applyFit('map')}>
          Fit Map Fly-In
        </button>
        <button type="button" disabled={!interiorScene} onClick={() => applyFit('interior')}>
          Fit Interior Tour
        </button>
        <button type="button" onClick={() => applyFit('project')}>
          Fit Full Project
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
