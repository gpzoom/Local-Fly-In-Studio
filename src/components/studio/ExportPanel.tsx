// src/components/studio/ExportPanel.tsx
import { useEffect, useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import './ExportPanel.css';
import type { Project } from '../../models/project';
import { checkExportCapabilities, type ExportCapabilityReport } from '../../export/capabilities';
import { createMediaAssetStore } from '../../media/createMediaAssetStore';
import { runExport } from '../../export/exportRunner';

interface ExportPanelProps {
  project: Project;
  viewer: Viewer;
  onClose: () => void;
}

type ExportPanelState =
  | { phase: 'idle'; capabilities: ExportCapabilityReport }
  | { phase: 'recording'; elapsedMs: number; totalMs: number }
  | { phase: 'done'; url: string; filename: string }
  | { phase: 'error'; message: string };

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ExportPanel({ project, viewer, onClose }: ExportPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [state, setState] = useState<ExportPanelState>(() => ({
    phase: 'idle',
    capabilities: checkExportCapabilities(viewer.scene.canvas),
  }));

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function handleStart() {
    if (!canvasRef.current) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setState({ phase: 'recording', elapsedMs: 0, totalMs: 0 });

    try {
      const mediaAssetStore = await createMediaAssetStore();
      const blob = await runExport({
        project,
        viewer,
        outputCanvas: canvasRef.current,
        mediaAssetStore,
        onProgress: (elapsedMs, totalMs) => setState({ phase: 'recording', elapsedMs, totalMs }),
        signal: abortController.signal,
      });
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      setState({ phase: 'done', url, filename: `${project.projectName}.${extension}` });
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Export failed.' });
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  function handleClose() {
    abortControllerRef.current?.abort();
    onClose();
  }

  return (
    <div className="export-panel-backdrop" onClick={handleClose}>
      <div className="export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-panel-header">
          <h3>Export Video</h3>
          <button type="button" onClick={handleClose}>
            &times;
          </button>
        </div>

        <canvas ref={canvasRef} className="export-panel-canvas" />

        {state.phase === 'idle' && (
          <div className="export-panel-body">
            <p>
              Exporting at {project.videoSettings.widthPx}&times;{project.videoSettings.heightPx},{' '}
              {project.videoSettings.fps}fps
            </p>
            {state.capabilities.blockingIssues.length > 0 && (
              <ul className="export-panel-issues">
                {state.capabilities.blockingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <button type="button" disabled={!state.capabilities.canRecord} onClick={() => void handleStart()}>
              Start
            </button>
          </div>
        )}

        {state.phase === 'recording' && (
          <div className="export-panel-body">
            <progress value={state.totalMs > 0 ? state.elapsedMs : 0} max={state.totalMs || 1} />
            <p>
              {formatMs(state.elapsedMs)} / {formatMs(state.totalMs)}
            </p>
            <button type="button" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        )}

        {state.phase === 'done' && (
          <div className="export-panel-body">
            <p>Export complete.</p>
            <a href={state.url} download={state.filename}>
              Download {state.filename}
            </a>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="export-panel-body">
            <p role="alert">{state.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
