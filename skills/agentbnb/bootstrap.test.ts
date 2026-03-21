/**
 * Unit tests for bootstrap.ts thin OpenClaw adapter.
 *
 * bootstrap.ts is a thin adapter — it delegates all lifecycle logic to
 * ServiceCoordinator via AgentBnBService. Tests verify the adapter's own
 * responsibilities:
 *   - CONFIG_NOT_FOUND when no config exists
 *   - BootstrapContext shape (service, status, startDisposition)
 *   - Signal handler registration and removal
 *   - deactivate() only stops node when startDisposition === 'started'
 *   - deactivate() is idempotent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

const mockEnsureRunning = vi.fn<() => Promise<'started' | 'already_running'>>();
const mockGetNodeStatus = vi.fn();
const mockStop = vi.fn<() => Promise<void>>();

vi.mock('../../src/app/agentbnb-service.js', () => ({
  AgentBnBService: vi.fn().mockImplementation(() => ({
    ensureRunning: mockEnsureRunning,
    getNodeStatus: mockGetNodeStatus,
    stop: mockStop,
  })),
}));

vi.mock('../../src/runtime/service-coordinator.js', () => ({
  ServiceCoordinator: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/runtime/process-guard.js', () => ({
  ProcessGuard: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/cli/config.js', () => ({
  loadConfig: vi.fn(),
  getConfigDir: vi.fn(() => join(homedir(), '.agentbnb')),
}));

import { loadConfig } from '../../src/cli/config.js';
import { activate, deactivate } from './bootstrap.js';
import type { BootstrapContext } from './bootstrap.js';

const mockLoadConfig = vi.mocked(loadConfig);

const MINIMAL_CONFIG = {
  owner: 'test-agent',
  gateway_url: 'http://localhost:7700',
  gateway_port: 7700,
  db_path: ':memory:',
  credit_db_path: ':memory:',
  token: 'test-token',
  api_key: 'test-api-key',
  registry: 'https://agentbnb.fly.dev',
};

const MOCK_STATUS = {
  state: 'running' as const,
  pid: 1234,
  port: 7700,
  owner: 'test-agent',
  relayConnected: false,
  uptime_ms: 100,
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('bootstrap activate/deactivate lifecycle', () => {
  let ctx: BootstrapContext | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureRunning.mockResolvedValue('started');
    mockGetNodeStatus.mockResolvedValue(MOCK_STATUS);
    mockStop.mockResolvedValue(undefined);
    mockLoadConfig.mockReturnValue(MINIMAL_CONFIG as ReturnType<typeof loadConfig>);
  });

  afterEach(async () => {
    if (ctx) {
      await deactivate(ctx).catch(() => undefined);
      ctx = undefined;
    }
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  // ---------------------------------------------------------------------------
  // Test 1: CONFIG_NOT_FOUND when no config exists
  // ---------------------------------------------------------------------------
  it('activate() throws CONFIG_NOT_FOUND when config is missing', async () => {
    mockLoadConfig.mockReturnValue(null);

    await expect(activate()).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: BootstrapContext shape
  // ---------------------------------------------------------------------------
  it('activate() returns BootstrapContext with correct shape', async () => {
    ctx = await activate();

    expect(ctx).toHaveProperty('service');
    expect(ctx).toHaveProperty('status');
    expect(ctx).toHaveProperty('startDisposition');
    expect(ctx).toHaveProperty('_removeSignalHandlers');
    expect(typeof ctx._removeSignalHandlers).toBe('function');
  });

  // ---------------------------------------------------------------------------
  // Test 3: startDisposition reflects ensureRunning result
  // ---------------------------------------------------------------------------
  it('startDisposition is "started" when ensureRunning returns "started"', async () => {
    mockEnsureRunning.mockResolvedValue('started');
    ctx = await activate();
    expect(ctx.startDisposition).toBe('started');
  });

  it('startDisposition is "already_running" when node was already up', async () => {
    mockEnsureRunning.mockResolvedValue('already_running');
    ctx = await activate();
    expect(ctx.startDisposition).toBe('already_running');
  });

  // ---------------------------------------------------------------------------
  // Test 4: status snapshot from getNodeStatus
  // ---------------------------------------------------------------------------
  it('activate() status reflects getNodeStatus() snapshot', async () => {
    ctx = await activate();
    expect(ctx.status).toEqual(MOCK_STATUS);
  });

  // ---------------------------------------------------------------------------
  // Test 5: signal handlers registered
  // ---------------------------------------------------------------------------
  it('activate() registers SIGTERM and SIGINT handlers', async () => {
    const sigtermBefore = process.listenerCount('SIGTERM');
    const sigintBefore = process.listenerCount('SIGINT');

    ctx = await activate();

    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore + 1);
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore + 1);
  });

  // ---------------------------------------------------------------------------
  // Test 6: _removeSignalHandlers removes them
  // ---------------------------------------------------------------------------
  it('_removeSignalHandlers() removes SIGTERM and SIGINT handlers', async () => {
    ctx = await activate();
    const sigtermAfterActivate = process.listenerCount('SIGTERM');
    const sigintAfterActivate = process.listenerCount('SIGINT');

    ctx._removeSignalHandlers();

    expect(process.listenerCount('SIGTERM')).toBe(sigtermAfterActivate - 1);
    expect(process.listenerCount('SIGINT')).toBe(sigintAfterActivate - 1);

    ctx = undefined;
  });

  // ---------------------------------------------------------------------------
  // Test 7: deactivate() stops node when startDisposition === 'started'
  // ---------------------------------------------------------------------------
  it('deactivate() calls service.stop() when startDisposition is "started"', async () => {
    mockEnsureRunning.mockResolvedValue('started');
    ctx = await activate();

    await deactivate(ctx);
    ctx = undefined;

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Test 8: deactivate() does NOT stop node when already_running
  // ---------------------------------------------------------------------------
  it('deactivate() does NOT call service.stop() when startDisposition is "already_running"', async () => {
    mockEnsureRunning.mockResolvedValue('already_running');
    ctx = await activate();

    await deactivate(ctx);
    ctx = undefined;

    expect(mockStop).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 9: deactivate() is idempotent
  // ---------------------------------------------------------------------------
  it('deactivate() is idempotent — second call does not throw', async () => {
    ctx = await activate();

    await deactivate(ctx);
    await expect(deactivate(ctx)).resolves.not.toThrow();

    ctx = undefined;
  });

  // ---------------------------------------------------------------------------
  // Test 10: deactivate() removes signal handlers
  // ---------------------------------------------------------------------------
  it('deactivate() removes signal handlers', async () => {
    ctx = await activate();
    const sigtermAfterActivate = process.listenerCount('SIGTERM');

    await deactivate(ctx);
    ctx = undefined;

    expect(process.listenerCount('SIGTERM')).toBeLessThan(sigtermAfterActivate);
  });
});
