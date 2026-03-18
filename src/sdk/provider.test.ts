import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentBnBProvider } from './provider.js';
import { createIdentity } from '../identity/identity.js';
import { generateKeyPair, saveKeyPair } from '../credit/signing.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { openDatabase, insertCard } from '../registry/store.js';
import { AgentBnBError } from '../types/index.js';
import { randomUUID } from 'node:crypto';

describe('AgentBnBProvider', () => {
  let tempDir: string;
  const OWNER = 'test-provider';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-provider-'));
    // Set up identity, keypair, and databases
    const keys = generateKeyPair();
    saveKeyPair(tempDir, keys);
    createIdentity(tempDir, OWNER);

    const creditDb = openCreditDb(join(tempDir, 'credit.db'));
    bootstrapAgent(creditDb, OWNER, 100);
    creditDb.close();

    const registryDb = openDatabase(join(tempDir, 'registry.db'));
    insertCard(registryDb, {
      spec_version: '1.0',
      id: randomUUID(),
      owner: OWNER,
      name: 'Test Capability',
      description: 'A test capability',
      level: 1,
      inputs: [{ name: 'text', type: 'text', required: true }],
      outputs: [{ name: 'result', type: 'text', required: true }],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
    });
    registryDb.close();

    process.env['AGENTBNB_DIR'] = tempDir;
  });

  afterEach(async () => {
    delete process.env['AGENTBNB_DIR'];
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('authenticate', () => {
    it('loads identity from config directory', () => {
      const provider = new AgentBnBProvider({ configDir: tempDir });
      const identity = provider.authenticate();
      expect(identity.owner).toBe(OWNER);
      expect(identity.agent_id).toBeTruthy();
    });
  });

  describe('getIdentity', () => {
    it('throws NOT_AUTHENTICATED before authenticate()', () => {
      const provider = new AgentBnBProvider({ configDir: tempDir });
      expect(() => provider.getIdentity()).toThrow(AgentBnBError);
    });
  });

  describe('listCapabilities', () => {
    it('returns published cards for the owner', () => {
      const provider = new AgentBnBProvider({ configDir: tempDir });
      provider.authenticate();
      const caps = provider.listCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0].name).toBe('Test Capability');
      expect(caps[0].owner).toBe(OWNER);
    });
  });

  describe('getBalance', () => {
    it('returns the bootstrapped credit balance', () => {
      const provider = new AgentBnBProvider({ configDir: tempDir });
      provider.authenticate();
      expect(provider.getBalance()).toBe(100);
    });
  });

  describe('close', () => {
    it('cleans up databases without error', async () => {
      const provider = new AgentBnBProvider({ configDir: tempDir });
      provider.authenticate();
      provider.listCapabilities(); // Force DB open
      await provider.close();
      // Should not throw on double close
      await provider.close();
    });
  });
});
