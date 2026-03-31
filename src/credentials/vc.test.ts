import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { issueCredential, verifyCredential, decodeCredential } from './vc.js';

describe('VC Core Engine', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:platform';

  it('issues a VC with correct structure', () => {
    const vc = issueCredential({
      subject: { id: 'did:agentbnb:agent-1', foo: 'bar' },
      types: ['TestCredential'],
      issuerDid,
      signerKey: keys.privateKey,
    });

    expect(vc['@context']).toEqual([
      'https://www.w3.org/2018/credentials/v1',
      'https://agentbnb.dev/credentials/v1',
    ]);
    expect(vc.type).toEqual(['VerifiableCredential', 'TestCredential']);
    expect(vc.issuer).toBe(issuerDid);
    expect(vc.issuanceDate).toBeTruthy();
    expect(vc.credentialSubject).toEqual({ id: 'did:agentbnb:agent-1', foo: 'bar' });
    expect(vc.proof.type).toBe('Ed25519Signature2020');
    expect(vc.proof.proofPurpose).toBe('assertionMethod');
    expect(vc.proof.verificationMethod).toBe('did:agentbnb:platform#key-1');
    expect(vc.proof.proofValue).toBeTruthy();
  });

  it('sets expirationDate when provided', () => {
    const expiry = '2027-01-01T00:00:00.000Z';
    const vc = issueCredential({
      subject: { id: 'did:agentbnb:agent-1' },
      types: ['TestCredential'],
      issuerDid,
      signerKey: keys.privateKey,
      expirationDate: expiry,
    });

    expect(vc.expirationDate).toBe(expiry);
  });

  it('omits expirationDate when not provided', () => {
    const vc = issueCredential({
      subject: { id: 'did:agentbnb:agent-1' },
      types: ['TestCredential'],
      issuerDid,
      signerKey: keys.privateKey,
    });

    expect(vc.expirationDate).toBeUndefined();
  });

  it('verifies a valid VC', () => {
    const vc = issueCredential({
      subject: { id: 'did:agentbnb:agent-1', score: 42 },
      types: ['TestCredential'],
      issuerDid,
      signerKey: keys.privateKey,
    });

    expect(verifyCredential(vc, keys.publicKey)).toBe(true);
  });

  it('rejects a tampered VC', () => {
    const vc = issueCredential({
      subject: { id: 'did:agentbnb:agent-1', score: 42 },
      types: ['TestCredential'],
      issuerDid,
      signerKey: keys.privateKey,
    });

    vc.credentialSubject.score = 999;
    expect(verifyCredential(vc, keys.publicKey)).toBe(false);
  });

  it('rejects with wrong public key', () => {
    const otherKeys = generateKeyPair();
    const vc = issueCredential({
      subject: { id: 'did:agentbnb:agent-1' },
      types: ['TestCredential'],
      issuerDid,
      signerKey: keys.privateKey,
    });

    expect(verifyCredential(vc, otherKeys.publicKey)).toBe(false);
  });

  it('decodes a VC from JSON without verifying', () => {
    const vc = issueCredential({
      subject: { id: 'did:agentbnb:agent-1' },
      types: ['TestCredential'],
      issuerDid,
      signerKey: keys.privateKey,
    });

    const json = JSON.stringify(vc);
    const decoded = decodeCredential(json);
    expect(decoded).toEqual(vc);
  });
});
