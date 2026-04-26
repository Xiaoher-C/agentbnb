import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createRegistryServer } from './server.js';
import { openDatabase } from './store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { generateKeyPair } from '../credit/signing.js';
import { signRequest } from './identity-auth.js';
import { createAgentRecord } from '../identity/agent-identity.js';
import { deriveAgentId } from '../identity/identity.js';
import type Database from 'better-sqlite3';

describe('credit routes', () => {
  let server: FastifyInstance;
  let creditDb: Database.Database;
  const keyPair = generateKeyPair();
  const publicKeyHex = keyPair.publicKey.toString('hex');

  // Helper: create signed headers for a request
  function authHeaders(method: string, path: string, body: unknown = null): Record<string, string> {
    return signRequest(method, path, body, keyPair.privateKey, publicKeyHex);
  }

  beforeEach(async () => {
    const registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');

    createAgentRecord(creditDb, {
      agent_id: deriveAgentId(publicKeyHex),
      display_name: 'alice-agent',
      public_key: publicKeyHex,
      legacy_owner: 'alice',
    });

    const { server: s } = createRegistryServer({
      registryDb,
      creditDb,
      silent: true,
    });
    server = s;
    await server.ready();

    // Bootstrap test agents with credits
    bootstrapAgent(creditDb, 'alice', 200);
    bootstrapAgent(creditDb, 'bob', 100);
  });

  afterEach(async () => {
    await server.close();
  });

  // Test 1: POST /api/credits/hold with valid auth deducts from balance, returns { escrowId }
  it('POST /api/credits/hold deducts balance and returns escrowId', async () => {
    const body = { owner: 'alice', amount: 50, cardId: 'card-001' };
    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/hold',
      headers: {
        ...authHeaders('POST', '/api/credits/hold', body),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(body),
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data).toHaveProperty('escrowId');
    expect(typeof data.escrowId).toBe('string');
  });

  // Test 2: POST /api/credits/hold with insufficient balance returns 400
  it('POST /api/credits/hold with insufficient balance returns 400 INSUFFICIENT_CREDITS', async () => {
    const body = { owner: 'alice', amount: 9999, cardId: 'card-001' };
    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/hold',
      headers: {
        ...authHeaders('POST', '/api/credits/hold', body),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(body),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
  });

  // Test 3: POST /api/credits/settle transfers held credits to provider, returns { ok: true }
  it('POST /api/credits/settle transfers credits to provider', async () => {
    // First hold some credits
    const holdBody = { owner: 'alice', amount: 30, cardId: 'card-001' };
    const holdResponse = await server.inject({
      method: 'POST',
      url: '/api/credits/hold',
      headers: {
        ...authHeaders('POST', '/api/credits/hold', holdBody),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(holdBody),
    });
    const { escrowId } = holdResponse.json();

    // Now settle
    const settleBody = { escrowId, recipientOwner: 'bob' };
    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/settle',
      headers: {
        ...authHeaders('POST', '/api/credits/settle', settleBody),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(settleBody),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  // Test 4: POST /api/credits/release refunds credits to requester, returns { ok: true }
  it('POST /api/credits/release refunds credits to requester', async () => {
    // First hold some credits
    const holdBody = { owner: 'alice', amount: 20, cardId: 'card-002' };
    const holdResponse = await server.inject({
      method: 'POST',
      url: '/api/credits/hold',
      headers: {
        ...authHeaders('POST', '/api/credits/hold', holdBody),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(holdBody),
    });
    const { escrowId } = holdResponse.json();

    // Now release
    const releaseBody = { escrowId };
    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/release',
      headers: {
        ...authHeaders('POST', '/api/credits/release', releaseBody),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(releaseBody),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  // Test 5: POST /api/credits/grant gives 50 credits on first call
  it('POST /api/credits/grant gives 50 credits on first call', async () => {
    const body = { owner: 'alice' };
    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/grant',
      headers: {
        ...authHeaders('POST', '/api/credits/grant', body),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(body),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, granted: 50 });
  });

  // Test 6: POST /api/credits/grant on second call returns already_granted
  it('POST /api/credits/grant deduplicates by Ed25519 public key', async () => {
    const body = { owner: 'alice' };
    const headers = authHeaders('POST', '/api/credits/grant', body);

    // First grant
    await server.inject({
      method: 'POST',
      url: '/api/credits/grant',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
    });

    // Second grant with same key — different timestamp so need new headers
    const headers2 = authHeaders('POST', '/api/credits/grant', body);
    const response2 = await server.inject({
      method: 'POST',
      url: '/api/credits/grant',
      headers: { ...headers2, 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
    });

    expect(response2.statusCode).toBe(200);
    expect(response2.json()).toEqual({ ok: true, granted: 0, reason: 'already_granted' });
  });

  // Test 7: GET /api/credits/:owner returns { balance: N }
  it('GET /api/credits/:owner returns balance', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/credits/alice',
      headers: authHeaders('GET', '/api/credits/alice'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ balance: 200 });
  });

  // Test 8: GET /api/credits/:owner/history returns { transactions, limit }
  it('GET /api/credits/:owner/history returns paginated transactions', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/credits/alice/history',
      headers: authHeaders('GET', '/api/credits/alice/history'),
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data).toHaveProperty('transactions');
    expect(Array.isArray(data.transactions)).toBe(true);
    expect(data).toHaveProperty('limit');
  });

  // Test 9: All endpoints return 401 without auth headers
  it('all credit endpoints return 401 without auth headers', async () => {
    const endpoints = [
      { method: 'POST', url: '/api/credits/hold', payload: { owner: 'alice', amount: 10, cardId: 'x' } },
      { method: 'POST', url: '/api/credits/settle', payload: { escrowId: 'x', recipientOwner: 'bob' } },
      { method: 'POST', url: '/api/credits/release', payload: { escrowId: 'x' } },
      { method: 'POST', url: '/api/credits/grant', payload: { owner: 'alice' } },
      { method: 'GET', url: '/api/credits/alice', payload: null },
      { method: 'GET', url: '/api/credits/alice/history', payload: null },
    ];

    for (const ep of endpoints) {
      const response = await server.inject({
        method: ep.method as 'GET' | 'POST',
        url: ep.url,
        headers: ep.payload ? { 'Content-Type': 'application/json' } : {},
        payload: ep.payload ? JSON.stringify(ep.payload) : undefined,
      });

      expect(response.statusCode, `${ep.method} ${ep.url} should return 401`).toBe(401);
    }
  });

  // Test 10: POST /api/credits/hold with missing required fields returns 400
  it('POST /api/credits/hold with missing required fields returns 400', async () => {
    const body = { owner: 'alice' }; // missing amount and cardId
    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/hold',
      headers: {
        ...authHeaders('POST', '/api/credits/hold', body),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(body),
    });

    expect(response.statusCode).toBe(400);
  });

  // Test 11: GET /api/credits/balance (public, no auth) returns { owner, balance }
  it('GET /api/credits/balance returns balance without auth', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/credits/balance?owner=alice',
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data).toHaveProperty('owner', 'alice');
    expect(data).toHaveProperty('balance', 200);
  });

  // Test 12: GET /api/credits/balance missing owner returns 400
  it('GET /api/credits/balance without owner returns 400', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/credits/balance',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
  });

  // Test 13: GET /api/credits/transactions (public, no auth) returns { owner, transactions, limit }
  it('GET /api/credits/transactions returns transaction history without auth', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/credits/transactions?owner=alice',
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data).toHaveProperty('owner', 'alice');
    expect(Array.isArray(data.transactions)).toBe(true);
    expect(data).toHaveProperty('limit');
  });

  // Test 14: GET /api/credits/transactions with limit param is capped at 100
  it('GET /api/credits/transactions respects limit param', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/credits/transactions?owner=alice&limit=5',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().limit).toBe(5);
  });

  // Test 15: GET /api/credits/transactions missing owner returns 400
  it('GET /api/credits/transactions without owner returns 400', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/credits/transactions',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
  });

  // Test 16: POST /api/credits/settle as a non-owner returns 403
  it('POST /api/credits/settle as a non-owner returns 403', async () => {
    // Alice creates the escrow as the owner
    const holdBody = { owner: 'alice', amount: 30, cardId: 'card-001' };
    const holdResponse = await server.inject({
      method: 'POST',
      url: '/api/credits/hold',
      headers: {
        ...authHeaders('POST', '/api/credits/hold', holdBody),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(holdBody),
    });
    expect(holdResponse.statusCode).toBe(200);
    const { escrowId } = holdResponse.json();

    // Mallory (a different identity) tries to settle Alice's escrow.
    const malloryKeys = generateKeyPair();
    const malloryPubHex = malloryKeys.publicKey.toString('hex');
    createAgentRecord(creditDb, {
      agent_id: deriveAgentId(malloryPubHex),
      display_name: 'mallory-agent',
      public_key: malloryPubHex,
      legacy_owner: 'mallory',
    });
    bootstrapAgent(creditDb, 'mallory', 50);

    const settleBody = { escrowId, recipientOwner: 'mallory' };
    const malloryHeaders = signRequest(
      'POST',
      '/api/credits/settle',
      settleBody,
      malloryKeys.privateKey,
      malloryPubHex,
    );

    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/settle',
      headers: { ...malloryHeaders, 'Content-Type': 'application/json' },
      payload: JSON.stringify(settleBody),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'forbidden_not_escrow_owner' });
  });

  // Test 17: POST /api/credits/release as a non-owner returns 403
  it('POST /api/credits/release as a non-owner returns 403', async () => {
    // Alice creates the escrow as the owner
    const holdBody = { owner: 'alice', amount: 20, cardId: 'card-002' };
    const holdResponse = await server.inject({
      method: 'POST',
      url: '/api/credits/hold',
      headers: {
        ...authHeaders('POST', '/api/credits/hold', holdBody),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(holdBody),
    });
    expect(holdResponse.statusCode).toBe(200);
    const { escrowId } = holdResponse.json();

    // Mallory (a different identity) tries to release Alice's escrow.
    const malloryKeys = generateKeyPair();
    const malloryPubHex = malloryKeys.publicKey.toString('hex');
    createAgentRecord(creditDb, {
      agent_id: deriveAgentId(malloryPubHex),
      display_name: 'mallory-agent',
      public_key: malloryPubHex,
      legacy_owner: 'mallory',
    });

    const releaseBody = { escrowId };
    const malloryHeaders = signRequest(
      'POST',
      '/api/credits/release',
      releaseBody,
      malloryKeys.privateKey,
      malloryPubHex,
    );

    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/release',
      headers: { ...malloryHeaders, 'Content-Type': 'application/json' },
      payload: JSON.stringify(releaseBody),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'forbidden_not_escrow_owner' });
  });

  // Test 18: POST /api/credits/settle for a non-existent escrow returns 404
  it('POST /api/credits/settle for missing escrow returns 404', async () => {
    const body = { escrowId: 'does-not-exist', recipientOwner: 'bob' };
    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/settle',
      headers: {
        ...authHeaders('POST', '/api/credits/settle', body),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(body),
    });

    expect(response.statusCode).toBe(404);
  });

  // Test 19: POST /api/credits/release for a non-existent escrow returns 404
  it('POST /api/credits/release for missing escrow returns 404', async () => {
    const body = { escrowId: 'does-not-exist' };
    const response = await server.inject({
      method: 'POST',
      url: '/api/credits/release',
      headers: {
        ...authHeaders('POST', '/api/credits/release', body),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(body),
    });

    expect(response.statusCode).toBe(404);
  });
});
