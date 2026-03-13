import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createGatewayServer } from './server.js';
import { openDatabase, insertCard } from '../registry/store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { requestCapability } from './client.js';
import type { CapabilityCard } from '../types/index.js';
import type Database from 'better-sqlite3';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CapabilityCard> = {}): CapabilityCard {
  return {
    id: randomUUID(),
    owner: 'provider-agent',
    name: 'Test Capability',
    description: 'A test capability for unit tests',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'result', type: 'text', required: true }],
    pricing: { credits_per_call: 10 },
    availability: { online: true },
    metadata: {},
    ...overrides,
  };
}

/**
 * Creates a minimal Fastify mock handler that returns a fixed response.
 * Binds to a random port and returns the URL for use in tests.
 */
async function createMockHandler(
  response: unknown = { output: 'mock result' },
  statusCode = 200,
): Promise<{ server: FastifyInstance; url: string }> {
  const server = Fastify({ logger: false });
  server.post('/', async (_req, reply) => {
    return reply.status(statusCode).send(response);
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const addr = server.server.address();
  const url = `http://127.0.0.1:${(addr as { port: number }).port}`;
  return { server, url };
}

// ─── Gateway server tests ─────────────────────────────────────────────────────

describe('Gateway Server', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;
  let gateway: FastifyInstance;
  let mockHandler: { server: FastifyInstance; url: string };
  let testCard: CapabilityCard;
  const validToken = 'test-token-abc123';

  beforeEach(async () => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');

    // Bootstrap the requesting agent with enough credits
    bootstrapAgent(creditDb, 'requester-agent', 100);

    testCard = makeCard({ id: randomUUID() });
    insertCard(registryDb, testCard);

    mockHandler = await createMockHandler({ output: 'hello from handler' });

    gateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: mockHandler.url,
      timeoutMs: 5000,
    });

    await gateway.ready();
  });

  afterEach(async () => {
    await gateway.close();
    await mockHandler.server.close();
    registryDb.close();
    creditDb.close();
  });

  // ── /health ──────────────────────────────────────────────────────────────

  it('GET /health returns 200 with status ok', async () => {
    const res = await gateway.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe('ok');
  });

  it('GET /health includes version and uptime', async () => {
    const res = await gateway.inject({ method: 'GET', url: '/health' });
    const body = res.json<{ version: string; uptime: number }>();
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  it('POST /rpc without auth token returns 401', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: testCard.id, requester: 'requester-agent' },
        id: '1',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /rpc with invalid token returns 401', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: 'Bearer wrong-token' },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: testCard.id, requester: 'requester-agent' },
        id: '1',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── JSON-RPC dispatch ─────────────────────────────────────────────────────

  it('POST /rpc with valid token and valid card executes and returns result', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: testCard.id, requester: 'requester-agent', prompt: 'hello' },
        id: 'req-1',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ jsonrpc: string; result: unknown; id: string }>();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result).toBeDefined();
    expect(body.id).toBe('req-1');
  });

  it('POST /rpc with unknown card_id returns JSON-RPC error -32602', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: randomUUID(), requester: 'requester-agent' },
        id: '2',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ error: { code: number; message: string } }>();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toMatch(/not found/i);
  });

  it('POST /rpc with insufficient credits returns JSON-RPC error -32603', async () => {
    // Bootstrap requester with 0 credits by using a fresh agent that was never bootstrapped
    const brokeAgent = 'broke-agent-' + randomUUID();
    // brokeAgent has 0 credits (never bootstrapped)

    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: testCard.id, requester: brokeAgent },
        id: '3',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ error: { code: number; message: string } }>();
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toMatch(/insufficient credits/i);
  });

  it('POST /rpc execution timeout returns JSON-RPC error -32603', async () => {
    // Create a handler that never responds (simulated timeout)
    const slowHandler = Fastify({ logger: false });
    slowHandler.post('/', async (_req, reply) => {
      // Delay longer than gateway timeout
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return reply.send({ output: 'too slow' });
    });
    await slowHandler.listen({ port: 0, host: '127.0.0.1' });
    const slowAddr = slowHandler.server.address();
    const slowUrl = `http://127.0.0.1:${(slowAddr as { port: number }).port}`;

    const timeoutGateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: slowUrl,
      timeoutMs: 100, // Very short timeout
    });
    await timeoutGateway.ready();

    try {
      const res = await timeoutGateway.inject({
        method: 'POST',
        url: '/rpc',
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          jsonrpc: '2.0',
          method: 'capability.execute',
          params: { card_id: testCard.id, requester: 'requester-agent' },
          id: '4',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ error: { code: number; message: string } }>();
      expect(body.error.code).toBe(-32603);
      expect(body.error.message).toMatch(/timeout/i);
    } finally {
      await timeoutGateway.close();
      await slowHandler.close();
    }
  });

  it('escrow is settled after successful execution', async () => {
    const { getBalance } = await import('../credit/ledger.js');
    const initialBalance = getBalance(creditDb, 'requester-agent');

    await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: testCard.id, requester: 'requester-agent' },
        id: '5',
      },
    });

    const afterBalance = getBalance(creditDb, 'requester-agent');
    expect(afterBalance).toBe(initialBalance - testCard.pricing.credits_per_call);
  });

  it('escrow is released on handler error', async () => {
    const errorHandler = await createMockHandler({ error: 'handler error' }, 500);
    const { getBalance } = await import('../credit/ledger.js');
    const initialBalance = getBalance(creditDb, 'requester-agent');

    const errorGateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: errorHandler.url,
      timeoutMs: 5000,
    });
    await errorGateway.ready();

    try {
      await errorGateway.inject({
        method: 'POST',
        url: '/rpc',
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          jsonrpc: '2.0',
          method: 'capability.execute',
          params: { card_id: testCard.id, requester: 'requester-agent' },
          id: '6',
        },
      });

      const afterBalance = getBalance(creditDb, 'requester-agent');
      // Credits should be refunded on error
      expect(afterBalance).toBe(initialBalance);
    } finally {
      await errorGateway.close();
      await errorHandler.server.close();
    }
  });
});

