import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDb } from '../persistence/db';
import { saveProjectTemplate, listProjectTemplates, getProjectTemplate } from '../persistence/projectTemplateRepository';
import { makeMinimalProjectTemplate } from './fixtures';

afterEach(async () => {
  const db = await getDb();
  await db.clear('templates');
});

describe('projectTemplateRepository', () => {
  it('saves and loads a template by id', async () => {
    const template = makeMinimalProjectTemplate({ id: 'tmpl-a' });
    await saveProjectTemplate(template);
    const loaded = await getProjectTemplate('tmpl-a');
    expect(loaded).toEqual(template);
  });

  it('returns null for a missing template', async () => {
    const loaded = await getProjectTemplate('does-not-exist');
    expect(loaded).toBeNull();
  });

  it('lists all saved templates', async () => {
    await saveProjectTemplate(makeMinimalProjectTemplate({ id: 'tmpl-b' }));
    await saveProjectTemplate(makeMinimalProjectTemplate({ id: 'tmpl-c' }));
    const all = await listProjectTemplates();
    const ids = all.map((t) => t.id).sort();
    expect(ids).toEqual(['tmpl-b', 'tmpl-c']);
  });

  it('skips a corrupt stored record instead of throwing', async () => {
    const db = await getDb();
    await db.put('templates', { id: 'corrupt', name: 'Bad' }); // missing required fields
    await saveProjectTemplate(makeMinimalProjectTemplate({ id: 'tmpl-d' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const all = await listProjectTemplates();
    expect(all.map((t) => t.id)).toEqual(['tmpl-d']);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
