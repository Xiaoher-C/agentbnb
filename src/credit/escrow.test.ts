import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openCreditDb, bootstrapAgent, getBalance } from './ledger.js';
import {
  holdEscrow,
  getEscrowStatus,
  markEscrowStarted,
  markEscrowProgressing,
  markEscrowAbandoned,
  settleEscrow,
  releaseEscrow,
} from './escrow.js';

describe('escrow lifecycle transitions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    bootstrapAgent(db, 'requester-1', 100);
    bootstrapAgent(db, 'provider-1', 0);
    db.prepare('UPDATE demand_vouchers SET is_active = 0').run();
  });

  afterEach(() => {
    db.close();
  });

  it('supports held -> started -> progressing -> settled', () => {
    const escrowId = holdEscrow(db, 'requester-1', 20, 'card-1');
    expect(getEscrowStatus(db, escrowId)?.status).toBe('held');

    markEscrowStarted(db, escrowId);
    expect(getEscrowStatus(db, escrowId)?.status).toBe('started');

    markEscrowProgressing(db, escrowId);
    expect(getEscrowStatus(db, escrowId)?.status).toBe('progressing');

    settleEscrow(db, escrowId, 'provider-1');
    expect(getEscrowStatus(db, escrowId)?.status).toBe('settled');
    expect(getBalance(db, 'requester-1')).toBe(80);
    expect(getBalance(db, 'provider-1')).toBe(38);
  });

  it('supports started -> abandoned -> released', () => {
    const escrowId = holdEscrow(db, 'requester-1', 10, 'card-2');
    expect(getBalance(db, 'requester-1')).toBe(90);

    markEscrowStarted(db, escrowId);
    markEscrowAbandoned(db, escrowId);
    expect(getEscrowStatus(db, escrowId)?.status).toBe('abandoned');

    releaseEscrow(db, escrowId);
    expect(getEscrowStatus(db, escrowId)?.status).toBe('released');
    expect(getBalance(db, 'requester-1')).toBe(100);
  });

  it('rejects invalid transition held -> abandoned', () => {
    const escrowId = holdEscrow(db, 'requester-1', 10, 'card-3');
    expect(() => markEscrowAbandoned(db, escrowId)).toThrow(/Invalid escrow transition/i);
  });

  it('rejects transitions from terminal statuses', () => {
    const escrowId = holdEscrow(db, 'requester-1', 10, 'card-4');
    settleEscrow(db, escrowId, 'provider-1');

    expect(() => markEscrowStarted(db, escrowId)).toThrow(/Invalid escrow transition/i);
    expect(() => releaseEscrow(db, escrowId)).toThrow(/already settled/i);
  });
});
