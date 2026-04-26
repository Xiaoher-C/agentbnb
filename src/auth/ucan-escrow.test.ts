import { describe, it, expect } from 'vitest';
import {
  createEscrowBoundUCAN,
  escrowStateToUCANState,
  UCANRevocationSet,
} from './ucan-escrow.js';
import { decodeUCAN } from './ucan.js';
import { generateKeyPair } from '../credit/signing.js';
import type { UCANAttenuation } from './ucan.js';

describe('UCAN Escrow Binding', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:aaaa111122223333';
  const audienceDid = 'did:agentbnb:bbbb444455556666';
  const attenuations: UCANAttenuation[] = [
    { with: 'agentbnb://skill/summarize', can: 'invoke' },
  ];
  const escrowId = 'esc-test-001';
  const escrowExpiresAt = Math.floor(Date.now() / 1000) + 3600;

  describe('escrowStateToUCANState', () => {
    it('maps held → active', () => {
      expect(escrowStateToUCANState('held')).toBe('active');
    });

    it('maps started → active', () => {
      expect(escrowStateToUCANState('started')).toBe('active');
    });

    it('maps progressing → active', () => {
      expect(escrowStateToUCANState('progressing')).toBe('active');
    });

    it('maps settled → expired', () => {
      expect(escrowStateToUCANState('settled')).toBe('expired');
    });

    it('maps released → revoked', () => {
      expect(escrowStateToUCANState('released')).toBe('revoked');
    });

    it('maps abandoned → revoked', () => {
      expect(escrowStateToUCANState('abandoned')).toBe('revoked');
    });
  });

  describe('createEscrowBoundUCAN', () => {
    it('creates a UCAN bound to an escrow with active status', () => {
      const result = createEscrowBoundUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        escrowId,
        escrowExpiresAt,
      });

      expect(result.escrowId).toBe(escrowId);
      expect(result.status).toBe('active');
      expect(result.token).toBeTruthy();

      const decoded = decodeUCAN(result.token);
      expect(decoded.payload.fct).toEqual({ escrow_id: escrowId });
    });

    it('caps UCAN exp at escrow expiry', () => {
      const requestedExp = escrowExpiresAt + 9999;

      const result = createEscrowBoundUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        escrowId,
        escrowExpiresAt,
        requestedExpiresAt: requestedExp,
      });

      const decoded = decodeUCAN(result.token);
      expect(decoded.payload.exp).toBe(escrowExpiresAt);
    });

    it('uses requested exp when less than escrow expiry', () => {
      const requestedExp = escrowExpiresAt - 600;

      const result = createEscrowBoundUCAN({
        issuerDid,
        audienceDid,
        attenuations,
        signerKey: keys.privateKey,
        escrowId,
        escrowExpiresAt,
        requestedExpiresAt: requestedExp,
      });

      const decoded = decodeUCAN(result.token);
      expect(decoded.payload.exp).toBe(requestedExp);
    });
  });

  describe('UCANRevocationSet', () => {
    it('tracks revoked escrow IDs', () => {
      const revSet = new UCANRevocationSet();

      expect(revSet.isRevoked('esc-1')).toBe(false);

      revSet.revokeByEscrow('esc-1');
      expect(revSet.isRevoked('esc-1')).toBe(true);
      expect(revSet.isRevoked('esc-2')).toBe(false);
    });

    it('lists all revoked escrow IDs', () => {
      const revSet = new UCANRevocationSet();
      revSet.revokeByEscrow('esc-1');
      revSet.revokeByEscrow('esc-2');

      const list = revSet.listRevoked();
      expect(list).toHaveLength(2);
      expect(list).toContain('esc-1');
      expect(list).toContain('esc-2');
    });

    it('clears all revocations', () => {
      const revSet = new UCANRevocationSet();
      revSet.revokeByEscrow('esc-1');
      revSet.revokeByEscrow('esc-2');

      revSet.clear();
      expect(revSet.isRevoked('esc-1')).toBe(false);
      expect(revSet.listRevoked()).toHaveLength(0);
    });

    it('handles duplicate revocations gracefully', () => {
      const revSet = new UCANRevocationSet();
      revSet.revokeByEscrow('esc-1');
      revSet.revokeByEscrow('esc-1');

      expect(revSet.listRevoked()).toHaveLength(1);
    });

    it('tracks revoked issuer DIDs separately from revoked escrows', () => {
      const revSet = new UCANRevocationSet();

      expect(revSet.isIssuerRevoked('did:agentbnb:aaaa000011112222')).toBe(false);
      revSet.revokeIssuer('did:agentbnb:aaaa000011112222');
      expect(revSet.isIssuerRevoked('did:agentbnb:aaaa000011112222')).toBe(true);
      expect(revSet.isIssuerRevoked('did:agentbnb:bbbb000011112222')).toBe(false);

      // Issuer revocation does not bleed into escrow revocation.
      expect(revSet.isRevoked('did:agentbnb:aaaa000011112222')).toBe(false);
    });

    it('lists revoked issuers separately', () => {
      const revSet = new UCANRevocationSet();
      revSet.revokeIssuer('did:agentbnb:aaaa000011112222');
      revSet.revokeIssuer('did:agentbnb:bbbb000011112222');

      const issuers = revSet.listRevokedIssuers();
      expect(issuers).toHaveLength(2);
      expect(issuers).toContain('did:agentbnb:aaaa000011112222');
      expect(issuers).toContain('did:agentbnb:bbbb000011112222');
    });

    it('clear() also empties revoked issuers', () => {
      const revSet = new UCANRevocationSet();
      revSet.revokeByEscrow('esc-1');
      revSet.revokeIssuer('did:agentbnb:aaaa000011112222');

      revSet.clear();
      expect(revSet.listRevoked()).toHaveLength(0);
      expect(revSet.listRevokedIssuers()).toHaveLength(0);
    });
  });
});
