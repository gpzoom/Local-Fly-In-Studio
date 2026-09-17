import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkExportCapabilities } from '../export/capabilities';
import type { CodecSelection } from '../export/codecSelection';

function fakeCanvas(overrides: Partial<{ captureStream: unknown }> = {}): HTMLCanvasElement {
  return { captureStream: vi.fn(), ...overrides } as unknown as HTMLCanvasElement;
}

function workingSelectMimeType(): () => CodecSelection | null {
  return () => ({ mimeType: 'video/webm', fileExtension: 'webm' });
}

function workingProbeContext(): () => CanvasRenderingContext2D | null {
  return () =>
    ({
      drawImage: vi.fn(),
      getImageData: vi.fn(),
    }) as unknown as CanvasRenderingContext2D;
}

describe('checkExportCapabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports canRecord: true and no blocking issues when everything is supported', () => {
    const report = checkExportCapabilities(fakeCanvas(), workingSelectMimeType(), workingProbeContext());
    expect(report).toEqual({ canRecord: true, blockingIssues: [] });
  });

  it('flags missing captureStream support', () => {
    const canvas = fakeCanvas({ captureStream: undefined });
    const report = checkExportCapabilities(canvas, workingSelectMimeType(), workingProbeContext());
    expect(report.canRecord).toBe(false);
    expect(report.blockingIssues).toContain('This browser does not support recording canvas output.');
  });

  it('flags missing MediaRecorder support', () => {
    vi.unstubAllGlobals();
    const report = checkExportCapabilities(fakeCanvas(), workingSelectMimeType(), workingProbeContext());
    expect(report.canRecord).toBe(false);
    expect(report.blockingIssues).toContain('This browser does not support MediaRecorder.');
  });

  it('flags no supported video format', () => {
    const report = checkExportCapabilities(fakeCanvas(), () => null, workingProbeContext());
    expect(report.canRecord).toBe(false);
    expect(report.blockingIssues).toContain('No supported video format is available in this browser.');
  });

  it('flags a tainted canvas via a SecurityError from getImageData', () => {
    const throwingProbeContext = () =>
      ({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => {
          throw new DOMException('tainted', 'SecurityError');
        }),
      }) as unknown as CanvasRenderingContext2D;
    const report = checkExportCapabilities(fakeCanvas(), workingSelectMimeType(), throwingProbeContext);
    expect(report.canRecord).toBe(false);
    expect(report.blockingIssues).toContain(
      'Map imagery could not be read for export (a cross-origin security restriction).',
    );
  });

  it('accumulates every failure at once rather than stopping at the first', () => {
    vi.unstubAllGlobals();
    const canvas = fakeCanvas({ captureStream: undefined });
    const report = checkExportCapabilities(canvas, () => null, workingProbeContext());
    expect(report.blockingIssues).toHaveLength(3);
  });
});
