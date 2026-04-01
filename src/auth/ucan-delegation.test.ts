import { describe, it, expect } from 'vitest';
import { delegateUCAN, validateChain, MAX_CHAIN_DEPTH } from './ucan-delegation.js';
import { createUCAN, decodeUCAN } from './ucan.js';
import { generateKeyPair } from '../credit/signing.js';
import type { UCANAttenuation } from './ucan.js';

describe('UCAN Delegation', () => {
  // Agent A (root) → Agent B → Agent C → Agent D
  const keysA = generateKeyPair();
  const keysB = generateKeyPair();
  const keysC = generateKeyPair();
  const keysD = generateKeyPair();
  const keysE = generateKeyPair();

  const didA = 'did:agentbnb:aaaa111122223333';
  const didB = 'did:agentbnb:bbbb444455556666';
  const didC = 'did:agentbnb:cccc777788889999';
  const didD = 'did:agentbnb:dddd000011112222';
  const didE = 'did:agentbnb:eeee333344445555';

  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const broadAtts: UCANAttenuation[] = [
    { with: 'agentbnb://skill/**', can: 'invoke' },
    { with: 'agentbnb://escrow/esc-1', can: 'settle' },
  ];

  const resolveKey = (did: string): Buffer | null => {
    const map: Record<string, Buffer> = {
      [didA]: keysA.publicKey,
      [didB]: keysB.publicKey,
      [didC]: keysC.publicKey,
      [didD]: keysD.publicKey,
      [didE]: keysE.publicKey,
    };
    return map[did] ?? null;
  };

  describe('delegateUCAN', () => {
    it('creates a valid delegated token with narrowed attenuations', () => {
      const rootToken = createUCAN({
        issuerDid: didA,
        audienceDid: didB,
        attenuations: broadAtts,
        signerKey: keysA.privateKey,
        expiresAt: futureExp,
      });

      const narrowAtts: UCANAttenuation[] = [
        { with: 'agentbnb://skill/summarize', can: 'invoke' },
      ];

      const delegated = delegateUCAN({
        parentToken: rootToken,
        newAudienceDid: didC,
        narrowedAttenuations: narrowAtts,
        signerKey: keysB.privateKey,
      });

      const decoded = decodeUCAN(delegated);
      expect(decoded.payload.iss).toBe(didB);
      expect(decoded.payload.aud).toBe(didC);
      expect(decoded.payload.att).toEqual(narrowAtts);
      expect(decoded.payload.prf).toHaveLength(1);
      expect(decoded.payload.exp).toBeLessThanOrEqual(futureExp);
    });

    it('caps expiry at parent expiry', () => {
      const rootToken = createUCAN({
        issuerDid: didA,
        audienceDid: didB,
        attenuations: broadAtts,
        signerKey: keysA.privateKey,
        expiresAt: futureExp,
      });

      const delegated = delegateUCAN({
        parentToken: rootToken,
        newAudienceDid: didC,
        narrowedAttenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysB.privateKey,
        expiresAt: futureExp + 9999, // beyond parent's expiry
      });

      const decoded = decodeUCAN(delegated);
      expect(decoded.payload.exp).toBe(futureExp);
    });

    it('rejects attenuation widening', () => {
      const rootToken = createUCAN({
        issuerDid: didA,
        audienceDid: didB,
        attenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysA.privateKey,
        expiresAt: futureExp,
      });

      expect(() =>
        delegateUCAN({
          parentToken: rootToken,
          newAudienceDid: didC,
          narrowedAttenuations: [{ with: 'agentbnb://skill/**', can: 'invoke' }],
          signerKey: keysB.privateKey,
        }),
      ).toThrow('attenuations must be a subset');
    });
  });

  describe('validateChain', () => {
    it('validates a 2-link chain (A→B→C)', () => {
      const tokenAB = createUCAN({
        issuerDid: didA,
        audienceDid: didB,
        attenuations: broadAtts,
        signerKey: keysA.privateKey,
        expiresAt: futureExp,
      });

      const tokenBC = delegateUCAN({
        parentToken: tokenAB,
        newAudienceDid: didC,
        narrowedAttenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysB.privateKey,
      });

      const result = validateChain([tokenAB, tokenBC], resolveKey);
      expect(result.valid).toBe(true);
      expect(result.depth).toBe(1);
    });

    it('validates a 3-link chain (A→B→C→D, depth=3)', () => {
      const tokenAB = createUCAN({
        issuerDid: didA,
        audienceDid: didB,
        attenuations: broadAtts,
        signerKey: keysA.privateKey,
        expiresAt: futureExp,
      });

      const tokenBC = delegateUCAN({
        parentToken: tokenAB,
        newAudienceDid: didC,
        narrowedAttenuations: broadAtts,
        signerKey: keysB.privateKey,
      });

      const tokenCD = delegateUCAN({
        parentToken: tokenBC,
        newAudienceDid: didD,
        narrowedAttenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysC.privateKey,
      });

      const result = validateChain([tokenAB, tokenBC, tokenCD], resolveKey);
      expect(result.valid).toBe(true);
      expect(result.depth).toBe(2);
    });

    it('validates depth=3 chain (4 tokens)', () => {
      const tokenAB = createUCAN({
        issuerDid: didA, audienceDid: didB,
        attenuations: broadAtts, signerKey: keysA.privateKey, expiresAt: futureExp,
      });
      const tokenBC = delegateUCAN({
        parentToken: tokenAB, newAudienceDid: didC,
        narrowedAttenuations: broadAtts, signerKey: keysB.privateKey,
      });
      const tokenCD = delegateUCAN({
        parentToken: tokenBC, newAudienceDid: didD,
        narrowedAttenuations: broadAtts, signerKey: keysC.privateKey,
      });
      const tokenDE = delegateUCAN({
        parentToken: tokenCD, newAudienceDid: didE,
        narrowedAttenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysD.privateKey,
      });

      const result = validateChain([tokenAB, tokenBC, tokenCD, tokenDE], resolveKey);
      expect(result.valid).toBe(true);
      expect(result.depth).toBe(MAX_CHAIN_DEPTH);
    });

    it('rejects depth=4 chain (5 tokens, exceeds MAX_CHAIN_DEPTH)', () => {
      const keysF = generateKeyPair();
      const didF = 'did:agentbnb:ffff666677778888';

      const tokenAB = createUCAN({
        issuerDid: didA, audienceDid: didB,
        attenuations: broadAtts, signerKey: keysA.privateKey, expiresAt: futureExp,
      });
      const tokenBC = delegateUCAN({
        parentToken: tokenAB, newAudienceDid: didC,
        narrowedAttenuations: broadAtts, signerKey: keysB.privateKey,
      });
      const tokenCD = delegateUCAN({
        parentToken: tokenBC, newAudienceDid: didD,
        narrowedAttenuations: broadAtts, signerKey: keysC.privateKey,
      });
      const tokenDE = delegateUCAN({
        parentToken: tokenCD, newAudienceDid: didE,
        narrowedAttenuations: broadAtts, signerKey: keysD.privateKey,
      });
      const tokenEF = delegateUCAN({
        parentToken: tokenDE, newAudienceDid: didF,
        narrowedAttenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysE.privateKey,
      });

      const result = validateChain(
        [tokenAB, tokenBC, tokenCD, tokenDE, tokenEF],
        (did) => {
          if (did === didF) return keysF.publicKey;
          return resolveKey(did);
        },
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum');
      expect(result.depth).toBe(4);
    });

    it('rejects attenuation widening in chain', () => {
      const tokenAB = createUCAN({
        issuerDid: didA,
        audienceDid: didB,
        attenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysA.privateKey,
        expiresAt: futureExp,
      });

      // Manually create a wider token (bypassing delegateUCAN's check)
      const widerToken = createUCAN({
        issuerDid: didB,
        audienceDid: didC,
        attenuations: [{ with: 'agentbnb://skill/**', can: 'invoke' }],
        signerKey: keysB.privateKey,
        expiresAt: futureExp,
        proofs: [tokenAB],
      });

      const result = validateChain([tokenAB, widerToken], resolveKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Attenuation widening');
    });

    it('rejects expired parent invalidating child', () => {
      const pastExp = Math.floor(Date.now() / 1000) - 100;
      const tokenAB = createUCAN({
        issuerDid: didA,
        audienceDid: didB,
        attenuations: broadAtts,
        signerKey: keysA.privateKey,
        expiresAt: pastExp,
      });

      // Manually create child with later expiry (bypassing cap)
      const tokenBC = createUCAN({
        issuerDid: didB,
        audienceDid: didC,
        attenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysB.privateKey,
        expiresAt: futureExp,
        proofs: [tokenAB],
      });

      const result = validateChain([tokenAB, tokenBC], resolveKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds parent expiry');
    });

    it('rejects audience/issuer mismatch', () => {
      const tokenAB = createUCAN({
        issuerDid: didA,
        audienceDid: didB,
        attenuations: broadAtts,
        signerKey: keysA.privateKey,
        expiresAt: futureExp,
      });

      // Child issued by C instead of B (mismatch)
      const tokenCD = createUCAN({
        issuerDid: didC,
        audienceDid: didD,
        attenuations: [{ with: 'agentbnb://skill/summarize', can: 'invoke' }],
        signerKey: keysC.privateKey,
        expiresAt: futureExp,
        proofs: [tokenAB],
      });

      const result = validateChain([tokenAB, tokenCD], resolveKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Audience/issuer mismatch');
    });

    it('returns invalid for empty chain', () => {
      const result = validateChain([], resolveKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Empty');
    });
  });
});
