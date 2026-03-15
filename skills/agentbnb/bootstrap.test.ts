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

const mockRuntime = {
  registryDb: { pragma: vi.fn() } as unknown,
  creditDb: { pragma: vi.fn() } as unknown,
  owner: 'test-owner',
  jobs: [] as unknown[],
  start: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
  registerJob: vi.fn(),
  isDraining: false,
};

const mockGateway = {
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockCronJob = { stop: vi.fn() };

const mockIdleMonitor = {
  start: vi.fn().mockReturnValue(mockCronJob),
  getJob: vi.fn().mockReturnValue(mockCronJob),
  poll: vi.fn().mockResolvedValue(undefined),
};

const mockCard = {
  spec_version: '2.0' as const,
  id: 'card-uuid',
  owner: 'test-owner',
  agent_name: 'TestAgent',
  skills: [
    {
      id: 'test-skill',
      name: 'Test Skill',
      description: 'A test skill',
      level: 2 as const,
      inputs: [{ name: 'input', type: 'text' as const, required: true }],
      outputs: [{ name: 'output', type: 'text' as const, required: true }],
      pricing: { credits_per_call: 10 },
      availability: { online: true },
    },
  ],
  availability: { online: true },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

vi.mock('../../src/runtime/agent-runtime.js', () => ({
  AgentRuntime: vi.fn().mockImplementation(() => mockRuntime),
}));

vi.mock('../../src/openclaw/soul-sync.js', () => ({
  publishFromSoulV2: vi.fn().mockReturnValue(mockCard),
}));

vi.mock('../../src/gateway/server.js', () => ({
  createGatewayServer: vi.fn().mockReturnValue(mockGateway),
}));

vi.mock('../../src/autonomy/idle-monitor.js', () => ({
  IdleMonitor: vi.fn().mockImplementation(() => mockIdleMonitor),
}));

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

describe('activate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      '## Test Skill\nA test skill',
    );
    mockRuntime.start.mockResolvedValue(undefined);
    mockGateway.listen.mockResolvedValue(undefined);
    mockIdleMonitor.start.mockReturnValue(mockCronJob);
    mockRuntime.registerJob.mockReset();
    mockRuntime.shutdown.mockResolvedValue(undefined);
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
    expect(mockRuntime.start).toHaveBeenCalledOnce();
  });

  it('reads SOUL.md from the configured soulMdPath', async () => {
    await activate(VALID_CONFIG);
    expect(existsSync).toHaveBeenCalledWith('/fake/SOUL.md');
    expect(readFileSync).toHaveBeenCalledWith('/fake/SOUL.md', 'utf8');
  });

  it('calls publishFromSoulV2 with registry DB, soul content, and owner', async () => {
    await activate(VALID_CONFIG);
    expect(publishFromSoulV2).toHaveBeenCalledWith(
      mockRuntime.registryDb,
      '## Test Skill\nA test skill',
      'test-owner',
    );
  });

  it('calls createGatewayServer with correct options', async () => {
    await activate({ ...VALID_CONFIG, gatewayPort: 8800, gatewayToken: 'tok123' });
    expect(createGatewayServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 8800,
        tokens: ['tok123'],
        registryDb: mockRuntime.registryDb,
        creditDb: mockRuntime.creditDb,
      }),
    );
  });

  it('calls gateway.listen() on the correct port', async () => {
    await activate({ ...VALID_CONFIG, gatewayPort: 7700 });
    expect(mockGateway.listen).toHaveBeenCalledWith(
      expect.objectContaining({ port: 7700 }),
    );
  });

  it('creates IdleMonitor and calls start()', async () => {
    await activate(VALID_CONFIG);
    expect(IdleMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'test-owner', db: mockRuntime.registryDb }),
    );
    expect(mockIdleMonitor.start).toHaveBeenCalledOnce();
  });

  it('registers the idle cron job with runtime', async () => {
    await activate(VALID_CONFIG);
    expect(mockRuntime.registerJob).toHaveBeenCalledWith(mockCronJob);
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
    mockRuntime.start.mockResolvedValue(undefined);
    mockGateway.listen.mockResolvedValue(undefined);
    mockIdleMonitor.start.mockReturnValue(mockCronJob);
    mockRuntime.shutdown.mockResolvedValue(undefined);
    mockGateway.close.mockResolvedValue(undefined);
    ctx = await activate(VALID_CONFIG);
    vi.clearAllMocks();
  });

  it('calls gateway.close()', async () => {
    await deactivate(ctx);
    expect(mockGateway.close).toHaveBeenCalledOnce();
  });

  it('calls runtime.shutdown()', async () => {
    await deactivate(ctx);
    expect(mockRuntime.shutdown).toHaveBeenCalledOnce();
  });

  it('calls gateway.close() before runtime.shutdown()', async () => {
    const callOrder: string[] = [];
    mockGateway.close.mockImplementation(() => { callOrder.push('close'); return Promise.resolve(); });
    mockRuntime.shutdown.mockImplementation(() => { callOrder.push('shutdown'); return Promise.resolve(); });
    await deactivate(ctx);
    expect(callOrder).toEqual(['close', 'shutdown']);
  });

  it('is idempotent — calling twice does not throw', async () => {
    await expect(deactivate(ctx)).resolves.toBeUndefined();
    await expect(deactivate(ctx)).resolves.toBeUndefined();
  });
});
