/**
 * Tests for bootstrap.ts — activate() and deactivate() lifecycle entry points.
 *
 * These tests verify the contract described in the plan:
 * - activate() initializes AgentRuntime, publishes a card from SOUL.md, starts the gateway, starts IdleMonitor
 * - deactivate() stops IdleMonitor cron, closes the gateway, and shuts down AgentRuntime
 * - activate() throws if SOUL.md does not exist
 * - deactivate() is idempotent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock all src/ dependencies so tests run without real DBs or ports ---
// Note: vi.mock factories are hoisted — do NOT reference module-level variables inside them.

vi.mock('../../src/runtime/agent-runtime.js', () => {
  const mockRuntime = {
    registryDb: {},
    creditDb: {},
    owner: 'test-owner',
    jobs: [],
    start: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    registerJob: vi.fn(),
    isDraining: false,
  };
  return {
    AgentRuntime: vi.fn().mockImplementation(() => mockRuntime),
  };
});

vi.mock('../../src/openclaw/soul-sync.js', () => ({
  publishFromSoulV2: vi.fn().mockReturnValue({
    spec_version: '2.0',
    id: 'card-uuid',
    owner: 'test-owner',
    agent_name: 'TestAgent',
    skills: [
      {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        level: 2,
        inputs: [{ name: 'input', type: 'text', required: true }],
        outputs: [{ name: 'output', type: 'text', required: true }],
        pricing: { credits_per_call: 10 },
        availability: { online: true },
      },
    ],
    availability: { online: true },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }),
}));

vi.mock('../../src/gateway/server.js', () => {
  const mockGateway = {
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    createGatewayServer: vi.fn().mockReturnValue(mockGateway),
  };
});

vi.mock('../../src/autonomy/idle-monitor.js', () => {
  const mockCronJob = { stop: vi.fn() };
  const mockIdleMonitor = {
    start: vi.fn().mockReturnValue(mockCronJob),
    getJob: vi.fn().mockReturnValue(mockCronJob),
    poll: vi.fn().mockResolvedValue(undefined),
  };
  return {
    IdleMonitor: vi.fn().mockImplementation(() => mockIdleMonitor),
  };
});

vi.mock('../../src/autonomy/tiers.js', () => ({
  DEFAULT_AUTONOMY_CONFIG: { tier1_max_credits: 0, tier2_max_credits: 0 },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('## Test Skill\nA test skill'),
}));

import { activate, deactivate } from './bootstrap.js';
import type { BootstrapConfig, BootstrapContext } from './bootstrap.js';
import { existsSync, readFileSync } from 'node:fs';
import { AgentRuntime } from '../../src/runtime/agent-runtime.js';
import { publishFromSoulV2 } from '../../src/openclaw/soul-sync.js';
import { createGatewayServer } from '../../src/gateway/server.js';
import { IdleMonitor } from '../../src/autonomy/idle-monitor.js';

const VALID_CONFIG: BootstrapConfig = {
  owner: 'test-owner',
  soulMdPath: '/fake/SOUL.md',
};

// Helpers to access the mocked instances after activation
function getRuntimeInstance() {
  return (AgentRuntime as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
    start: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
    registerJob: ReturnType<typeof vi.fn>;
    registryDb: unknown;
    creditDb: unknown;
  };
}

function getGatewayInstance() {
  return (createGatewayServer as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

function getIdleMonitorInstance() {
  return (IdleMonitor as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
    start: ReturnType<typeof vi.fn>;
  };
}

describe('activate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      '## Test Skill\nA test skill',
    );
    // Re-setup mock implementations after clearAllMocks
    (AgentRuntime as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      registryDb: { id: 'reg-db' },
      creditDb: { id: 'cred-db' },
      owner: 'test-owner',
      jobs: [],
      start: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      registerJob: vi.fn(),
      isDraining: false,
    }));
    const mockCronJob = { stop: vi.fn() };
    (IdleMonitor as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      start: vi.fn().mockReturnValue(mockCronJob),
      getJob: vi.fn().mockReturnValue(mockCronJob),
      poll: vi.fn().mockResolvedValue(undefined),
    }));
    (createGatewayServer as ReturnType<typeof vi.fn>).mockReturnValue({
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('returns a BootstrapContext with runtime, gateway, idleMonitor, and card', async () => {
    const ctx = await activate(VALID_CONFIG);
    expect(ctx).toHaveProperty('runtime');
    expect(ctx).toHaveProperty('gateway');
    expect(ctx).toHaveProperty('idleMonitor');
    expect(ctx).toHaveProperty('card');
  });

  it('constructs AgentRuntime with correct options', async () => {
    await activate({ ...VALID_CONFIG, registryDbPath: '/reg.db', creditDbPath: '/cred.db' });
    expect(AgentRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        registryDbPath: '/reg.db',
        creditDbPath: '/cred.db',
      }),
    );
  });

  it('calls runtime.start() to recover orphaned escrows', async () => {
    await activate(VALID_CONFIG);
    const runtime = getRuntimeInstance();
    expect(runtime.start).toHaveBeenCalledOnce();
  });

  it('reads SOUL.md from the configured soulMdPath', async () => {
    await activate(VALID_CONFIG);
    expect(existsSync).toHaveBeenCalledWith('/fake/SOUL.md');
    expect(readFileSync).toHaveBeenCalledWith('/fake/SOUL.md', 'utf8');
  });

  it('calls publishFromSoulV2 with registry DB, soul content, and owner', async () => {
    await activate(VALID_CONFIG);
    const runtime = getRuntimeInstance();
    expect(publishFromSoulV2).toHaveBeenCalledWith(
      runtime.registryDb,
      '## Test Skill\nA test skill',
      'test-owner',
    );
  });

  it('calls createGatewayServer with correct options', async () => {
    await activate({ ...VALID_CONFIG, gatewayPort: 8800, gatewayToken: 'tok123' });
    const runtime = getRuntimeInstance();
    expect(createGatewayServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 8800,
        tokens: ['tok123'],
        registryDb: runtime.registryDb,
        creditDb: runtime.creditDb,
      }),
    );
  });

  it('calls gateway.listen() on the correct port', async () => {
    await activate({ ...VALID_CONFIG, gatewayPort: 7700 });
    const gateway = getGatewayInstance();
    expect(gateway.listen).toHaveBeenCalledWith(
      expect.objectContaining({ port: 7700 }),
    );
  });

  it('creates IdleMonitor and calls start()', async () => {
    await activate(VALID_CONFIG);
    const runtime = getRuntimeInstance();
    expect(IdleMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'test-owner', db: runtime.registryDb }),
    );
    const idleMonitor = getIdleMonitorInstance();
    expect(idleMonitor.start).toHaveBeenCalledOnce();
  });

  it('registers the idle cron job with runtime', async () => {
    await activate(VALID_CONFIG);
    const runtime = getRuntimeInstance();
    expect(runtime.registerJob).toHaveBeenCalledOnce();
  });

  it('throws AgentBnBError with code FILE_NOT_FOUND if SOUL.md is missing', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await expect(activate(VALID_CONFIG)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
});

describe('deactivate()', () => {
  let ctx: BootstrapContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      '## Test Skill\nA test skill',
    );
    const mockCronJob = { stop: vi.fn() };
    (AgentRuntime as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      registryDb: { id: 'reg-db' },
      creditDb: { id: 'cred-db' },
      owner: 'test-owner',
      jobs: [],
      start: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      registerJob: vi.fn(),
      isDraining: false,
    }));
    (IdleMonitor as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      start: vi.fn().mockReturnValue(mockCronJob),
    }));
    (createGatewayServer as ReturnType<typeof vi.fn>).mockReturnValue({
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    ctx = await activate(VALID_CONFIG);
    // Reset call counts after setup — only measure deactivate calls
    vi.clearAllMocks();
    // Re-add shutdown/close mocks since clearAllMocks wipes them
    ctx.runtime.shutdown = vi.fn().mockResolvedValue(undefined);
    (ctx.gateway as unknown as { close: ReturnType<typeof vi.fn> }).close = vi.fn().mockResolvedValue(undefined);
  });

  it('calls gateway.close()', async () => {
    await deactivate(ctx);
    expect((ctx.gateway as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledOnce();
  });

  it('calls runtime.shutdown()', async () => {
    await deactivate(ctx);
    expect(ctx.runtime.shutdown).toHaveBeenCalledOnce();
  });

  it('calls gateway.close() before runtime.shutdown()', async () => {
    const callOrder: string[] = [];
    (ctx.gateway as unknown as { close: ReturnType<typeof vi.fn> }).close = vi.fn().mockImplementation(() => {
      callOrder.push('close');
      return Promise.resolve();
    });
    ctx.runtime.shutdown = vi.fn().mockImplementation(() => {
      callOrder.push('shutdown');
      return Promise.resolve();
    });
    await deactivate(ctx);
    expect(callOrder).toEqual(['close', 'shutdown']);
  });

  it('is idempotent — calling twice does not throw', async () => {
    await expect(deactivate(ctx)).resolves.toBeUndefined();
    await expect(deactivate(ctx)).resolves.toBeUndefined();
  });
});
