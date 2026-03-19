import { describe, it, expect, beforeEach } from 'vitest';
import { openCreditDb } from './ledger.js';
import { LocalCreditLedger } from './local-credit-ledger.js';
import type { CreditLedger } from './credit-ledger.js';
import Database from 'better-sqlite3';

describe('LocalCreditLedger', () => {
  let db: Database.Database;
  let ledger: CreditLedger;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    ledger = new LocalCreditLedger(db);
  });

  describe('grant()', () => {
    it('grants initial credits to a new agent', async () => {
      await ledger.grant('agent-alice', 100);
      const balance = await ledger.getBalance('agent-alice');
      expect(balance).toBe(100);
    });

    it('uses default amount of 100 if not specified', async () => {
      await ledger.grant('agent-default');
      const balance = await ledger.getBalance('agent-default');
      expect(balance).toBe(100);
    });

    it('is idempotent — calling twice does not double the balance', async () => {
      await ledger.grant('agent-bob', 50);
      await ledger.grant('agent-bob', 50);
      const balance = await ledger.getBalance('agent-bob');
      expect(balance).toBe(50);
    });
  });

  describe('getBalance()', () => {
    it('returns 0 for an unknown agent', async () => {
      const balance = await ledger.getBalance('agent-unknown');
      expect(balance).toBe(0);
    });

    it('returns current balance after grant', async () => {
      await ledger.grant('agent-charlie', 200);
      const balance = await ledger.getBalance('agent-charlie');
      expect(balance).toBe(200);
    });
  });

  describe('hold()', () => {
    it('deducts credits and returns an escrowId', async () => {
      await ledger.grant('agent-dave', 100);
      const result = await ledger.hold('agent-dave', 30, 'card-123');
      expect(result.escrowId).toBeDefined();
      expect(typeof result.escrowId).toBe('string');
      const balance = await ledger.getBalance('agent-dave');
      expect(balance).toBe(70);
    });

    it('throws INSUFFICIENT_CREDITS when balance is too low', async () => {
      await ledger.grant('agent-eve', 10);
      await expect(ledger.hold('agent-eve', 50, 'card-abc')).rejects.toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
      });
    });

    it('throws INSUFFICIENT_CREDITS for agent with zero balance', async () => {
      await expect(ledger.hold('agent-new', 1, 'card-xyz')).rejects.toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
      });
    });
  });

  describe('settle()', () => {
    it('transfers held credits to recipient', async () => {
      await ledger.grant('agent-frank', 100);
      const { escrowId } = await ledger.hold('agent-frank', 40, 'card-999');
      await ledger.settle(escrowId, 'agent-grace');
      const graceBal = await ledger.getBalance('agent-grace');
      expect(graceBal).toBe(40);
    });

    it('throws ESCROW_NOT_FOUND for unknown escrowId', async () => {
      await expect(ledger.settle('nonexistent-escrow', 'agent-someone')).rejects.toMatchObject({
        code: 'ESCROW_NOT_FOUND',
      });
    });

    it('throws ESCROW_ALREADY_SETTLED if escrow was already settled', async () => {
      await ledger.grant('agent-harry', 100);
      const { escrowId } = await ledger.hold('agent-harry', 20, 'card-dup');
      await ledger.settle(escrowId, 'agent-ivy');
      await expect(ledger.settle(escrowId, 'agent-ivy')).rejects.toMatchObject({
        code: 'ESCROW_ALREADY_SETTLED',
      });
    });
  });

  describe('release()', () => {
    it('refunds held credits back to original owner', async () => {
      await ledger.grant('agent-jack', 100);
      const { escrowId } = await ledger.hold('agent-jack', 35, 'card-refund');
      await ledger.release(escrowId);
      const balance = await ledger.getBalance('agent-jack');
      expect(balance).toBe(100);
    });

    it('throws ESCROW_NOT_FOUND for unknown escrowId', async () => {
      await expect(ledger.release('nonexistent-escrow')).rejects.toMatchObject({
        code: 'ESCROW_NOT_FOUND',
      });
    });

    it('throws ESCROW_ALREADY_SETTLED if escrow was already released', async () => {
      await ledger.grant('agent-kate', 100);
      const { escrowId } = await ledger.hold('agent-kate', 25, 'card-double-release');
      await ledger.release(escrowId);
      await expect(ledger.release(escrowId)).rejects.toMatchObject({
        code: 'ESCROW_ALREADY_SETTLED',
      });
    });
  });

  describe('getHistory()', () => {
    it('returns empty array for agent with no transactions', async () => {
      const history = await ledger.getHistory('agent-nobody');
      expect(history).toEqual([]);
    });

    it('returns transactions newest first', async () => {
      await ledger.grant('agent-liam', 100);
      await ledger.hold('agent-liam', 10, 'card-hist');
      const history = await ledger.getHistory('agent-liam');
      expect(history.length).toBeGreaterThanOrEqual(2);
      // newest first — escrow_hold debit should come after bootstrap
      const reasons = history.map((t) => t.reason);
      expect(reasons[0]).toBe('escrow_hold');
      expect(reasons[reasons.length - 1]).toBe('bootstrap');
    });

    it('respects limit parameter', async () => {
      await ledger.grant('agent-mia', 100);
      await ledger.hold('agent-mia', 5, 'card-1');
      await ledger.hold('agent-mia', 5, 'card-2');
      const history = await ledger.getHistory('agent-mia', 2);
      expect(history.length).toBeLessThanOrEqual(2);
    });

    it('returns CreditTransaction objects with expected shape', async () => {
      await ledger.grant('agent-noah', 100);
      const history = await ledger.getHistory('agent-noah');
      expect(history.length).toBe(1);
      const tx = history[0];
      expect(tx).toMatchObject({
        id: expect.any(String),
        owner: 'agent-noah',
        amount: 100,
        reason: 'bootstrap',
      });
    });
  });

  describe('CreditLedger interface compliance', () => {
    it('all methods return Promises', () => {
      const l = new LocalCreditLedger(db);
      expect(l.grant('x')).toBeInstanceOf(Promise);
      expect(l.getBalance('x')).toBeInstanceOf(Promise);
      expect(l.getHistory('x')).toBeInstanceOf(Promise);
      // hold/settle/release return promises too (they may reject but are still Promises)
      const holdP = l.hold('x', 1, 'card').catch(() => {});
      expect(holdP).toBeInstanceOf(Promise);
    });
  });
});
