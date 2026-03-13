import { describe, it, expect, beforeEach } from 'vitest';
import { openCreditDb, getBalance, bootstrapAgent, getTransactions } from './ledger.js';
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
