import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createIdentity,
  loadIdentity,
  saveIdentity,
  ensureIdentity,
  deriveAgentId,
  issueAgentCertificate,
  verifyAgentCertificate,
} from './identity.js';
import { generateKeyPair, saveKeyPair, loadKeyPair } from '../credit/signing.js';

describe('identity', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-identity-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('deriveAgentId', () => {
    it('produces a 16-char hex string from a public key hex', () => {
      const keys = generateKeyPair();
      const id = deriveAgentId(keys.publicKey.toString('hex'));
      expect(id).toMatch(/^[a-f0-9]{16}$/);
    });

    it('is deterministic — same key always produces same id', () => {
      const keys = generateKeyPair();
      const hex = keys.publicKey.toString('hex');
      expect(deriveAgentId(hex)).toBe(deriveAgentId(hex));
    });
  });

  describe('createIdentity', () => {
    it('creates identity.json in the config directory', () => {
      const identity = createIdentity(tempDir, 'test-owner');
      expect(existsSync(join(tempDir, 'identity.json'))).toBe(true);
      expect(identity.owner).toBe('test-owner');
      expect(identity.agent_id).toMatch(/^[a-f0-9]{16}$/);
      expect(identity.public_key).toBeTruthy();
      expect(identity.created_at).toBeTruthy();
    });

    it('generates a keypair if none exists', () => {
      createIdentity(tempDir, 'test-owner');
      expect(existsSync(join(tempDir, 'private.key'))).toBe(true);
      expect(existsSync(join(tempDir, 'public.key'))).toBe(true);
    });

    it('preserves existing keypair', () => {
      const keys = generateKeyPair();
      saveKeyPair(tempDir, keys);
      const identity = createIdentity(tempDir, 'test-owner');
      const loaded = loadKeyPair(tempDir);
      expect(loaded.publicKey.equals(keys.publicKey)).toBe(true);
      expect(identity.public_key).toBe(keys.publicKey.toString('hex'));
    });
  });

  describe('loadIdentity', () => {
    it('returns null when identity.json does not exist', () => {
      expect(loadIdentity(tempDir)).toBeNull();
    });

    it('returns parsed identity when file exists', () => {
      const created = createIdentity(tempDir, 'test-owner');
      const loaded = loadIdentity(tempDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.agent_id).toBe(created.agent_id);
      expect(loaded!.owner).toBe('test-owner');
    });
  });

  describe('saveIdentity', () => {
    it('writes identity to disk', () => {
      const identity = createIdentity(tempDir, 'test-owner');
      // Modify and re-save
      identity.owner = 'new-owner';
      saveIdentity(tempDir, identity);
      const loaded = loadIdentity(tempDir);
      expect(loaded!.owner).toBe('new-owner');
    });
  });

  describe('ensureIdentity', () => {
    it('creates identity if none exists', () => {
      const identity = ensureIdentity(tempDir, 'test-owner');
      expect(identity.owner).toBe('test-owner');
      expect(existsSync(join(tempDir, 'identity.json'))).toBe(true);
    });

    it('returns existing identity and syncs owner if changed', () => {
      const first = createIdentity(tempDir, 'first-owner');
      const second = ensureIdentity(tempDir, 'second-owner');
      // Should keep same agent_id/keypair but update owner
      expect(second.agent_id).toBe(first.agent_id);
      expect(second.public_key).toBe(first.public_key);
      expect(second.owner).toBe('second-owner');
      // Verify persisted to disk
      const loaded = loadIdentity(tempDir);
      expect(loaded!.owner).toBe('second-owner');
    });

    it('does not overwrite owner when unchanged', () => {
      createIdentity(tempDir, 'same-owner');
      const second = ensureIdentity(tempDir, 'same-owner');
      expect(second.owner).toBe('same-owner');
    });
  });

  describe('persistence across restarts', () => {
    it('identity persists when directory is re-read', () => {
      const created = createIdentity(tempDir, 'persistent-agent');
      // Simulate restart by re-reading from same directory
      const loaded = loadIdentity(tempDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.agent_id).toBe(created.agent_id);
      expect(loaded!.owner).toBe('persistent-agent');
      expect(loaded!.public_key).toBe(created.public_key);
    });
  });

  describe('Agent Certificates', () => {
    it('issues a self-signed certificate', () => {
      const identity = createIdentity(tempDir, 'cert-agent');
      const keys = loadKeyPair(tempDir);
      const cert = issueAgentCertificate(identity, keys.privateKey);

      expect(cert.identity.agent_id).toBe(identity.agent_id);
      expect(cert.issuer_public_key).toBe(identity.public_key);
      expect(cert.signature).toBeTruthy();
      expect(new Date(cert.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('verifies a valid certificate', () => {
      const identity = createIdentity(tempDir, 'cert-agent');
      const keys = loadKeyPair(tempDir);
      const cert = issueAgentCertificate(identity, keys.privateKey);

      expect(verifyAgentCertificate(cert)).toBe(true);
    });

    it('rejects a certificate signed with a different key', () => {
      const identity = createIdentity(tempDir, 'cert-agent');
      const otherKeys = generateKeyPair();
      const cert = issueAgentCertificate(identity, otherKeys.privateKey);

      // Certificate was signed with otherKeys but claims to be from identity's public key
      expect(verifyAgentCertificate(cert)).toBe(false);
    });

    it('rejects an expired certificate', () => {
      const identity = createIdentity(tempDir, 'cert-agent');
      const keys = loadKeyPair(tempDir);
      const cert = issueAgentCertificate(identity, keys.privateKey);

      // Tamper with expiry to make it expired
      cert.expires_at = new Date(Date.now() - 1000).toISOString();
      expect(verifyAgentCertificate(cert)).toBe(false);
    });
  });
});
