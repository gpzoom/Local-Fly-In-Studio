import { describe, it, expect } from 'vitest';
import { selectExportMimeType } from '../export/codecSelection';

describe('selectExportMimeType', () => {
  it('picks MP4 first when supported, even when WebM variants are also supported', () => {
    const isTypeSupported = () => true;
    const result = selectExportMimeType(isTypeSupported);
    expect(result).toEqual({ mimeType: 'video/mp4;codecs=avc1', fileExtension: 'mp4' });
  });

  it('falls back to VP9 WebM when MP4 is unsupported', () => {
    const isTypeSupported = (mimeType: string) =>
      mimeType === 'video/webm;codecs=vp9' || mimeType === 'video/webm;codecs=vp8' || mimeType === 'video/webm';
    const result = selectExportMimeType(isTypeSupported);
    expect(result).toEqual({ mimeType: 'video/webm;codecs=vp9', fileExtension: 'webm' });
  });

  it('falls back to VP8 WebM when only VP8 and bare webm are supported', () => {
    const isTypeSupported = (mimeType: string) => mimeType === 'video/webm;codecs=vp8' || mimeType === 'video/webm';
    const result = selectExportMimeType(isTypeSupported);
    expect(result).toEqual({ mimeType: 'video/webm;codecs=vp8', fileExtension: 'webm' });
  });

  it('never puts an .mp4 extension on WebM content', () => {
    const isTypeSupported = (mimeType: string) => mimeType === 'video/webm';
    const result = selectExportMimeType(isTypeSupported);
    expect(result?.fileExtension).toBe('webm');
  });

  it('returns null when nothing in the priority list is supported', () => {
    const result = selectExportMimeType(() => false);
    expect(result).toBeNull();
  });
});
