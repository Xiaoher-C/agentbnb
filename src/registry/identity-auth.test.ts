import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPair, signEscrowReceipt } from '../credit/signing.js';
import { identityAuthPlugin, signRequest } from './identity-auth.js';

/**
 * Creates a small test server with identityAuthPlugin applied to a protected scope,
 * with GET /test and POST /test routes behind the auth hook.
 *
 * Note: identityAuthPlugin is called directly on the scope (not via scope.register)
 * so the addHook applies to the same scope as the routes.
 */
async function createTestServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });

  // Register protected routes in a scoped block with the identity auth hook
  await server.register(async (scope) => {
    // Apply the auth hook directly to this scope
    identityAuthPlugin(scope);

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
  const keyPair = generateKeyPair();
  const publicKeyHex = keyPair.publicKey.toString('hex');

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
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
    // Sign with wrong private key but claim correct public key
    const timestamp = new Date().toISOString();
    const payload: Record<string, unknown> = {
      method: 'GET',
      path: '/test',
      timestamp,
      publicKey: publicKeyHex,
    };
    const wrongSignature = signEscrowReceipt(payload, wrongKeyPair.privateKey);

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'X-Agent-PublicKey': publicKeyHex,
        'X-Agent-Signature': wrongSignature,
        'X-Agent-Timestamp': timestamp,
      },
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
    };
    const signature = signEscrowReceipt(payload, keyPair.privateKey);

    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: {
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
});
