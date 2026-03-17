import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import { openDatabase } from '../registry/store.js';
import { registerWebSocketRelay } from './websocket-relay.js';
import type Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';

/** Helpers */
function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => {
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
  });
}

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify(msg));
}

describe('WebSocket Relay', () => {
  let db: Database.Database;
  let server: ReturnType<typeof Fastify>;
  let port: number;
  let relayState: ReturnType<typeof registerWebSocketRelay>;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    db = openDatabase(':memory:');
    server = Fastify({ logger: false });
    await server.register(fastifyWebsocket);
    relayState = registerWebSocketRelay(server, db);
    await server.listen({ port: 0, host: '127.0.0.1' });
    port = (server.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const ws of clients) {
      try { ws.close(); } catch { /* ignore */ }
    }
    clients.length = 0;
    relayState.shutdown();
    await server.close();
    db.close();
  });

  function connect(): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    clients.push(ws);
    return ws;
  }

  async function registerAgent(owner: string): Promise<WebSocket> {
    const ws = connect();
    await waitForOpen(ws);
    const responsePromise = waitForMessage(ws);
    send(ws, {
      type: 'register',
      owner,
      token: 'test-token',
      card: {
        spec_version: '1.0',
        id: crypto.randomUUID(),
        owner,
        name: `${owner}'s card`,
        description: 'Test card',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
      },
    });
    const response = await responsePromise;
    expect(response.type).toBe('registered');
    return ws;
  }

  it('registers an agent and returns registered message', async () => {
    const ws = connect();
    await waitForOpen(ws);

    const responsePromise = waitForMessage(ws);
    send(ws, {
      type: 'register',
      owner: 'agent-a',
      token: 'test-token',
      card: {
        spec_version: '1.0',
        id: crypto.randomUUID(),
        owner: 'agent-a',
        name: 'Test Card',
        description: 'Test',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
      },
    });

    const response = await responsePromise;
    expect(response.type).toBe('registered');
    expect(response.agent_id).toBeDefined();
    expect(relayState.getOnlineCount()).toBe(1);
    expect(relayState.getOnlineOwners()).toContain('agent-a');
  });

  it('tracks online count and handles disconnect', async () => {
    const wsA = await registerAgent('agent-a');
    const wsB = await registerAgent('agent-b');

    expect(relayState.getOnlineCount()).toBe(2);

    // Disconnect agent-a
    wsA.close();
    // Wait a bit for close event
    await new Promise((r) => setTimeout(r, 100));

    expect(relayState.getOnlineCount()).toBe(1);
    expect(relayState.getOnlineOwners()).not.toContain('agent-a');
    expect(relayState.getOnlineOwners()).toContain('agent-b');

    wsB.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(relayState.getOnlineCount()).toBe(0);
  });

  it('relays a request from agent A to agent B and back', async () => {
    const wsA = await registerAgent('agent-a');
    const wsB = await registerAgent('agent-b');

    // Agent B listens for incoming requests
    const incomingPromise = waitForMessage(wsB);

    // Agent A sends relay request
    const requestId = crypto.randomUUID();
    const responsePromise = waitForMessage(wsA);

    send(wsA, {
      type: 'relay_request',
      id: requestId,
      target_owner: 'agent-b',
      card_id: 'some-card',
      params: { text: 'hello' },
    });

    // Agent B receives incoming request
    const incoming = await incomingPromise;
    expect(incoming.type).toBe('incoming_request');
    expect(incoming.id).toBe(requestId);
    expect(incoming.from_owner).toBe('agent-a');
    expect(incoming.card_id).toBe('some-card');
    expect((incoming.params as Record<string, unknown>).text).toBe('hello');

    // Agent B responds
    send(wsB, {
      type: 'relay_response',
      id: requestId,
      result: { audio: 'base64...' },
    });

    // Agent A receives response
    const response = await responsePromise;
    expect(response.type).toBe('response');
    expect(response.id).toBe(requestId);
    expect((response.result as Record<string, unknown>).audio).toBe('base64...');
    expect(response.error).toBeUndefined();
  });

  it('returns error when target agent is offline', async () => {
    const wsA = await registerAgent('agent-a');

    const responsePromise = waitForMessage(wsA);
    send(wsA, {
      type: 'relay_request',
      id: crypto.randomUUID(),
      target_owner: 'nonexistent-agent',
      card_id: 'some-card',
      params: {},
    });

    const response = await responsePromise;
    expect(response.type).toBe('response');
    expect(response.error).toBeDefined();
    expect((response.error as Record<string, unknown>).message).toContain('offline');
  });

  it('rejects relay requests before registration', async () => {
    const ws = connect();
    await waitForOpen(ws);

    const responsePromise = waitForMessage(ws);
    send(ws, {
      type: 'relay_request',
      id: crypto.randomUUID(),
      target_owner: 'agent-b',
      card_id: 'some-card',
      params: {},
    });

    const response = await responsePromise;
    expect(response.type).toBe('error');
    expect(response.code).toBe('not_registered');
  });

  it('rate limits excessive relay requests', async () => {
    const wsA = await registerAgent('agent-a');
    await registerAgent('agent-b');

    // Send 61 requests rapidly (limit is 60/min)
    const responses: Record<string, unknown>[] = [];
    const messageHandler = (raw: WebSocket.RawData) => {
      responses.push(JSON.parse(raw.toString()) as Record<string, unknown>);
    };
    wsA.on('message', messageHandler);

    for (let i = 0; i < 61; i++) {
      send(wsA, {
        type: 'relay_request',
        id: crypto.randomUUID(),
        target_owner: 'agent-b',
        card_id: 'some-card',
        params: { i },
      });
    }

    // Wait for all responses
    await new Promise((r) => setTimeout(r, 300));
    wsA.off('message', messageHandler);

    // At least one should be rate_limited
    const rateLimited = responses.filter((r) => r.type === 'error' && r.code === 'rate_limited');
    expect(rateLimited.length).toBeGreaterThan(0);
  });

  it('shutdown closes all connections', async () => {
    const wsA = await registerAgent('agent-a');
    const wsB = await registerAgent('agent-b');

    const closePromiseA = new Promise<void>((resolve) => wsA.on('close', resolve));
    const closePromiseB = new Promise<void>((resolve) => wsB.on('close', resolve));

    relayState.shutdown();

    await Promise.all([closePromiseA, closePromiseB]);
    expect(relayState.getOnlineCount()).toBe(0);
  });
});
