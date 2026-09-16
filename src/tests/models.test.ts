import { describe, it, expect } from 'vitest';
import { ProjectSchema } from '../models/project';
import { makeMinimalProject } from './fixtures';

describe('ProjectSchema', () => {
  it('accepts a valid minimal project', () => {
    const project = makeMinimalProject();
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
  });

  it('rejects a project missing required fields', () => {
    const project = makeMinimalProject();
    // @ts-expect-error intentionally invalid for the test
    delete project.destination;
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(false);
  });

  it('rejects a scene with an unknown discriminant', () => {
    const project = makeMinimalProject();
    project.scenes = [{ ...project.scenes[0], type: 'not-a-real-type' } as never];
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(false);
  });

  it('rejects an interior tour item with an unknown discriminant', () => {
    const project = makeMinimalProject();
    const tourScene = project.scenes.find((s) => s.type === 'interior-tour');
    if (tourScene && tourScene.type === 'interior-tour') {
      tourScene.items = [{ ...tourScene.items[0], type: 'audio' } as never];
    }
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(false);
  });
});
