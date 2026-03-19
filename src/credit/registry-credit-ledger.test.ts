import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { openCreditDb } from './ledger.js';
import { RegistryCreditLedger } from './registry-credit-ledger.js';
import type { CreditLedger } from './credit-ledger.js';
import { AgentBnBError } from '../types/index.js';
import Database from 'better-sqlite3';

// ─── Direct DB Mode Tests ────────────────────────────────────────────────────

describe('RegistryCreditLedger (direct DB mode)', () => {
  let db: Database.Database;
  let ledger: CreditLedger;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    ledger = new RegistryCreditLedger({ mode: 'direct', db });
  });

  describe('grant()', () => {
    it('grants initial credits to a new agent', async () => {
      await ledger.grant('agent-alice', 100);
      const balance = await ledger.getBalance('agent-alice');
      expect(balance).toBe(100);
    });

    it('uses default amount of 100 if not specified', async () => {
      await ledger.grant('agent-default');
      const balance = await ledger.getBalance('agent-default');
      expect(balance).toBe(100);
    });

    it('is idempotent — calling twice does not double the balance', async () => {
      await ledger.grant('agent-bob', 50);
      await ledger.grant('agent-bob', 50);
      const balance = await ledger.getBalance('agent-bob');
      expect(balance).toBe(50);
    });
  });

  describe('getBalance()', () => {
    it('returns 0 for an unknown agent', async () => {
      const balance = await ledger.getBalance('agent-unknown');
      expect(balance).toBe(0);
    });

    it('returns current balance after grant', async () => {
      await ledger.grant('agent-charlie', 200);
      const balance = await ledger.getBalance('agent-charlie');
      expect(balance).toBe(200);
    });
  });

  describe('hold()', () => {
    it('deducts credits and returns an escrowId', async () => {
      await ledger.grant('agent-dave', 100);
      const result = await ledger.hold('agent-dave', 30, 'card-123');
      expect(result.escrowId).toBeDefined();
      expect(typeof result.escrowId).toBe('string');
      const balance = await ledger.getBalance('agent-dave');
      expect(balance).toBe(70);
    });

    it('throws INSUFFICIENT_CREDITS when balance is too low', async () => {
      await ledger.grant('agent-eve', 10);
      await expect(ledger.hold('agent-eve', 50, 'card-abc')).rejects.toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
      });
    });

    it('throws INSUFFICIENT_CREDITS for agent with zero balance', async () => {
      await expect(ledger.hold('agent-new', 1, 'card-xyz')).rejects.toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
      });
    });
  });

  describe('settle()', () => {
    it('transfers held credits to recipient', async () => {
      await ledger.grant('agent-frank', 100);
      const { escrowId } = await ledger.hold('agent-frank', 40, 'card-999');
      await ledger.settle(escrowId, 'agent-grace');
      const graceBal = await ledger.getBalance('agent-grace');
      expect(graceBal).toBe(40);
    });

    it('throws ESCROW_NOT_FOUND for unknown escrowId', async () => {
      await expect(ledger.settle('nonexistent-escrow', 'agent-someone')).rejects.toMatchObject({
        code: 'ESCROW_NOT_FOUND',
      });
    });

    it('throws ESCROW_ALREADY_SETTLED if escrow was already settled', async () => {
      await ledger.grant('agent-harry', 100);
      const { escrowId } = await ledger.hold('agent-harry', 20, 'card-dup');
      await ledger.settle(escrowId, 'agent-ivy');
      await expect(ledger.settle(escrowId, 'agent-ivy')).rejects.toMatchObject({
        code: 'ESCROW_ALREADY_SETTLED',
      });
    });
  });

  describe('release()', () => {
    it('refunds held credits back to original owner', async () => {
      await ledger.grant('agent-jack', 100);
      const { escrowId } = await ledger.hold('agent-jack', 35, 'card-refund');
      await ledger.release(escrowId);
      const balance = await ledger.getBalance('agent-jack');
      expect(balance).toBe(100);
    });

    it('throws ESCROW_NOT_FOUND for unknown escrowId', async () => {
      await expect(ledger.release('nonexistent-escrow')).rejects.toMatchObject({
        code: 'ESCROW_NOT_FOUND',
      });
    });

    it('throws ESCROW_ALREADY_SETTLED if escrow was already released', async () => {
      await ledger.grant('agent-kate', 100);
      const { escrowId } = await ledger.hold('agent-kate', 25, 'card-double-release');
      await ledger.release(escrowId);
      await expect(ledger.release(escrowId)).rejects.toMatchObject({
        code: 'ESCROW_ALREADY_SETTLED',
      });
    });
  });

  describe('getHistory()', () => {
    it('returns empty array for agent with no transactions', async () => {
      const history = await ledger.getHistory('agent-nobody');
      expect(history).toEqual([]);
    });

    it('returns transactions newest first', async () => {
      await ledger.grant('agent-liam', 100);
      await ledger.hold('agent-liam', 10, 'card-hist');
      const history = await ledger.getHistory('agent-liam');
      expect(history.length).toBeGreaterThanOrEqual(2);
      const reasons = history.map((t) => t.reason);
      expect(reasons[0]).toBe('escrow_hold');
      expect(reasons[reasons.length - 1]).toBe('bootstrap');
    });

    it('respects limit parameter', async () => {
      await ledger.grant('agent-mia', 100);
      await ledger.hold('agent-mia', 5, 'card-1');
      await ledger.hold('agent-mia', 5, 'card-2');
      const history = await ledger.getHistory('agent-mia', 2);
      expect(history.length).toBeLessThanOrEqual(2);
    });
  });
});

