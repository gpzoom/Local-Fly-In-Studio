import { getDb } from './db';
import { ProjectSchema, type Project } from '../models/project';
import { migrateProjectData } from './migrations';

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.put('projects', project);
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const raw = await db.get('projects', id);
  if (!raw) return null;
  const migrated = migrateProjectData(raw);
  return ProjectSchema.parse(migrated);
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const all = await db.getAll('projects');
  return all.map((raw) => ProjectSchema.parse(migrateProjectData(raw)));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('projects', id);
}
