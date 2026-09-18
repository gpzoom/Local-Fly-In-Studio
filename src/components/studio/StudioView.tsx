// src/components/studio/StudioView.tsx
import { useEffect, useRef, useState } from 'react';
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
import { BulkEditControls } from '../inspectors/BulkEditControls';
import { SaveTemplateControls } from './SaveTemplateControls';
import { ExportPanel } from './ExportPanel';
import { createMediaAssetStore } from '../../media/createMediaAssetStore';
import { checkMissingMediaAssets } from '../../media/checkMissingMediaAssets';
import { relinkMediaAsset, type MediaRelinkComparison } from '../../media/relinkMediaAsset';
import type { MediaAssetStore } from '../../media/MediaAssetStore';
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
  const mediaStoreRef = useRef<MediaAssetStore | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [missingAssetIds, setMissingAssetIds] = useState<Set<string>>(new Set());

  if (!currentProject) return null;
  // Bind a non-null local so nested function declarations below (which are hoisted,
  // so TS can't carry the guard's narrowing of `currentProject` into their bodies)
  // see a definitely-non-null Project.
  const project = currentProject;

  // Latest-project ref so the mount-keyed missing-asset scan below can read the current
  // project without listing the whole (identity-changing-on-every-edit) `project` object
  // as a dependency — the scan is meant to run once per opened project, not on every edit.
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!mediaStoreRef.current) {
        mediaStoreRef.current = await createMediaAssetStore();
      }
      const missing = await checkMissingMediaAssets(projectRef.current, mediaStoreRef.current);
      if (!cancelled) setMissingAssetIds(missing);
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  function updateProject(updater: (project: Project) => Project) {
    updateProjectAction(updater);
    setIsDirty(true);
  }

  async function handleRelink(assetId: string, file: File): Promise<MediaRelinkComparison> {
    const originalAsset = project.mediaAssets.find((a) => a.id === assetId);
    if (!originalAsset) {
      throw new Error(`No media asset found with id ${assetId}`);
    }
    if (!mediaStoreRef.current) {
      mediaStoreRef.current = await createMediaAssetStore();
    }
    const result = await relinkMediaAsset(originalAsset, file, { mediaAssetStore: mediaStoreRef.current });
    updateProject((current) => ({
      ...current,
      mediaAssets: current.mediaAssets.map((a) => (a.id === assetId ? result.updatedAsset : a)),
    }));
    setMissingAssetIds((current) => {
      const next = new Set(current);
      next.delete(assetId);
      return next;
    });
    return result.comparison;
  }

  async function handleSave() {
    setError(null);
    // Stamp the save time so ProjectList's "updated …" column reflects reality.
    updateProject((current) => ({ ...current, updatedAt: new Date().toISOString() }));
    try {
      await saveProjectAction();
      setIsDirty(false);
    } catch (err) {
      // A failed save must never be silent: isDirty stays true and the Back button warns
      // about unsaved changes, but the user needs to know the write itself did not land.
      setError(err instanceof Error ? err.message : 'Could not save the project.');
    }
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
      const storefrontScene = project.scenes.find(
        (s): s is StorefrontScene => s.type === 'storefront' && s.id === selection.sceneId,
      );
      if (!storefrontScene) return null;
      return (
        <StorefrontInspector
          project={project}
          sceneId={selection.sceneId}
          updateProject={updateProject}
          isMissing={missingAssetIds.has(storefrontScene.assetId)}
          onRelink={(file) => handleRelink(storefrontScene.assetId, file)}
        />
      );
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
            isMissing={missingAssetIds.has(item.assetId)}
            onRelink={(file) => handleRelink(item.assetId, file)}
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
            isMissing={missingAssetIds.has(item.assetId)}
            onRelink={(file) => handleRelink(item.assetId, file)}
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
        <div className="studio-header-actions">
          <button type="button" disabled={!viewerReady} onClick={() => setExportOpen(true)}>
            Export
          </button>
          <button type="button" disabled={!isDirty} onClick={() => void handleSave()}>
            Save
          </button>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <TimelineStrip project={project} onSeek={handleSeek} updateProject={updateProject} missingAssetIds={missingAssetIds} />

      <PreviewStage
        project={project}
        onOverlayClick={handleOverlayClick}
        onViewerReady={(viewer) => {
          viewerRef.current = viewer;
          setViewerReady(true);
        }}
        onControllerReady={(controller) => {
          controllerRef.current = controller;
        }}
      />

      <div className="studio-inspector">{renderInspector()}</div>

      <ScalingControls project={project} updateProject={updateProject} />

      <BulkEditControls project={project} updateProject={updateProject} />

      <SaveTemplateControls project={project} />

      {exportOpen && viewerRef.current && (
        <ExportPanel project={project} viewer={viewerRef.current} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}
