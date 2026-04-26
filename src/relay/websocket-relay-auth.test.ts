import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import type Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../registry/store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import type { RelayState } from './types.js';

/**
 * These tests cover the security hardening of the WebSocket relay:
 *  - register-token verification (audit finding #4)
 *  - balance_sync ownership enforcement (audit finding #5)
 *  - max-payload protection (audit finding #12)
 *
 * Module-level configuration (`RELAY_AUTH_SECRET`, `RELAY_MAX_PAYLOAD_BYTES`)
 * is captured at import time, so each describe block sets the env vars
 * BEFORE re-importing the relay module via `vi.resetModules()`.
 */

interface TestHarness {
  db: Database.Database;
  creditDb: Database.Database;
  server: FastifyInstance;
  port: number;
  relayState: RelayState;
  clients: WebSocket[];
}

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify(msg));
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      ws.off('error', onError);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    };
    const onError = (err: Error) => {
      ws.off('message', onMessage);
      reject(err);
    };
    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve({ code: 1006, reason: '' });
      return;
    }
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function makeCard(owner: string): Record<string, unknown> {
  return {
    spec_version: '1.0',
    id: randomUUID(),
    owner,
    name: `${owner} card`,
    description: 'Test card',
    level: 1,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
  };
}

async function bootRelay(): Promise<TestHarness> {
  // Re-import the relay module so module-level env reads pick up the value
  // configured by the surrounding describe block.
  const mod = await import('./websocket-relay.js');
  const db = openDatabase(':memory:');
  const creditDb = openCreditDb(':memory:');
  const server = Fastify({ logger: false });
  await server.register(fastifyWebsocket);
  const relayState = mod.registerWebSocketRelay(server, db, creditDb);
  await server.listen({ port: 0, host: '127.0.0.1' });
  const port = (server.server.address() as AddressInfo).port;
  return { db, creditDb, server, port, relayState, clients: [] };
}

async function teardown(h: TestHarness): Promise<void> {
  await Promise.all(
    h.clients.map(
      (ws) =>
        new Promise<void>((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          const t = setTimeout(resolve, 200);
          ws.once('close', () => {
            clearTimeout(t);
            resolve();
          });
          try { ws.close(); } catch { resolve(); }
        }),
    ),
  );
  h.clients.length = 0;
  h.relayState.shutdown();
  await h.server.close();
  h.db.close();
  h.creditDb.close();
}

