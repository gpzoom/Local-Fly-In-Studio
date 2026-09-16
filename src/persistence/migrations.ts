import { CURRENT_SCHEMA_VERSION } from '../models/project';

export interface Migration {
  fromVersion: number;
  toVersion: number;
  migrate: (data: Record<string, unknown>) => Record<string, unknown>;
}

let migrations: Migration[] = [];

export function registerMigration(migration: Migration): void {
  migrations.push(migration);
}

export function resetMigrationsForTesting(): void {
  migrations = [];
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
    current = migration.migrate(current);
    currentVersion = migration.toVersion;
  }

  return current;
}
