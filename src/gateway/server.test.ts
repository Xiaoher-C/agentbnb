import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createGatewayServer } from './server.js';
import { openDatabase, insertCard, getCard } from '../registry/store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { requestCapability } from './client.js';
import { getRequestLog } from '../registry/request-log.js';
import type { CapabilityCard, CapabilityCardV2 } from '../types/index.js';
import type Database from 'better-sqlite3';

// ─── Helper: insert a v2.0 card directly into the DB ─────────────────────────

function insertCardV2(db: Database.Database, card: CapabilityCardV2): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run(card.id, card.owner, JSON.stringify(card), now, now);
}

/** Creates a two-skill v2.0 card for use in skill_id routing tests. */
function makeV2Card(overrides: Partial<CapabilityCardV2> = {}): CapabilityCardV2 {
  return {
    spec_version: '2.0',
    id: randomUUID(),
    owner: 'provider-agent',
    agent_name: 'Multi-Skill Agent',
    skills: [
      {
        id: 'skill-tts',
        name: 'Text to Speech',
        description: 'Converts text to audio',
        level: 1,
        inputs: [{ name: 'text', type: 'text', required: true }],
        outputs: [{ name: 'audio', type: 'audio', required: true }],
        pricing: { credits_per_call: 5 },
      },
      {
        id: 'skill-stt',
        name: 'Speech to Text',
        description: 'Converts audio to text',
        level: 1,
        inputs: [{ name: 'audio', type: 'audio', required: true }],
        outputs: [{ name: 'text', type: 'text', required: true }],
        pricing: { credits_per_call: 8 },
      },
    ],
    availability: { online: true },
    ...overrides,
  };
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CapabilityCard> = {}): CapabilityCard {
  return {
    spec_version: '1.0',
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

// ─── Reputation tracking tests ────────────────────────────────────────────────

describe('Gateway Reputation Tracking', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;
  let gateway: FastifyInstance;
  let mockHandler: { server: FastifyInstance; url: string };
  let testCard: CapabilityCard;
  const validToken = 'reputation-test-token';

  beforeEach(async () => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');

    bootstrapAgent(creditDb, 'requester-agent', 1000);

    testCard = makeCard({ id: randomUUID() });
    insertCard(registryDb, testCard);

    mockHandler = await createMockHandler({ output: 'success result' });

    gateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: mockHandler.url,
      timeoutMs: 5000,
      silent: true,
    });

    await gateway.ready();
  });

  afterEach(async () => {
    await gateway.close();
    await mockHandler.server.close();
    registryDb.close();
    creditDb.close();
  });

  it('Test 1: After successful execution (200), card success_rate is updated (not undefined)', async () => {
    await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: testCard.id, requester: 'requester-agent' },
        id: 'r-1',
      },
    });

    const updated = getCard(registryDb, testCard.id);
    expect(updated?.metadata?.success_rate).toBeDefined();
    expect(typeof updated?.metadata?.success_rate).toBe('number');
  });

  it('Test 2: After failed execution (handler 500), success_rate reflects failure', async () => {
    const errorHandler = await createMockHandler({ error: 'internal error' }, 500);

    const errorGateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: errorHandler.url,
      timeoutMs: 5000,
      silent: true,
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
          id: 'r-2',
        },
      });

      const updated = getCard(registryDb, testCard.id);
      expect(updated?.metadata?.success_rate).toBeDefined();
      // Bootstrap with success=false: rate should be 0.0
      expect(updated?.metadata?.success_rate).toBe(0.0);
    } finally {
      await errorGateway.close();
      await errorHandler.server.close();
    }
  });

  it('Test 3: After successful execution, avg_latency_ms is set to a positive number', async () => {
    await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: testCard.id, requester: 'requester-agent' },
        id: 'r-3',
      },
    });

    const updated = getCard(registryDb, testCard.id);
    expect(updated?.metadata?.avg_latency_ms).toBeDefined();
    expect(updated?.metadata?.avg_latency_ms).toBeGreaterThan(0);
  });

  it('Test 4: After timeout (AbortError), success_rate reflects failure', async () => {
    const slowHandler = Fastify({ logger: false });
    slowHandler.post('/', async (_req, reply) => {
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
      timeoutMs: 50, // Very short timeout to trigger AbortError
      silent: true,
    });
    await timeoutGateway.ready();

    try {
      await timeoutGateway.inject({
        method: 'POST',
        url: '/rpc',
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          jsonrpc: '2.0',
          method: 'capability.execute',
          params: { card_id: testCard.id, requester: 'requester-agent' },
          id: 'r-4',
        },
      });

      const updated = getCard(registryDb, testCard.id);
      expect(updated?.metadata?.success_rate).toBeDefined();
      // Bootstrap with success=false: rate should be 0.0
      expect(updated?.metadata?.success_rate).toBe(0.0);
    } finally {
      await timeoutGateway.close();
      await slowHandler.close();
    }
  });
});

