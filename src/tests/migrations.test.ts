import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerMigration,
  migrateProjectData,
  resetMigrationsForTesting,
} from '../persistence/migrations';

describe('migrateProjectData', () => {
  beforeEach(() => {
    resetMigrationsForTesting();
  });

  it('passes through data already at the current version', () => {
    const data = { schemaVersion: 1, projectName: 'Already Current' };
    expect(migrateProjectData(data)).toEqual(data);
  });

  it('applies a registered migration to bring data up to the current version', () => {
    registerMigration({
      fromVersion: 0,
      toVersion: 1,
      migrate: (data) => ({ ...data, schemaVersion: 1, videoSettings: { aspectRatio: '16:9' } }),
    });
    const legacy = { projectName: 'Legacy Project' };
    const migrated = migrateProjectData(legacy);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.videoSettings).toEqual({ aspectRatio: '16:9' });
  });

  it('throws a clear error when no migration path exists', () => {
    const legacy = { schemaVersion: 0, projectName: 'Stuck' };
    expect(() => migrateProjectData(legacy)).toThrow(/no migration/i);
  });

  it('throws a clear error when data claims a newer version than supported', () => {
    const future = { schemaVersion: 99, projectName: 'From the future' };
    expect(() => migrateProjectData(future)).toThrow(/newer schema version/i);
  });
});
