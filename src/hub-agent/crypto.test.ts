import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, getMasterKey } from './crypto.js';

// Generate a valid 32-byte test key
const TEST_KEY_HEX = randomBytes(32).toString('hex');

describe('hub-agent/crypto', () => {
  describe('encrypt / decrypt', () => {
    const masterKey = Buffer.from(TEST_KEY_HEX, 'hex');

    it('round-trips a plaintext string', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encrypt(plaintext, masterKey);
      expect(encrypted).toContain(':');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
      // All parts should be valid hex
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f]+$/);
      }
      const decrypted = decrypt(encrypted, masterKey);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts empty string', () => {
      const encrypted = encrypt('', masterKey);
      expect(decrypt(encrypted, masterKey)).toBe('');
    });

    it('encrypts unicode content', () => {
      const plaintext = 'key-with-unicode-\u4e2d\u6587-\ud83d\ude80';
      const encrypted = encrypt(plaintext, masterKey);
      expect(decrypt(encrypted, masterKey)).toBe(plaintext);
    });

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const plaintext = 'same-key';
      const enc1 = encrypt(plaintext, masterKey);
      const enc2 = encrypt(plaintext, masterKey);
      expect(enc1).not.toBe(enc2);
      // Both decrypt to the same value
      expect(decrypt(enc1, masterKey)).toBe(plaintext);
      expect(decrypt(enc2, masterKey)).toBe(plaintext);
    });

    it('throws when decrypting with wrong key', () => {
      const plaintext = 'secret';
      const encrypted = encrypt(plaintext, masterKey);
      const wrongKey = randomBytes(32);
      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });
  });

  describe('getMasterKey', () => {
    const originalEnv = process.env.HUB_MASTER_KEY;

    afterAll(() => {
      if (originalEnv !== undefined) {
        process.env.HUB_MASTER_KEY = originalEnv;
      } else {
        delete process.env.HUB_MASTER_KEY;
      }
    });

    it('returns a 32-byte Buffer when env var is valid', () => {
      process.env.HUB_MASTER_KEY = TEST_KEY_HEX;
      const key = getMasterKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });

    it('throws when env var is missing', () => {
      delete process.env.HUB_MASTER_KEY;
      expect(() => getMasterKey()).toThrow('HUB_MASTER_KEY');
    });

    it('throws when env var has wrong length', () => {
      process.env.HUB_MASTER_KEY = 'abcdef'; // too short
      expect(() => getMasterKey()).toThrow('HUB_MASTER_KEY');
    });
  });
});
