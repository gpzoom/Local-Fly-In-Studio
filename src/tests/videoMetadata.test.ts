import { describe, it, expect, vi } from 'vitest';
import { extractVideoMetadata, type VideoMetadata } from '../media/videoMetadata';

describe('extractVideoMetadata', () => {
  it('resolves with duration/width/height from the injected loader', async () => {
    const fakeLoad = vi.fn().mockResolvedValue({ durationMs: 4200, width: 1920, height: 1080 });
    const result = await extractVideoMetadata(new Blob(), fakeLoad);
    expect(result).toEqual({ durationMs: 4200, width: 1920, height: 1080 });
  });

  it('rejects when the loader simulates the underlying video element firing an error event', async () => {
    const fakeLoad = vi.fn().mockImplementation(
      () =>
        new Promise<VideoMetadata>((_resolve, reject) => {
          // Mirrors defaultLoadMetadata's video.onerror handler.
          reject(new Error('Could not read video metadata'));
        }),
    );
    await expect(extractVideoMetadata(new Blob(), fakeLoad)).rejects.toThrow(
      'Could not read video metadata',
    );
  });
});
