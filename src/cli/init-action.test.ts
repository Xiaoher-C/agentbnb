import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performInit } from './init-action.js';
import { loadKeyPair, generateKeyPair } from '../credit/signing.js';
import { deriveAgentId, loadIdentity, saveIdentity } from '../identity/identity.js';

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
});
