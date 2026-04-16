import type Database from 'better-sqlite3';

/**
 * A single schema migration definition.
 *
 * Migrations are applied in array order. Each migration's `key` must be unique
 * across all migration arrays passed to `runPendingMigrations`.
 */
export interface Migration {
  /** Unique identifier, e.g. 'request_log_add_skill_id'. */
  key: string;
  /** Human-readable description of what this migration does. */
  description: string;
  /**
   * Forward migration function. Runs inside a transaction together with the
   * metadata bookkeeping INSERT. If this throws, the transaction rolls back
   * and the migration is NOT recorded.
   */
  up: (db: Database.Database) => void;
}

/**
 * Ensures the `migration_metadata` table exists, then runs any pending
 * migrations from the provided list.
 *
 * Each migration is wrapped in its own transaction. On success the migration
 * key, description, and ISO-8601 timestamp are recorded in `migration_metadata`.
 * On failure the transaction rolls back and the migration is not marked as applied,
 * so subsequent calls will retry it.
 *
 * Already-applied migrations (by key) are skipped.
 *
 * @param db - Open better-sqlite3 Database instance.
 * @param migrations - Ordered list of migrations to apply.
 */
export function runPendingMigrations(db: Database.Database, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_metadata (
      key TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT key FROM migration_metadata').all() as Array<{ key: string }>).map(
      (r) => r.key,
    ),
  );

  for (const migration of migrations) {
    if (applied.has(migration.key)) continue;

    db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT INTO migration_metadata (key, description, applied_at) VALUES (?, ?, ?)',
      ).run(migration.key, migration.description, new Date().toISOString());
    })();
  }
}
