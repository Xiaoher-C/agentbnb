import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { openCreditDb } from '../credit/ledger.js';
import { generateKeyPair, signEscrowReceipt } from '../credit/signing.js';
import { identityAuthPlugin, signRequest } from './identity-auth.js';
import { createAgentRecord } from '../identity/agent-identity.js';
import { deriveAgentId } from '../identity/identity.js';

/**
 * Creates a small test server with identityAuthPlugin applied to a protected scope,
 * with GET /test and POST /test routes behind the auth hook.
 *
 * Note: identityAuthPlugin is called directly on the scope (not via scope.register)
 * so the addHook applies to the same scope as the routes.
 */
async function createTestServer(agentDb: Database.Database): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });

  // Register protected routes in a scoped block with the identity auth hook
  await server.register(async (scope) => {
    // Apply the auth hook directly to this scope
    identityAuthPlugin(scope, { agentDb });

    scope.get('/test', async (_request, reply) => {
      return reply.send({ ok: true });
    });

    scope.post('/test', async (request, reply) => {
      return reply.send({ ok: true, body: request.body });
    });
  });

  await server.ready();
  return server;
}

describe('identityAuthPlugin', () => {
  let server: FastifyInstance;
  let agentDb: Database.Database;
  let keyPair: ReturnType<typeof generateKeyPair>;
  let publicKeyHex: string;
  let agentId: string;

  beforeEach(async () => {
    keyPair = generateKeyPair();
    publicKeyHex = keyPair.publicKey.toString('hex');
    agentId = deriveAgentId(publicKeyHex);

    agentDb = openCreditDb(':memory:');
    createAgentRecord(agentDb, {
      agent_id: agentId,
      display_name: 'test-agent',
      public_key: publicKeyHex,
      legacy_owner: 'alice',
    });

    server = await createTestServer(agentDb);
  });

  afterEach(async () => {
    await server.close();
    agentDb.close();
  });

  // Test 1: Request with valid headers passes auth (200)
  it('passes request with valid Ed25519 identity headers', async () => {
    const headers = signRequest('GET', '/test', null, keyPair.privateKey, publicKeyHex);

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  // Test 2: Missing X-Agent-PublicKey returns 401
  it('returns 401 when X-Agent-PublicKey header is missing', async () => {
    const headers = signRequest('GET', '/test', null, keyPair.privateKey, publicKeyHex);
    const { 'X-Agent-PublicKey': _, ...headersWithout } = headers;

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: headersWithout,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Missing identity headers' });
  });

  // Test 3: Missing X-Agent-Signature returns 401
  it('returns 401 when X-Agent-Signature header is missing', async () => {
    const headers = signRequest('GET', '/test', null, keyPair.privateKey, publicKeyHex);
    const { 'X-Agent-Signature': _, ...headersWithout } = headers;

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: headersWithout,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Missing identity headers' });
  });

  // Test 4: Invalid signature (wrong key) returns 401
  it('returns 401 when signature is invalid (wrong key)', async () => {
    const wrongKeyPair = generateKeyPair();
    const headers = signRequest('GET', '/test', null, wrongKeyPair.privateKey, publicKeyHex, agentId);

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid identity signature' });
  });

  // Test 5: Expired timestamp (>5 min old) returns 401
  it('returns 401 when timestamp is expired (>5 minutes old)', async () => {
    const expiredTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const payload: Record<string, unknown> = {
      method: 'GET',
      path: '/test',
      timestamp: expiredTimestamp,
      publicKey: publicKeyHex,
      agentId,
      params: null,
    };
    const signature = signEscrowReceipt(payload, keyPair.privateKey);

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'X-Agent-Id': agentId,
        'X-Agent-PublicKey': publicKeyHex,
        'X-Agent-Signature': signature,
        'X-Agent-Timestamp': expiredTimestamp,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Request expired' });
  });

  // Test for POST requests — auth headers work with POST body
  it('passes POST request with valid auth headers', async () => {
    const body = { owner: 'alice', amount: 10 };
    const headers = signRequest('POST', '/test', body, keyPair.privateKey, publicKeyHex);

    const response = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 401 when X-Agent-Id does not match the signing public key', async () => {
    const forgedAgentId = 'deadbeefdeadbeef';
    const timestamp = new Date().toISOString();
    const payload: Record<string, unknown> = {
      method: 'GET',
      path: '/test',
      timestamp,
      publicKey: publicKeyHex,
      agentId: forgedAgentId,
      params: null,
    };
    const signature = signEscrowReceipt(payload, keyPair.privateKey);

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'X-Agent-Id': forgedAgentId,
        'X-Agent-PublicKey': publicKeyHex,
        'X-Agent-Signature': signature,
        'X-Agent-Timestamp': timestamp,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid identity signature' });
  });

  it('returns 401 when signed params are tampered (nested field changed)', async () => {
    const originalBody = {
      requester: 'alice',
      params: {
        card_id: 'card-1',
        escrow: { amount: 10, nonce: 'abc' },
      },
    };
    const tamperedBody = {
      requester: 'alice',
      params: {
        card_id: 'card-9',
        escrow: { amount: 10, nonce: 'abc' },
      },
    };
    const headers = signRequest('POST', '/test', originalBody, keyPair.privateKey, publicKeyHex);

    const response = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: JSON.stringify(tamperedBody),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid identity signature' });
  });

  it('returns 401 when caller claims a different requester identity', async () => {
    const body = { owner: 'mallory', amount: 10 };
    const headers = signRequest('POST', '/test', body, keyPair.privateKey, publicKeyHex);

    const response = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Identity does not match requester' });
  });

  // Audit ref: docs/maintenance/2026-04-25-ui-backend-gap-audit.md finding #1
  // — Hub historically registered agent_id as `agent-<16hex>`. Backend must
  // canonicalize the incoming X-Agent-Id so legacy Hub sessions don't 401.
  describe('agent_id canonicalization (audit finding #1)', () => {
    it('accepts a prefixed agent- header when payload is signed with the canonical bare hex', async () => {
      const headers = signRequest('GET', '/test', null, keyPair.privateKey, publicKeyHex);
      const prefixedHeaders = { ...headers, 'X-Agent-Id': `agent-${agentId}` };

      const response = await server.inject({
        method: 'GET',
        url: '/test',
        headers: prefixedHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });

    it('accepts the bare 16-hex header (canonical path)', async () => {
      const headers = signRequest('GET', '/test', null, keyPair.privateKey, publicKeyHex);
      expect(headers['X-Agent-Id']).toBe(agentId);

      const response = await server.inject({
        method: 'GET',
        url: '/test',
        headers,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  it('returns 401 when registered agent record public key does not match', async () => {
    const attacker = generateKeyPair();
    const attackerPublicKeyHex = attacker.publicKey.toString('hex');
    const attackerAgentId = deriveAgentId(attackerPublicKeyHex);

    // Insert mismatched mapping intentionally: attacker agent_id -> victim public key.
    createAgentRecord(agentDb, {
      agent_id: attackerAgentId,
      display_name: 'attacker',
      public_key: publicKeyHex,
      legacy_owner: 'attacker-owner',
    });

    const headers = signRequest(
      'GET',
      '/test',
      null,
      attacker.privateKey,
      attackerPublicKeyHex,
      attackerAgentId,
    );

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid identity signature' });
  });
});
