import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AgentBnBError } from '../types/index.js';
import { registerProvider, getProviderNumber, getProviderBonus, getActiveVoucher, consumeVoucher } from './ledger.js';

/** Network fee rate applied to settled escrows (5%). */
export const NETWORK_FEE_RATE = 0.05;

/**
 * An escrow record holding credits during capability execution
 */
export interface EscrowRecord {
  id: string;
  owner: string;
  amount: number;
  card_id: string;
  status: 'held' | 'settled' | 'released';
  created_at: string;
  settled_at: string | null;
}

/**
 * Creates an escrow hold on credits.
 * Atomically deducts the amount from the owner's balance and creates an escrow record.
 * Throws if the owner has insufficient credits.
 *
 * @param db - The credit database instance.
 * @param owner - Agent identifier (requester).
 * @param amount - Number of credits to hold.
 * @param cardId - Capability Card ID being requested.
 * @returns The new escrow ID.
 * @throws {AgentBnBError} with code 'INSUFFICIENT_CREDITS' if balance < amount.
 */
export function holdEscrow(
  db: Database.Database,
  owner: string,
  amount: number,
  cardId: string,
): string {
  const escrowId = randomUUID();
  const now = new Date().toISOString();

  const hold = db.transaction(() => {
    // Check for active voucher first
    const voucher = getActiveVoucher(db, owner);
    let fundingSource: 'balance' | 'voucher' = 'balance';

    if (voucher && voucher.remaining >= amount) {
      // Use voucher instead of balance
      consumeVoucher(db, voucher.id, amount);
      fundingSource = 'voucher';

      db.prepare(
        'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at, funding_source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(escrowId, owner, amount, cardId, 'held', now, 'voucher');

      db.prepare(
        'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), owner, -amount, 'voucher_hold', escrowId, now);
    } else {
      // Normal balance deduction
      const row = db
        .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
        .get(owner) as { balance: number } | undefined;

      if (!row || row.balance < amount) {
        throw new AgentBnBError('Insufficient credits', 'INSUFFICIENT_CREDITS');
      }

      db.prepare(
        'UPDATE credit_balances SET balance = balance - ?, updated_at = ? WHERE owner = ? AND balance >= ?',
      ).run(amount, now, owner, amount);

      db.prepare(
        'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at, funding_source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(escrowId, owner, amount, cardId, 'held', now, 'balance');

      db.prepare(
        'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), owner, -amount, 'escrow_hold', escrowId, now);
    }
  });

  hold();
  return escrowId;
}

/**
 * Settles an escrow — transfers credits to the capability owner upon successful execution.
 * Sets escrow status to 'settled'.
 *
 * @param db - The credit database instance.
 * @param escrowId - The escrow ID to settle.
 * @param recipientOwner - Agent identifier who will receive the credits.
 * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
 * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
 */
export function settleEscrow(
  db: Database.Database,
  escrowId: string,
  recipientOwner: string,
): void {
  const now = new Date().toISOString();

  const settle = db.transaction(() => {
    const escrow = db
      .prepare('SELECT id, owner, amount, status, funding_source FROM credit_escrow WHERE id = ?')
      .get(escrowId) as { id: string; owner: string; amount: number; status: string; funding_source: string } | undefined;

    if (!escrow) {
      throw new AgentBnBError(`Escrow not found: ${escrowId}`, 'ESCROW_NOT_FOUND');
    }
    if (escrow.status !== 'held') {
      throw new AgentBnBError(
        `Escrow ${escrowId} is already ${escrow.status}`,
        'ESCROW_ALREADY_SETTLED',
      );
    }

    // Network fee (5%)
    const feeAmount = Math.floor(escrow.amount * NETWORK_FEE_RATE);
    const providerAmount = escrow.amount - feeAmount;

    // Credit recipient (capability owner) — INSERT OR IGNORE in case they don't have a balance row yet
    db.prepare(
      'INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, 0, ?)',
    ).run(recipientOwner, now);

    db.prepare(
      'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
    ).run(providerAmount, now, recipientOwner);

    // Credit platform treasury with fee
    if (feeAmount > 0) {
      db.prepare(
        'INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, 0, ?)',
      ).run('platform_treasury', now);
      db.prepare(
        'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
      ).run(feeAmount, now, 'platform_treasury');
      db.prepare(
        'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), 'platform_treasury', feeAmount, 'network_fee', escrowId, now);
    }

    // Mark escrow as settled
    db.prepare(
      'UPDATE credit_escrow SET status = ?, settled_at = ? WHERE id = ?',
    ).run('settled', now, escrowId);

    // Log settlement for recipient (providerAmount, not full)
    db.prepare(
      'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), recipientOwner, providerAmount, 'settlement', escrowId, now);

    // First Provider Bonus
    let providerNum = getProviderNumber(db, recipientOwner);
    if (providerNum === null) {
      providerNum = registerProvider(db, recipientOwner);
    }
    const bonus = getProviderBonus(providerNum);
    if (bonus > 1.0) {
      const bonusAmount = Math.floor(providerAmount * (bonus - 1));
      if (bonusAmount > 0) {
        // Bonus comes from platform_treasury
        db.prepare(
          'INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, 0, ?)',
        ).run('platform_treasury', now);
        db.prepare(
          'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
        ).run(bonusAmount, now, recipientOwner);
        db.prepare(
          'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(randomUUID(), recipientOwner, bonusAmount, 'provider_bonus', escrowId, now);
      }
    }
  });

  settle();
}

/**
 * Releases an escrow — refunds credits back to the requester on failed execution.
 * Sets escrow status to 'released'.
 *
 * @param db - The credit database instance.
 * @param escrowId - The escrow ID to release.
 * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
 * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
 */
export function releaseEscrow(db: Database.Database, escrowId: string): void {
  const now = new Date().toISOString();

  const release = db.transaction(() => {
    const escrow = db
      .prepare('SELECT id, owner, amount, status, funding_source FROM credit_escrow WHERE id = ?')
      .get(escrowId) as { id: string; owner: string; amount: number; status: string; funding_source: string } | undefined;

    if (!escrow) {
      throw new AgentBnBError(`Escrow not found: ${escrowId}`, 'ESCROW_NOT_FOUND');
    }
    if (escrow.status !== 'held') {
      throw new AgentBnBError(
        `Escrow ${escrowId} is already ${escrow.status}`,
        'ESCROW_ALREADY_SETTLED',
      );
    }

    // Refund credits to original requester (balance refund regardless of funding source)
    db.prepare(
      'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
    ).run(escrow.amount, now, escrow.owner);

    // Mark escrow as released
    db.prepare(
      'UPDATE credit_escrow SET status = ?, settled_at = ? WHERE id = ?',
    ).run('released', now, escrowId);

    // Log refund transaction
    db.prepare(
      'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), escrow.owner, escrow.amount, 'refund', escrowId, now);
  });

  release();
}

/**
 * Confirms an escrow debit for P2P settlement.
 * Marks escrow status as 'settled' WITHOUT crediting any recipient.
 * Used by the requester side in cross-machine settlement — the credits were
 * already deducted by holdEscrow, and the provider records earnings in their own DB.
 *
 * @param db - The requester's local credit database.
 * @param escrowId - The escrow ID to confirm.
 * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
 * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
 */
export function confirmEscrowDebit(db: Database.Database, escrowId: string): void {
  const now = new Date().toISOString();

  const confirm = db.transaction(() => {
    const escrow = db
      .prepare('SELECT id, owner, amount, status, funding_source FROM credit_escrow WHERE id = ?')
      .get(escrowId) as { id: string; owner: string; amount: number; status: string; funding_source: string } | undefined;

    if (!escrow) {
      throw new AgentBnBError(`Escrow not found: ${escrowId}`, 'ESCROW_NOT_FOUND');
    }
    if (escrow.status !== 'held') {
      throw new AgentBnBError(
        `Escrow ${escrowId} is already ${escrow.status}`,
        'ESCROW_ALREADY_SETTLED',
      );
    }

    // Mark escrow as settled — no credit transfer (provider records in their own DB)
    db.prepare(
      'UPDATE credit_escrow SET status = ?, settled_at = ? WHERE id = ?',
    ).run('settled', now, escrowId);

    // Log confirmation transaction
    db.prepare(
      'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), escrow.owner, 0, 'remote_settlement_confirmed', escrowId, now);
  });

  confirm();
}

/**
 * Returns the current escrow record, or null if not found.
 *
 * @param db - The credit database instance.
 * @param escrowId - The escrow ID to look up.
 * @returns The escrow record or null.
 */
export function getEscrowStatus(db: Database.Database, escrowId: string): EscrowRecord | null {
  const row = db
    .prepare(
      'SELECT id, owner, amount, card_id, status, created_at, settled_at FROM credit_escrow WHERE id = ?',
    )
    .get(escrowId) as EscrowRecord | undefined;
  return row ?? null;
}
