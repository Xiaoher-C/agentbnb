import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AgentBnBError } from '../types/index.js';
import { registerProvider, getProviderNumber, getProviderBonus, getActiveVoucher, consumeVoucher } from './ledger.js';
import { recordSuccessfulHire } from './reliability-metrics.js';
import { canonicalizeCreditOwner } from './owner-normalization.js';
import { loadCoreConfig } from '../core-config.js';

const coreEconomics = loadCoreConfig<{ network_fee_rate?: number }>('economics');

/** Network fee rate applied to settled escrows (5%). */
export const NETWORK_FEE_RATE = coreEconomics?.network_fee_rate ?? 0.05;
/** Escrow lifecycle statuses. */
export type EscrowStatus = 'held' | 'started' | 'progressing' | 'abandoned' | 'settled' | 'released';
/** Non-terminal escrow statuses that can still be finalized to settled/released. */
const FINALIZABLE_ESCROW_STATUSES: ReadonlySet<EscrowStatus> = new Set([
  'held',
  'started',
  'progressing',
  'abandoned',
]);
const TERMINAL_ESCROW_STATUSES: ReadonlySet<EscrowStatus> = new Set(['settled', 'released']);

/**
 * An escrow record holding credits during capability execution
 */
export interface EscrowRecord {
  id: string;
  owner: string;
  amount: number;
  card_id: string;
  status: EscrowStatus;
  created_at: string;
  settled_at: string | null;
}

interface EscrowMutationRow {
  id: string;
  owner: string;
  amount: number;
  status: string;
  funding_source: string;
}

function getEscrowForMutation(
  db: Database.Database,
  escrowId: string,
): EscrowMutationRow {
  const escrow = db
    .prepare('SELECT id, owner, amount, status, funding_source FROM credit_escrow WHERE id = ?')
    .get(escrowId) as EscrowMutationRow | undefined;
  if (!escrow) {
    throw new AgentBnBError(`Escrow not found: ${escrowId}`, 'ESCROW_NOT_FOUND');
  }
  return {
    ...escrow,
    owner: canonicalizeCreditOwner(db, escrow.owner),
  };
}

function updateEscrowStatus(
  db: Database.Database,
  escrowId: string,
  fromStatuses: readonly EscrowStatus[],
  toStatus: EscrowStatus,
): void {
  const now = new Date().toISOString();
  const transition = db.transaction(() => {
    const escrow = getEscrowForMutation(db, escrowId);
    const current = escrow.status as EscrowStatus;
    if (!fromStatuses.includes(current)) {
      throw new AgentBnBError(
        `Invalid escrow transition for ${escrowId}: ${current} -> ${toStatus}`,
        'ESCROW_INVALID_TRANSITION',
      );
    }
    if (current === toStatus) return;
    const settledAt = TERMINAL_ESCROW_STATUSES.has(toStatus) ? now : null;
    db.prepare('UPDATE credit_escrow SET status = ?, settled_at = ? WHERE id = ?').run(
      toStatus,
      settledAt,
      escrowId,
    );
  });
  transition();
}

