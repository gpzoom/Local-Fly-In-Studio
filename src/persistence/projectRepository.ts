import { getDb } from './db';
import { ProjectSchema, type Project } from '../models/project';
import { migrateProjectData } from './migrations';

export async function saveProject(project: Project): Promise<void> {
  // Defense in depth: never let a schema-invalid project reach the store, where it
  // would otherwise be skipped by listProjects and fail loudly in loadProject.
  ProjectSchema.parse(project);
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
  const projects: Project[] = [];
  for (const raw of all) {
    const parsed = ProjectSchema.safeParse(migrateProjectData(raw));
    if (parsed.success) {
      projects.push(parsed.data);
      continue;
    }
    // One corrupt record must never make the whole list unreachable — skip it so the
    // remaining projects still load. (loadProject still throws: a single explicit open
    // failing loudly is the desired behavior.)
    console.warn('Skipping unreadable stored project', parsed.error);
  }
  return projects;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('projects', id);
}
