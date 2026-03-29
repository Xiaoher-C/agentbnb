import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { generateKeyPair } from '../credit/signing.js';
import { signEscrowReceipt } from '../credit/signing.js';
import { markEscrowStarted, markEscrowAbandoned } from '../credit/escrow.js';
import {
  processEscrowHold,
  processEscrowSettle,
  settleWithNetworkFee,
  verifyRelaySignature,
} from './relay-escrow.js';

describe('relay-escrow', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    // Bootstrap gives credits + issues a 50-credit demand voucher.
    // holdEscrow uses voucher first, then balance.
    // Expire all vouchers so tests use balance only (predictable).
    bootstrapAgent(db, 'consumer-1', 200);
    bootstrapAgent(db, 'provider-1', 50);
    db.prepare("UPDATE demand_vouchers SET is_active = 0").run();
  });

  afterEach(() => {
    db.close();
  });

  describe('processEscrowHold', () => {
    it('holds credits and returns escrow_id', () => {
      const result = processEscrowHold(
        db, 'consumer-1', 'provider-1', 'tts', 10, crypto.randomUUID(),
      );

      expect(result.escrow_id).toBeTruthy();
      expect(result.hold_amount).toBe(10);
      expect(result.consumer_remaining).toBe(190);
      expect(getBalance(db, 'consumer-1')).toBe(190);
    });

    it('throws on insufficient credits', () => {
      expect(() =>
        processEscrowHold(db, 'consumer-1', 'provider-1', 'tts', 999, crypto.randomUUID()),
      ).toThrow();
    });

    it('verifies signature when provided', () => {
      const keys = generateKeyPair();
      const requestId = crypto.randomUUID();
      const signData = {
        consumer_agent_id: 'consumer-1',
        provider_agent_id: 'provider-1',
        skill_id: 'tts',
        amount: 10,
        request_id: requestId,
      };
      const sig = signEscrowReceipt(signData as Record<string, unknown>, keys.privateKey);

      const result = processEscrowHold(
        db, 'consumer-1', 'provider-1', 'tts', 10, requestId,
        sig, keys.publicKey.toString('hex'),
      );

      expect(result.escrow_id).toBeTruthy();
    });

    it('rejects invalid signature', () => {
      const keys = generateKeyPair();
      expect(() =>
        processEscrowHold(
          db, 'consumer-1', 'provider-1', 'tts', 10, crypto.randomUUID(),
          'invalid-signature', keys.publicKey.toString('hex'),
        ),
      ).toThrow('Invalid consumer signature');
    });
  });

  describe('processEscrowSettle — success', () => {
    it('settles with 5% network fee + first-provider bonus', () => {
      const hold = processEscrowHold(
        db, 'consumer-1', 'provider-1', 'tts', 100, crypto.randomUUID(),
      );

      const result = processEscrowSettle(db, hold.escrow_id, true, 'provider-1');

      expect(result.network_fee).toBe(5); // floor(5% of 100) = 5
      expect(result.provider_earned).toBe(95); // 100 - 5
      expect(result.escrow_id).toBe(hold.escrow_id);
      // Provider: started with 50, earned 95, plus 2x first-provider bonus on 95 = +95 = 240
      // settleEscrow credits providerAmount(95) + bonus(floor(95*1.0)=95) = 190 total added
      expect(getBalance(db, 'provider-1')).toBe(50 + 95 + 95);
      // Platform treasury gets the fee
      expect(getBalance(db, 'platform_treasury')).toBe(5);
    });

    it('network fee calculation', () => {
      const hold = processEscrowHold(
        db, 'consumer-1', 'provider-1', 'tts', 5, crypto.randomUUID(),
      );

      const result = processEscrowSettle(db, hold.escrow_id, true, 'provider-1');

      // floor(5% of 5) = 0, no minimum in settleEscrow
      expect(result.network_fee).toBe(0);
      expect(result.provider_earned).toBe(5);
    });

    it('settles escrows that reached abandoned state', () => {
      const hold = processEscrowHold(
        db, 'consumer-1', 'provider-1', 'tts', 20, crypto.randomUUID(),
      );

      markEscrowStarted(db, hold.escrow_id);
      markEscrowAbandoned(db, hold.escrow_id);

      const result = processEscrowSettle(db, hold.escrow_id, true, 'provider-1');
      expect(result.escrow_id).toBe(hold.escrow_id);
      expect(result.provider_earned).toBeGreaterThan(0);
    });
  });

  describe('processEscrowSettle — failure', () => {
    it('refunds consumer on failure', () => {
      const hold = processEscrowHold(
        db, 'consumer-1', 'provider-1', 'tts', 50, crypto.randomUUID(),
      );

      const result = processEscrowSettle(db, hold.escrow_id, false, 'provider-1');

      expect(result.provider_earned).toBe(0);
      expect(result.network_fee).toBe(0);
      expect(result.consumer_remaining).toBe(200); // Full refund
      expect(getBalance(db, 'consumer-1')).toBe(200);
    });
  });

  describe('processEscrowSettle — double settle', () => {
    it('throws on already settled escrow', () => {
      const hold = processEscrowHold(
        db, 'consumer-1', 'provider-1', 'tts', 10, crypto.randomUUID(),
      );

      processEscrowSettle(db, hold.escrow_id, true, 'provider-1');

      expect(() =>
        processEscrowSettle(db, hold.escrow_id, true, 'provider-1'),
      ).toThrow();
    });
  });

  describe('settleWithNetworkFee', () => {
    it('is a convenience wrapper for successful settlement', async () => {
      // Use the existing relay escrow flow (holdEscrow directly)
      const { holdEscrow } = await import('../credit/escrow.js');
      const escrowId = holdEscrow(db, 'consumer-1', 50, 'card-1');

      const result = settleWithNetworkFee(db, escrowId, 'provider-1');

      expect(result.provider_earned).toBe(48); // 50 - 2 (floor of 5% = 2.5 → 2)
      expect(result.network_fee).toBe(2);
    });
  });

  describe('verifyRelaySignature', () => {
    it('verifies a valid signature', () => {
      const keys = generateKeyPair();
      const data = { foo: 'bar', num: 42 };
      const sig = signEscrowReceipt(data as Record<string, unknown>, keys.privateKey);

      expect(verifyRelaySignature(data, sig, keys.publicKey.toString('hex'))).toBe(true);
    });

    it('rejects an invalid signature', () => {
      const keys = generateKeyPair();
      expect(verifyRelaySignature({ foo: 'bar' }, 'bad-sig', keys.publicKey.toString('hex'))).toBe(false);
    });

    it('rejects a signature from a different key', () => {
      const keys1 = generateKeyPair();
      const keys2 = generateKeyPair();
      const data = { test: 'data' };
      const sig = signEscrowReceipt(data as Record<string, unknown>, keys1.privateKey);

      expect(verifyRelaySignature(data, sig, keys2.publicKey.toString('hex'))).toBe(false);
    });
  });
});
