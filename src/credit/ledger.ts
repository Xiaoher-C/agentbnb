import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AgentBnBError } from '../types/index.js';

/**
 * A single credit transaction record
 */
export interface CreditTransaction {
  id: string;
  owner: string;
  /** Positive = credit, negative = debit */
  amount: number;
  reason: 'bootstrap' | 'escrow_hold' | 'escrow_release' | 'settlement' | 'refund' | 'remote_earning' | 'remote_settlement_confirmed';
  reference_id: string | null;
  created_at: string;
}

const CREDIT_SCHEMA = `
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

  CREATE INDEX IF NOT EXISTS idx_transactions_owner ON credit_transactions(owner, created_at);
  CREATE INDEX IF NOT EXISTS idx_escrow_owner ON credit_escrow(owner);
`;

/**
 * Opens a SQLite database for the credit system.
 * Uses WAL mode for better read concurrency.
 *
 * @param path - Path to the database file. Defaults to ':memory:' for in-memory.
 * @returns Configured Database instance with all credit tables created.
 */
export function openCreditDb(path: string = ':memory:'): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREDIT_SCHEMA);
  return db;
}

/**
 * Grants initial credits to a new agent (bootstrap grant).
 * Idempotent: calling multiple times has no additional effect on balance.
 * Uses INSERT OR IGNORE so the balance row is only created once.
 *
 * @param db - The credit database instance.
 * @param owner - Agent identifier.
 * @param amount - Number of credits to grant. Defaults to 100.
 */
export function bootstrapAgent(
  db: Database.Database,
  owner: string,
  amount: number = 100,
): void {
  const now = new Date().toISOString();

  db.transaction(() => {
    const result = db
      .prepare('INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, ?, ?)')
      .run(owner, amount, now);

    // Only record the transaction if the balance row was actually created
    if (result.changes > 0) {
      db.prepare(
        'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), owner, amount, 'bootstrap', null, now);
    }
  })();
}

/**
 * Returns the current credit balance for an agent.
 * Returns 0 if the agent has never been bootstrapped.
 *
 * @param db - The credit database instance.
 * @param owner - Agent identifier.
 * @returns Current balance in credits.
 */
export function getBalance(db: Database.Database, owner: string): number {
  const row = db
    .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
    .get(owner) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/**
 * Returns the transaction history for an agent, newest first.
 * Useful for auditing credit flows.
 *
 * @param db - The credit database instance.
 * @param owner - Agent identifier.
 * @param limit - Maximum number of transactions to return. Defaults to 100.
 * @returns Array of credit transactions, ordered newest first.
 */
export function getTransactions(
  db: Database.Database,
  owner: string,
  limit: number = 100,
): CreditTransaction[] {
  return db
    .prepare(
      'SELECT id, owner, amount, reason, reference_id, created_at FROM credit_transactions WHERE owner = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(owner, limit) as CreditTransaction[];
}

/**
 * Records a remote earning for the provider.
 * Idempotent on nonce — calling twice with the same nonce does not double-credit.
 * Used by the provider side in P2P settlement to credit earnings from a signed receipt.
 *
 * @param db - The provider's local credit database.
 * @param owner - Provider agent identifier.
 * @param amount - Number of credits earned.
 * @param cardId - Capability Card ID that was executed.
 * @param receiptNonce - Receipt nonce for replay protection.
 */
export function recordEarning(
  db: Database.Database,
  owner: string,
  amount: number,
  _cardId: string,
  receiptNonce: string,
): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    // Idempotency: check if this nonce was already recorded
    const existing = db
      .prepare(
        "SELECT id FROM credit_transactions WHERE reference_id = ? AND reason = 'remote_earning'",
      )
      .get(receiptNonce) as { id: string } | undefined;
    if (existing) return; // Already recorded — skip

    // Ensure balance row exists
    db.prepare(
      'INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, 0, ?)',
    ).run(owner, now);
    // Credit the earnings
    db.prepare(
      'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
    ).run(amount, now, owner);
    // Log transaction with receipt nonce as reference_id
    db.prepare(
      'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), owner, amount, 'remote_earning', receiptNonce, now);
  })();
}

// Re-export error for use in escrow module
export { AgentBnBError };
