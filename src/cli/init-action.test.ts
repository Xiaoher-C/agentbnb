import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performInit } from './init-action.js';
import { loadKeyPair, generateKeyPair } from '../credit/signing.js';
import { deriveAgentId, loadIdentity, saveIdentity } from '../identity/identity.js';
import { openCreditDb, getBalance } from '../credit/ledger.js';
import { openDatabase } from '../registry/store.js';
import { lookupAgent } from '../identity/agent-identity.js';

describe('performInit identity repair', () => {
  let tempDir: string;
  let originalAgentbnbDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-init-action-'));
    originalAgentbnbDir = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tempDir;
  });

  afterEach(() => {
    if (originalAgentbnbDir === undefined) {
      delete process.env['AGENTBNB_DIR'];
    } else {
      process.env['AGENTBNB_DIR'] = originalAgentbnbDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('repairs stale identity.json on repeat init in the same directory', async () => {
    await performInit({
      owner: 'worker-two-owner',
      port: '7700',
      yes: false,
      detect: false,
      json: true,
    });

    const durableKeys = loadKeyPair(tempDir);
    const forgedKeys = generateKeyPair();
    saveIdentity(tempDir, {
      agent_id: deriveAgentId(forgedKeys.publicKey.toString('hex')),
      owner: 'worker-two-owner',
      public_key: forgedKeys.publicKey.toString('hex'),
      created_at: new Date().toISOString(),
    });

    const second = await performInit({
      owner: 'worker-two-owner',
      port: '7700',
      yes: false,
      detect: false,
      json: true,
    });

    const repaired = loadIdentity(tempDir);
    expect(second.identity.agent_id).toBe(deriveAgentId(durableKeys.publicKey.toString('hex')));
    expect(repaired?.public_key).toBe(durableKeys.publicKey.toString('hex'));
    expect(repaired?.agent_id).toBe(deriveAgentId(durableKeys.publicKey.toString('hex')));
  });

  it('keeps keypair stable while syncing owner across repeat init runs', async () => {
    await performInit({
      owner: 'first-owner',
      port: '7700',
      yes: false,
      detect: false,
      json: true,
    });

    const firstKeys = loadKeyPair(tempDir);

    await performInit({
      owner: 'second-owner',
      port: '7700',
      yes: false,
      detect: false,
      json: true,
    });

    const secondKeys = loadKeyPair(tempDir);
    const identity = loadIdentity(tempDir);

    expect(secondKeys.publicKey.equals(firstKeys.publicKey)).toBe(true);
    expect(secondKeys.privateKey.equals(firstKeys.privateKey)).toBe(true);
    expect(identity?.owner).toBe('second-owner');
    expect(identity?.public_key).toBe(firstKeys.publicKey.toString('hex'));
  });

  it('syncs the canonical agent record into both local databases and keeps credits on agent_id after owner rename', async () => {
    const first = await performInit({
      owner: 'first-owner',
      port: '7700',
      yes: false,
      detect: false,
      json: true,
    });

    const second = await performInit({
      owner: 'second-owner',
      port: '7700',
      yes: false,
      detect: false,
      json: true,
    });

    expect(second.identity.agent_id).toBe(first.identity.agent_id);

    const creditDb = openCreditDb(join(tempDir, 'credit.db'));
    const registryDb = openDatabase(join(tempDir, 'registry.db'));
    try {
      const creditAgent = lookupAgent(creditDb, second.identity.agent_id);
      const registryAgent = lookupAgent(registryDb, second.identity.agent_id);

      expect(creditAgent?.legacy_owner).toBe('second-owner');
      expect(registryAgent?.legacy_owner).toBe('second-owner');
      expect(getBalance(creditDb, second.identity.agent_id)).toBe(100);
      expect(
        (creditDb.prepare('SELECT COUNT(*) as count FROM credit_balances WHERE owner = ?').get('first-owner') as { count: number }).count,
      ).toBe(0);
    } finally {
      creditDb.close();
      registryDb.close();
    }
  });
});
