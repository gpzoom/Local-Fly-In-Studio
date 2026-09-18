// src/components/studio/ExportPanel.tsx
import { useEffect, useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import './ExportPanel.css';
import type { Project } from '../../models/project';
import { checkExportCapabilities, type ExportCapabilityReport } from '../../export/capabilities';
import { createMediaAssetStore } from '../../media/createMediaAssetStore';
import { runExport } from '../../export/exportRunner';
import {
  EXPORT_VARIANTS,
  EXPORT_VARIANT_LABELS,
  isVariantAvailable,
  type ExportVariant,
} from '../../export/exportVariants';

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
  const mountedRef = useRef(true);
  const [state, setState] = useState<ExportPanelState>(() => ({
    phase: 'idle',
    capabilities: checkExportCapabilities(viewer.scene.canvas),
  }));
  const [variant, setVariant] = useState<ExportVariant>('complete');

  useEffect(() => {
    // Under React StrictMode's dev-only double-invoke, this effect's cleanup runs once
    // immediately after the first mount (simulating an unmount) before the effect body runs
    // again for the "real" mount. Without resetting mountedRef.current here, that first
    // cleanup call leaves it permanently false, so every mountedRef.current-gated update below
    // (onProgress, the post-export state transition, the error handler) would silently no-op
    // forever — the panel would look stuck in "recording" indefinitely even though the export
    // itself completes normally in the background.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function handleStart() {
    if (!canvasRef.current) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setState({ phase: 'recording', elapsedMs: 0, totalMs: 0 });

    // onProgress fires on every rAF tick (30-60/sec). The UI only ever renders whole seconds
    // (formatMs rounds to seconds, and the progress bar moves imperceptibly between ticks), so
    // re-rendering React that often just steals main-thread time from compositing and encoding.
    // Update only when the displayed second actually changes — plus the very first tick, which
    // is what fills in totalMs for the progress bar's max.
    let lastReportedSecond = -1;

    try {
      const mediaAssetStore = await createMediaAssetStore();
      const blob = await runExport({
        project,
        viewer,
        outputCanvas: canvasRef.current,
        mediaAssetStore,
        variant,
        onProgress: (elapsedMs, totalMs) => {
          if (!mountedRef.current) return;
          const second = Math.floor(elapsedMs / 1000);
          if (second === lastReportedSecond) return;
          lastReportedSecond = second;
          setState({ phase: 'recording', elapsedMs, totalMs });
        },
        signal: abortController.signal,
      });
      const url = URL.createObjectURL(blob);
      if (!mountedRef.current) {
        // The component unmounted while the export was finishing (its own cleanup effect
        // already ran and revoked whatever was in objectUrlRef at that time, so it will
        // never see this URL), so nothing else will ever revoke it unless we do it here.
        URL.revokeObjectURL(url);
        return;
      }
      objectUrlRef.current = url;
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      // Complete Video keeps today's exact filename unchanged; the 3 new variants append the
      // same label text the picker shows, so the UI and the downloaded filename always agree.
      const filename =
        variant === 'complete'
          ? `${project.projectName}.${extension}`
          : `${project.projectName} - ${EXPORT_VARIANT_LABELS[variant]}.${extension}`;
      setState({ phase: 'done', url, filename });
    } catch (err) {
      if (!mountedRef.current) return;
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
            <fieldset className="export-panel-variant-picker">
              <legend>What to export</legend>
              {EXPORT_VARIANTS.map((v) => {
                const available = isVariantAvailable(project, v);
                return (
                  <label key={v} className="export-panel-variant-option">
                    <input
                      type="radio"
                      name="export-variant"
                      value={v}
                      checked={variant === v}
                      disabled={!available}
                      onChange={() => setVariant(v)}
                    />
                    {EXPORT_VARIANT_LABELS[v]}
                    {!available && (
                      <span className="export-panel-variant-unavailable">
                        This project has no Interior Tour content.
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
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
