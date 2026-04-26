import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUCAN,
  verifyUCAN,
  decodeUCAN,
  isExpired,
  setRevocationSet,
  mintSelfDelegatedSkillToken,
} from './ucan.js';
import { UCANRevocationSet } from './ucan-escrow.js';
import { clearReplayCache } from './ucan-replay.js';
import { generateKeyPair } from '../credit/signing.js';
import type { UCANAttenuation } from './ucan.js';

describe('UCAN Token Engine', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:aaaa111122223333';
  const audienceDid = 'did:agentbnb:bbbb444455556666';
  const attenuations: UCANAttenuation[] = [
    { with: 'agentbnb://skill/summarize', can: 'invoke' },
  ];
  const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  beforeEach(() => {
    // Each test gets a clean replay cache and no revocation set so that the
    // module-level state from one test does not leak into the next.
    clearReplayCache();
    setRevocationSet(null);
  });

  describe('createUCAN + verifyUCAN round-trip', () => {
    it('creates and verifies a valid token', () => {
      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const result = verifyUCAN(token, keys.publicKey);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('includes optional fields when provided', () => {
      const nbf = Math.floor(Date.now() / 1000);
      const facts = { escrow_id: 'esc-123', task_description: 'Summarize docs' };
      const proofs = ['parent-token-string'];

      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
        notBefore: nbf,
        facts,
        proofs,
      });

      const decoded = decodeUCAN(token);
      expect(decoded.payload.nbf).toBe(nbf);
      expect(decoded.payload.fct).toEqual(facts);
      expect(decoded.payload.prf).toEqual(proofs);
    });
  });

  describe('tampered token', () => {
    it('fails verification when payload is tampered', () => {
      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      // Tamper with the payload by changing a character
      const parts = token.split('.');
      const tamperedPayload = parts[1]!.slice(0, -1) + (parts[1]!.endsWith('A') ? 'B' : 'A');
      const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const result = verifyUCAN(tampered, keys.publicKey);
      expect(result.valid).toBe(false);
    });
  });

  describe('wrong key', () => {
    it('fails verification with a different public key', () => {
      const otherKeys = generateKeyPair();
      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const result = verifyUCAN(token, otherKeys.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Signature verification failed');
    });
  });

  describe('isExpired', () => {
    it('returns true for an expired token', () => {
      const pastExp = Math.floor(Date.now() / 1000) - 100;
      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: pastExp,
      });

      expect(isExpired(token)).toBe(true);
    });

    it('returns false for a non-expired token', () => {
      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      expect(isExpired(token)).toBe(false);
    });
  });

  describe('decodeUCAN', () => {
    it('extracts correct header and payload', () => {
      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const decoded = decodeUCAN(token);
      expect(decoded.header).toEqual({
        alg: 'EdDSA',
        typ: 'JWT',
        ucv: '0.10.0',
      });
      expect(decoded.payload.iss).toBe(issuerDid);
      expect(decoded.payload.aud).toBe(audienceDid);
      expect(decoded.payload.exp).toBe(futureExp);
      expect(decoded.payload.att).toEqual(attenuations);
      expect(decoded.payload.prf).toEqual([]);
      expect(decoded.signature).toBeTruthy();
    });
  });

  describe('nonce uniqueness', () => {
    it('generates unique nonces for each token', () => {
      const token1 = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });
      const token2 = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const decoded1 = decodeUCAN(token1);
      const decoded2 = decodeUCAN(token2);
      expect(decoded1.payload.nnc).not.toBe(decoded2.payload.nnc);
    });
  });

  describe('invalid token format', () => {
    it('throws on token with wrong number of parts', () => {
      expect(() => decodeUCAN('only.two')).toThrow('expected 3 dot-separated parts');
      expect(() => decodeUCAN('one')).toThrow('expected 3 dot-separated parts');
      expect(() => decodeUCAN('a.b.c.d')).toThrow('expected 3 dot-separated parts');
    });

    it('throws on invalid base64url in header', () => {
      expect(() => decodeUCAN('!!!.valid.sig')).toThrow('failed to decode header');
    });

    it('verifyUCAN returns invalid for wrong format', () => {
      const result = verifyUCAN('not-a-valid-token', keys.publicKey);
      expect(result.valid).toBe(false);
    });
  });

  describe('jti replay protection', () => {
    it('records the jti on first verify and rejects the second', () => {
      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const first = verifyUCAN(token, keys.publicKey);
      expect(first.valid).toBe(true);

      const second = verifyUCAN(token, keys.publicKey);
      expect(second.valid).toBe(false);
      expect(second.reason).toBe('replay_detected');
    });

    it('does not consult the replay cache when checkReplay is false', () => {
      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const first = verifyUCAN(token, keys.publicKey, { checkReplay: false });
      const second = verifyUCAN(token, keys.publicKey, { checkReplay: false });
      expect(first.valid).toBe(true);
      expect(second.valid).toBe(true);
    });

    it('emits a fresh jti for every newly-created token', () => {
      const token1 = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });
      const token2 = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const decoded1 = decodeUCAN(token1);
      const decoded2 = decodeUCAN(token2);
      expect(decoded1.payload.jti).toBeTruthy();
      expect(decoded2.payload.jti).toBeTruthy();
      expect(decoded1.payload.jti).not.toBe(decoded2.payload.jti);
    });
  });

  describe('issuer revocation', () => {
    it('rejects a token whose issuer DID is in the revocation set', () => {
      const set = new UCANRevocationSet();
      set.revokeIssuer(issuerDid);
      setRevocationSet(set);

      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const result = verifyUCAN(token, keys.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('issuer_revoked');
    });

    it('rejects a token bound to a revoked escrow', () => {
      const set = new UCANRevocationSet();
      set.revokeByEscrow('esc-revoked-1');
      setRevocationSet(set);

      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
        facts: { escrow_id: 'esc-revoked-1' },
      });

      const result = verifyUCAN(token, keys.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('escrow_revoked');
    });

    it('honours checkRevocation: false to bypass the revocation set', () => {
      const set = new UCANRevocationSet();
      set.revokeIssuer(issuerDid);
      setRevocationSet(set);

      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const result = verifyUCAN(token, keys.publicKey, { checkRevocation: false });
      expect(result.valid).toBe(true);
    });
  });

  describe('attenuation preservation', () => {
    it('preserves all attenuation fields including caveats', () => {
      const complexAtts: UCANAttenuation[] = [
        {
          with: 'agentbnb://skill/summarize',
          can: 'invoke',
          nb: { max_calls: 5, max_cost: 10 },
        },
        {
          with: 'agentbnb://escrow/esc-456',
          can: 'settle',
        },
      ];

      const token = createUCAN({
        issuerDid,
        audienceDid,
        attenuations: complexAtts,
        signerKey: keys.privateKey,
        expiresAt: futureExp,
      });

      const decoded = decodeUCAN(token);
      expect(decoded.payload.att).toEqual(complexAtts);
    });
  });

  describe('mintSelfDelegatedSkillToken', () => {
    it('issues a self-issued token (iss === aud) that verifies under the holder key', () => {
      const did = 'did:agentbnb:self0000aaaabbbb';
      const token = mintSelfDelegatedSkillToken({
        did,
        signerKey: keys.privateKey,
        skillId: 'summarize',
        ttlSeconds: 60,
      });

      // 3-segment JWT-like shape
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      const decoded = decodeUCAN(token);
      expect(decoded.payload.iss).toBe(did);
      expect(decoded.payload.aud).toBe(did);
      expect(decoded.payload.att).toEqual([
        { with: 'agentbnb://skill/summarize', can: 'invoke' },
      ]);
      expect(decoded.payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

      const result = verifyUCAN(token, keys.publicKey);
      expect(result.valid).toBe(true);
    });

    it('falls back to wildcard skill scope when skillId is omitted', () => {
      const did = 'did:agentbnb:self1111';
      const token = mintSelfDelegatedSkillToken({
        did,
        signerKey: keys.privateKey,
      });

      const decoded = decodeUCAN(token);
      expect(decoded.payload.att[0]?.with).toBe('agentbnb://skill/*');
    });

    it('throws when given a malformed signer key', () => {
      expect(() =>
        mintSelfDelegatedSkillToken({
          did: 'did:agentbnb:self2222',
          signerKey: Buffer.from('not-a-real-der-key'),
          skillId: 'tts',
        }),
      ).toThrow();
    });
  });
});
