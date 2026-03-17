import { describe, it, expect } from 'vitest';
import { openCreditDb, bootstrapAgent } from './ledger.js';
import { createSignedEscrowReceipt, EscrowReceiptSchema } from './escrow-receipt.js';
import { generateKeyPair, verifyEscrowReceipt } from './signing.js';
import type { EscrowReceipt } from '../types/index.js';

describe('escrow-receipt', () => {
  function setupDb(owner: string, balance = 100) {
    const db = openCreditDb(':memory:');
    bootstrapAgent(db, owner, balance);
    return db;
  }

  describe('createSignedEscrowReceipt', () => {
    it('holds escrow and returns a signed receipt', () => {
      const db = setupDb('alice');
      const keys = generateKeyPair();

      const { escrowId, receipt } = createSignedEscrowReceipt(db, keys.privateKey, keys.publicKey, {
        owner: 'alice',
        amount: 10,
        cardId: '00000000-0000-4000-8000-000000000001',
      });

      expect(typeof escrowId).toBe('string');
      expect(escrowId.length).toBeGreaterThan(0);

      expect(receipt.requester_owner).toBe('alice');
      expect(receipt.amount).toBe(10);
      expect(receipt.card_id).toBe('00000000-0000-4000-8000-000000000001');
      expect(receipt.signature).toBeTruthy();
      expect(receipt.nonce).toBeTruthy();
      expect(receipt.timestamp).toBeTruthy();
      expect(receipt.requester_public_key).toBeTruthy();

      db.close();
    });

    it('receipt signature can be verified with requester public key', () => {
      const db = setupDb('bob');
      const keys = generateKeyPair();

      const { receipt } = createSignedEscrowReceipt(db, keys.privateKey, keys.publicKey, {
        owner: 'bob',
        amount: 5,
        cardId: '00000000-0000-4000-8000-000000000002',
      });

      // Extract data without signature for verification
      const { signature, ...data } = receipt;
      const valid = verifyEscrowReceipt(data as Record<string, unknown>, signature, keys.publicKey);
      expect(valid).toBe(true);

      db.close();
    });

    it('throws INSUFFICIENT_CREDITS when balance is too low', () => {
      const db = setupDb('charlie', 5);
      const keys = generateKeyPair();

      expect(() =>
        createSignedEscrowReceipt(db, keys.privateKey, keys.publicKey, {
          owner: 'charlie',
          amount: 10,
          cardId: '00000000-0000-4000-8000-000000000003',
        }),
      ).toThrow('Insufficient credits');

      db.close();
    });

    it('produces unique nonce per call', () => {
      const db = setupDb('dave', 100);
      const keys = generateKeyPair();

      const { receipt: r1 } = createSignedEscrowReceipt(db, keys.privateKey, keys.publicKey, {
        owner: 'dave',
        amount: 5,
        cardId: '00000000-0000-4000-8000-000000000004',
      });

      const { receipt: r2 } = createSignedEscrowReceipt(db, keys.privateKey, keys.publicKey, {
        owner: 'dave',
        amount: 5,
        cardId: '00000000-0000-4000-8000-000000000004',
      });

      expect(r1.nonce).not.toBe(r2.nonce);

      db.close();
    });

    it('includes optional skillId when provided', () => {
      const db = setupDb('eve');
      const keys = generateKeyPair();

      const { receipt } = createSignedEscrowReceipt(db, keys.privateKey, keys.publicKey, {
        owner: 'eve',
        amount: 10,
        cardId: '00000000-0000-4000-8000-000000000005',
        skillId: 'tts-elevenlabs',
      });

      expect(receipt.skill_id).toBe('tts-elevenlabs');

      db.close();
    });
  });

  describe('EscrowReceiptSchema', () => {
    it('validates a well-formed receipt', () => {
      const db = setupDb('frank');
      const keys = generateKeyPair();

      const { receipt } = createSignedEscrowReceipt(db, keys.privateKey, keys.publicKey, {
        owner: 'frank',
        amount: 10,
        cardId: '00000000-0000-4000-8000-000000000006',
      });

      const result = EscrowReceiptSchema.safeParse(receipt);
      expect(result.success).toBe(true);

      db.close();
    });

    it('rejects a receipt missing required fields', () => {
      const result = EscrowReceiptSchema.safeParse({
        requester_owner: 'test',
        // missing other fields
      });
      expect(result.success).toBe(false);
    });
  });
});
