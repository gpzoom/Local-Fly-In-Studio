import { getDb } from './db';
import { ProjectTemplateSchema, type ProjectTemplate } from '../models/projectTemplate';

export async function saveProjectTemplate(template: ProjectTemplate): Promise<void> {
  // Defense in depth: never let a schema-invalid template reach the store, where it
  // would otherwise be skipped by listProjectTemplates and fail loudly in getProjectTemplate.
  ProjectTemplateSchema.parse(template);
  const db = await getDb();
  await db.put('templates', template);
}

export async function getProjectTemplate(id: string): Promise<ProjectTemplate | null> {
  const db = await getDb();
  const raw = await db.get('templates', id);
  if (!raw) return null;
  return ProjectTemplateSchema.parse(raw);
}

export async function listProjectTemplates(): Promise<ProjectTemplate[]> {
  const db = await getDb();
  const all = await db.getAll('templates');
  const templates: ProjectTemplate[] = [];
  for (const raw of all) {
    const parsed = ProjectTemplateSchema.safeParse(raw);
    if (parsed.success) {
      templates.push(parsed.data);
      continue;
    }
    // One corrupt record must never make the whole list unreachable — skip it so the
    // remaining templates still load.
    console.warn('Skipping unreadable stored template', parsed.error);
  }
  return templates;
}
