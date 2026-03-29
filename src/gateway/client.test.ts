import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EscrowReceipt } from '../types/index.js';
import { generateKeyPair } from '../credit/signing.js';

// Mock fetch globally
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('Gateway Client - Escrow Receipt Attachment', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Helper: create a mock EscrowReceipt for testing. */
  function makeMockReceipt(overrides: Partial<EscrowReceipt> = {}): EscrowReceipt {
    return {
      requester_owner: 'test-agent',
      requester_public_key: 'deadbeef',
      amount: 10,
      card_id: randomUUID(),
      timestamp: new Date().toISOString(),
      nonce: randomUUID(),
      signature: 'mock-signature',
      ...overrides,
    };
  }

  it('requestCapability with escrowReceipt includes it in JSON-RPC params', async () => {
    const mockReceipt = makeMockReceipt();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 'test', result: { ok: true } }),
    });

    const { requestCapability } = await import('./client.js');
    const cardId = randomUUID();
    await requestCapability({
      gatewayUrl: 'http://localhost:7700',
      token: 'test-token',
      cardId,
      params: { requester: 'test-agent' },
      escrowReceipt: mockReceipt,
    });

    // Verify fetch was called with escrow_receipt in params
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchOpts] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(fetchOpts.body) as {
      params: Record<string, unknown>;
    };
    expect(payload.params.escrow_receipt).toEqual(mockReceipt);
    expect(payload.params.card_id).toBe(cardId);
    expect(payload.params.requester).toBe('test-agent');
  });

  it('requestCapability without escrowReceipt sends no receipt (backward compat)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 'test', result: { ok: true } }),
    });

    const { requestCapability } = await import('./client.js');
    await requestCapability({
      gatewayUrl: 'http://localhost:7700',
      token: 'test-token',
      cardId: randomUUID(),
      params: { requester: 'test-agent' },
    });

    // Verify fetch was called WITHOUT escrow_receipt
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchOpts] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(fetchOpts.body) as {
      params: Record<string, unknown>;
    };
    expect(payload.params.escrow_receipt).toBeUndefined();
  });

  it('requestCapability sends signed identity headers and bearer token together', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 'test', result: { ok: true } }),
    });

    const keys = generateKeyPair();
    const publicKeyHex = keys.publicKey.toString('hex');
    const { requestCapability } = await import('./client.js');

    await requestCapability({
      gatewayUrl: 'http://localhost:7700',
      token: 'fallback-token',
      cardId: randomUUID(),
      identity: {
        agentId: 'agent-identity-123',
        publicKey: publicKeyHex,
        privateKey: keys.privateKey,
      },
    });

    const [, fetchOpts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(fetchOpts.headers['Authorization']).toBe('Bearer fallback-token');
    expect(fetchOpts.headers['X-Agent-Id']).toBe('agent-identity-123');
    expect(fetchOpts.headers['X-Agent-Public-Key']).toBe(publicKeyHex);
    expect(fetchOpts.headers['X-Agent-Signature']).toBeDefined();
  });

  it('requestCapabilityBatch sends signed identity headers and bearer token together', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { jsonrpc: '2.0', id: 'r1', result: { ok: true } },
        { jsonrpc: '2.0', id: 'r2', result: { ok: true } },
      ]),
    });

    const keys = generateKeyPair();
    const publicKeyHex = keys.publicKey.toString('hex');
    const { requestCapabilityBatch } = await import('./client.js');

    await requestCapabilityBatch(
      'http://localhost:7700',
      'fallback-token',
      [
        { id: 'r1', cardId: randomUUID(), params: { requester: 'test-agent' } },
        { id: 'r2', cardId: randomUUID(), params: { requester: 'test-agent' } },
      ],
      {
        identity: {
          agentId: 'agent-identity-123',
          publicKey: publicKeyHex,
          privateKey: keys.privateKey,
        },
      },
    );

    const [, fetchOpts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(fetchOpts.headers['Authorization']).toBe('Bearer fallback-token');
    expect(fetchOpts.headers['X-Agent-Id']).toBe('agent-identity-123');
    expect(fetchOpts.headers['X-Agent-Public-Key']).toBe(publicKeyHex);
    expect(fetchOpts.headers['X-Agent-Signature']).toBeDefined();
  });

  it('deriveRequestTimeoutMs uses expected_duration_ms with multiplier and grace', async () => {
    const { deriveRequestTimeoutMs } = await import('./client.js');
    const timeout = deriveRequestTimeoutMs({
      expected_duration_ms: 20_000,
      hard_timeout_ms: 10_000,
    });
    expect(timeout).toBe(60_000);
  });

  it('deriveRequestTimeoutMs falls back to hard_timeout_ms when expected_duration_ms is missing', async () => {
    const { deriveRequestTimeoutMs } = await import('./client.js');
    const timeout = deriveRequestTimeoutMs({
      hard_timeout_ms: 45_000,
    });
    expect(timeout).toBe(75_000);
  });

  it('requestViaRelay uses metadata-derived timeout by default and preserves explicit override', async () => {
    const relayRequestMock = vi.fn().mockResolvedValue({ ok: true });
    const relay = {
      request: relayRequestMock,
    } as unknown as import('../relay/websocket-client.js').RelayClient;

    const { requestViaRelay } = await import('./client.js');

    await requestViaRelay(relay, {
      targetOwner: 'target-agent',
      targetAgentId: 'target-agent-id',
      cardId: randomUUID(),
      timeoutHint: { expected_duration_ms: 10_000 },
    });
    expect(relayRequestMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      targetAgentId: 'target-agent-id',
      timeoutMs: 45_000,
    }));

    await requestViaRelay(relay, {
      targetOwner: 'target-agent',
      cardId: randomUUID(),
      timeoutHint: { expected_duration_ms: 10_000 },
      timeoutMs: 9_999,
    });
    expect(relayRequestMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      timeoutMs: 9_999,
    }));
  });
});
