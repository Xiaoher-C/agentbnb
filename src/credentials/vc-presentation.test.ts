import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { issueCredential } from './vc.js';
import {
  createPresentation,
  verifyPresentation,
  createSelectivePresentation,
} from './vc-presentation.js';

describe('vc-presentation', () => {
  const holderKeys = generateKeyPair();
  const issuerKeys = generateKeyPair();
  const holderDid = 'did:agentbnb:holder001';
  const issuerDid = 'did:agentbnb:issuer001';

  function makeReputationVc() {
    return issueCredential({
      subject: { id: holderDid, successRate: 0.95 },
      types: ['VerifiableCredential', 'AgentReputationCredential'],
      issuerDid,
      signerKey: issuerKeys.privateKey,
    });
  }

  function makeSkillVc() {
    return issueCredential({
      subject: { id: holderDid, skill: 'code-review' },
      types: ['VerifiableCredential', 'AgentSkillCredential'],
      issuerDid,
      signerKey: issuerKeys.privateKey,
    });
  }

  describe('createPresentation / verifyPresentation', () => {
    it('create and verify round-trip', () => {
      const vc = makeReputationVc();
      const vp = createPresentation({
        holderDid,
        credentials: [vc],
        signerKey: holderKeys.privateKey,
      });

      expect(vp['@context']).toEqual([
        'https://www.w3.org/2018/credentials/v1',
        'https://agentbnb.dev/credentials/v1',
      ]);
      expect(vp.type).toEqual(['VerifiablePresentation']);
      expect(vp.holder).toBe(holderDid);
      expect(vp.verifiableCredential).toHaveLength(1);
      expect(vp.proof.type).toBe('Ed25519Signature2020');
      expect(vp.proof.proofPurpose).toBe('authentication');
      expect(vp.proof.verificationMethod).toBe(`${holderDid}#key-1`);

      expect(verifyPresentation(vp, holderKeys.publicKey)).toBe(true);
    });

    it('tampered VP fails verification', () => {
      const vc = makeReputationVc();
      const vp = createPresentation({
        holderDid,
        credentials: [vc],
        signerKey: holderKeys.privateKey,
      });

      vp.holder = 'did:agentbnb:attacker';
      expect(verifyPresentation(vp, holderKeys.publicKey)).toBe(false);
    });

    it('wrong key fails verification', () => {
      const vc = makeReputationVc();
      const otherKeys = generateKeyPair();
      const vp = createPresentation({
        holderDid,
        credentials: [vc],
        signerKey: holderKeys.privateKey,
      });

      expect(verifyPresentation(vp, otherKeys.publicKey)).toBe(false);
    });

    it('challenge is included in proof', () => {
      const vc = makeReputationVc();
      const challenge = 'nonce-abc-123';
      const vp = createPresentation({
        holderDid,
        credentials: [vc],
        signerKey: holderKeys.privateKey,
        challenge,
      });

      expect(vp.proof.challenge).toBe(challenge);
      expect(verifyPresentation(vp, holderKeys.publicKey)).toBe(true);
    });

    it('empty credentials array works', () => {
      const vp = createPresentation({
        holderDid,
        credentials: [],
        signerKey: holderKeys.privateKey,
      });

      expect(vp.verifiableCredential).toHaveLength(0);
      expect(verifyPresentation(vp, holderKeys.publicKey)).toBe(true);
    });
  });

  describe('createSelectivePresentation', () => {
    it('filters by disclosed types', () => {
      const repVc = makeReputationVc();
      const skillVc = makeSkillVc();

      const vp = createSelectivePresentation({
        holderDid,
        credentials: [repVc, skillVc],
        disclosedTypes: ['AgentReputationCredential'],
        signerKey: holderKeys.privateKey,
      });

      expect(vp.verifiableCredential).toHaveLength(1);
      expect(vp.verifiableCredential[0]!.type).toContain('AgentReputationCredential');
      expect(verifyPresentation(vp, holderKeys.publicKey)).toBe(true);
    });

    it('returns empty when no types match', () => {
      const repVc = makeReputationVc();
      const vp = createSelectivePresentation({
        holderDid,
        credentials: [repVc],
        disclosedTypes: ['NonExistentType'],
        signerKey: holderKeys.privateKey,
      });

      expect(vp.verifiableCredential).toHaveLength(0);
      expect(verifyPresentation(vp, holderKeys.publicKey)).toBe(true);
    });

    it('includes multiple types when requested', () => {
      const repVc = makeReputationVc();
      const skillVc = makeSkillVc();

      const vp = createSelectivePresentation({
        holderDid,
        credentials: [repVc, skillVc],
        disclosedTypes: ['AgentReputationCredential', 'AgentSkillCredential'],
        signerKey: holderKeys.privateKey,
      });

      expect(vp.verifiableCredential).toHaveLength(2);
      expect(verifyPresentation(vp, holderKeys.publicKey)).toBe(true);
    });
  });
});
