import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getLastOpenProjectId, setLastOpenProjectId } from '../store/lastOpenProject';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lastOpenProject', () => {
  it('returns null when nothing has been set', () => {
    expect(getLastOpenProjectId()).toBeNull();
  });

  it('stores and retrieves the last open project id', () => {
    setLastOpenProjectId('proj-xyz');
    expect(getLastOpenProjectId()).toBe('proj-xyz');
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => setLastOpenProjectId('proj-xyz')).not.toThrow();
    expect(getLastOpenProjectId()).toBeNull();
  });
});
