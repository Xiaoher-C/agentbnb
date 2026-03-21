import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentBnBConfig } from '../cli/config.js';
import type { ServiceCoordinator } from '../runtime/service-coordinator.js';
import { AgentBnBService } from './agentbnb-service.js';
import { openDatabase, insertCard } from '../registry/store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import * as gatewayClient from '../gateway/client.js';
import { RelayClient } from '../relay/websocket-client.js';
import { AgentBnBError } from '../types/index.js';

function makeConfig(tmpDir: string, overrides: Partial<AgentBnBConfig> = {}): AgentBnBConfig {
  return {
    owner: 'test-owner',
    gateway_url: 'http://127.0.0.1:7700',
    gateway_port: 7700,
    db_path: join(tmpDir, 'registry.db'),
    credit_db_path: join(tmpDir, 'credit.db'),
    token: 'test-token',
    ...overrides,
  };
}

function makeCard(id: string, owner = 'provider-owner'): import('../types/index.js').CapabilityCard {
  return {
    spec_version: '1.0',
    id,
    owner,
    name: `Card ${id.slice(0, 6)}`,
    description: 'Test card',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'result', type: 'text', required: true }],
    pricing: { credits_per_call: 3 },
    availability: { online: true },
    metadata: { success_rate: 0.9 },
  };
}