// ─── HTTP Client Mode Tests ───────────────────────────────────────────────────

describe('RegistryCreditLedger (HTTP client mode)', () => {
  const REGISTRY_URL = 'https://registry.agentbnb.dev';
  const OWNER_PUBLIC_KEY = 'pk-test-abc123';
  let ledger: RegistryCreditLedger;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    ledger = new RegistryCreditLedger({
      mode: 'http',
      registryUrl: REGISTRY_URL,
      ownerPublicKey: OWNER_PUBLIC_KEY,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to create a mock Response with JSON body
   */
  function mockResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  describe('hold()', () => {
    it('sends POST to /api/credits/hold with correct body and headers', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ escrowId: 'escrow-xyz' }));

      const result = await ledger.hold('agent-alice', 30, 'card-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${REGISTRY_URL}/api/credits/hold`);
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({ owner: 'agent-alice', amount: 30, cardId: 'card-123' });
      expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect((opts.headers as Record<string, string>)['X-Agent-Owner']).toBe('agent-alice');
      expect((opts.headers as Record<string, string>)['X-Agent-PublicKey']).toBe(OWNER_PUBLIC_KEY);
      expect(result).toEqual({ escrowId: 'escrow-xyz' });
    });
  });

  describe('settle()', () => {
    it('sends POST to /api/credits/settle with correct body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}));

      await ledger.settle('escrow-abc', 'agent-provider');

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${REGISTRY_URL}/api/credits/settle`);
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({ escrowId: 'escrow-abc', recipientOwner: 'agent-provider' });
    });
  });

  describe('release()', () => {
    it('sends POST to /api/credits/release with correct body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}));

      await ledger.release('escrow-def');

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${REGISTRY_URL}/api/credits/release`);
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({ escrowId: 'escrow-def' });
    });
  });

  describe('getBalance()', () => {
    it('sends GET to /api/credits/:owner and returns balance', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ balance: 250 }));

      const balance = await ledger.getBalance('agent-bob');

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${REGISTRY_URL}/api/credits/agent-bob`);
      expect(opts.method).toBe('GET');
      expect(balance).toBe(250);
    });
  });

  describe('getHistory()', () => {
    it('sends GET to /api/credits/:owner/history with limit param', async () => {
      const transactions = [
        { id: 'tx-1', owner: 'agent-carol', amount: 100, reason: 'bootstrap', reference_id: null, created_at: '2026-01-01T00:00:00Z' },
      ];
      mockFetch.mockResolvedValueOnce(mockResponse({ transactions }));

      const result = await ledger.getHistory('agent-carol', 50);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${REGISTRY_URL}/api/credits/agent-carol/history?limit=50`);
      expect(opts.method).toBe('GET');
      expect(result).toEqual(transactions);
    });

    it('defaults to limit=100 when not specified', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ transactions: [] }));

      await ledger.getHistory('agent-carol');

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${REGISTRY_URL}/api/credits/agent-carol/history?limit=100`);
    });
  });

  describe('grant()', () => {
    it('sends POST to /api/credits/grant with correct body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}));

      await ledger.grant('agent-dave', 50);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${REGISTRY_URL}/api/credits/grant`);
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({ owner: 'agent-dave', amount: 50 });
    });

    it('sends default amount of 100 when not specified', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}));

      await ledger.grant('agent-eve');

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({ owner: 'agent-eve', amount: 100 });
    });
  });

  describe('HTTP error handling', () => {
    it('throws AgentBnBError on non-2xx response with code from body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 400),
      );

      await expect(ledger.hold('agent-broke', 999, 'card-exp')).rejects.toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
      });
    });

    it('throws AgentBnBError with REGISTRY_ERROR code when body has no code', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: 'Internal server error' }, 500),
      );

      await expect(ledger.getBalance('agent-x')).rejects.toMatchObject({
        code: 'REGISTRY_ERROR',
      });
    });

    it('throws AgentBnBError with REGISTRY_UNREACHABLE code when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(ledger.getBalance('agent-offline')).rejects.toMatchObject({
        code: 'REGISTRY_UNREACHABLE',
      });
    });
  });

  describe('request headers', () => {
    it('includes X-Agent-Owner and X-Agent-PublicKey on GET requests', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ balance: 0 }));

      await ledger.getBalance('agent-auth-test');

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Agent-Owner']).toBe('agent-auth-test');
      expect(headers['X-Agent-PublicKey']).toBe(OWNER_PUBLIC_KEY);
    });
  });
});