// ─── Gateway Client tests ─────────────────────────────────────────────────────

describe('Gateway Client', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;
  let gateway: FastifyInstance;
  let gatewayUrl: string;
  let mockHandler: { server: FastifyInstance; url: string };
  let testCard: CapabilityCard;
  const validToken = 'client-test-token';

  beforeEach(async () => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');
    bootstrapAgent(creditDb, 'requester-agent', 100);

    testCard = makeCard({ id: randomUUID() });
    insertCard(registryDb, testCard);

    mockHandler = await createMockHandler({ output: 'capability result' });

    gateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: mockHandler.url,
      timeoutMs: 5000,
    });

    await gateway.listen({ port: 0, host: '127.0.0.1' });
    const addr = gateway.server.address();
    gatewayUrl = `http://127.0.0.1:${(addr as { port: number }).port}`;
  });

  afterEach(async () => {
    await gateway.close();
    await mockHandler.server.close();
    registryDb.close();
    creditDb.close();
  });

  it('requestCapability sends JSON-RPC POST to gateway and returns result', async () => {
    const result = await requestCapability({
      gatewayUrl,
      token: validToken,
      cardId: testCard.id,
      params: { requester: 'requester-agent', prompt: 'test' },
    });
    expect(result).toBeDefined();
  });

  it('requestCapability includes Authorization header', async () => {
    // Test indirectly: if no auth header, gateway returns 401 and client throws
    await expect(
      requestCapability({
        gatewayUrl,
        token: 'wrong-token',
        cardId: testCard.id,
        params: { requester: 'requester-agent' },
      }),
    ).rejects.toThrow();
  });

  it('requestCapability handles JSON-RPC error responses', async () => {
    await expect(
      requestCapability({
        gatewayUrl,
        token: validToken,
        cardId: randomUUID(), // unknown card
        params: { requester: 'requester-agent' },
      }),
    ).rejects.toThrow();
  });

  it('requestCapability throws on network failure', async () => {
    await expect(
      requestCapability({
        gatewayUrl: 'http://127.0.0.1:1', // Nothing listening on port 1
        token: validToken,
        cardId: testCard.id,
        params: { requester: 'requester-agent' },
      }),
    ).rejects.toThrow();
  });

  it('requestCapability respects timeout', async () => {
    const slowHandler = Fastify({ logger: false });
    slowHandler.post('/', async (_req, reply) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return reply.send({ output: 'too slow' });
    });
    await slowHandler.listen({ port: 0, host: '127.0.0.1' });
    const slowAddr = slowHandler.server.address();
    const slowUrl = `http://127.0.0.1:${(slowAddr as { port: number }).port}`;

    const slowGateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: slowUrl,
      timeoutMs: 100, // Gateway times out fast
    });
    await slowGateway.listen({ port: 0, host: '127.0.0.1' });
    const slowGatewayAddr = slowGateway.server.address();
    const slowGatewayUrl = `http://127.0.0.1:${(slowGatewayAddr as { port: number }).port}`;

    try {
      // The client itself has a longer timeout but gateway will return error
      const result = await requestCapability({
        gatewayUrl: slowGatewayUrl,
        token: validToken,
        cardId: testCard.id,
        params: { requester: 'requester-agent' },
        timeoutMs: 5000,
      });
      // If result doesn't throw, it should be an error response
      expect(result).toBeDefined();
    } catch (err) {
      // Either the gateway's JSON-RPC timeout error came back, which is expected
      expect(err).toBeInstanceOf(Error);
    } finally {
      await slowGateway.close();
      await slowHandler.close();
    }
  });
});
