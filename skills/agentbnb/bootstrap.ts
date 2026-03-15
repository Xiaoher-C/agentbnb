/**
 * AgentBnB Bootstrap — single-call entry point for OpenClaw skill lifecycle.
 *
 * A single `activate()` call brings an agent fully online:
 *   1. Initialize AgentRuntime (opens DBs, recovers orphaned escrows)
 *   2. Publish the capability card from SOUL.md
 *   3. Start the gateway HTTP server
 *   4. Start the IdleMonitor background loop
 *
 * A single `deactivate()` call tears everything down cleanly and is idempotent.
 *
 * Usage:
 * ```ts
 * import { activate, deactivate } from './skills/agentbnb/bootstrap.js';
 * const ctx = await activate({ owner: 'alice', soulMdPath: './SOUL.md' });
 * // ... agent is online ...
 * await deactivate(ctx);
 * ```
 */

import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

import { AgentRuntime } from '../../src/runtime/agent-runtime.js';
import { publishFromSoulV2 } from '../../src/openclaw/soul-sync.js';
import { createGatewayServer } from '../../src/gateway/server.js';
import { IdleMonitor } from '../../src/autonomy/idle-monitor.js';
import { DEFAULT_AUTONOMY_CONFIG } from '../../src/autonomy/tiers.js';
import { AgentBnBError } from '../../src/types/index.js';
import type { AutonomyConfig } from '../../src/autonomy/tiers.js';
import type { CapabilityCardV2 } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Configuration for bringing an AgentBnB agent online.
 * All fields except `owner` and `soulMdPath` have sensible defaults.
 */
export interface BootstrapConfig {
  /** Agent owner identifier — used for card ownership and credit ledger. */
  owner: string;
  /** Absolute path to the SOUL.md file describing the agent's capabilities. */
  soulMdPath: string;
  /** Path to the registry SQLite database. Defaults to ~/.agentbnb/registry.db */
  registryDbPath?: string;
  /** Path to the credit SQLite database. Defaults to ~/.agentbnb/credit.db */
  creditDbPath?: string;
  /** Port for the gateway HTTP server. Defaults to 7700. */
  gatewayPort?: number;
  /** Bearer token for gateway auth. Defaults to a random UUID. */
  gatewayToken?: string;
  /** URL the gateway forwards requests to (local capability handler). Defaults to http://localhost:{gatewayPort}. */
  handlerUrl?: string;
  /** Autonomy tier configuration. Defaults to DEFAULT_AUTONOMY_CONFIG (Tier 3 — ask-before-acting). */
  autonomyConfig?: AutonomyConfig;
  /** Suppress gateway HTTP logs (useful in tests). Defaults to false. */
  silent?: boolean;
}

/**
 * Live handles returned by activate(). Pass this to deactivate() for clean teardown.
 */
export interface BootstrapContext {
  /** The AgentRuntime managing DBs and background job lifecycle. */
  runtime: AgentRuntime;
  /** The Fastify gateway HTTP server instance. */
  gateway: FastifyInstance;
  /** The IdleMonitor background loop tracking per-skill idle rates. */
  idleMonitor: IdleMonitor;
  /** The published CapabilityCard derived from SOUL.md. */
  card: CapabilityCardV2;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Brings an AgentBnB agent fully online in a single call.
 *
 * Execution order:
 * 1. Read and validate SOUL.md
 * 2. Construct AgentRuntime and call start() (recovers orphaned escrows)
 * 3. Publish capability card via publishFromSoulV2
 * 4. Create and start gateway HTTP server
 * 5. Create IdleMonitor, call start(), register the Cron job with runtime
 *
 * @param config - Bootstrap configuration options.
 * @returns BootstrapContext with live handles for runtime, gateway, idleMonitor, and card.
 * @throws {AgentBnBError} with code FILE_NOT_FOUND if SOUL.md does not exist at soulMdPath.
 */
export async function activate(config: BootstrapConfig): Promise<BootstrapContext> {
  const {
    owner,
    soulMdPath,
    registryDbPath = join(homedir(), '.agentbnb', 'registry.db'),
    creditDbPath = join(homedir(), '.agentbnb', 'credit.db'),
    gatewayPort = 7700,
    gatewayToken = randomUUID(),
    autonomyConfig = DEFAULT_AUTONOMY_CONFIG,
    silent = false,
  } = config;

  const handlerUrl = config.handlerUrl ?? `http://localhost:${gatewayPort}`;

  // 1. Read SOUL.md — throw if missing
  if (!existsSync(soulMdPath)) {
    throw new AgentBnBError(
      `SOUL.md not found at path: ${soulMdPath}`,
      'FILE_NOT_FOUND',
    );
  }
  const soulContent = readFileSync(soulMdPath, 'utf8');

  // 2. Initialize runtime and recover orphaned escrows
  const runtime = new AgentRuntime({ registryDbPath, creditDbPath, owner });
  await runtime.start();

  // 3. Publish capability card from SOUL.md
  const card = publishFromSoulV2(runtime.registryDb, soulContent, owner);

  // 4. Create and start gateway server
  const gateway = createGatewayServer({
    port: gatewayPort,
    registryDb: runtime.registryDb,
    creditDb: runtime.creditDb,
    tokens: [gatewayToken],
    handlerUrl,
    silent,
  });
  await gateway.listen({ port: gatewayPort, host: '0.0.0.0' });

  // 5. Start IdleMonitor and register its cron job with runtime
  const idleMonitor = new IdleMonitor({ owner, db: runtime.registryDb, autonomyConfig });
  const idleJob = idleMonitor.start();
  runtime.registerJob(idleJob);

  return { runtime, gateway, idleMonitor, card };
}

/**
 * Tears down all active components cleanly.
 *
 * Execution order:
 * 1. Close the gateway HTTP server (stop accepting new connections)
 * 2. Shutdown the runtime (stops IdleMonitor cron and closes both DBs)
 *
 * Idempotent — safe to call multiple times without throwing.
 *
 * @param ctx - The BootstrapContext returned by activate().
 */
export async function deactivate(ctx: BootstrapContext): Promise<void> {
  try {
    await ctx.gateway.close();
    await ctx.runtime.shutdown();
  } catch {
    // Swallow errors — idempotent teardown
  }
}