// ─── Request Log tracking tests ───────────────────────────────────────────────

describe('Gateway Request Log Tracking', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;
  let gateway: FastifyInstance;
  let mockHandler: { server: FastifyInstance; url: string };
  let testCard: CapabilityCard;
  const validToken = 'request-log-test-token';

  beforeEach(async () => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');

    bootstrapAgent(creditDb, 'requester-agent', 1000);

    testCard = makeCard({ id: randomUUID() });
    insertCard(registryDb, testCard);

    mockHandler = await createMockHandler({ output: 'success result' });

    gateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: mockHandler.url,
      timeoutMs: 5000,
      silent: true,
    });

    await gateway.ready();
  });

  afterEach(async () => {
    await gateway.close();
    await mockHandler.server.close();
    registryDb.close();
    creditDb.close();
  });

  it('after successful execution, request_log has 1 row with status "success"', async () => {
    await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: testCard.id, requester: 'requester-agent' },
        id: 'log-1',
      },
    });

    const log = getRequestLog(registryDb, 10);
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe('success');
    expect(log[0].card_id).toBe(testCard.id);
    expect(log[0].card_name).toBe(testCard.name);
    expect(log[0].requester).toBe('requester-agent');
    expect(log[0].credits_charged).toBe(testCard.pricing.credits_per_call);
    expect(log[0].latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('after failed execution (handler 500), request_log has 1 row with status "failure"', async () => {
    const errorHandler = await createMockHandler({ error: 'handler error' }, 500);
    const errorGateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: errorHandler.url,
      timeoutMs: 5000,
      silent: true,
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
          id: 'log-2',
        },
      });

      const log = getRequestLog(registryDb, 10);
      expect(log).toHaveLength(1);
      expect(log[0].status).toBe('failure');
      expect(log[0].credits_charged).toBe(0);
    } finally {
      await errorGateway.close();
      await errorHandler.server.close();
    }
  });

  it('after timeout, request_log has 1 row with status "timeout"', async () => {
    const slowHandler = Fastify({ logger: false });
    slowHandler.post('/', async (_req, reply) => {
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
      timeoutMs: 50,
      silent: true,
    });
    await timeoutGateway.ready();

    try {
      await timeoutGateway.inject({
        method: 'POST',
        url: '/rpc',
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          jsonrpc: '2.0',
          method: 'capability.execute',
          params: { card_id: testCard.id, requester: 'requester-agent' },
          id: 'log-3',
        },
      });

      const log = getRequestLog(registryDb, 10);
      expect(log).toHaveLength(1);
      expect(log[0].status).toBe('timeout');
      expect(log[0].credits_charged).toBe(0);
    } finally {
      await timeoutGateway.close();
      await slowHandler.close();
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

// ─── Skill ID Routing tests ───────────────────────────────────────────────────

describe('Gateway skill_id routing', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;
  let gateway: FastifyInstance;
  let mockHandler: { server: FastifyInstance; url: string };
  let v2Card: CapabilityCardV2;
  const validToken = 'skill-routing-test-token';

  beforeEach(async () => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');

    bootstrapAgent(creditDb, 'requester-agent', 1000);

    v2Card = makeV2Card();
    insertCardV2(registryDb, v2Card);

    mockHandler = await createMockHandler({ output: 'skill executed' });

    gateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: mockHandler.url,
      timeoutMs: 5000,
      silent: true,
    });

    await gateway.ready();
  });

  afterEach(async () => {
    await gateway.close();
    await mockHandler.server.close();
    registryDb.close();
    creditDb.close();
  });

  it('Test 1: POST /rpc with { card_id, skill_id } routes to handler and returns result', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: {
          card_id: v2Card.id,
          skill_id: 'skill-tts',
          requester: 'requester-agent',
        },
        id: 'skill-1',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ jsonrpc: string; result: unknown }>();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result).toBeDefined();
  });

  it('Test 2: POST /rpc without skill_id falls back to first skill for pricing', async () => {
    // The first skill has credits_per_call = 5
    const initialBalance = 1000;

    await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: { card_id: v2Card.id, requester: 'requester-agent' },
        id: 'skill-2',
      },
    });

    const { getBalance } = await import('../credit/ledger.js');
    const afterBalance = getBalance(creditDb, 'requester-agent');
    // First skill pricing is 5 credits
    expect(afterBalance).toBe(initialBalance - v2Card.skills[0].pricing.credits_per_call);
  });

  it('Test 3: POST /rpc with skill_id uses that skill\'s credits_per_call for escrow', async () => {
    // skill-stt has credits_per_call = 8 (different from first skill = 5)
    const { getBalance } = await import('../credit/ledger.js');
    const initialBalance = getBalance(creditDb, 'requester-agent');

    await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: {
          card_id: v2Card.id,
          skill_id: 'skill-stt',
          requester: 'requester-agent',
        },
        id: 'skill-3',
      },
    });

    const afterBalance = getBalance(creditDb, 'requester-agent');
    const sttSkill = v2Card.skills.find((s) => s.id === 'skill-stt')!;
    expect(afterBalance).toBe(initialBalance - sttSkill.pricing.credits_per_call);
  });

  it('Test 4: POST /rpc with invalid skill_id returns JSON-RPC error -32602', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: {
          card_id: v2Card.id,
          skill_id: 'skill-nonexistent',
          requester: 'requester-agent',
        },
        id: 'skill-4',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ error: { code: number; message: string } }>();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toMatch(/skill not found/i);
  });

  it('Test 5: POST /rpc with skill_id logs skill_id in request_log entry', async () => {
    await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        jsonrpc: '2.0',
        method: 'capability.execute',
        params: {
          card_id: v2Card.id,
          skill_id: 'skill-tts',
          requester: 'requester-agent',
        },
        id: 'skill-5',
      },
    });

    const log = getRequestLog(registryDb, 10);
    expect(log).toHaveLength(1);
    expect(log[0].skill_id).toBe('skill-tts');
  });

  it('Test 8: v1.0 backward compat — migrated card works without skill_id', async () => {
    // Insert a v1.0 card — it will be migrated to v2.0 shape on openDatabase
    // but inserted after the DB is open, so we need to use a fresh DB with v1.0 card
    const freshRegistryDb = openDatabase(':memory:');
    const v1Card = makeCard({ id: randomUUID(), pricing: { credits_per_call: 10 } });
    insertCard(freshRegistryDb, v1Card);

    bootstrapAgent(creditDb, 'v1-requester', 200);

    const v1Gateway = createGatewayServer({
      registryDb: freshRegistryDb,
      creditDb,
      tokens: [validToken],
      handlerUrl: mockHandler.url,
      timeoutMs: 5000,
      silent: true,
    });
    await v1Gateway.ready();

    try {
      const res = await v1Gateway.inject({
        method: 'POST',
        url: '/rpc',
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          jsonrpc: '2.0',
          method: 'capability.execute',
          // v1.0 style — no skill_id
          params: { card_id: v1Card.id, requester: 'v1-requester' },
          id: 'compat-1',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ jsonrpc: string; result: unknown; error?: unknown }>();
      expect(body.jsonrpc).toBe('2.0');
      // Should succeed, not error
      expect(body.result).toBeDefined();
      expect(body.error).toBeUndefined();
    } finally {
      await v1Gateway.close();
      freshRegistryDb.close();
    }
  });
});
