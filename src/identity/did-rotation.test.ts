import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import {
  createRotationRecord,
  verifyRotationRecord,
  isWithinGracePeriod,
  rotateKeys,
  ROTATION_GRACE_DAYS,
} from './did-rotation.js';

describe('DID key rotation', () => {
  const oldKeys = generateKeyPair();
  const newKeys = generateKeyPair();

  describe('createRotationRecord + verifyRotationRecord', () => {
    it('creates a valid rotation record that verifies', () => {
      const record = createRotationRecord({ oldKeys, newKeys });

      expect(record.old_did).toMatch(/^did:agentbnb:[0-9a-f]{16}$/);
      expect(record.new_did).toMatch(/^did:agentbnb:[0-9a-f]{16}$/);
      expect(record.old_did).not.toBe(record.new_did);
      expect(record.old_public_key).toBe(oldKeys.publicKey.toString('hex'));
      expect(record.new_public_key).toBe(newKeys.publicKey.toString('hex'));
      expect(record.grace_period_days).toBe(ROTATION_GRACE_DAYS);
      expect(record.old_key_signature).toBeTruthy();

      expect(verifyRotationRecord(record)).toBe(true);
    });

    it('rejects a tampered rotation record', () => {
      const record = createRotationRecord({ oldKeys, newKeys });
      record.new_did = 'did:agentbnb:aaaaaaaaaaaaaaaa';

      expect(verifyRotationRecord(record)).toBe(false);
    });

    it('respects custom grace period', () => {
      const record = createRotationRecord({ oldKeys, newKeys, gracePeriodDays: 7 });
      expect(record.grace_period_days).toBe(7);
    });
  });

  describe('isWithinGracePeriod', () => {
    it('returns true for a freshly created record', () => {
      const record = createRotationRecord({ oldKeys, newKeys });
      expect(isWithinGracePeriod(record)).toBe(true);
    });

    it('returns false for an expired record', () => {
      const record = createRotationRecord({ oldKeys, newKeys, gracePeriodDays: 0 });
      // Force timestamp into the past so that 0-day grace is expired
      record.timestamp = new Date(Date.now() - 1000).toISOString();
      expect(isWithinGracePeriod(record)).toBe(false);
    });
  });

  describe('rotateKeys', () => {
    it('generates a new different keypair and a valid rotation record', () => {
      const result = rotateKeys(oldKeys);

      expect(result.newKeys.publicKey).not.toEqual(oldKeys.publicKey);
      expect(result.newKeys.privateKey).not.toEqual(oldKeys.privateKey);
      expect(result.rotationRecord.old_public_key).toBe(oldKeys.publicKey.toString('hex'));
      expect(result.rotationRecord.new_public_key).toBe(result.newKeys.publicKey.toString('hex'));
      expect(verifyRotationRecord(result.rotationRecord)).toBe(true);
    });

    it('produces a new DID that differs from the old DID', () => {
      const result = rotateKeys(oldKeys);
      expect(result.rotationRecord.new_did).not.toBe(result.rotationRecord.old_did);
    });
  });
});
