import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { issueCredential, verifyCredential, VerifiableCredential } from './vc.js';

describe('vc core engine', () => {
  const keys = generateKeyPair();
  const otherKeys = generateKeyPair();
  const issuerDid = 'did:agentbnb:platform';

  function makeVc(): VerifiableCredential {
    return issueCredential({
      subject: { id: 'did:agentbnb:agent-001', foo: 'bar' },
      types: ['VerifiableCredential', 'TestCredential'],
      issuerDid,
      signerKey: keys.privateKey,
    });
  }

  describe('issueCredential', () => {
    it('returns correct @context', () => {
      const vc = makeVc();
      expect(vc['@context']).toEqual([
        'https://www.w3.org/2018/credentials/v1',
        'https://agentbnb.dev/credentials/v1',
      ]);
    });

    it('returns correct type array', () => {
      const vc = makeVc();
      expect(vc.type).toEqual(['VerifiableCredential', 'TestCredential']);
    });

    it('sets issuer to the provided DID', () => {
      const vc = makeVc();
      expect(vc.issuer).toBe(issuerDid);
    });

    it('sets issuanceDate to an ISO 8601 string', () => {
      const vc = makeVc();
      expect(new Date(vc.issuanceDate).toISOString()).toBe(vc.issuanceDate);
    });

    it('includes credentialSubject with id', () => {
      const vc = makeVc();
      expect(vc.credentialSubject.id).toBe('did:agentbnb:agent-001');
      expect(vc.credentialSubject['foo']).toBe('bar');
    });

    it('includes proof with Ed25519Signature2020 type', () => {
      const vc = makeVc();
      expect(vc.proof.type).toBe('Ed25519Signature2020');
      expect(vc.proof.proofPurpose).toBe('assertionMethod');
      expect(vc.proof.verificationMethod).toBe(`${issuerDid}#key-1`);
      expect(vc.proof.proofValue).toBeTruthy();
      expect(vc.proof.created).toBeTruthy();
    });

    it('includes expirationDate when provided', () => {
      const expiry = new Date(Date.now() + 86400000).toISOString();
      const vc = issueCredential({
        subject: { id: 'did:agentbnb:agent-001' },
        types: ['VerifiableCredential'],
        issuerDid,
        signerKey: keys.privateKey,
        expirationDate: expiry,
      });
      expect(vc.expirationDate).toBe(expiry);
    });

    it('omits expirationDate when not provided', () => {
      const vc = makeVc();
      expect(vc.expirationDate).toBeUndefined();
    });
  });

  describe('verifyCredential', () => {
    it('verifies a valid credential (sign-verify round-trip)', () => {
      const vc = makeVc();
      expect(verifyCredential(vc, keys.publicKey)).toBe(true);
    });

    it('verifies a credential with expirationDate', () => {
      const vc = issueCredential({
        subject: { id: 'did:agentbnb:agent-001', level: 5 },
        types: ['VerifiableCredential', 'TestCredential'],
        issuerDid,
        signerKey: keys.privateKey,
        expirationDate: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(verifyCredential(vc, keys.publicKey)).toBe(true);
    });

    it('rejects a tampered credential (modified subject)', () => {
      const vc = makeVc();
      vc.credentialSubject['foo'] = 'tampered';
      expect(verifyCredential(vc, keys.publicKey)).toBe(false);
    });

    it('rejects a tampered credential (modified issuer)', () => {
      const vc = makeVc();
      vc.issuer = 'did:agentbnb:hacker';
      expect(verifyCredential(vc, keys.publicKey)).toBe(false);
    });

    it('rejects verification with wrong public key', () => {
      const vc = makeVc();
      expect(verifyCredential(vc, otherKeys.publicKey)).toBe(false);
    });
  });
});
