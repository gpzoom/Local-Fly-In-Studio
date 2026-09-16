import { describe, it, expect, vi, afterEach } from 'vitest';
import { censusGeocode } from '../destination/censusGeocoder';

afterEach(() => {
  vi.useRealTimers();
});

function injectScriptResolvingWith(response: unknown) {
  return vi.fn((src: string) => {
    const url = new URL(src);
    const callbackName = url.searchParams.get('callback')!;
    queueMicrotask(() => {
      (globalThis as unknown as Record<string, (response: unknown) => void>)[callbackName](response);
    });
    return vi.fn();
  });
}

describe('censusGeocode', () => {
  it('resolves a match from the JSONP callback', async () => {
    const injectScript = injectScriptResolvingWith({
      result: {
        addressMatches: [
          { matchedAddress: '123 MAIN ST, ANYTOWN, ST, 12345', coordinates: { x: -74.006, y: 40.7128 } },
        ],
      },
    });

    const result = await censusGeocode('123 Main St', { injectScript });

    expect(result).toEqual({
      matchedAddress: '123 MAIN ST, ANYTOWN, ST, 12345',
      latitude: 40.7128,
      longitude: -74.006,
    });
  });

  it('calls the cleanup function returned by injectScript exactly once on success', async () => {
    const cleanupSpy = vi.fn();
    const injectScript = vi.fn((src: string) => {
      const url = new URL(src);
      const callbackName = url.searchParams.get('callback')!;
      queueMicrotask(() => {
        (globalThis as unknown as Record<string, (response: unknown) => void>)[callbackName]({
          result: { addressMatches: [] },
        });
      });
      return cleanupSpy;
    });

    await censusGeocode('123 Main St', { injectScript });
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves null when there are no address matches', async () => {
    const injectScript = injectScriptResolvingWith({ result: { addressMatches: [] } });
    const result = await censusGeocode('nonexistent address', { injectScript });
    expect(result).toBeNull();
  });

  it('resolves null on timeout and cleans up', async () => {
    vi.useFakeTimers();
    const cleanupSpy = vi.fn();
    const injectScript = vi.fn(() => cleanupSpy); // never invokes the callback

    const promise = censusGeocode('slow address', { injectScript, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toBeNull();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes the globalThis callback after resolving, leaving no leaked global', async () => {
    let capturedCallbackName = '';
    const injectScript = vi.fn((src: string) => {
      const url = new URL(src);
      capturedCallbackName = url.searchParams.get('callback')!;
      queueMicrotask(() => {
        (globalThis as unknown as Record<string, (response: unknown) => void>)[capturedCallbackName]({
          result: { addressMatches: [] },
        });
      });
      return vi.fn();
    });

    await censusGeocode('123 Main St', { injectScript });
    expect(capturedCallbackName in (globalThis as Record<string, unknown>)).toBe(false);
  });
});
