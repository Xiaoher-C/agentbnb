import { describe, it, expect, beforeEach } from 'vitest';
import { openCreditDb, getBalance, getBalanceSnapshot, bootstrapAgent, getTransactions, getActiveVoucher, getProviderNumber, registerProvider } from './ledger.js';
import { holdEscrow, settleEscrow, releaseEscrow, getEscrowStatus } from './escrow.js';
import type Database from 'better-sqlite3';
import { createAgentRecord } from '../identity/agent-identity.js';
import { getReliabilityMetrics, recordAvailabilityCheck, recordFeedback } from './reliability-metrics.js';

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

  it('getBalanceSnapshot returns null updated_at for unknown agent', () => {
    expect(getBalanceSnapshot(db, 'unknown-agent')).toEqual({
      balance: 0,
      updated_at: null,
    });
  });

  it('getBalanceSnapshot returns balance and updated_at after bootstrap', () => {
    bootstrapAgent(db, 'agent-snapshot', 125);
    const snapshot = getBalanceSnapshot(db, 'agent-snapshot');
    expect(snapshot.balance).toBe(125);
    expect(typeof snapshot.updated_at).toBe('string');
    expect(snapshot.updated_at).toContain('T');
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

  it('migrates legacy owner credit rows to canonical agent_id on read/write access', () => {
    bootstrapAgent(db, 'legacy-owner', 100);
    const escrowId = holdEscrow(db, 'legacy-owner', 10, 'card-legacy');
    registerProvider(db, 'legacy-owner');
    recordFeedback(db, 'legacy-owner', 4);
    recordAvailabilityCheck(db, 'legacy-owner', true);

    createAgentRecord(db, {
      agent_id: 'abcdefabcdefabcd',
      display_name: 'legacy-owner',
      public_key: '11'.repeat(32),
      legacy_owner: 'legacy-owner',
    });

    expect(getBalance(db, 'abcdefabcdefabcd')).toBe(100);
    expect(getTransactions(db, 'abcdefabcdefabcd').length).toBeGreaterThan(0);
    expect(getProviderNumber(db, 'abcdefabcdefabcd')).toBe(1);
    expect(getActiveVoucher(db, 'abcdefabcdefabcd')?.remaining).toBe(40);
    expect(getReliabilityMetrics(db, 'abcdefabcdefabcd')?.avg_feedback_score).toBe(4);
    expect(getEscrowStatus(db, escrowId)?.owner).toBe('abcdefabcdefabcd');

    expect(
      (db.prepare('SELECT COUNT(*) as count FROM credit_balances WHERE owner = ?').get('legacy-owner') as { count: number }).count,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM credit_transactions WHERE owner = ?').get('legacy-owner') as { count: number }).count,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM credit_escrow WHERE owner = ?').get('legacy-owner') as { count: number }).count,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM provider_registry WHERE owner = ?').get('legacy-owner') as { count: number }).count,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM demand_vouchers WHERE owner = ?').get('legacy-owner') as { count: number }).count,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM provider_reliability_metrics WHERE owner = ?').get('legacy-owner') as { count: number }).count,
    ).toBe(0);
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
    // Exhaust voucher first so hold uses balance
    holdEscrow(db, 'agent-requester', 50, 'card-exhaust-voucher');
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
    // Exhaust voucher first so holds use balance
    holdEscrow(db, 'agent-requester', 50, 'card-exhaust-voucher');
    holdEscrow(db, 'agent-requester', 80, 'card-abc');
    expect(() => holdEscrow(db, 'agent-requester', 40, 'card-def')).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_CREDITS' }),
    );
    // First hold succeeded, balance is 20
    expect(getBalance(db, 'agent-requester')).toBe(20);
  });

  it('settleEscrow transfers credits to capability owner and sets status "settled"', () => {
    // Exhaust voucher first so hold uses balance
    holdEscrow(db, 'agent-requester', 50, 'card-exhaust-voucher');
    const escrowId = holdEscrow(db, 'agent-requester', 30, 'card-abc');
    settleEscrow(db, escrowId, 'agent-owner');
    // fee: floor(30*0.05)=1, providerAmount=29, bonus: 2x (first provider), bonusAmount=29
    // agent-owner had balance 0, gets 29+29=58
    expect(getBalance(db, 'agent-owner')).toBe(58);
    const escrow = getEscrowStatus(db, escrowId);
    expect(escrow?.status).toBe('settled');
  });

  it('releaseEscrow refunds credits to requester and sets status "released"', () => {
    // Exhaust voucher first so hold uses balance
    holdEscrow(db, 'agent-requester', 50, 'card-exhaust-voucher');
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
    // Exhaust voucher first so hold uses balance
    holdEscrow(db, 'agent-requester', 50, 'card-exhaust-voucher');
    holdEscrow(db, 'agent-requester', 30, 'card-abc');
    const txns = getTransactions(db, 'agent-requester');
    // Should have bootstrap + voucher_hold + escrow_hold
    expect(txns.length).toBe(3);
    const holdTxn = txns.find((t) => t.reason === 'escrow_hold');
    expect(holdTxn).toBeDefined();
    expect(holdTxn?.amount).toBe(-30);
  });

  it('settleEscrow logs credit transactions for both parties', () => {
    // Exhaust voucher first so hold uses balance
    holdEscrow(db, 'agent-requester', 50, 'card-exhaust-voucher');
    const escrowId = holdEscrow(db, 'agent-requester', 30, 'card-abc');
    settleEscrow(db, escrowId, 'agent-owner');
    const ownerTxns = getTransactions(db, 'agent-owner');
    expect(ownerTxns.some((t) => t.reason === 'settlement')).toBe(true);
    // Settlement amount is providerAmount after 5% fee: 30 - floor(30*0.05) = 29
    expect(ownerTxns.find((t) => t.reason === 'settlement')?.amount).toBe(29);
  });
});
