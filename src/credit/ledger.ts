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
  reason: 'bootstrap' | 'escrow_hold' | 'escrow_release' | 'settlement' | 'refund' | 'remote_earning' | 'remote_settlement_confirmed' | 'network_fee' | 'provider_bonus' | 'voucher_hold' | 'voucher_settlement';
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

  CREATE TABLE IF NOT EXISTS provider_registry (
    owner TEXT PRIMARY KEY,
    provider_number INTEGER NOT NULL,
    registered_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS demand_vouchers (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    amount INTEGER NOT NULL,
    remaining INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
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

  // Safe migration: add funding_source to credit_escrow if not present
  try {
    db.exec("ALTER TABLE credit_escrow ADD COLUMN funding_source TEXT NOT NULL DEFAULT 'balance'");
  } catch {
    // Column already exists — ignore
  }

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

  let isNew = false;
  db.transaction(() => {
    const result = db
      .prepare('INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, ?, ?)')
      .run(owner, amount, now);

    // Only record the transaction if the balance row was actually created
    if (result.changes > 0) {
      isNew = true;
      db.prepare(
        'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), owner, amount, 'bootstrap', null, now);
    }
  })();

  // Issue demand voucher for new agents
  if (isNew) {
    issueVoucher(db, owner, 50, 30);
  }
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
 * Registers a new provider and assigns the next sequential provider_number.
 * Returns the assigned provider_number. Idempotent — calling twice for the same
 * owner returns the existing number.
 *
 * @param db - The credit database instance.
 * @param owner - Provider agent identifier.
 * @returns The assigned provider_number.
 */
export function registerProvider(db: Database.Database, owner: string): number {
  const now = new Date().toISOString();
  const maxRow = db.prepare('SELECT MAX(provider_number) as maxNum FROM provider_registry').get() as { maxNum: number | null };
  const nextNum = (maxRow?.maxNum ?? 0) + 1;
  db.prepare('INSERT OR IGNORE INTO provider_registry (owner, provider_number, registered_at) VALUES (?, ?, ?)').run(owner, nextNum, now);
  // Return the actual number (in case INSERT OR IGNORE hit)
  const row = db.prepare('SELECT provider_number FROM provider_registry WHERE owner = ?').get(owner) as { provider_number: number };
  return row.provider_number;
}

/**
 * Returns the provider_number for an owner, or null if not registered.
 *
 * @param db - The credit database instance.
 * @param owner - Provider agent identifier.
 * @returns The provider_number or null if not registered.
 */
export function getProviderNumber(db: Database.Database, owner: string): number | null {
  const row = db.prepare('SELECT provider_number FROM provider_registry WHERE owner = ?').get(owner) as { provider_number: number } | undefined;
  return row?.provider_number ?? null;
}

/**
 * Returns the bonus multiplier based on provider_number.
 * First 50: 2.0x, 51-200: 1.5x, 201+: 1.0x
 *
 * @param providerNumber - The sequential provider number.
 * @returns The bonus multiplier (2.0, 1.5, or 1.0).
 */
export function getProviderBonus(providerNumber: number): number {
  if (providerNumber <= 50) return 2.0;
  if (providerNumber <= 200) return 1.5;
  return 1.0;
}

/**
 * Issues a demand voucher to an agent.
 *
 * @param db - The credit database instance.
 * @param owner - Agent identifier.
 * @param amount - Number of voucher credits. Defaults to 50.
 * @param daysValid - Number of days until expiry. Defaults to 30.
 * @returns The voucher ID.
 */
export function issueVoucher(
  db: Database.Database,
  owner: string,
  amount: number = 50,
  daysValid: number = 30,
): string {
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + daysValid * 24 * 60 * 60 * 1000);
  db.prepare(
    'INSERT INTO demand_vouchers (id, owner, amount, remaining, created_at, expires_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
  ).run(id, owner, amount, amount, now.toISOString(), expiresAt.toISOString());
  return id;
}

/**
 * Returns the active, non-expired voucher for an owner, or null.
 *
 * @param db - The credit database instance.
 * @param owner - Agent identifier.
 * @returns The active voucher with id, remaining credits, and expiry, or null.
 */
export function getActiveVoucher(
  db: Database.Database,
  owner: string,
): { id: string; remaining: number; expires_at: string } | null {
  const now = new Date().toISOString();
  const row = db.prepare(
    'SELECT id, remaining, expires_at FROM demand_vouchers WHERE owner = ? AND is_active = 1 AND remaining > 0 AND expires_at > ? ORDER BY created_at ASC LIMIT 1',
  ).get(owner, now) as { id: string; remaining: number; expires_at: string } | undefined;
  return row ?? null;
}

/**
 * Consumes credits from a voucher.
 *
 * @param db - The credit database instance.
 * @param voucherId - The voucher ID.
 * @param amount - Number of credits to consume.
 */
export function consumeVoucher(
  db: Database.Database,
  voucherId: string,
  amount: number,
): void {
  db.prepare(
    'UPDATE demand_vouchers SET remaining = remaining - ? WHERE id = ? AND remaining >= ?',
  ).run(amount, voucherId, amount);
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

/**
 * Migrates credit data from one owner to another.
 * Merges balances and updates all transaction/escrow records.
 *
 * @param db - The credit database instance.
 * @param oldOwner - Previous owner identifier.
 * @param newOwner - New owner identifier.
 */
export function migrateOwner(
  db: Database.Database,
  oldOwner: string,
  newOwner: string,
): void {
  if (oldOwner === newOwner) return;

  const now = new Date().toISOString();

  db.transaction(() => {
    // Get old balance
    const oldRow = db.prepare('SELECT balance FROM credit_balances WHERE owner = ?').get(oldOwner) as { balance: number } | undefined;
    if (!oldRow) return; // nothing to migrate

    // Check if new owner already has a balance row
    const newRow = db.prepare('SELECT balance FROM credit_balances WHERE owner = ?').get(newOwner) as { balance: number } | undefined;

    if (newRow) {
      // Merge: add old balance to new
      db.prepare('UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?')
        .run(oldRow.balance, now, newOwner);
    } else {
      // Rename: update owner in place
      db.prepare('UPDATE credit_balances SET owner = ?, updated_at = ? WHERE owner = ?')
        .run(newOwner, now, oldOwner);
    }

    // Delete old row if merge happened (new row existed)
    if (newRow) {
      db.prepare('DELETE FROM credit_balances WHERE owner = ?').run(oldOwner);
    }

    // Migrate transactions
    db.prepare('UPDATE credit_transactions SET owner = ? WHERE owner = ?').run(newOwner, oldOwner);

    // Migrate escrows
    db.prepare('UPDATE credit_escrow SET owner = ? WHERE owner = ?').run(newOwner, oldOwner);
  })();
}

// Re-export error for use in escrow module
export { AgentBnBError };
