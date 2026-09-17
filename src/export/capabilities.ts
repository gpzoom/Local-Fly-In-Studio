import { selectExportMimeType, type CodecSelection } from './codecSelection';

export interface ExportCapabilityReport {
  canRecord: boolean;
  blockingIssues: string[];
}

function defaultCreateProbeContext(): CanvasRenderingContext2D | null {
  const probe = document.createElement('canvas');
  probe.width = 2;
  probe.height = 2;
  return probe.getContext('2d');
}

export function checkExportCapabilities(
  canvas: HTMLCanvasElement,
  selectMimeType: () => CodecSelection | null = () => selectExportMimeType(),
  createProbeContext: () => CanvasRenderingContext2D | null = defaultCreateProbeContext,
): ExportCapabilityReport {
  const blockingIssues: string[] = [];

  if (typeof canvas.captureStream !== 'function') {
    blockingIssues.push('This browser does not support recording canvas output.');
  }
  if (typeof MediaRecorder === 'undefined') {
    blockingIssues.push('This browser does not support MediaRecorder.');
  }
  if (selectMimeType() === null) {
    blockingIssues.push('No supported video format is available in this browser.');
  }

  const probeCtx = createProbeContext();
  if (probeCtx) {
    try {
      probeCtx.drawImage(canvas, 0, 0, 2, 2);
      probeCtx.getImageData(0, 0, 2, 2);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        blockingIssues.push('Map imagery could not be read for export (a cross-origin security restriction).');
      } else {
        throw err;
      }
    }
  }

  return { canRecord: blockingIssues.length === 0, blockingIssues };
}
