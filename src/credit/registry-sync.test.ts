import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { syncCreditsFromRegistry } from './registry-sync.js';
import { openCreditDb, getBalance, getTransactions } from './ledger.js';
import type { AgentBnBConfig } from '../cli/config.js';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../identity/identity.js', () => ({
  loadOrRepairIdentity: vi.fn(() => ({
    identity: { agent_id: 'test-agent-id', public_key: 'deadbeef' },
    keys: { publicKey: Buffer.from('pub'), privateKey: Buffer.from('priv') },
    status: 'existing',
  })),
}));

vi.mock('../cli/config.js', () => ({
  getConfigDir: vi.fn(() => '/tmp/agentbnb-test'),
}));

// Shared mock ledger — tests override getBalance/getHistory per scenario
const mockLedger = {
  getBalance: vi.fn<[string], Promise<number>>(),
  getHistory: vi.fn<[string, number?], Promise<unknown[]>>(),
  hold: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  grant: vi.fn(),
  rename: vi.fn(),
};

vi.mock('./create-ledger.js', () => ({
  createLedger: vi.fn(() => mockLedger),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(override: Partial<AgentBnBConfig> = {}): AgentBnBConfig {
  return {
    owner: 'alice',
    gateway_url: 'http://localhost:7700',
    gateway_port: 7700,
    db_path: ':memory:',
    credit_db_path: ':memory:',
    token: 'test-token',
    registry: 'https://fly.agentbnb.dev',
    ...override,
  };
}

const SAMPLE_TRANSACTIONS = [
  {
    id: 'txn-1',
    owner: 'alice',
    amount: 100,
    reason: 'bootstrap' as const,
    reference_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'txn-2',
    owner: 'alice',
    amount: -10,
    reason: 'escrow_hold' as const,
    reference_id: 'card-abc',
    created_at: '2026-01-02T00:00:00.000Z',
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('syncCreditsFromRegistry', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it('returns early with error when no registry is configured', async () => {
    const config = makeConfig({ registry: undefined });
    const result = await syncCreditsFromRegistry(config, db);

    expect(result.synced).toBe(false);
    expect(result.error).toBe('no registry configured');
    const { createLedger } = await import('./create-ledger.js');
    expect(createLedger).not.toHaveBeenCalled();
  });

  it('happy path: updates local balance to remote balance', async () => {
    mockLedger.getBalance.mockResolvedValue(250);
    mockLedger.getHistory.mockResolvedValue(SAMPLE_TRANSACTIONS);

    const result = await syncCreditsFromRegistry(makeConfig(), db);

    expect(result.synced).toBe(true);
    expect(result.remoteBalance).toBe(250);
    expect(result.localWas).toBe(0); // local was empty before sync
    expect(getBalance(db, 'alice')).toBe(250);
  });

  it('happy path: inserts remote transactions into local DB', async () => {
    mockLedger.getBalance.mockResolvedValue(90);
    mockLedger.getHistory.mockResolvedValue(SAMPLE_TRANSACTIONS);

    await syncCreditsFromRegistry(makeConfig(), db);

    const txns = getTransactions(db, 'alice');
    const ids = txns.map((t) => t.id);
    expect(ids).toContain('txn-1');
    expect(ids).toContain('txn-2');
  });

  it('captures local balance before overwriting (localWas)', async () => {
    // Pre-seed local balance
    db.prepare(
      'INSERT OR REPLACE INTO credit_balances (owner, balance, updated_at) VALUES (?, ?, ?)',
    ).run('alice', 50, new Date().toISOString());

    mockLedger.getBalance.mockResolvedValue(200);
    mockLedger.getHistory.mockResolvedValue([]);

    const result = await syncCreditsFromRegistry(makeConfig(), db);

    expect(result.synced).toBe(true);
    expect(result.localWas).toBe(50);
    expect(result.remoteBalance).toBe(200);
    expect(getBalance(db, 'alice')).toBe(200);
  });

  it('network failure: returns synced=false with error message', async () => {
    mockLedger.getBalance.mockRejectedValue(new Error('ECONNREFUSED'));
    mockLedger.getHistory.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await syncCreditsFromRegistry(makeConfig(), db);

    expect(result.synced).toBe(false);
    expect(result.error).toBeTruthy();
    // Local DB should be unchanged
    expect(getBalance(db, 'alice')).toBe(0);
  });

  it('idempotency: duplicate transactions are not inserted twice', async () => {
    mockLedger.getBalance.mockResolvedValue(90);
    mockLedger.getHistory.mockResolvedValue(SAMPLE_TRANSACTIONS);

    await syncCreditsFromRegistry(makeConfig(), db);
    await syncCreditsFromRegistry(makeConfig(), db);

    const txns = getTransactions(db, 'alice');
    const ids = txns.map((t) => t.id);
    // txn-1 and txn-2 should appear exactly once
    expect(ids.filter((id) => id === 'txn-1').length).toBe(1);
    expect(ids.filter((id) => id === 'txn-2').length).toBe(1);
  });

  it('idempotency: balance is overwritten to latest remote value on second call', async () => {
    mockLedger.getBalance.mockResolvedValueOnce(100).mockResolvedValueOnce(150);
    mockLedger.getHistory.mockResolvedValue([]);

    await syncCreditsFromRegistry(makeConfig(), db);
    const result2 = await syncCreditsFromRegistry(makeConfig(), db);

    expect(result2.remoteBalance).toBe(150);
    expect(getBalance(db, 'alice')).toBe(150);
  });

  it('gracefully handles non-Error thrown values', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    mockLedger.getBalance.mockRejectedValue('string error');
    mockLedger.getHistory.mockRejectedValue('string error');

    const result = await syncCreditsFromRegistry(makeConfig(), db);

    expect(result.synced).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});
