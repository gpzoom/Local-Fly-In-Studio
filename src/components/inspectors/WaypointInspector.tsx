// src/components/inspectors/WaypointInspector.tsx
import { useState } from 'react';
import type { RefObject } from 'react';
import type { Viewer } from 'cesium';
import { captureCameraState } from '../../cesium/captureCameraState';
import { applyCameraState } from '../../cesium/applyCameraState';
import { replaceWaypointCamera } from '../../timeline/waypointEditing';
import { resolveRelativeCameraState } from '../../timeline/resolveRelativeCamera';
import type { Project } from '../../models/project';
import type { CameraState, EasingPreset, MapScene, Waypoint } from '../../models/scenes';

const EASING_PRESETS: EasingPreset[] = ['cinematic', 'smooth', 'linear', 'accelerate', 'decelerate'];

interface WaypointInspectorProps {
  project: Project;
  sceneId: string;
  waypointId: string;
  updateProject: (updater: (project: Project) => Project) => void;
  viewerRef: RefObject<Viewer | null>;
}

export function WaypointInspector({ project, sceneId, waypointId, updateProject, viewerRef }: WaypointInspectorProps) {
  const [captured, setCaptured] = useState<CameraState | null>(null);

  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map' && s.id === sceneId);
  const waypoint = mapScene?.waypoints.find((wp) => wp.id === waypointId);

  if (!mapScene || !waypoint) return null;

  function replaceWaypoint(nextWaypoint: Waypoint) {
    updateProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === sceneId && scene.type === 'map'
          ? { ...scene, waypoints: scene.waypoints.map((wp) => (wp.id === waypointId ? nextWaypoint : wp)) }
          : scene,
      ),
    }));
  }

  function updateWaypoint(patch: Partial<Waypoint>) {
    if (!waypoint) return;
    replaceWaypoint({ ...waypoint, ...patch } as Waypoint);
  }

  const goToCamera: CameraState | null =
    waypoint.type === 'absolute' ? waypoint.camera : resolveRelativeCameraState(waypoint.relativeCamera, project.destination);

  return (
    <div className="inspector waypoint-inspector">
      <h3>Waypoint: {waypoint.name}</h3>

      <label>
        Name
        <input type="text" value={waypoint.name} onChange={(e) => updateWaypoint({ name: e.target.value })} />
      </label>

      <label>
        Travel duration (ms)
        <input
          type="number"
          min="0"
          value={waypoint.travelDurationMs}
          onChange={(e) => updateWaypoint({ travelDurationMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={waypoint.travelDurationLocked}
          onChange={(e) => updateWaypoint({ travelDurationLocked: e.target.checked })}
        />
        Lock travel duration
      </label>

      <label>
        Hold duration (ms)
        <input
          type="number"
          min="0"
          value={waypoint.holdDurationMs}
          onChange={(e) => updateWaypoint({ holdDurationMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={waypoint.holdDurationLocked}
          onChange={(e) => updateWaypoint({ holdDurationLocked: e.target.checked })}
        />
        Lock hold duration
      </label>

      <label>
        Easing
        <select value={waypoint.easing} onChange={(e) => updateWaypoint({ easing: e.target.value as EasingPreset })}>
          {EASING_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>

      <div className="waypoint-inspector-actions">
        <button
          type="button"
          onClick={() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            setCaptured(captureCameraState(viewer));
          }}
        >
          Capture Current View
        </button>
        <button
          type="button"
          onClick={() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            replaceWaypoint(replaceWaypointCamera(waypoint, captureCameraState(viewer)));
          }}
        >
          Replace Selected Waypoint
        </button>
        <button
          type="button"
          disabled={!goToCamera}
          onClick={() => {
            const viewer = viewerRef.current;
            if (!viewer || !goToCamera) return;
            applyCameraState(viewer, goToCamera);
          }}
        >
          Go To Waypoint
        </button>
      </div>

      {captured && (
        <dl className="captured-camera-readout">
          <dt>Longitude</dt>
          <dd>{captured.longitude.toFixed(6)}</dd>
          <dt>Latitude</dt>
          <dd>{captured.latitude.toFixed(6)}</dd>
          <dt>Height</dt>
          <dd>{captured.height.toFixed(1)}</dd>
          <dt>Heading</dt>
          <dd>{captured.heading.toFixed(1)}</dd>
          <dt>Pitch</dt>
          <dd>{captured.pitch.toFixed(1)}</dd>
          <dt>Roll</dt>
          <dd>{captured.roll.toFixed(1)}</dd>
        </dl>
      )}
    </div>
  );
}
