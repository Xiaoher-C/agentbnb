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
import { homedir } from 'node:os';

import { loadConfig } from '../../src/cli/config.js';
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
}

/**
 * Brings an AgentBnB node online (idempotent — safe to call when already running).
 * @throws {AgentBnBError} CONFIG_NOT_FOUND if ~/.agentbnb/config.json does not exist.
 */
export async function activate(config: BootstrapConfig = {}): Promise<BootstrapContext> {
  const agentConfig = loadConfig();
  if (!agentConfig) {
    throw new AgentBnBError(
      'AgentBnB config not found. Run: agentbnb init',
      'CONFIG_NOT_FOUND',
    );
  }

  const guard = new ProcessGuard(join(homedir(), '.agentbnb', '.pid'));
  const coordinator = new ServiceCoordinator(agentConfig, guard);
  const service = new AgentBnBService(coordinator, agentConfig);

  const opts: ServiceOptions = {
    port: config.port,
    registryUrl: config.registryUrl,
    relay: config.relay,
  };

  const startDisposition = await service.ensureRunning(opts);
  const status = await service.getNodeStatus();

  return { service, status, startDisposition };
}

/**
 * Tears down the AgentBnB node — only if this activate() call was the one that started it.
 * If the node was already running before activate(), it is left untouched.
 */
export async function deactivate(ctx: BootstrapContext): Promise<void> {
  if (ctx.startDisposition === 'started') {
    try {
      await ctx.service.stop();
    } catch {
      // Swallow errors — idempotent teardown
    }
  }
}