function connect(h: TestHarness): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws`);
  h.clients.push(ws);
  return ws;
}

// ───────────────────────────────────────────────────────────────────────────
// Register token verification
// ───────────────────────────────────────────────────────────────────────────

describe('register token verification (RELAY_AUTH_SECRET set)', () => {
  let h: TestHarness;
  const SECRET = 'super-secret-token-value';

  beforeEach(async () => {
    vi.resetModules();
    process.env.RELAY_AUTH_SECRET = SECRET;
    h = await bootRelay();
  });

  afterEach(async () => {
    await teardown(h);
    delete process.env.RELAY_AUTH_SECRET;
  });

  it('accepts registration when token equals the configured secret', async () => {
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);

    send(ws, {
      type: 'register',
      owner: 'agent-ok',
      token: SECRET,
      card: makeCard('agent-ok'),
    });

    const reply = await replyPromise;
    expect(reply.type).toBe('registered');
    expect(h.relayState.getOnlineOwners()).toContain('agent-ok');
  });

  it('rejects a wrong token, closes 1008, and never adds the connection', async () => {
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);
    const closePromise = waitForClose(ws);

    send(ws, {
      type: 'register',
      owner: 'agent-bad',
      token: 'wrong-token',
      card: makeCard('agent-bad'),
    });

    const reply = await replyPromise;
    expect(reply.type).toBe('error');
    expect(reply.code).toBe('unauthorized');

    const close = await closePromise;
    expect(close.code).toBe(1008);
    expect(h.relayState.getOnlineOwners()).not.toContain('agent-bad');
    expect(h.relayState.getOnlineCount()).toBe(0);
  });

  it('rejects a wrong token whose length matches the secret (constant-time path)', async () => {
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);
    const closePromise = waitForClose(ws);

    // Same length as SECRET, different content
    const sameLenWrong = 'X'.repeat(SECRET.length);
    expect(sameLenWrong.length).toBe(SECRET.length);

    send(ws, {
      type: 'register',
      owner: 'agent-bad-eq-len',
      token: sameLenWrong,
      card: makeCard('agent-bad-eq-len'),
    });

    const reply = await replyPromise;
    expect(reply.type).toBe('error');
    expect(reply.code).toBe('unauthorized');

    const close = await closePromise;
    expect(close.code).toBe(1008);
    expect(h.relayState.getOnlineOwners()).not.toContain('agent-bad-eq-len');
  });
});

describe('register token verification (empty token always rejected)', () => {
  let h: TestHarness;

  beforeEach(async () => {
    vi.resetModules();
    process.env.RELAY_AUTH_SECRET = 'a-secret';
    h = await bootRelay();
  });

  afterEach(async () => {
    await teardown(h);
    delete process.env.RELAY_AUTH_SECRET;
  });

  it('refuses an empty-string token under both Zod and the auth gate', async () => {
    // Zod schema requires min(1), so the empty token surfaces as
    // `invalid_message` rather than `unauthorized`. The security property —
    // that the agent never gets registered — is what we verify.
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);

    send(ws, {
      type: 'register',
      owner: 'agent-empty-token',
      token: '',
      card: makeCard('agent-empty-token'),
    });

    const reply = await replyPromise;
    expect(reply.type).toBe('error');
    expect(['invalid_message', 'unauthorized']).toContain(reply.code);
    expect(h.relayState.getOnlineOwners()).not.toContain('agent-empty-token');
  });

  it('rejects a non-empty wrong token with code 1008', async () => {
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);
    const closePromise = waitForClose(ws);

    send(ws, {
      type: 'register',
      owner: 'agent-wrong-token',
      token: 'x',
      card: makeCard('agent-wrong-token'),
    });

    const reply = await replyPromise;
    expect(reply.type).toBe('error');
    expect(reply.code).toBe('unauthorized');

    const close = await closePromise;
    expect(close.code).toBe(1008);
    expect(h.relayState.getOnlineOwners()).not.toContain('agent-wrong-token');
  });
});

describe('register token verification (dev mode rejects empty token)', () => {
  let h: TestHarness;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RELAY_AUTH_SECRET;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h = await bootRelay();
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await teardown(h);
  });

  it('refuses an empty token even in dev mode', async () => {
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);

    send(ws, {
      type: 'register',
      owner: 'agent-dev-empty',
      token: '',
      card: makeCard('agent-dev-empty'),
    });

    const reply = await replyPromise;
    expect(reply.type).toBe('error');
    expect(['invalid_message', 'unauthorized']).toContain(reply.code);
    expect(h.relayState.getOnlineOwners()).not.toContain('agent-dev-empty');
  });
});

describe('register token verification (RELAY_AUTH_SECRET unset / dev mode)', () => {
  let h: TestHarness;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RELAY_AUTH_SECRET;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h = await bootRelay();
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await teardown(h);
  });

  it('accepts any non-empty token and warns once', async () => {
    const ws1 = connect(h);
    await waitForOpen(ws1);
    const reply1Promise = waitForMessage(ws1);
    send(ws1, {
      type: 'register',
      owner: 'agent-dev-1',
      token: 'whatever',
      card: makeCard('agent-dev-1'),
    });
    const reply1 = await reply1Promise;
    expect(reply1.type).toBe('registered');

    // Second registration on a separate connection: still accepted, but the
    // dev-mode warning should not be emitted again in the same process.
    const ws2 = connect(h);
    await waitForOpen(ws2);
    const reply2Promise = waitForMessage(ws2);
    send(ws2, {
      type: 'register',
      owner: 'agent-dev-2',
      token: 'something-else',
      card: makeCard('agent-dev-2'),
    });
    const reply2 = await reply2Promise;
    expect(reply2.type).toBe('registered');

    const warnCalls = warnSpy.mock.calls.filter((c) =>
      typeof c[0] === 'string' && (c[0] as string).includes('RELAY_AUTH_SECRET not set'),
    );
    expect(warnCalls.length).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// balance_sync ownership
// ───────────────────────────────────────────────────────────────────────────

describe('balance_sync ownership enforcement', () => {
  let h: TestHarness;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RELAY_AUTH_SECRET;
    h = await bootRelay();
  });

  afterEach(async () => {
    await teardown(h);
  });

  async function registerAgent(
    owner: string,
    agentId?: string,
  ): Promise<WebSocket> {
    bootstrapAgent(h.creditDb, owner, 100);
    if (agentId && agentId !== owner) {
      bootstrapAgent(h.creditDb, agentId, 100);
    }
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);
    send(ws, {
      type: 'register',
      owner,
      ...(agentId ? { agent_id: agentId } : {}),
      token: 'dev-token',
      card: makeCard(owner),
    });
    const reply = await replyPromise;
    expect(reply.type).toBe('registered');
    return ws;
  }

  it('returns balance for the agents own owner key', async () => {
    const ws = await registerAgent('owner-self');
    const replyPromise = waitForMessage(ws);
    send(ws, { type: 'balance_sync', agent_id: 'owner-self' });
    const reply = await replyPromise;
    expect(reply.type).toBe('balance_sync_response');
    expect(reply.agent_id).toBe('owner-self');
    expect(reply.balance).toBe(100);
  });

  it('returns balance when querying by the agents own agent_id', async () => {
    const ws = await registerAgent('owner-with-id', 'agentid-abc');
    const replyPromise = waitForMessage(ws);
    send(ws, { type: 'balance_sync', agent_id: 'agentid-abc' });
    const reply = await replyPromise;
    expect(reply.type).toBe('balance_sync_response');
    expect(reply.agent_id).toBe('agentid-abc');
    // bootstrapAgent above seeded the agentid-abc identity with 100 credits.
    expect(reply.balance).toBe(100);
  });

  it('rejects a query for another registered agents balance', async () => {
    await registerAgent('owner-victim');
    const wsAttacker = await registerAgent('owner-attacker');

    const replyPromise = waitForMessage(wsAttacker);
    send(wsAttacker, { type: 'balance_sync', agent_id: 'owner-victim' });
    const reply = await replyPromise;
    expect(reply.type).toBe('error');
    expect(reply.code).toBe('unauthorized');
    expect(reply.message).toContain('balance');
  });

  it('rejects a query from an unregistered (anonymous) connection', async () => {
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);
    send(ws, { type: 'balance_sync', agent_id: 'anyone' });
    const reply = await replyPromise;
    expect(reply.type).toBe('error');
    expect(reply.code).toBe('unauthorized');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Max payload protection
// ───────────────────────────────────────────────────────────────────────────

describe('max payload size guard', () => {
  let h: TestHarness;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RELAY_AUTH_SECRET;
    process.env.RELAY_MAX_PAYLOAD_BYTES = '4096'; // 4 KiB cap for the test
    h = await bootRelay();
  });

  afterEach(async () => {
    delete process.env.RELAY_MAX_PAYLOAD_BYTES;
    await teardown(h);
  });

  it('rejects oversized frames with code 1009 and never registers the agent', async () => {
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);
    const closePromise = waitForClose(ws);

    // Build a register message larger than 4 KiB. The card.description carries
    // the bulk so the JSON payload as a whole exceeds the cap.
    const giant = 'A'.repeat(8192);
    send(ws, {
      type: 'register',
      owner: 'agent-too-big',
      token: 'dev-token',
      card: { ...makeCard('agent-too-big'), description: giant },
    });

    const reply = await replyPromise;
    expect(reply.type).toBe('error');
    expect(reply.code).toBe('payload_too_large');

    const close = await closePromise;
    expect(close.code).toBe(1009);
    expect(h.relayState.getOnlineOwners()).not.toContain('agent-too-big');
    expect(h.relayState.getOnlineCount()).toBe(0);
  });

  it('accepts frames at or below the configured cap', async () => {
    const ws = connect(h);
    await waitForOpen(ws);
    const replyPromise = waitForMessage(ws);

    send(ws, {
      type: 'register',
      owner: 'agent-fits',
      token: 'dev-token',
      card: makeCard('agent-fits'),
    });

    const reply = await replyPromise;
    expect(reply.type).toBe('registered');
    expect(h.relayState.getOnlineOwners()).toContain('agent-fits');
  });
});
