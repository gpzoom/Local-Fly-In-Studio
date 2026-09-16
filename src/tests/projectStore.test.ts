import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../persistence/db';
import { useProjectStore } from '../store/projectStore';
import { getLastOpenProjectId } from '../store/lastOpenProject';
import { makeMinimalProject } from './fixtures';

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

afterEach(async () => {
  const db = await getDb();
  await db.clear('projects');
  useProjectStore.setState({ currentProject: null });
  vi.unstubAllGlobals();
});

describe('projectStore', () => {
  it('creates a project, persists it, sets it as current, and records it as last-open', async () => {
    const project = makeMinimalProject({ id: 'store-proj-1' });

    await useProjectStore.getState().createProject(project);

    expect(useProjectStore.getState().currentProject).toEqual(project);
    expect(getLastOpenProjectId()).toBe('store-proj-1');
  });

  it('loads a previously saved project by id and records it as last-open', async () => {
    const project = makeMinimalProject({ id: 'store-proj-2' });
    await useProjectStore.getState().createProject(project);
    useProjectStore.setState({ currentProject: null });

    await useProjectStore.getState().loadProject('store-proj-2');

    expect(useProjectStore.getState().currentProject).toEqual(project);
    expect(getLastOpenProjectId()).toBe('store-proj-2');
  });

  it('saves changes to the current project', async () => {
    const project = makeMinimalProject({ id: 'store-proj-3' });
    await useProjectStore.getState().createProject(project);

    const renamed = { ...project, projectName: 'Renamed' };
    useProjectStore.setState({ currentProject: renamed });
    await useProjectStore.getState().saveProject();

    useProjectStore.setState({ currentProject: null });
    await useProjectStore.getState().loadProject('store-proj-3');
    expect(useProjectStore.getState().currentProject?.projectName).toBe('Renamed');
  });
});