describe('AgentBnBService', () => {
  let tmpDir: string;
  let originalAgentbnbDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-service-test-'));
    originalAgentbnbDir = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tmpDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAgentbnbDir === undefined) {
      delete process.env['AGENTBNB_DIR'];
    } else {
      process.env['AGENTBNB_DIR'] = originalAgentbnbDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('delegates lifecycle methods to ServiceCoordinator', async () => {
    const ensureRunning = vi.fn(async () => 'started' as const);
    const getStatus = vi.fn(async () => ({
      state: 'running' as const,
      pid: 1,
      port: 7700,
      owner: 'test-owner',
      relayConnected: false,
      uptime_ms: 100,
    }));
    const stop = vi.fn(async () => undefined);
    const restart = vi.fn(async () => undefined);
    const healthCheck = vi.fn(async () => ({
      ok: true,
      agentbnb: true,
      latency_ms: 2,
      version: '0.0.1',
    }));

    const coordinator = {
      ensureRunning,
      getStatus,
      stop,
      restart,
      healthCheck,
    } as unknown as ServiceCoordinator;
    const config = makeConfig(tmpDir);
    const service = new AgentBnBService(coordinator, config);

    await expect(service.ensureRunning()).resolves.toBe('started');
    await expect(service.getNodeStatus()).resolves.toMatchObject({ state: 'running' });
    await expect(service.stop()).resolves.toBeUndefined();
    await expect(service.restart()).resolves.toBeUndefined();
    await expect(service.healthCheck()).resolves.toMatchObject({ ok: true });

    expect(ensureRunning).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(healthCheck).toHaveBeenCalledTimes(1);
  });

  it('discoverCapabilities returns local-first then appends deduped remote cards', async () => {
    const localDb = openDatabase(join(tmpDir, 'registry.db'));
    const localA = makeCard('11111111-1111-1111-1111-111111111111', 'local-owner');
    const localB = makeCard('22222222-2222-2222-2222-222222222222', 'local-owner');
    insertCard(localDb, localA);
    insertCard(localDb, localB);
    localDb.close();

    const remoteServer = Fastify({ logger: false });
    remoteServer.get('/cards', async () => {
      return {
        items: [
          { ...localA, name: 'Remote Duplicate' }, // duplicate by id -> should be dropped
          makeCard('33333333-3333-3333-3333-333333333333', 'remote-owner'),
        ],
      };
    });
    await remoteServer.listen({ port: 0, host: '127.0.0.1' });
    const remotePort = (remoteServer.server.address() as { port: number }).port;

    const coordinator = {} as ServiceCoordinator;
    const config = makeConfig(tmpDir, {
      registry: `http://127.0.0.1:${remotePort}`,
    });
    const service = new AgentBnBService(coordinator, config);

    try {
      const cards = await service.discoverCapabilities({});
      expect(cards.map((card) => card.id)).toEqual([
        localA.id,
        localB.id,
        '33333333-3333-3333-3333-333333333333',
      ]);
    } finally {
      await remoteServer.close();
    }
  });

  it('rentCapability uses requester-side escrow flow and settles on success', async () => {
    const db = openDatabase(join(tmpDir, 'registry.db'));
    const targetCard = makeCard('44444444-4444-4444-4444-444444444444', 'provider-owner');
    insertCard(db, targetCard);
    db.close();

    const creditDb = openCreditDb(join(tmpDir, 'credit.db'));
    bootstrapAgent(creditDb, 'test-owner', 100);
    creditDb.close();

    let lastRpcPayload: Record<string, unknown> | null = null;
    const gatewayServer = Fastify({ logger: false });
    gatewayServer.post('/rpc', async (request) => {
      lastRpcPayload = request.body as Record<string, unknown>;
      const id = (lastRpcPayload['id'] as string) ?? 'test-id';
      return { jsonrpc: '2.0', id, result: { output: 'ok' } };
    });
    await gatewayServer.listen({ port: 0, host: '127.0.0.1' });
    const port = (gatewayServer.server.address() as { port: number }).port;

    const coordinator = {} as ServiceCoordinator;
    const config = makeConfig(tmpDir, {
      gateway_url: `http://127.0.0.1:${port}`,
      gateway_port: port,
    });
    const service = new AgentBnBService(coordinator, config);

    try {
      const result = await service.rentCapability({
        cardId: targetCard.id,
        maxCredits: 10,
        taskParams: { prompt: 'hello' },
      });

      expect(result.transactionId).toBeTruthy();
      expect(result.result).toEqual({ output: 'ok' });
      expect(lastRpcPayload).not.toBeNull();

      const params = (lastRpcPayload!.params as Record<string, unknown>) ?? {};
      expect(params['card_id']).toBe(targetCard.id);
      expect(params['escrow_receipt']).toBeDefined();

      const dbCheck = openCreditDb(join(tmpDir, 'credit.db'));
      const row = dbCheck
        .prepare('SELECT status FROM credit_escrow WHERE id = ?')
        .get(result.transactionId) as { status: string } | undefined;
      dbCheck.close();
      expect(row?.status).toBe('settled');
    } finally {
      await gatewayServer.close();
    }
  });

  it('rentCapability uses relay when remote card has no gateway_url', async () => {
    const remoteCardId = '55555555-5555-5555-5555-555555555555';

    const creditDb = openCreditDb(join(tmpDir, 'credit.db'));
    bootstrapAgent(creditDb, 'test-owner', 100);
    creditDb.close();

    const registryServer = Fastify({ logger: false });
    registryServer.get('/cards/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id !== remoteCardId) {
        return reply.code(404).send({ error: 'not found' });
      }
      return makeCard(remoteCardId, 'relay-provider');
    });
    await registryServer.listen({ port: 0, host: '127.0.0.1' });
    const registryPort = (registryServer.server.address() as { port: number }).port;

    const requestCapabilitySpy = vi.spyOn(gatewayClient, 'requestCapability');
    const relaySpy = vi.spyOn(gatewayClient, 'requestViaRelay').mockResolvedValue({ output: 'via-relay' });
    const connectSpy = vi.spyOn(RelayClient.prototype, 'connect').mockResolvedValue(undefined);
    const disconnectSpy = vi.spyOn(RelayClient.prototype, 'disconnect').mockImplementation(() => undefined);

    const service = new AgentBnBService(
      {} as ServiceCoordinator,
      makeConfig(tmpDir, {
        registry: `http://127.0.0.1:${registryPort}`,
      }),
    );

    try {
      const result = await service.rentCapability({
        cardId: remoteCardId,
        maxCredits: 7,
        taskParams: { prompt: 'relay me' },
      });

      expect(result.result).toEqual({ output: 'via-relay' });
      expect(requestCapabilitySpy).not.toHaveBeenCalled();
      expect(relaySpy).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);

      const relayOpts = relaySpy.mock.calls[0]?.[1] as {
        targetOwner: string;
        cardId: string;
        requester: string;
        escrowReceipt?: unknown;
      };
      expect(relayOpts.targetOwner).toBe('relay-provider');
      expect(relayOpts.cardId).toBe(remoteCardId);
      expect(relayOpts.requester).toBe('test-owner');
      expect(relayOpts.escrowReceipt).toBeDefined();

      const dbCheck = openCreditDb(join(tmpDir, 'credit.db'));
      const row = dbCheck
        .prepare('SELECT status FROM credit_escrow WHERE id = ?')
        .get(result.transactionId) as { status: string } | undefined;
      dbCheck.close();
      expect(row?.status).toBe('settled');
    } finally {
      await registryServer.close();
    }
  });

  it('rentCapability falls back to relay on direct network error for remote cards', async () => {
    const remoteCardId = '66666666-6666-6666-6666-666666666666';

    const creditDb = openCreditDb(join(tmpDir, 'credit.db'));
    bootstrapAgent(creditDb, 'test-owner', 100);
    creditDb.close();

    const registryServer = Fastify({ logger: false });
    registryServer.get('/cards/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id !== remoteCardId) {
        return reply.code(404).send({ error: 'not found' });
      }
      return {
        ...makeCard(remoteCardId, 'relay-provider'),
        gateway_url: 'http://127.0.0.1:9',
      };
    });
    await registryServer.listen({ port: 0, host: '127.0.0.1' });
    const registryPort = (registryServer.server.address() as { port: number }).port;

    const requestCapabilitySpy = vi.spyOn(gatewayClient, 'requestCapability').mockRejectedValue(
      new AgentBnBError('Network error: ECONNREFUSED', 'NETWORK_ERROR'),
    );
    const relaySpy = vi.spyOn(gatewayClient, 'requestViaRelay').mockResolvedValue({ output: 'relay-fallback' });
    const connectSpy = vi.spyOn(RelayClient.prototype, 'connect').mockResolvedValue(undefined);
    const disconnectSpy = vi.spyOn(RelayClient.prototype, 'disconnect').mockImplementation(() => undefined);

    const service = new AgentBnBService(
      {} as ServiceCoordinator,
      makeConfig(tmpDir, {
        registry: `http://127.0.0.1:${registryPort}`,
      }),
    );

    try {
      const result = await service.rentCapability({
        cardId: remoteCardId,
        maxCredits: 11,
        taskParams: { prompt: 'fallback please' },
      });

      expect(result.result).toEqual({ output: 'relay-fallback' });
      expect(requestCapabilitySpy).toHaveBeenCalledTimes(1);
      expect(relaySpy).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);

      const directOpts = requestCapabilitySpy.mock.calls[0]?.[0] as { gatewayUrl: string; cardId: string };
      expect(directOpts.gatewayUrl).toBe('http://127.0.0.1:9');
      expect(directOpts.cardId).toBe(remoteCardId);

      const dbCheck = openCreditDb(join(tmpDir, 'credit.db'));
      const row = dbCheck
        .prepare('SELECT status FROM credit_escrow WHERE id = ?')
        .get(result.transactionId) as { status: string } | undefined;
      dbCheck.close();
      expect(row?.status).toBe('settled');
    } finally {
      await registryServer.close();
    }
  });

  it('shareCapability remains explicit TODO stub', async () => {
    const service = new AgentBnBService({} as ServiceCoordinator, makeConfig(tmpDir));
    await expect(service.shareCapability({})).rejects.toThrow(/not implemented/i);
  });
});
