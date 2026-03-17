import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EscrowReceipt } from '../types/index.js';

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
});
