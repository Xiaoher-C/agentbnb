import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Cron } from 'croner';
import { AgentRuntime } from './agent-runtime.js';
import type { RuntimeOptions } from './agent-runtime.js';

// Helper to create an in-memory credit DB with the required schema
function createCreditDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_balances (
      owner TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_escrow (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      amount INTEGER NOT NULL,
      card_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'held',
      created_at TEXT NOT NULL,
      settled_at TEXT
    );
  `);
  return db;
}

// Helper to create an in-memory registry DB with the required schema
function createRegistryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_cards (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('AgentRuntime', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;

  beforeEach(() => {
    registryDb = createRegistryDb();
    creditDb = createCreditDb();
  });

  afterEach(() => {
    // Clean up any open handles (in case tests didn't call shutdown)
    try { registryDb.close(); } catch { /* already closed */ }
    try { creditDb.close(); } catch { /* already closed */ }
  });

  it('Test 1: constructor opens both DBs with WAL mode and busy_timeout=5000', () => {
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
    });

    // Note: WAL mode is not available for :memory: databases (SQLite limitation).
    // The runtime does call pragma journal_mode = WAL via openDatabase()/openCreditDb(),
    // but SQLite silently keeps 'memory' mode for in-memory DBs.
    // We verify that the DB is open and functional (schema tables created).
    const registryTables = runtime.registryDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(registryTables.some((t) => t.name === 'capability_cards')).toBe(true);

    const creditTables = runtime.creditDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(creditTables.some((t) => t.name === 'credit_escrow')).toBe(true);

    // Check busy_timeout is set (5000ms) — this works even for in-memory DBs
    const registryTimeout = runtime.registryDb.pragma('busy_timeout', { simple: true });
    const creditTimeout = runtime.creditDb.pragma('busy_timeout', { simple: true });

    expect(registryTimeout).toBe(5000);
    expect(creditTimeout).toBe(5000);

    // Cleanup
    void runtime.shutdown();
  });

  it('Test 2: start() releases orphaned escrows older than threshold', async () => {
    // Use a shared pre-opened credit DB so we can inspect results
    // We'll test this by creating a runtime that uses an injected DB (via path :memory: won't work for inspection)
    // Instead, we test via the runtime's public interface with real escrow records

    // Create runtime with explicit in-memory paths — we need a file-backed DB to share state
    // For test isolation, we'll use a custom approach: create runtime, then manually inspect
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
      orphanedEscrowAgeMinutes: 0.001, // 60ms threshold for testing
    });

    // Insert an old 'held' escrow (created_at in the past)
    const oldTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    runtime.creditDb
      .prepare(
        "INSERT INTO credit_balances (owner, balance, updated_at) VALUES ('owner1', 100, ?)",
      )
      .run(oldTimestamp);
    runtime.creditDb
      .prepare(
        'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('escrow-old-1', 'owner1', 10, 'card-1', 'held', oldTimestamp);

    await runtime.start();

    // Orphaned escrow should now be 'released'
    const escrow = runtime.creditDb
      .prepare('SELECT status FROM credit_escrow WHERE id = ?')
      .get('escrow-old-1') as { status: string } | undefined;

    expect(escrow?.status).toBe('released');

    void runtime.shutdown();
  });

  it('Test 3: start() does NOT release escrows newer than threshold', async () => {
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
      orphanedEscrowAgeMinutes: 60, // 60 minute threshold
    });

    // Insert a recent 'held' escrow (created just now)
    const recentTimestamp = new Date().toISOString();
    runtime.creditDb
      .prepare(
        "INSERT INTO credit_balances (owner, balance, updated_at) VALUES ('owner2', 100, ?)",
      )
      .run(recentTimestamp);
    runtime.creditDb
      .prepare(
        'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('escrow-new-1', 'owner2', 10, 'card-1', 'held', recentTimestamp);

    await runtime.start();

    // Recent escrow should still be 'held'
    const escrow = runtime.creditDb
      .prepare('SELECT status FROM credit_escrow WHERE id = ?')
      .get('escrow-new-1') as { status: string } | undefined;

    expect(escrow?.status).toBe('held');

    void runtime.shutdown();
  });

  it('start() releases stale abandoned escrows but keeps stale started escrows', async () => {
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
      orphanedEscrowAgeMinutes: 0.001,
    });

    const oldTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    runtime.creditDb
      .prepare(
        "INSERT INTO credit_balances (owner, balance, updated_at) VALUES ('owner3', 100, ?)",
      )
      .run(oldTimestamp);
    runtime.creditDb
      .prepare(
        'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('escrow-abandoned-1', 'owner3', 15, 'card-1', 'abandoned', oldTimestamp);
    runtime.creditDb
      .prepare(
        'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('escrow-started-1', 'owner3', 20, 'card-1', 'started', oldTimestamp);

    await runtime.start();

    const abandoned = runtime.creditDb
      .prepare('SELECT status FROM credit_escrow WHERE id = ?')
      .get('escrow-abandoned-1') as { status: string } | undefined;
    const started = runtime.creditDb
      .prepare('SELECT status FROM credit_escrow WHERE id = ?')
      .get('escrow-started-1') as { status: string } | undefined;

    expect(abandoned?.status).toBe('released');
    expect(started?.status).toBe('started');

    void runtime.shutdown();
  });

  it('Test 4: registerJob() adds a Cron to the managed jobs list', () => {
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
    });

    const job = new Cron('*/5 * * * *', { paused: true }, () => {});
    runtime.registerJob(job);

    expect(runtime.jobs.length).toBe(1);
    expect(runtime.jobs[0]).toBe(job);

    job.stop();
    void runtime.shutdown();
  });

  it('Test 5: shutdown() calls stop() on all registered Cron jobs', async () => {
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
    });

    const job = new Cron('*/5 * * * *', { paused: true }, () => {});
    runtime.registerJob(job);

    await runtime.shutdown();

    // Job should be stopped after shutdown
    expect(job.isStopped()).toBe(true);
  });

  it('Test 6: shutdown() closes both database handles (subsequent DB access throws)', async () => {
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
    });

    await runtime.shutdown();

    // After shutdown, DB access should throw
    expect(() => {
      runtime.registryDb.prepare('SELECT 1').get();
    }).toThrow();

    expect(() => {
      runtime.creditDb.prepare('SELECT 1').get();
    }).toThrow();
  });

  it('Test 7: isDraining getter returns true after shutdown() is called', async () => {
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
    });

    expect(runtime.isDraining).toBe(false);

    await runtime.shutdown();

    expect(runtime.isDraining).toBe(true);
  });

  it('Test 8: shutdown() is idempotent (calling twice does not throw)', async () => {
    const runtime = new AgentRuntime({
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      owner: 'test-agent',
    });

    await runtime.shutdown();

    // Second call should not throw
    await expect(runtime.shutdown()).resolves.not.toThrow();
  });
});
