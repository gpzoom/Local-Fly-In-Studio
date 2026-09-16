import { CURRENT_SCHEMA_VERSION } from '../models/project';

export interface Migration {
  fromVersion: number;
  toVersion: number;
  migrate: (data: Record<string, unknown>) => Record<string, unknown>;
}

// Add new migrations here as schemaVersion increases. This is the single
// production registration point for migrations — nothing else registers
// migrations outside of tests.
const MIGRATIONS: Migration[] = [];

let migrations: Migration[] = [...MIGRATIONS];

export function registerMigration(migration: Migration): void {
  migrations.push(migration);
}

export function resetMigrationsForTesting(): void {
  migrations = [...MIGRATIONS];
}

function readVersion(data: Record<string, unknown>): number {
  return typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
}

export function migrateProjectData(data: Record<string, unknown>): Record<string, unknown> {
  let current = data;
  let currentVersion = readVersion(current);

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project was created with a newer schema version (${currentVersion}) than this app supports (${CURRENT_SCHEMA_VERSION}).`
    );
  }

  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.find((m) => m.fromVersion === currentVersion);
    if (!migration) {
      throw new Error(`No migration found from schema version ${currentVersion}.`);
    }
    if (migration.toVersion <= currentVersion) {
      throw new Error(
        `Migration from version ${currentVersion} does not advance the schema version (toVersion: ${migration.toVersion}).`
      );
    }
    current = migration.migrate(current);
    currentVersion = migration.toVersion;
  }

  return current;
}
