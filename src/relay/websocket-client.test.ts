import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { RelayClient } from './websocket-client.js';

/** Mock server return type */
interface MockServer {
  wss: WebSocketServer;
  port: number;
  received: Record<string, unknown>[];
  clients: Set<WebSocket>;
  sendToAll: (msg: Record<string, unknown>) => void;
  close: () => Promise<void>;
}

/** Minimal mock relay server that registers clients and tracks messages */
async function createMockServer(): Promise<MockServer> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });

  // Wait for the server to start listening
  await new Promise<void>((resolve) => wss.on('listening', resolve));

  const port = (wss.address() as AddressInfo).port;
  const received: Record<string, unknown>[] = [];
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(msg);

      // Auto-respond to register messages with a registered ACK
      if (msg.type === 'register') {
        ws.send(JSON.stringify({
          type: 'registered',
          agent_id: 'mock-agent-id',
        }));
      }
    });
  });

  return {
    wss,
    port,
    received,
    clients,
    sendToAll: (msg) => {
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      }
    },
    close: () => new Promise<void>((resolve) => {
      for (const ws of clients) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wss.close(() => resolve());
    }),
  };
}

function makeClientOpts(port: number, overrides?: Partial<import('./websocket-client.js').RelayClientOptions>) {
  return {
    registryUrl: `ws://127.0.0.1:${port}/ws`,
    owner: 'test-owner',
    token: 'test-token',
    card: {
      spec_version: '1.0',
      id: 'test-card',
      owner: 'test-owner',
      name: 'Test',
      description: 'Test card',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 1 },
      availability: { online: true },
    },
    onRequest: async () => ({ result: { ok: true } }),
    silent: true,
    ...overrides,
  };
}

describe('RelayClient (websocket-client)', () => {
  const servers: MockServer[] = [];
  const clients: RelayClient[] = [];

  afterEach(async () => {
    // Disconnect all clients first (suppress errors for already-closed)
    await Promise.all(clients.map((c) => c.disconnect().catch(() => {})));
    clients.length = 0;

    // Close all servers
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
  });

  it('connects and registers', async () => {
    const server = await createMockServer();
    servers.push(server);

    const client = new RelayClient(makeClientOpts(server.port));
    clients.push(client);

    await client.connect();

    expect(client.isConnected).toBe(true);
    // Server should have received the register message
    const registerMsg = server.received.find((m) => m.type === 'register');
    expect(registerMsg).toBeDefined();
    expect(registerMsg?.owner).toBe('test-owner');
  });

  it('disconnect closes cleanly', async () => {
    const server = await createMockServer();
    servers.push(server);

    const client = new RelayClient(makeClientOpts(server.port));
    clients.push(client);

    await client.connect();
    expect(client.isConnected).toBe(true);

    await client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it('jitter applied to backoff', async () => {
    const server = await createMockServer();
    servers.push(server);

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const client = new RelayClient(makeClientOpts(server.port));
    clients.push(client);

    await client.connect();

    // Close server-side connection to trigger reconnect
    for (const ws of server.clients) {
      ws.close();
    }

    // Wait for close event to propagate and reconnect to be scheduled
    await new Promise((r) => setTimeout(r, 200));

    // Find the setTimeout call for reconnect — should be between 1000 and 1300 (base * 1.0-1.3)
    const reconnectCall = setTimeoutSpy.mock.calls.find(([_fn, delay]) => {
      return typeof delay === 'number' && delay >= 1000 && delay <= 1300;
    });

    expect(reconnectCall).toBeDefined();
    const delay = reconnectCall![1] as number;
    // Delay should be between base (1000) and base * 1.3 (1300)
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1300);

    setTimeoutSpy.mockRestore();

    // Force intentional close to stop reconnect loop
    await client.disconnect();
  });

  it('graceful drain waits for pending', async () => {
    const server = await createMockServer();
    servers.push(server);

    const client = new RelayClient(makeClientOpts(server.port));
    clients.push(client);

    await client.connect();

    // Start a relay request that we will resolve before drain timeout
    let requestResolved = false;
    const requestPromise = client.request({
      targetOwner: 'other-agent',
      cardId: 'some-card',
      params: {},
      timeoutMs: 10_000,
    }).then(() => { requestResolved = true; })
      .catch(() => { /* expected */ });

    // Find the relay_request in server received and get the id
    await new Promise((r) => setTimeout(r, 50));
    const relayReq = server.received.find((m) => m.type === 'relay_request');
    expect(relayReq).toBeDefined();

    // Start graceful drain with 2000ms timeout
    const disconnectPromise = client.disconnect(2000);

    // Simulate the server responding before drain timeout
    await new Promise((r) => setTimeout(r, 50));
    server.sendToAll({
      type: 'response',
      id: relayReq!.id,
      result: { data: 'ok' },
    });

    await requestPromise;
    await disconnectPromise;

    // The request should have resolved, not been force-rejected
    expect(requestResolved).toBe(true);
  });

  it('graceful drain force-rejects after timeout', async () => {
    const server = await createMockServer();
    servers.push(server);

    const client = new RelayClient(makeClientOpts(server.port));
    clients.push(client);

    await client.connect();

    // Start a relay request that will never get a response
    let requestRejected = false;
    let rejectionError: Error | null = null;
    const requestPromise = client.request({
      targetOwner: 'other-agent',
      cardId: 'some-card',
      params: {},
      timeoutMs: 60_000, // long timeout so only drain kills it
    }).catch((err: Error) => {
      requestRejected = true;
      rejectionError = err;
    });

    await new Promise((r) => setTimeout(r, 50));

    // Call disconnect with short drain timeout
    const start = Date.now();
    await client.disconnect(100);
    const elapsed = Date.now() - start;

    await requestPromise;

    expect(requestRejected).toBe(true);
    expect(rejectionError?.message).toBe('Client disconnected');
    // Should have waited roughly 100ms (allow some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(500);
  });

  it('state events fire in order', async () => {
    const server = await createMockServer();
    servers.push(server);

    const states: string[] = [];
    const client = new RelayClient(makeClientOpts(server.port, {
      onStateChange: (state) => states.push(state),
    }));
    clients.push(client);

    await client.connect();
    await client.disconnect();

    expect(states).toEqual(['connecting', 'connected', 'disconnected']);
  });

  it('reconnects on unexpected close', async () => {
    const server = await createMockServer();
    servers.push(server);

    const states: string[] = [];
    const client = new RelayClient(makeClientOpts(server.port, {
      onStateChange: (state) => states.push(state),
    }));
    clients.push(client);

    await client.connect();
    expect(client.isConnected).toBe(true);

    // Close server-side connection unexpectedly
    for (const ws of server.clients) {
      ws.close();
    }

    // Wait for reconnect to be scheduled and attempted
    // Base delay is 1000ms + up to 30% jitter = max ~1300ms
    await new Promise((r) => setTimeout(r, 2000));

    // Client should have reconnected
    expect(client.isConnected).toBe(true);

    // State changes should include reconnecting
    expect(states).toContain('reconnecting');

    await client.disconnect();
  });
});
