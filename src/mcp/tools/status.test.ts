import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServerContext } from '../server.js';

function createMockContext(): McpServerContext {
  return {
    configDir: '/tmp/agentbnb-mcp-test',
    config: {
      owner: 'test-agent',
      gateway_url: 'http://localhost:7700',
      gateway_port: 7700,
      db_path: ':memory:',
      credit_db_path: ':memory:',
      token: 'test-token',
      registry: 'http://registry.local',
    },
    identity: {
      agent_id: 'agent-id-123',
      owner: 'test-agent',
      public_key: 'ab'.repeat(44),
      created_at: new Date().toISOString(),
    },
  };
}

describe('MCP status tool', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns balance and identity info without registry', async () => {
    vi.doMock('../../credit/ledger.js', () => ({
      openCreditDb: () => ({ close: () => undefined }),
      getBalanceSnapshot: () => ({ balance: 42, updated_at: '2026-01-01T00:00:00Z' }),
    }));

    vi.doMock('../../credit/create-ledger.js', () => ({
      createLedger: vi.fn(),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: vi.fn(),
    }));

    const { handleStatus } = await import('./status.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    const response = await handleStatus(ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.agent_id).toBe('agent-id-123');
    expect(parsed.owner).toBe('test-agent');
    expect(parsed.public_key).toBe('ab'.repeat(44));
    expect(parsed.balance).toBe(42);
    expect(parsed.local_balance).toBe(42);
    expect(parsed.local_balance_updated_at).toBe('2026-01-01T00:00:00Z');
    expect(parsed.registry_url).toBeNull();
    // Registry-specific fields should NOT be present without registry
    expect(parsed.registry_balance).toBeUndefined();
    expect(parsed.sync_needed).toBeUndefined();
  });

  it('returns both local and registry balances when registry is configured', async () => {
    vi.doMock('../../credit/ledger.js', () => ({
      openCreditDb: () => ({ close: () => undefined }),
      getBalanceSnapshot: () => ({ balance: 50, updated_at: '2026-01-01T00:00:00Z' }),
    }));

    vi.doMock('../../credit/create-ledger.js', () => ({
      createLedger: () => ({
        getBalance: vi.fn().mockResolvedValue(50),
      }),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: () => ({
        privateKey: Buffer.from('11'.repeat(48), 'hex'),
        publicKey: Buffer.from('22'.repeat(44), 'hex'),
      }),
    }));

    const { handleStatus } = await import('./status.js');
    const ctx = createMockContext();

    const response = await handleStatus(ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.balance).toBe(50);
    expect(parsed.local_balance).toBe(50);
    expect(parsed.registry_balance).toBe(50);
    expect(parsed.sync_needed).toBe(false);
    expect(parsed.registry_error).toBeNull();
    expect(parsed.balance_warning).toBeNull();
    expect(parsed.registry_url).toBe('http://registry.local');
  });

  it('detects sync_needed when local and registry balances diverge', async () => {
    vi.doMock('../../credit/ledger.js', () => ({
      openCreditDb: () => ({ close: () => undefined }),
      getBalanceSnapshot: () => ({ balance: 30, updated_at: '2026-01-01T00:00:00Z' }),
    }));

    vi.doMock('../../credit/create-ledger.js', () => ({
      createLedger: () => ({
        getBalance: vi.fn().mockResolvedValue(50),
      }),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: () => ({
        privateKey: Buffer.from('11'.repeat(48), 'hex'),
        publicKey: Buffer.from('22'.repeat(44), 'hex'),
      }),
    }));

    const { handleStatus } = await import('./status.js');
    const ctx = createMockContext();

    const response = await handleStatus(ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.balance).toBe(50);
    expect(parsed.local_balance).toBe(30);
    expect(parsed.registry_balance).toBe(50);
    expect(parsed.sync_needed).toBe(true);
    expect(parsed.balance_warning).toContain('stale');
    expect(parsed.balance_warning).toContain('20');
  });

  it('falls back to local balance when registry fetch fails', async () => {
    vi.doMock('../../credit/ledger.js', () => ({
      openCreditDb: () => ({ close: () => undefined }),
      getBalanceSnapshot: () => ({ balance: 100, updated_at: '2026-01-01T00:00:00Z' }),
    }));

    vi.doMock('../../credit/create-ledger.js', () => ({
      createLedger: () => ({
        getBalance: vi.fn().mockRejectedValue(new Error('Registry unreachable')),
      }),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: () => ({
        privateKey: Buffer.from('11'.repeat(48), 'hex'),
        publicKey: Buffer.from('22'.repeat(44), 'hex'),
      }),
    }));

    const { handleStatus } = await import('./status.js');
    const ctx = createMockContext();

    const response = await handleStatus(ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.balance).toBe(100);
    expect(parsed.registry_balance).toBeNull();
    expect(parsed.registry_error).toContain('Registry unreachable');
    expect(parsed.balance_warning).toContain('local balance');
    expect(parsed.balance_warning).toContain('stale');
  });

  it('handles missing credit db gracefully (fresh install)', async () => {
    vi.doMock('../../credit/ledger.js', () => ({
      openCreditDb: () => ({ close: () => undefined }),
      getBalanceSnapshot: () => { throw new Error('no such table'); },
    }));

    vi.doMock('../../credit/create-ledger.js', () => ({
      createLedger: vi.fn(),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: vi.fn(),
    }));

    const { handleStatus } = await import('./status.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    const response = await handleStatus(ctx);
    const parsed = JSON.parse(response.content[0].text);

    // readLocalBalanceSnapshot catches errors and returns { balance: 0, updated_at: null }
    expect(parsed.balance).toBe(0);
    expect(parsed.local_balance).toBe(0);
    expect(parsed.local_balance_updated_at).toBeNull();
  });

  it('uses agent_id as credit key when available', async () => {
    const getBalanceSnapshotMock = vi.fn().mockReturnValue({ balance: 75, updated_at: '2026-01-01T00:00:00Z' });

    vi.doMock('../../credit/ledger.js', () => ({
      openCreditDb: () => ({ close: () => undefined }),
      getBalanceSnapshot: getBalanceSnapshotMock,
    }));

    vi.doMock('../../credit/create-ledger.js', () => ({
      createLedger: vi.fn(),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: vi.fn(),
    }));

    const { handleStatus } = await import('./status.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    await handleStatus(ctx);

    expect(getBalanceSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      'agent-id-123',
    );
  });

  it('falls back to owner when agent_id is missing', async () => {
    const getBalanceSnapshotMock = vi.fn().mockReturnValue({ balance: 75, updated_at: '2026-01-01T00:00:00Z' });

    vi.doMock('../../credit/ledger.js', () => ({
      openCreditDb: () => ({ close: () => undefined }),
      getBalanceSnapshot: getBalanceSnapshotMock,
    }));

    vi.doMock('../../credit/create-ledger.js', () => ({
      createLedger: vi.fn(),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: vi.fn(),
    }));

    const { handleStatus } = await import('./status.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;
    ctx.identity.agent_id = undefined as unknown as string;

    await handleStatus(ctx);

    expect(getBalanceSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      'test-agent',
    );
  });

  it('returns config_dir in the response', async () => {
    vi.doMock('../../credit/ledger.js', () => ({
      openCreditDb: () => ({ close: () => undefined }),
      getBalanceSnapshot: () => ({ balance: 0, updated_at: null }),
    }));

    vi.doMock('../../credit/create-ledger.js', () => ({
      createLedger: vi.fn(),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: vi.fn(),
    }));

    const { handleStatus } = await import('./status.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    const response = await handleStatus(ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.config_dir).toBe('/tmp/agentbnb-mcp-test');
  });
});