function assertEscrowCanFinalize(escrow: EscrowMutationRow): void {
  const status = escrow.status as EscrowStatus;
  if (FINALIZABLE_ESCROW_STATUSES.has(status)) {
    return;
  }
  if (TERMINAL_ESCROW_STATUSES.has(status)) {
    throw new AgentBnBError(
      `Escrow ${escrow.id} is already ${status}`,
      'ESCROW_ALREADY_SETTLED',
    );
  }
  throw new AgentBnBError(
    `Escrow ${escrow.id} has invalid lifecycle status: ${escrow.status}`,
    'ESCROW_INVALID_TRANSITION',
  );
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
  const canonicalOwner = canonicalizeCreditOwner(db, owner);
  const escrowId = randomUUID();
  const now = new Date().toISOString();

  const hold = db.transaction(() => {
    // Check for active voucher first
    const voucher = getActiveVoucher(db, canonicalOwner);
    if (voucher && voucher.remaining >= amount) {
      // Use voucher instead of balance
      consumeVoucher(db, voucher.id, amount);

      db.prepare(
        'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at, funding_source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(escrowId, canonicalOwner, amount, cardId, 'held', now, 'voucher');

      db.prepare(
        'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), canonicalOwner, -amount, 'voucher_hold', escrowId, now);
    } else {
      // Normal balance deduction
      const row = db
        .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
        .get(canonicalOwner) as { balance: number } | undefined;

      if (!row || row.balance < amount) {
        throw new AgentBnBError('Insufficient credits', 'INSUFFICIENT_CREDITS');
      }

      db.prepare(
        'UPDATE credit_balances SET balance = balance - ?, updated_at = ? WHERE owner = ? AND balance >= ?',
      ).run(amount, now, canonicalOwner, amount);

      db.prepare(
        'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at, funding_source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(escrowId, canonicalOwner, amount, cardId, 'held', now, 'balance');

      db.prepare(
        'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), canonicalOwner, -amount, 'escrow_hold', escrowId, now);
    }
  });

  hold();
  return escrowId;
}

/**
 * Marks a held escrow as started when the provider acknowledges request receipt.
 *
 * @param db - The credit database instance.
 * @param escrowId - The escrow ID to transition.
 */
export function markEscrowStarted(db: Database.Database, escrowId: string): void {
  updateEscrowStatus(db, escrowId, ['held', 'started'], 'started');
}

/**
 * Marks an escrow as progressing when provider emits progress heartbeats.
 *
 * @param db - The credit database instance.
 * @param escrowId - The escrow ID to transition.
 */
export function markEscrowProgressing(db: Database.Database, escrowId: string): void {
  updateEscrowStatus(db, escrowId, ['held', 'started', 'progressing'], 'progressing');
}

/**
 * Marks an in-flight escrow as abandoned (requester disconnected after start).
 *
 * @param db - The credit database instance.
 * @param escrowId - The escrow ID to transition.
 */
export function markEscrowAbandoned(db: Database.Database, escrowId: string): void {
  updateEscrowStatus(db, escrowId, ['started', 'progressing', 'abandoned'], 'abandoned');
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
  const canonicalRecipientOwner = canonicalizeCreditOwner(db, recipientOwner);
  const now = new Date().toISOString();

  const settle = db.transaction(() => {
    const escrow = getEscrowForMutation(db, escrowId);
    assertEscrowCanFinalize(escrow);

    // Network fee (5%)
    const feeAmount = Math.floor(escrow.amount * NETWORK_FEE_RATE);
    const providerAmount = escrow.amount - feeAmount;

    // Credit recipient (capability owner) — INSERT OR IGNORE in case they don't have a balance row yet
    db.prepare(
      'INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, 0, ?)',
    ).run(canonicalRecipientOwner, now);

    db.prepare(
      'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
    ).run(providerAmount, now, canonicalRecipientOwner);

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
    ).run(randomUUID(), canonicalRecipientOwner, providerAmount, 'settlement', escrowId, now);

    // First Provider Bonus
    let providerNum = getProviderNumber(db, canonicalRecipientOwner);
    if (providerNum === null) {
      providerNum = registerProvider(db, canonicalRecipientOwner);
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
        ).run(bonusAmount, now, canonicalRecipientOwner);
        db.prepare(
          'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(randomUUID(), canonicalRecipientOwner, bonusAmount, 'provider_bonus', escrowId, now);
      }
    }

    // Update reliability metrics — record successful hire
    try {
      recordSuccessfulHire(db, canonicalRecipientOwner, escrow.owner);
    } catch {
      // Non-fatal — metrics collection should not block settlement
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
    const escrow = getEscrowForMutation(db, escrowId);
    assertEscrowCanFinalize(escrow);

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
    const escrow = getEscrowForMutation(db, escrowId);
    assertEscrowCanFinalize(escrow);

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
  if (!row) return null;
  return {
    ...row,
    owner: canonicalizeCreditOwner(db, row.owner),
  };
}
