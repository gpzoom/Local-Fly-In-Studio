// src/components/studio/StudioView.tsx
import { useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import './StudioView.css';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { computeDoorTargetTransform } from '../../timeline/waypointEditing';
import type { PlaybackController } from '../../timeline/playbackController';
import { TimelineStrip } from '../timeline/TimelineStrip';
import { PreviewStage } from '../preview/PreviewStage';
import { WaypointInspector } from '../inspectors/WaypointInspector';
import { StorefrontInspector } from '../inspectors/StorefrontInspector';
import { InteriorPhotoInspector } from '../inspectors/InteriorPhotoInspector';
import { InteriorVideoInspector } from '../inspectors/InteriorVideoInspector';
import { ScalingControls } from '../inspectors/ScalingControls';
import type { Project } from '../../models/project';
import type { EvaluatedLayer } from '../../models/timeline';
import type { InteriorTourScene, StorefrontScene } from '../../models/scenes';

interface StudioViewProps {
  onBack: () => void;
}

export function StudioView({ onBack }: StudioViewProps) {
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateProjectAction = useProjectStore((state) => state.updateProject);
  const saveProjectAction = useProjectStore((state) => state.saveProject);
  const selection = useUiStore((state) => state.selection);

  const viewerRef = useRef<Viewer | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  if (!currentProject) return null;
  // Bind a non-null local so nested function declarations below (which are hoisted,
  // so TS can't carry the guard's narrowing of `currentProject` into their bodies)
  // see a definitely-non-null Project.
  const project = currentProject;

  function updateProject(updater: (project: Project) => Project) {
    updateProjectAction(updater);
    setIsDirty(true);
  }

  async function handleSave() {
    await saveProjectAction();
    setIsDirty(false);
  }

  function handleBack() {
    if (isDirty && !window.confirm('You have unsaved changes. Discard them and go back?')) return;
    onBack();
  }

  function handleSeek(timeMs: number) {
    controllerRef.current?.seek(timeMs);
  }

  function handleOverlayClick(normalized: { x: number; y: number }, layer: EvaluatedLayer) {
    if (selection?.type !== 'storefront') return;
    const storefrontScene = project.scenes.find(
      (s): s is StorefrontScene => s.type === 'storefront' && s.id === selection.sceneId,
    );
    if (!storefrontScene || layer.sourceId !== storefrontScene.assetId) return;

    const newEndTransform = computeDoorTargetTransform(storefrontScene.endTransform, normalized);
    updateProject((project) => ({
      ...project,
      scenes: project.scenes.map((s) =>
        s.id === storefrontScene.id && s.type === 'storefront' ? { ...s, endTransform: newEndTransform } : s,
      ),
    }));
  }

  function renderInspector() {
    if (!selection) return null;

    if (selection.type === 'waypoint') {
      return (
        <WaypointInspector
          project={project}
          sceneId={selection.sceneId}
          waypointId={selection.waypointId}
          updateProject={updateProject}
          viewerRef={viewerRef}
        />
      );
    }
    if (selection.type === 'storefront') {
      return <StorefrontInspector project={project} sceneId={selection.sceneId} updateProject={updateProject} />;
    }
    if (selection.type === 'interior-item') {
      const interiorScene = project.scenes.find(
        (s): s is InteriorTourScene => s.type === 'interior-tour' && s.id === selection.sceneId,
      );
      const item = interiorScene?.items.find((i) => i.id === selection.itemId);
      if (item?.type === 'photo') {
        return (
          <InteriorPhotoInspector
            project={project}
            sceneId={selection.sceneId}
            itemId={selection.itemId}
            updateProject={updateProject}
          />
        );
      }
      if (item?.type === 'video') {
        return (
          <InteriorVideoInspector
            project={project}
            sceneId={selection.sceneId}
            itemId={selection.itemId}
            updateProject={updateProject}
          />
        );
      }
    }
    return null;
  }

  return (
    <div className="studio-view">
      <div className="studio-header">
        <button type="button" onClick={handleBack}>
          Back
        </button>
        <h2>{project.projectName}</h2>
        <button type="button" disabled={!isDirty} onClick={() => void handleSave()}>
          Save
        </button>
      </div>

      <TimelineStrip project={project} onSeek={handleSeek} updateProject={updateProject} />

      <PreviewStage
        project={project}
        onOverlayClick={handleOverlayClick}
        onViewerReady={(viewer) => {
          viewerRef.current = viewer;
        }}
        onControllerReady={(controller) => {
          controllerRef.current = controller;
        }}
      />

      <div className="studio-inspector">{renderInspector()}</div>

      <ScalingControls project={project} updateProject={updateProject} />
    </div>
  );
}
