/**
 * AgentBnB Bootstrap — single-call OpenClaw skill lifecycle entry point.
 *
 * Usage: `const ctx = await activate({ owner: 'alice', soulMdPath: './SOUL.md' });`
 * Teardown: `await deactivate(ctx);`
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
import { ensureIdentity, type AgentIdentity } from '../../src/identity/identity.js';
import type { AutonomyConfig } from '../../src/autonomy/tiers.js';
import type { CapabilityCardV2 } from '../../src/types/index.js';

/** Configuration for bringing an AgentBnB agent online. */
export interface BootstrapConfig {
  /** Agent owner identifier. */
  owner: string;
  /** Absolute path to SOUL.md. */
  soulMdPath: string;
  /** Registry DB path. Defaults to ~/.agentbnb/registry.db */
  registryDbPath?: string;
  /** Credit DB path. Defaults to ~/.agentbnb/credit.db */
  creditDbPath?: string;
  /** Gateway port. Defaults to 7700. */
  gatewayPort?: number;
  /** Bearer token for gateway auth. Defaults to a random UUID. */
  gatewayToken?: string;
  /** Handler URL for capability forwarding. Defaults to http://localhost:{gatewayPort}. */
  handlerUrl?: string;
  /** Autonomy tier config. Defaults to DEFAULT_AUTONOMY_CONFIG (Tier 3). */
  autonomyConfig?: AutonomyConfig;
  /** Suppress gateway logs. Defaults to false. */
  silent?: boolean;
  /** When true, ensures identity.json exists on activate. Defaults to true. */
  identityRequired?: boolean;
}

/** Live handles returned by activate(). Pass to deactivate() for clean teardown. */
export interface BootstrapContext {
  /** AgentRuntime managing DBs and background job lifecycle. */
  runtime: AgentRuntime;
  /** Fastify gateway HTTP server instance. */
  gateway: FastifyInstance;
  /** IdleMonitor background loop. */
  idleMonitor: IdleMonitor;
  /** Published CapabilityCard derived from SOUL.md. */
  card: CapabilityCardV2;
  /** Agent identity (created/loaded during activation). */
  identity: AgentIdentity | null;
}

/**
 * Brings an agent fully online: Runtime -> publishCard -> gateway.listen -> IdleMonitor.
 * @throws {AgentBnBError} FILE_NOT_FOUND if SOUL.md does not exist.
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

  const identityRequired = config.identityRequired ?? false;
  const handlerUrl = config.handlerUrl ?? `http://localhost:${gatewayPort}`;

  if (!existsSync(soulMdPath)) {
    throw new AgentBnBError(`SOUL.md not found at path: ${soulMdPath}`, 'FILE_NOT_FOUND');
  }
  const soulContent = readFileSync(soulMdPath, 'utf8');

  const runtime = new AgentRuntime({ registryDbPath, creditDbPath, owner });
  await runtime.start();

  // Ensure agent identity exists (idempotent — preserves existing identity)
  let identity: AgentIdentity | null = null;
  if (identityRequired) {
    const configDir = join(homedir(), '.agentbnb');
    identity = ensureIdentity(configDir, owner);
  }

  const card = publishFromSoulV2(runtime.registryDb, soulContent, owner);

  const gateway = createGatewayServer({
    port: gatewayPort,
    registryDb: runtime.registryDb,
    creditDb: runtime.creditDb,
    tokens: [gatewayToken],
    handlerUrl,
    silent,
  });
  await gateway.listen({ port: gatewayPort, host: '0.0.0.0' });

  const idleMonitor = new IdleMonitor({ owner, db: runtime.registryDb, autonomyConfig });
  const idleJob = idleMonitor.start();
  runtime.registerJob(idleJob);

  return { runtime, gateway, idleMonitor, card, identity };
}

/**
 * Tears down all active components: gateway.close() then runtime.shutdown().
 * Idempotent — safe to call multiple times.
 */
export async function deactivate(ctx: BootstrapContext): Promise<void> {
  try {
    await ctx.gateway.close();
    await ctx.runtime.shutdown();
  } catch {
    // Swallow errors — idempotent teardown
  }
}
