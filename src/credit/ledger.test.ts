import { describe, it, expect, beforeEach } from 'vitest';
import { openCreditDb, getBalance, bootstrapAgent, getTransactions } from './ledger.js';
import { holdEscrow, settleEscrow, releaseEscrow, getEscrowStatus } from './escrow.js';
import type Database from 'better-sqlite3';

describe('ledger', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
  });

  it('bootstrapAgent grants initial credits (100) and creates balance row', () => {
    bootstrapAgent(db, 'agent-alice');
    expect(getBalance(db, 'agent-alice')).toBe(100);
  });

  it('bootstrapAgent is idempotent — calling twice does not double credits', () => {
    bootstrapAgent(db, 'agent-alice');
    bootstrapAgent(db, 'agent-alice');
    expect(getBalance(db, 'agent-alice')).toBe(100);
  });

  it('getBalance returns 0 for unknown agent', () => {
    expect(getBalance(db, 'unknown-agent')).toBe(0);
  });

  it('getBalance returns correct balance after bootstrap', () => {
    bootstrapAgent(db, 'agent-bob', 250);
    expect(getBalance(db, 'agent-bob')).toBe(250);
  });

  it('getTransactions returns chronological transaction log (newest first)', () => {
    bootstrapAgent(db, 'agent-alice');
    const txns = getTransactions(db, 'agent-alice');
    expect(txns.length).toBeGreaterThan(0);
    expect(txns[0]).toBeDefined();
    // Newest first — bootstrap transaction should be present
    expect(txns[0]?.reason).toBe('bootstrap');
  });

  it('transaction log entries have required fields', () => {
    bootstrapAgent(db, 'agent-alice');
    const txns = getTransactions(db, 'agent-alice');
    expect(txns.length).toBeGreaterThanOrEqual(1);
    const txn = txns[0]!;
    expect(typeof txn.id).toBe('string');
    expect(txn.owner).toBe('agent-alice');
    expect(typeof txn.amount).toBe('number');
    expect(typeof txn.reason).toBe('string');
    // reference_id can be null or string
    expect(['string', 'object'].includes(typeof txn.reference_id)).toBe(true);
    expect(typeof txn.created_at).toBe('string');
  });

  it('bootstrapAgent transaction is not duplicated on second call', () => {
    bootstrapAgent(db, 'agent-alice');
    bootstrapAgent(db, 'agent-alice');
    // Should only have 1 transaction (first bootstrap only)
    const txns = getTransactions(db, 'agent-alice');
    expect(txns.length).toBe(1);
  });
});

describe('escrow', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    bootstrapAgent(db, 'agent-requester', 100);
    bootstrapAgent(db, 'agent-owner', 0);
  });

  it('holdEscrow deducts from balance and creates escrow record with status "held"', () => {
    const escrowId = holdEscrow(db, 'agent-requester', 30, 'card-abc');
    expect(getBalance(db, 'agent-requester')).toBe(70);
    const escrow = getEscrowStatus(db, escrowId);
    expect(escrow).not.toBeNull();
    expect(escrow?.status).toBe('held');
    expect(escrow?.amount).toBe(30);
    expect(escrow?.owner).toBe('agent-requester');
    expect(escrow?.card_id).toBe('card-abc');
  });

  it('holdEscrow with insufficient balance throws INSUFFICIENT_CREDITS', () => {
    expect(() => holdEscrow(db, 'agent-requester', 200, 'card-abc')).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_CREDITS' }),
    );
    // Balance should not have changed
    expect(getBalance(db, 'agent-requester')).toBe(100);
  });

  it('holdEscrow prevents double-spend (two holds exceeding balance)', () => {
    holdEscrow(db, 'agent-requester', 80, 'card-abc');
    expect(() => holdEscrow(db, 'agent-requester', 40, 'card-def')).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_CREDITS' }),
    );
    // First hold succeeded, balance is 20
    expect(getBalance(db, 'agent-requester')).toBe(20);
  });

  it('settleEscrow transfers credits to capability owner and sets status "settled"', () => {
    const escrowId = holdEscrow(db, 'agent-requester', 30, 'card-abc');
    settleEscrow(db, escrowId, 'agent-owner');
    expect(getBalance(db, 'agent-owner')).toBe(30);
    const escrow = getEscrowStatus(db, escrowId);
    expect(escrow?.status).toBe('settled');
  });

  it('releaseEscrow refunds credits to requester and sets status "released"', () => {
    const escrowId = holdEscrow(db, 'agent-requester', 30, 'card-abc');
    releaseEscrow(db, escrowId);
    expect(getBalance(db, 'agent-requester')).toBe(100);
    const escrow = getEscrowStatus(db, escrowId);
    expect(escrow?.status).toBe('released');
  });

  it('settle on already-settled escrow throws ESCROW_ALREADY_SETTLED', () => {
    const escrowId = holdEscrow(db, 'agent-requester', 30, 'card-abc');
    settleEscrow(db, escrowId, 'agent-owner');
    expect(() => settleEscrow(db, escrowId, 'agent-owner')).toThrowError(
      expect.objectContaining({ code: 'ESCROW_ALREADY_SETTLED' }),
    );
  });

  it('release on already-settled escrow throws ESCROW_ALREADY_SETTLED', () => {
    const escrowId = holdEscrow(db, 'agent-requester', 30, 'card-abc');
    settleEscrow(db, escrowId, 'agent-owner');
    expect(() => releaseEscrow(db, escrowId)).toThrowError(
      expect.objectContaining({ code: 'ESCROW_ALREADY_SETTLED' }),
    );
  });

  it('getEscrowStatus returns current escrow state', () => {
    const escrowId = holdEscrow(db, 'agent-requester', 50, 'card-xyz');
    const escrow = getEscrowStatus(db, escrowId);
    expect(escrow?.id).toBe(escrowId);
    expect(escrow?.status).toBe('held');
    expect(escrow?.amount).toBe(50);
  });

  it('getEscrowStatus returns null for unknown escrow ID', () => {
    const result = getEscrowStatus(db, 'nonexistent-id');
    expect(result).toBeNull();
  });

  it('holdEscrow logs a debit transaction', () => {
    holdEscrow(db, 'agent-requester', 30, 'card-abc');
    const txns = getTransactions(db, 'agent-requester');
    // Should have bootstrap + escrow_hold
    expect(txns.length).toBe(2);
    const holdTxn = txns.find((t) => t.reason === 'escrow_hold');
    expect(holdTxn).toBeDefined();
    expect(holdTxn?.amount).toBe(-30);
  });

  it('settleEscrow logs credit transactions for both parties', () => {
    const escrowId = holdEscrow(db, 'agent-requester', 30, 'card-abc');
    settleEscrow(db, escrowId, 'agent-owner');
    const ownerTxns = getTransactions(db, 'agent-owner');
    expect(ownerTxns.some((t) => t.reason === 'settlement')).toBe(true);
    expect(ownerTxns.find((t) => t.reason === 'settlement')?.amount).toBe(30);
  });
});
