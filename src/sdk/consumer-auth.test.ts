import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIdentity } from '../identity/identity.js';
import { generateKeyPair, saveKeyPair } from '../credit/signing.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';

describe('AgentBnBConsumer auth headers', () => {
  let tempDir: string;
  const owner = 'sdk-consumer-owner';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-consumer-auth-'));

    const keys = generateKeyPair();
    saveKeyPair(tempDir, keys);
    createIdentity(tempDir, owner);

    const db = openCreditDb(join(tempDir, 'credit.db'));
    bootstrapAgent(db, owner, 100);
    db.close();

    writeFileSync(join(tempDir, 'config.json'), JSON.stringify({
      owner,
      db_path: join(tempDir, 'registry.db'),
      credit_db_path: join(tempDir, 'credit.db'),
      gateway_url: 'http://localhost:7700',
      gateway_port: 7700,
      token: 'local-token',
    }));

    process.env['AGENTBNB_DIR'] = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['AGENTBNB_DIR'];
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes identity and bearer token together to gateway client', async () => {
    const requestCapabilityMock = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../gateway/client.js', () => ({
      requestCapability: requestCapabilityMock,
    }));

    const { AgentBnBConsumer } = await import('./consumer.js');
    const consumer = new AgentBnBConsumer({ configDir: tempDir });
    const identity = consumer.authenticate();

    await consumer.request({
      gatewayUrl: 'http://peer.example:7700',
      token: 'peer-token',
      cardId: 'card-123',
      skillId: 'skill-abc',
      params: { task: 'run' },
      credits: 5,
    });

    expect(requestCapabilityMock).toHaveBeenCalledTimes(1);
    expect(requestCapabilityMock).toHaveBeenCalledWith(expect.objectContaining({
      gatewayUrl: 'http://peer.example:7700',
      token: 'peer-token',
      cardId: 'card-123',
      timeoutHint: {
        expected_duration_ms: undefined,
        hard_timeout_ms: undefined,
      },
      identity: {
        agentId: identity.agent_id,
        publicKey: identity.public_key,
        privateKey: expect.any(Buffer),
      },
    }));

    consumer.close();
  });

  it('passes provider timeout metadata and preserves explicit timeout override', async () => {
    const requestCapabilityMock = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../gateway/client.js', () => ({
      requestCapability: requestCapabilityMock,
    }));

    const { AgentBnBConsumer } = await import('./consumer.js');
    const consumer = new AgentBnBConsumer({ configDir: tempDir });
    consumer.authenticate();

    await consumer.request({
      gatewayUrl: 'http://peer.example:7700',
      token: 'peer-token',
      cardId: 'card-123',
      credits: 5,
      timeoutMs: 54_321,
      expectedDurationMs: 12_000,
      providerHardTimeoutMs: 40_000,
    });

    expect(requestCapabilityMock).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 54_321,
      timeoutHint: {
        expected_duration_ms: 12_000,
        hard_timeout_ms: 40_000,
      },
    }));

    consumer.close();
  });
});
