import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIdentity } from '../identity/identity.js';
import { generateKeyPair, saveKeyPair } from '../credit/signing.js';

describe('AgentBnBConsumer auth headers', () => {
  let tempDir: string;
  const owner = 'sdk-consumer-owner';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-consumer-auth-'));

    const keys = generateKeyPair();
    saveKeyPair(tempDir, keys);
    createIdentity(tempDir, owner);

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
    const openCreditDbMock = vi.fn(() => ({ close: vi.fn() }));
    const settleRequesterEscrowMock = vi.fn();
    const releaseRequesterEscrowMock = vi.fn();

    vi.doMock('../gateway/client.js', () => ({
      requestCapability: requestCapabilityMock,
    }));

    vi.doMock('../credit/ledger.js', () => ({
      openCreditDb: openCreditDbMock,
      getBalance: vi.fn(() => 100),
    }));

    vi.doMock('../credit/escrow-receipt.js', () => ({
      createSignedEscrowReceipt: vi.fn(() => ({
        escrowId: 'escrow-1',
        receipt: {
          requester_owner: owner,
          requester_public_key: 'ab'.repeat(44),
          amount: 5,
          card_id: 'card-123',
          timestamp: new Date().toISOString(),
          nonce: 'nonce-1',
          signature: 'sig-1',
        },
      })),
    }));

    vi.doMock('../credit/settlement.js', () => ({
      settleRequesterEscrow: settleRequesterEscrowMock,
      releaseRequesterEscrow: releaseRequesterEscrowMock,
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
    expect(openCreditDbMock).toHaveBeenCalledTimes(1);
    expect(settleRequesterEscrowMock).toHaveBeenCalledWith(expect.anything(), 'escrow-1');
    expect(releaseRequesterEscrowMock).not.toHaveBeenCalled();

    consumer.close();
  });

  it('passes provider timeout metadata and preserves explicit timeout override', async () => {
    const requestCapabilityMock = vi.fn().mockResolvedValue({ ok: true });
    const openCreditDbMock = vi.fn(() => ({ close: vi.fn() }));

    vi.doMock('../gateway/client.js', () => ({
      requestCapability: requestCapabilityMock,
    }));

    vi.doMock('../credit/ledger.js', () => ({
      openCreditDb: openCreditDbMock,
      getBalance: vi.fn(() => 100),
    }));

    vi.doMock('../credit/escrow-receipt.js', () => ({
      createSignedEscrowReceipt: vi.fn(() => ({
        escrowId: 'escrow-2',
        receipt: {
          requester_owner: owner,
          requester_public_key: 'ab'.repeat(44),
          amount: 5,
          card_id: 'card-123',
          timestamp: new Date().toISOString(),
          nonce: 'nonce-2',
          signature: 'sig-2',
        },
      })),
    }));

    vi.doMock('../credit/settlement.js', () => ({
      settleRequesterEscrow: vi.fn(),
      releaseRequesterEscrow: vi.fn(),
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
    expect(openCreditDbMock).toHaveBeenCalledTimes(1);

    consumer.close();
  });

  it('forwards targetAgentId through requestViaRelay', async () => {
    const requestViaTemporaryRelayMock = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../gateway/relay-dispatch.js', () => ({
      requestViaTemporaryRelay: requestViaTemporaryRelayMock,
    }));

    const { AgentBnBConsumer } = await import('./consumer.js');
    const consumer = new AgentBnBConsumer({ configDir: tempDir });
    consumer.authenticate();

    await consumer.requestViaRelay({
      registryUrl: 'https://registry.agentbnb.dev',
      targetOwner: 'legacy-owner',
      targetAgentId: 'provider-agent-id',
      cardId: 'card-123',
      skillId: 'skill-1',
      params: { prompt: 'test' },
      timeoutMs: 9_876,
    });

    expect(requestViaTemporaryRelayMock).toHaveBeenCalledWith(expect.objectContaining({
      targetOwner: 'legacy-owner',
      targetAgentId: 'provider-agent-id',
      timeoutMs: 9_876,
    }));

    consumer.close();
  });
});
