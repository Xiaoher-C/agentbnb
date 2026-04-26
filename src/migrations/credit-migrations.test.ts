import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runPendingMigrations } from './runner.js';
import { creditMigrations } from './credit-migrations.js';
import { assertSafeMigrationIdentifiers } from './migration-identifiers.js';

describe('creditMigrations — applied identifier safety', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Minimal credit_escrow / credit_grants tables matching openCreditDb shape
    db.exec(`
      CREATE TABLE credit_escrow (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        amount INTEGER NOT NULL,
        card_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        settled_at TEXT
      )
    `);
    db.exec(`
      CREATE TABLE credit_grants (
        public_key TEXT PRIMARY KEY,
        granted_at TEXT NOT NULL
      )
    `);
  });

  it('applies funding_source and owner column migrations cleanly', () => {
    runPendingMigrations(db, creditMigrations);

    const escrowCols = db
      .prepare('PRAGMA table_info(credit_escrow)')
      .all() as Array<{ name: string }>;
    const grantsCols = db
      .prepare('PRAGMA table_info(credit_grants)')
      .all() as Array<{ name: string }>;

    expect(escrowCols.map((c) => c.name)).toContain('funding_source');
    expect(grantsCols.map((c) => c.name)).toContain('owner');
  });

  it('is idempotent across multiple runs', () => {
    runPendingMigrations(db, creditMigrations);
    expect(() => runPendingMigrations(db, creditMigrations)).not.toThrow();
  });
});

describe('assertSafeMigrationIdentifiers — allow-list guard', () => {
  it('throws on unknown table name', () => {
    expect(() =>
      assertSafeMigrationIdentifiers('users', 'owner', 'TEXT'),
    ).toThrow(/illegal identifier/);
  });

  it('throws on unknown column name', () => {
    expect(() =>
      assertSafeMigrationIdentifiers('credit_escrow', 'arbitrary_col', 'TEXT'),
    ).toThrow(/illegal identifier/);
  });

  it('accepts every (table, column) pair currently used by the migrations', () => {
    const callsites: Array<[string, string, string]> = [
      ['credit_escrow', 'funding_source', "TEXT NOT NULL DEFAULT 'balance'"],
      ['credit_grants', 'owner', 'TEXT'],
      ['request_log', 'skill_id', 'TEXT'],
      ['request_log', 'action_type', 'TEXT'],
      ['request_log', 'tier_invoked', 'INTEGER'],
      ['request_log', 'failure_reason', 'TEXT'],
      ['request_log', 'team_id', 'TEXT'],
      ['request_log', 'role', 'TEXT'],
      ['request_log', 'capability_type', 'TEXT'],
    ];
    for (const [table, column, type] of callsites) {
      expect(() => assertSafeMigrationIdentifiers(table, column, type)).not.toThrow();
    }
  });

  it('rejects type/constraints containing a semicolon (statement breakout)', () => {
    expect(() =>
      assertSafeMigrationIdentifiers(
        'credit_escrow',
        'funding_source',
        "TEXT; DROP TABLE credit_escrow",
      ),
    ).toThrow(/illegal type\/constraints/);
  });

  it('rejects type/constraints containing SQL comment markers', () => {
    expect(() =>
      assertSafeMigrationIdentifiers('credit_escrow', 'funding_source', 'TEXT --evil'),
    ).toThrow(/illegal type\/constraints/);
  });

  it('rejects empty type/constraints', () => {
    expect(() =>
      assertSafeMigrationIdentifiers('credit_escrow', 'funding_source', ''),
    ).toThrow(/illegal type\/constraints/);
  });
});
