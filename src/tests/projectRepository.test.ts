import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { getDb } from '../persistence/db';
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
} from '../persistence/projectRepository';
import { makeMinimalProject } from './fixtures';

afterEach(async () => {
  const db = await getDb();
  await db.clear('projects');
});

describe('projectRepository', () => {
  it('saves and loads a project by id', async () => {
    const project = makeMinimalProject({ id: 'proj-a' });
    await saveProject(project);
    const loaded = await loadProject('proj-a');
    expect(loaded).toEqual(project);
  });

  it('returns null for a missing project', async () => {
    const loaded = await loadProject('does-not-exist');
    expect(loaded).toBeNull();
  });

  it('lists all saved projects', async () => {
    await saveProject(makeMinimalProject({ id: 'proj-b' }));
    await saveProject(makeMinimalProject({ id: 'proj-c' }));
    const all = await listProjects();
    const ids = all.map((p) => p.id).sort();
    expect(ids).toEqual(['proj-b', 'proj-c']);
  });

  it('deletes a project', async () => {
    await saveProject(makeMinimalProject({ id: 'proj-d' }));
    await deleteProject('proj-d');
    const loaded = await loadProject('proj-d');
    expect(loaded).toBeNull();
  });
});
