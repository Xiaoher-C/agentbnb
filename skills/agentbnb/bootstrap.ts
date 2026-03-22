/**
 * AgentBnB Bootstrap — thin OpenClaw adapter layer.
 *
 * Delegates all lifecycle logic to the shared Core Foundation:
 *   ProcessGuard → ServiceCoordinator → AgentBnBService
 *
 * Usage: `const ctx = await activate({ port: 7700 });`
 * Teardown: `await deactivate(ctx);`
 */

import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { getConfigDir, loadConfig } from '../../src/cli/config.js';
import { AgentBnBError } from '../../src/types/index.js';
import { ProcessGuard } from '../../src/runtime/process-guard.js';
import { ServiceCoordinator } from '../../src/runtime/service-coordinator.js';
import type { ServiceOptions, ServiceStatus } from '../../src/runtime/service-coordinator.js';
import { AgentBnBService } from '../../src/app/agentbnb-service.js';

/** Configuration for bringing an AgentBnB agent online via OpenClaw. */
export interface BootstrapConfig {
  /** Gateway port override. Defaults to config value or 7700. */
  port?: number;
  /** Registry URL override. */
  registryUrl?: string;
  /** Enable WebSocket relay. Defaults to true. */
  relay?: boolean;
}

/** Context returned by activate(). Pass to deactivate() for conditional teardown. */
export interface BootstrapContext {
  /** Unified facade — use this for all AgentBnB operations. */
  service: AgentBnBService;
  /** Node status snapshot at activation time. */
  status: ServiceStatus;
  /** Whether this activate() call started a new node or found one already running. */
  startDisposition: 'started' | 'already_running';
  /**
   * Removes the SIGTERM/SIGINT handlers registered by activate().
   * Called automatically by deactivate() — do not call manually.
   * @internal
   */
  _removeSignalHandlers: () => void;
}

/**
 * Brings an AgentBnB node online (idempotent — safe to call when already running).
 * Registers SIGTERM/SIGINT handlers that conditionally stop the node on process exit.
 *
 * @throws {AgentBnBError} INIT_FAILED if auto-init fails when no config exists.
 *
 * TODO: Once ServiceCoordinator gains its own signal handling, remove the handlers
 * registered here to avoid double-handler conflicts. Track in Layer A implementation.
 */
export async function activate(config: BootstrapConfig = {}): Promise<BootstrapContext> {
  const configDir = getConfigDir();

  // Isolation: each agent must have its own data directory.
  // If AGENTBNB_DIR is not set, auto-set it from configDir so all child processes
  // spawned by this OpenClaw session (e.g. `agentbnb request` CLI calls) inherit it.
  if (!process.env['AGENTBNB_DIR']) {
    process.env['AGENTBNB_DIR'] = configDir;
    process.stderr.write(
      `[agentbnb] AGENTBNB_DIR not set — auto-configured to ${configDir} for child process isolation.\n`
    );
  } else if (process.env['AGENTBNB_DIR'] !== configDir) {
    process.stderr.write(
      `[agentbnb] WARNING: AGENTBNB_DIR (${process.env['AGENTBNB_DIR']}) differs from resolved configDir (${configDir}).\n`
    );
  }

  let agentConfig = loadConfig();
  if (!agentConfig) {
    // Auto-init for first-time OpenClaw plugin activation
    const result = spawnSync('agentbnb', ['init', '--yes', '--no-detect'], {
      stdio: 'pipe',
      env: { ...process.env },
      encoding: 'utf-8',
    });
    if (result.error || result.status !== 0) {
      const msg = result.error?.message ?? (result.stderr as string | null)?.trim() ?? 'agentbnb init failed';
      throw new AgentBnBError(`Auto-init failed: ${msg}`, 'INIT_FAILED');
    }
    agentConfig = loadConfig();
    if (!agentConfig) {
      throw new AgentBnBError('AgentBnB config still not found after auto-init', 'CONFIG_NOT_FOUND');
    }
  }

  // Print startup diagnostic so it's always visible in agent logs.
  process.stderr.write(
    `[agentbnb] activate: owner=${agentConfig.owner} config=${configDir}/config.json\n`
  );

  // Use configDir for PID file — previously hardcoded to homedir()/.agentbnb which meant
  // multiple agents on the same machine would fight over the same PID file.
  const guard = new ProcessGuard(join(configDir, '.pid'));
  const coordinator = new ServiceCoordinator(agentConfig, guard);
  const service = new AgentBnBService(coordinator, agentConfig);

  const opts: ServiceOptions = {
    port: config.port,
    registryUrl: config.registryUrl,
    relay: config.relay,
  };

  const startDisposition = await service.ensureRunning(opts);
  const status = await service.getNodeStatus();

  // Register signal handlers.
  // Use process.once so each signal fires at most once and self-removes.
  // No process.exit() — closing open handles via service.stop() drains the event loop naturally.
  // Only stop the node when we were the ones who started it.
  const onSigterm = () => {
    if (startDisposition === 'started') {
      void service.stop();
    }
  };
  const onSigint = () => {
    if (startDisposition === 'started') {
      void service.stop();
    }
  };

  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);

  const _removeSignalHandlers = () => {
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
  };

  return { service, status, startDisposition, _removeSignalHandlers };
}

/**
 * Tears down the AgentBnB node — only if this activate() call was the one that started it.
 * If the node was already running before activate(), it is left untouched.
 * Always removes the signal handlers registered by activate().
 */
export async function deactivate(ctx: BootstrapContext): Promise<void> {
  ctx._removeSignalHandlers();

  if (ctx.startDisposition === 'started') {
    try {
      await ctx.service.stop();
    } catch {
      // Swallow errors — idempotent teardown
    }
  }
}
