import { describe, it, expect } from 'vitest';
import { extractImageMetadata } from '../media/metadata';

describe('extractImageMetadata', () => {
  it('extracts GPS coordinates when present', async () => {
    const fakeParse = async () => ({ latitude: 40.7128, longitude: -74.006 });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.latitude).toBe(40.7128);
    expect(metadata.longitude).toBe(-74.006);
  });

  it('omits GPS fields when absent, without treating it as an error', async () => {
    const fakeParse = async () => ({});
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.latitude).toBeUndefined();
    expect(metadata.longitude).toBeUndefined();
  });

  it('converts DateTimeOriginal to an ISO capture time string', async () => {
    const date = new Date('2026-01-15T10:30:00.000Z');
    const fakeParse = async () => ({ DateTimeOriginal: date });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.captureTime).toBe('2026-01-15T10:30:00.000Z');
  });

  it('passes through orientation when present', async () => {
    const fakeParse = async () => ({ Orientation: 6 });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.orientation).toBe(6);
  });

  it('returns an empty object when parseExif throws (corrupt file)', async () => {
    const fakeParse = async (): Promise<never> => {
      throw new Error('corrupt EXIF');
    };
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata).toEqual({});
  });

  it('returns an empty object when parseExif resolves undefined', async () => {
    const fakeParse = async () => undefined;
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata).toEqual({});
  });
});
