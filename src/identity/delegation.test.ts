import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import {
  createDelegationToken,
  verifyDelegationToken,
  hasPermission,
} from './delegation.js';

describe('delegation tokens', () => {
  const keys = generateKeyPair();
  const otherKeys = generateKeyPair();

  describe('createDelegationToken', () => {
    it('creates a signed token with all fields', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        keys.privateKey,
      );

      expect(token.agent_id).toBe('agent-abc123');
      expect(token.server_id).toBe('macmini-001');
      expect(token.permissions).toEqual(['serve', 'publish', 'settle']);
      expect(token.granted_at).toBeTruthy();
      expect(token.expires_at).toBeTruthy();
      expect(token.signature).toBeTruthy();
    });

    it('respects custom permissions', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        keys.privateKey,
        ['serve', 'request'],
      );

      expect(token.permissions).toEqual(['serve', 'request']);
    });

    it('respects custom duration', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        keys.privateKey,
        ['serve'],
        7, // 7 days
      );

      const expires = new Date(token.expires_at);
      const granted = new Date(token.granted_at);
      const diffDays = (expires.getTime() - granted.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeCloseTo(7, 0);
    });
  });

  describe('verifyDelegationToken', () => {
    it('verifies a valid token', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        keys.privateKey,
      );

      const result = verifyDelegationToken(token, keys.publicKey);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('rejects a token signed with a different key', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        otherKeys.privateKey,
      );

      const result = verifyDelegationToken(token, keys.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid signature');
    });

    it('rejects an expired token', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        keys.privateKey,
        ['serve'],
        0, // 0 days = immediately expired
      );
      // Force expiry to past
      token.expires_at = new Date(Date.now() - 1000).toISOString();

      const result = verifyDelegationToken(token, keys.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token expired');
    });

    it('rejects a tampered token', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        keys.privateKey,
      );

      // Tamper with the agent_id
      token.agent_id = 'agent-hacked';

      const result = verifyDelegationToken(token, keys.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid signature');
    });
  });

  describe('hasPermission', () => {
    it('returns true for granted permission', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        keys.privateKey,
        ['serve', 'publish'],
      );

      expect(hasPermission(token, 'serve')).toBe(true);
      expect(hasPermission(token, 'publish')).toBe(true);
    });

    it('returns false for non-granted permission', () => {
      const token = createDelegationToken(
        'agent-abc123',
        'macmini-001',
        keys.privateKey,
        ['serve'],
      );

      expect(hasPermission(token, 'settle')).toBe(false);
      expect(hasPermission(token, 'request')).toBe(false);
    });
  });
});
