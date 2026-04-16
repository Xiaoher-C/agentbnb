import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runPendingMigrations, type Migration } from './runner.js';

describe('runPendingMigrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('runs pending migrations on a fresh database', () => {
    const migrations: Migration[] = [
      {
        key: 'add_foo_table',
        description: 'Create foo table',
        up: (d) => {
          d.exec('CREATE TABLE foo (id TEXT PRIMARY KEY)');
        },
      },
      {
        key: 'add_bar_column',
        description: 'Add bar column to foo',
        up: (d) => {
          d.exec('ALTER TABLE foo ADD COLUMN bar TEXT');
        },
      },
    ];

    runPendingMigrations(db, migrations);

    // Verify tables were created
    const fooInfo = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foo'")
      .get() as { name: string } | undefined;
    expect(fooInfo?.name).toBe('foo');

    // Verify bar column exists by inserting a row with it
    expect(() => {
      db.prepare('INSERT INTO foo (id, bar) VALUES (?, ?)').run('1', 'hello');
    }).not.toThrow();

    // Verify both migrations are recorded
    const applied = db
      .prepare('SELECT key FROM migration_metadata ORDER BY key')
      .all() as Array<{ key: string }>;
    expect(applied).toHaveLength(2);
    expect(applied.map((r) => r.key)).toEqual(['add_bar_column', 'add_foo_table']);
  });

  it('skips already-applied migrations', () => {
    let callCount = 0;
    const migrations: Migration[] = [
      {
        key: 'counted_migration',
        description: 'Counts how many times up() is called',
        up: () => {
          callCount++;
        },
      },
    ];

    runPendingMigrations(db, migrations);
    expect(callCount).toBe(1);

    // Run again — should skip
    runPendingMigrations(db, migrations);
    expect(callCount).toBe(1);
  });

  it('records applied_at timestamp', () => {
    const before = new Date().toISOString();

    const migrations: Migration[] = [
      {
        key: 'timestamped',
        description: 'Check timestamp recording',
        up: () => {
          // no-op
        },
      },
    ];

    runPendingMigrations(db, migrations);

    const after = new Date().toISOString();
    const row = db
      .prepare('SELECT applied_at FROM migration_metadata WHERE key = ?')
      .get('timestamped') as { applied_at: string };

    expect(row.applied_at).toBeDefined();
    expect(row.applied_at >= before).toBe(true);
    expect(row.applied_at <= after).toBe(true);
  });

  it('rolls back on failure and does not record the migration', () => {
    // Create a table so we can verify rollback
    db.exec('CREATE TABLE test_rollback (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO test_rollback (id) VALUES (?)').run('original');

    const migrations: Migration[] = [
      {
        key: 'failing_migration',
        description: 'This migration will throw',
        up: (d) => {
          // Make a change that should be rolled back
          d.prepare('DELETE FROM test_rollback WHERE id = ?').run('original');
          throw new Error('Intentional failure');
        },
      },
    ];

    expect(() => runPendingMigrations(db, migrations)).toThrow('Intentional failure');

    // Verify the DELETE was rolled back
    const row = db.prepare('SELECT id FROM test_rollback').get() as { id: string } | undefined;
    expect(row?.id).toBe('original');

    // Verify migration was NOT recorded
    const applied = db
      .prepare('SELECT key FROM migration_metadata WHERE key = ?')
      .get('failing_migration') as { key: string } | undefined;
    expect(applied).toBeUndefined();
  });
});
