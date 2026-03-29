import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateKeyPair,
  saveKeyPair,
  loadKeyPair,
  signEscrowReceipt,
  verifyEscrowReceipt,
} from './signing.js';

describe('signing', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-signing-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateKeyPair', () => {
    it('returns publicKey and privateKey as Buffers', () => {
      const keys = generateKeyPair();
      expect(keys.publicKey).toBeInstanceOf(Buffer);
      expect(keys.privateKey).toBeInstanceOf(Buffer);
    });

    it('generates different keypairs on each call', () => {
      const keys1 = generateKeyPair();
      const keys2 = generateKeyPair();
      expect(keys1.publicKey.equals(keys2.publicKey)).toBe(false);
    });
  });

  describe('saveKeyPair / loadKeyPair', () => {
    it('persists keys to disk and reloads them', () => {
      const keys = generateKeyPair();
      saveKeyPair(tempDir, keys);

      expect(existsSync(join(tempDir, 'private.key'))).toBe(true);
      expect(existsSync(join(tempDir, 'public.key'))).toBe(true);

      const loaded = loadKeyPair(tempDir);
      expect(loaded.publicKey.equals(keys.publicKey)).toBe(true);
      expect(loaded.privateKey.equals(keys.privateKey)).toBe(true);
    });

    it('throws KEYPAIR_NOT_FOUND when keys do not exist', () => {
      try {
        loadKeyPair(tempDir);
        expect.fail('should have thrown');
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe('KEYPAIR_NOT_FOUND');
      }
    });

    it('sets private key file permissions to 0o600', () => {
      const keys = generateKeyPair();
      saveKeyPair(tempDir, keys);

      // On macOS/Linux, check file mode
      const { statSync } = require('node:fs');
      const stat = statSync(join(tempDir, 'private.key'));
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('signEscrowReceipt / verifyEscrowReceipt', () => {
    it('roundtrip sign and verify succeeds', () => {
      const keys = generateKeyPair();
      const data = { amount: 10, card_id: 'test-card', timestamp: '2026-03-17T00:00:00Z' };

      const signature = signEscrowReceipt(data, keys.privateKey);
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      const valid = verifyEscrowReceipt(data, signature, keys.publicKey);
      expect(valid).toBe(true);
    });

    it('returns false for tampered data', () => {
      const keys = generateKeyPair();
      const data = { amount: 10, card_id: 'test-card' };
      const signature = signEscrowReceipt(data, keys.privateKey);

      const tampered = { amount: 99, card_id: 'test-card' };
      expect(verifyEscrowReceipt(tampered, signature, keys.publicKey)).toBe(false);
    });

    it('returns false for wrong public key', () => {
      const keys1 = generateKeyPair();
      const keys2 = generateKeyPair();
      const data = { amount: 10, card_id: 'test-card' };
      const signature = signEscrowReceipt(data, keys1.privateKey);

      expect(verifyEscrowReceipt(data, signature, keys2.publicKey)).toBe(false);
    });

    it('produces consistent signatures for same data (deterministic)', () => {
      const keys = generateKeyPair();
      const data = { card_id: 'abc', amount: 5 };

      const sig1 = signEscrowReceipt(data, keys.privateKey);
      const sig2 = signEscrowReceipt(data, keys.privateKey);
      // Ed25519 is deterministic
      expect(sig1).toBe(sig2);
    });

    it('produces canonical JSON (sorted keys)', () => {
      const keys = generateKeyPair();
      const data1 = { b: 2, a: 1 };
      const data2 = { a: 1, b: 2 };

      const sig1 = signEscrowReceipt(data1, keys.privateKey);
      const sig2 = signEscrowReceipt(data2, keys.privateKey);
      // Same data in different key order should produce same signature
      expect(sig1).toBe(sig2);
    });

    it('produces canonical JSON for nested objects at all depths', () => {
      const keys = generateKeyPair();
      const data1 = {
        params: {
          escrow: { z: 9, a: 1, nested: { y: 2, b: 3 } },
          card_id: 'card-123',
          requester: 'alice',
        },
        method: 'capability.execute',
      };
      const data2 = {
        method: 'capability.execute',
        params: {
          requester: 'alice',
          card_id: 'card-123',
          escrow: { nested: { b: 3, y: 2 }, a: 1, z: 9 },
        },
      };

      const sig1 = signEscrowReceipt(data1, keys.privateKey);
      const sig2 = signEscrowReceipt(data2, keys.privateKey);
      expect(sig1).toBe(sig2);
    });
  });
});
