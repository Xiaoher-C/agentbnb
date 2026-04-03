import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { deriveAgentId } from './identity.js';
import { toDIDAgentBnB } from './did.js';
import {
  createRevocationRecord,
  verifyRevocationRecord,
  DIDRevocationRegistry,
} from './did-revocation.js';

describe('DID revocation', () => {
  const keys = generateKeyPair();
  const pubHex = keys.publicKey.toString('hex');
  const did = toDIDAgentBnB(deriveAgentId(pubHex));

  describe('createRevocationRecord + verifyRevocationRecord', () => {
    it('creates a valid revocation record that verifies', () => {
      const record = createRevocationRecord({
        did,
        reason: 'Key compromised',
        revokerKey: keys.privateKey,
        revokerPublicKeyHex: pubHex,
      });

      expect(record.did).toBe(did);
      expect(record.reason).toBe('Key compromised');
      expect(record.revoker_public_key).toBe(pubHex);
      expect(record.signature).toBeTruthy();
      expect(record.timestamp).toBeTruthy();

      expect(verifyRevocationRecord(record)).toBe(true);
    });

    it('rejects a tampered revocation record', () => {
      const record = createRevocationRecord({
        did,
        reason: 'Key compromised',
        revokerKey: keys.privateKey,
        revokerPublicKeyHex: pubHex,
      });

      record.reason = 'Tampered reason';
      expect(verifyRevocationRecord(record)).toBe(false);
    });
  });

  describe('DIDRevocationRegistry', () => {
    it('tracks revoked DIDs', () => {
      const registry = new DIDRevocationRegistry();
      const record = createRevocationRecord({
        did,
        reason: 'Decommissioned',
        revokerKey: keys.privateKey,
        revokerPublicKeyHex: pubHex,
      });

      expect(registry.isRevoked(did)).toBe(false);

      registry.revoke(record);

      expect(registry.isRevoked(did)).toBe(true);
    });

    it('returns the revocation record for a revoked DID', () => {
      const registry = new DIDRevocationRegistry();
      const record = createRevocationRecord({
        did,
        reason: 'Decommissioned',
        revokerKey: keys.privateKey,
        revokerPublicKeyHex: pubHex,
      });

      expect(registry.getRevocation(did)).toBeNull();

      registry.revoke(record);

      const stored = registry.getRevocation(did);
      expect(stored).not.toBeNull();
      expect(stored!.did).toBe(did);
      expect(stored!.reason).toBe('Decommissioned');
    });

    it('lists all revoked DIDs', () => {
      const registry = new DIDRevocationRegistry();
      const otherKeys = generateKeyPair();
      const otherPubHex = otherKeys.publicKey.toString('hex');
      const otherDid = toDIDAgentBnB(deriveAgentId(otherPubHex));

      registry.revoke(createRevocationRecord({
        did,
        reason: 'Reason 1',
        revokerKey: keys.privateKey,
        revokerPublicKeyHex: pubHex,
      }));
      registry.revoke(createRevocationRecord({
        did: otherDid,
        reason: 'Reason 2',
        revokerKey: otherKeys.privateKey,
        revokerPublicKeyHex: otherPubHex,
      }));

      const revoked = registry.listRevoked();
      expect(revoked).toHaveLength(2);
      expect(revoked).toContain(did);
      expect(revoked).toContain(otherDid);
    });

    it('clears all revocations', () => {
      const registry = new DIDRevocationRegistry();
      registry.revoke(createRevocationRecord({
        did,
        reason: 'Reason',
        revokerKey: keys.privateKey,
        revokerPublicKeyHex: pubHex,
      }));

      expect(registry.isRevoked(did)).toBe(true);

      registry.clear();

      expect(registry.isRevoked(did)).toBe(false);
      expect(registry.listRevoked()).toHaveLength(0);
    });

    it('rejects a revocation with an invalid signature', () => {
      const registry = new DIDRevocationRegistry();
      const record = createRevocationRecord({
        did,
        reason: 'Reason',
        revokerKey: keys.privateKey,
        revokerPublicKeyHex: pubHex,
      });

      // Tamper
      record.did = 'did:agentbnb:aaaaaaaaaaaaaaaa';

      expect(() => registry.revoke(record)).toThrow('invalid signature');
    });
  });
});
