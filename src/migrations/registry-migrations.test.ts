import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runPendingMigrations } from './runner.js';
import { registryMigrations } from './registry-migrations.js';

describe('registryMigrations — backfill behavior', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Create the base request_log table (matches createRequestLogTable minimal schema)
    db.exec(`
      CREATE TABLE request_log (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        card_name TEXT NOT NULL,
        requester TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        credits_charged INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  });

  it('applies all column migrations on a fresh table', () => {
    runPendingMigrations(db, registryMigrations);

    const columns = db.prepare('PRAGMA table_info(request_log)').all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);

    expect(names).toContain('skill_id');
    expect(names).toContain('action_type');
    expect(names).toContain('tier_invoked');
    expect(names).toContain('failure_reason');
    expect(names).toContain('team_id');
    expect(names).toContain('role');
    expect(names).toContain('capability_type');
  });

  it('does not fail when columns already exist (production backfill)', () => {
    // Simulate production DB: columns were added by old try/catch pattern
    // but migration_metadata row is missing
    db.exec('ALTER TABLE request_log ADD COLUMN skill_id TEXT');
    db.exec('ALTER TABLE request_log ADD COLUMN action_type TEXT');
    db.exec('ALTER TABLE request_log ADD COLUMN tier_invoked INTEGER');

    // This should NOT throw "duplicate column name: skill_id"
    expect(() => runPendingMigrations(db, registryMigrations)).not.toThrow();

    // All migrations should be marked as applied
    const applied = db
      .prepare('SELECT key FROM migration_metadata WHERE key LIKE ?')
      .all('request_log_%') as Array<{ key: string }>;
    expect(applied.length).toBe(7);
  });

  it('is idempotent across multiple runs', () => {
    runPendingMigrations(db, registryMigrations);
    expect(() => runPendingMigrations(db, registryMigrations)).not.toThrow();

    // Verify migrations run exactly once (no duplicate columns, no errors)
    const columns = db.prepare('PRAGMA table_info(request_log)').all() as Array<{ name: string }>;
    const skillIdCount = columns.filter((c) => c.name === 'skill_id').length;
    expect(skillIdCount).toBe(1);
  });
});
