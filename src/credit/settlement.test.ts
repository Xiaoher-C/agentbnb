import { describe, it, expect } from 'vitest';
import { openCreditDb, getBalance, bootstrapAgent, getTransactions } from './ledger.js';
import { holdEscrow, getEscrowStatus } from './escrow.js';
import { recordEarning } from './ledger.js';
import {
  settleProviderEarning,
  settleRequesterEscrow,
  releaseRequesterEscrow,
} from './settlement.js';
import type { EscrowReceipt } from '../types/index.js';
import Database from 'better-sqlite3';

describe('settlement protocol', () => {
  function makeProviderDb(): Database.Database {
    return openCreditDb(':memory:');
  }

  function makeRequesterDb(): Database.Database {
    return openCreditDb(':memory:');
  }

  function fakeReceipt(overrides?: Partial<EscrowReceipt>): EscrowReceipt {
    return {
      requester_owner: 'requester-agent',
      requester_public_key: 'deadbeef',
      amount: 10,
      card_id: 'card-001',
      timestamp: new Date().toISOString(),
      nonce: 'nonce-' + Math.random().toString(36).slice(2),
      signature: 'fakesig',
      ...overrides,
    };
  }

  describe('recordEarning', () => {
    it('credits provider balance and logs transaction', () => {
      const db = makeProviderDb();
      bootstrapAgent(db, 'provider', 0);

      recordEarning(db, 'provider', 10, 'card-001', 'nonce-1');

      expect(getBalance(db, 'provider')).toBe(10);
      const txns = getTransactions(db, 'provider');
      const earning = txns.find((t) => t.reason === 'remote_earning');
      expect(earning).toBeDefined();
      expect(earning!.amount).toBe(10);
      expect(earning!.reference_id).toBe('nonce-1');
    });

    it('is idempotent on nonce -- calling twice does not double credit', () => {
      const db = makeProviderDb();
      bootstrapAgent(db, 'provider', 0);

      recordEarning(db, 'provider', 10, 'card-001', 'nonce-same');
      recordEarning(db, 'provider', 10, 'card-001', 'nonce-same');

      expect(getBalance(db, 'provider')).toBe(10); // Not 20
    });

    it('creates balance row if provider was not bootstrapped', () => {
      const db = makeProviderDb();

      recordEarning(db, 'new-provider', 25, 'card-002', 'nonce-new');

      expect(getBalance(db, 'new-provider')).toBe(25);
    });
  });

  describe('settleProviderEarning', () => {
    it('records earning from receipt in provider DB', () => {
      const providerDb = makeProviderDb();
      bootstrapAgent(providerDb, 'provider', 0);

      const receipt = fakeReceipt({ amount: 15 });
      const result = settleProviderEarning(providerDb, 'provider', receipt);

      expect(result).toEqual({ settled: true });
      expect(getBalance(providerDb, 'provider')).toBe(15);
    });
  });

  describe('settleRequesterEscrow', () => {
    it('confirms escrow debit without crediting anyone', () => {
      const requesterDb = makeRequesterDb();
      bootstrapAgent(requesterDb, 'requester', 100);

      const escrowId = holdEscrow(requesterDb, 'requester', 10, 'card-001');
      expect(getBalance(requesterDb, 'requester')).toBe(90);

      settleRequesterEscrow(requesterDb, escrowId);

      // Balance unchanged -- credits stay deducted
      expect(getBalance(requesterDb, 'requester')).toBe(90);
      // Escrow marked as settled
      const escrow = getEscrowStatus(requesterDb, escrowId);
      expect(escrow!.status).toBe('settled');
    });
  });

  describe('releaseRequesterEscrow', () => {
    it('refunds credits back to requester on failure', () => {
      const requesterDb = makeRequesterDb();
      bootstrapAgent(requesterDb, 'requester', 100);

      const escrowId = holdEscrow(requesterDb, 'requester', 10, 'card-001');
      expect(getBalance(requesterDb, 'requester')).toBe(90);

      releaseRequesterEscrow(requesterDb, escrowId);

      expect(getBalance(requesterDb, 'requester')).toBe(100);
      const escrow = getEscrowStatus(requesterDb, escrowId);
      expect(escrow!.status).toBe('released');
    });
  });

  describe('full settlement flow with separate DBs', () => {
    it('provider and requester settle independently', () => {
      const providerDb = makeProviderDb();
      const requesterDb = makeRequesterDb();

      bootstrapAgent(providerDb, 'provider', 0);
      bootstrapAgent(requesterDb, 'requester', 100);

      // Requester holds escrow
      const escrowId = holdEscrow(requesterDb, 'requester', 10, 'card-001');
      expect(getBalance(requesterDb, 'requester')).toBe(90);

      // Create receipt (normally signed, here just a fake)
      const receipt = fakeReceipt({ amount: 10 });

      // Provider records earning in own DB
      settleProviderEarning(providerDb, 'provider', receipt);
      expect(getBalance(providerDb, 'provider')).toBe(10);

      // Requester confirms escrow debit in own DB
      settleRequesterEscrow(requesterDb, escrowId);
      expect(getBalance(requesterDb, 'requester')).toBe(90);

      // No cross-DB operations happened
      // Provider DB doesn't know about requester, requester DB doesn't know about provider
    });

    it('provider and requester handle failure independently', () => {
      const providerDb = makeProviderDb();
      const requesterDb = makeRequesterDb();

      bootstrapAgent(providerDb, 'provider', 0);
      bootstrapAgent(requesterDb, 'requester', 100);

      // Requester holds escrow
      const escrowId = holdEscrow(requesterDb, 'requester', 10, 'card-001');

      // Execution fails -- provider does NOT record earning
      // Requester releases escrow (refund)
      releaseRequesterEscrow(requesterDb, escrowId);
      expect(getBalance(requesterDb, 'requester')).toBe(100);
      expect(getBalance(providerDb, 'provider')).toBe(0);
    });
  });
});
