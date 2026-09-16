import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectStorageCapabilities, checkQuota } from '../media/storageCapabilities';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectStorageCapabilities', () => {
  it('reports OPFS supported when navigator.storage.getDirectory exists', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({}) } });
    const caps = await detectStorageCapabilities();
    expect(caps.opfsSupported).toBe(true);
  });

  it('reports OPFS unsupported when navigator.storage.getDirectory is missing', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    const caps = await detectStorageCapabilities();
    expect(caps.opfsSupported).toBe(false);
  });

  it('reports OPFS unsupported when navigator is undefined', async () => {
    vi.stubGlobal('navigator', undefined);
    const caps = await detectStorageCapabilities();
    expect(caps.opfsSupported).toBe(false);
  });
});

describe('checkQuota', () => {
  it('reports sufficient when available space exceeds the estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 1_000_000, usage: 100_000 }) },
    });
    const result = await checkQuota(500_000);
    expect(result.sufficient).toBe(true);
    expect(result.availableBytes).toBe(900_000);
  });

  it('reports insufficient when available space is below the estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 1_000_000, usage: 900_000 }) },
    });
    const result = await checkQuota(500_000);
    expect(result.sufficient).toBe(false);
  });

  it('falls back to sufficient=true when storage.estimate is unavailable', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    const result = await checkQuota(500_000);
    expect(result.sufficient).toBe(true);
    expect(result.quotaBytes).toBeNull();
  });
});
