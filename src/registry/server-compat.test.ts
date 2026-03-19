import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistryServer } from './server.js';
import { openDatabase } from './store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import type Database from 'better-sqlite3';

// Module-level mock for onboarding — same pattern as server.test.ts
vi.mock('../cli/onboarding.js', () => ({
  detectApiKeys: vi.fn().mockReturnValue([]),
  buildDraftCard: vi.fn().mockReturnValue(null),
  KNOWN_API_KEYS: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
}));

/**
 * Backward compatibility tests for Hub endpoints in local-only mode.
 *
 * These tests verify that the Hub GET /me and GET /me/transactions endpoints
 * return the same shape as before the CreditLedger migration — COMPAT-03, COMPAT-04.
 *
 * Specifically:
 * 1. GET /me with creditDb returns balance via CreditLedger (direct mode)
 * 2. GET /me/transactions with creditDb returns history via CreditLedger (direct mode)
 * 3. GET /me without creditDb returns balance=0 — unchanged fallback behavior
 * 4. GET /me/transactions without creditDb returns empty items array
 */
describe('Hub compat: GET /me and /me/transactions via CreditLedger', () => {
  let registryDb: Database.Database;
  let tmpDir: string;

  const ownerName = 'compat-owner';
  const ownerApiKey = 'test-api-key-abc123';
  const authHeader = `Bearer ${ownerApiKey}`;

  beforeEach(() => {
    registryDb = openDatabase(':memory:');
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-compat-hub-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /me with creditDb returns balance from CreditLedger — same shape as before (HUB-01 compat)', async () => {
    const creditDbPath = join(tmpDir, 'credit.db');
    const creditDb = openCreditDb(creditDbPath);
    bootstrapAgent(creditDb, ownerName, 75);

    const { server } = createRegistryServer({
      registryDb,
      creditDb,
      ownerName,
      ownerApiKey,
      silent: true,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { owner: string; balance: number };
    expect(body.owner).toBe(ownerName);
    expect(body.balance).toBe(75);

    await server.close();
  });

  it('GET /me/transactions with creditDb returns history via CreditLedger — same shape as before (HUB-02 compat)', async () => {
    const creditDbPath = join(tmpDir, 'credit2.db');
    const creditDb = openCreditDb(creditDbPath);
    bootstrapAgent(creditDb, ownerName, 100);

    const { server } = createRegistryServer({
      registryDb,
      creditDb,
      ownerName,
      ownerApiKey,
      silent: true,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.limit).toBe('number');

    // Verify the transaction shape matches expected CreditTransaction schema
    const firstTx = body.items[0] as Record<string, unknown>;
    expect(firstTx).toHaveProperty('id');
    expect(firstTx).toHaveProperty('owner');
    expect(firstTx).toHaveProperty('amount');
    expect(firstTx).toHaveProperty('reason');
    expect(firstTx).toHaveProperty('created_at');
    expect(firstTx.reason).toBe('bootstrap');
    expect(firstTx.amount).toBe(100);

    await server.close();
  });

  it('GET /me without creditDb returns balance=0 — unchanged fallback behavior (HUB-03 compat)', async () => {
    // No creditDb provided — legacy/local-only config
    const { server } = createRegistryServer({
      registryDb,
      ownerName,
      ownerApiKey,
      silent: true,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { owner: string; balance: number };
    expect(body.owner).toBe(ownerName);
    expect(body.balance).toBe(0); // Zero balance fallback — no credit DB configured

    await server.close();
  });

  it('GET /me/transactions without creditDb returns empty items array (HUB-04 compat)', async () => {
    // No creditDb provided — legacy/local-only config
    const { server } = createRegistryServer({
      registryDb,
      ownerName,
      ownerApiKey,
      silent: true,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number };
    expect(body.items).toEqual([]);
    expect(body.limit).toBe(20); // default limit

    await server.close();
  });

  it('GET /me/transactions with limit param respects limit — same shape as before', async () => {
    const creditDbPath = join(tmpDir, 'credit3.db');
    const creditDb = openCreditDb(creditDbPath);
    bootstrapAgent(creditDb, ownerName, 100);

    const { server } = createRegistryServer({
      registryDb,
      creditDb,
      ownerName,
      ownerApiKey,
      silent: true,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions?limit=5',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number };
    expect(body.limit).toBe(5);
    expect(body.items.length).toBeLessThanOrEqual(5);

    await server.close();
  });
});
