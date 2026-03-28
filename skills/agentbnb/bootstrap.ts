/**
 * AgentBnB Bootstrap — thin OpenClaw adapter layer.
 *
 * Delegates all lifecycle logic to the shared Core Foundation:
 *   ProcessGuard → ServiceCoordinator → AgentBnBService
 *
 * Usage: `const ctx = await activate({ port: 7700 });`
 * Teardown: `await deactivate(ctx);`
 */

import { join, basename, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execAsync = promisify(exec);

/**
 * Derives a workspace-specific AGENTBNB_DIR using a priority chain:
 *
 * 1. AGENTBNB_DIR env var (already works for CLI — defensive check)
 * 2. cwd is inside ~/.openclaw/agents/<name>/ → use <agent-dir>/.agentbnb/
 * 3. Fallback to the global ~/.agentbnb/
 *
 * NOTE: The primary fix for the daemon cwd bug is in activate(), which reads
 * OpenClaw's context.workspaceDir / context.agentDir before reaching this function.
 * This function is defense-in-depth for cases where context is not available.
 */
function resolveWorkspaceDir(): string {
  // 1. AGENTBNB_DIR env var (set by CLI or parent process)
  if (process.env['AGENTBNB_DIR']) {
    return process.env['AGENTBNB_DIR'];
  }

  // 2. Check if cwd is inside an OpenClaw agent directory — derive from agent name
  const openclawAgentsDir = join(homedir(), '.openclaw', 'agents');
  const cwd = process.cwd();
  if (cwd.startsWith(openclawAgentsDir + '/')) {
    const relative = cwd.slice(openclawAgentsDir.length + 1);
    const agentName = relative.split('/')[0];
    return join(openclawAgentsDir, agentName, '.agentbnb');
  }

  // 3. Global fallback
  return join(homedir(), '.agentbnb');
}

import { getConfigDir, loadConfig } from '../../src/cli/config.js';
import { AgentBnBError } from '../../src/types/index.js';
import { ProcessGuard } from '../../src/runtime/process-guard.js';
import { ServiceCoordinator } from '../../src/runtime/service-coordinator.js';
import type { ServiceOptions, ServiceStatus } from '../../src/runtime/service-coordinator.js';
import { AgentBnBService } from '../../src/app/agentbnb-service.js';
import { openDatabase } from '../../src/registry/store.js';

/** Configuration for bringing an AgentBnB agent online via OpenClaw. */
export interface BootstrapConfig {
  /** Gateway port override. Defaults to config value or 7700. */
  port?: number;
  /** Registry URL override. */
  registryUrl?: string;
  /** Enable WebSocket relay. Defaults to true. */
  relay?: boolean;
  /**
   * Explicit agent config directory override.
   * When set, used as AGENTBNB_DIR instead of auto-detection.
   *
   * Example: `~/.openclaw/agents/genesis-bot/.agentbnb`
   */
  agentDir?: string;
  /**
   * OpenClaw workspace directory passthrough.
   * When OpenClaw calls activate(context), context.workspaceDir lands here.
   * Derives AGENTBNB_DIR as `<workspaceDir>/.agentbnb`.
   *
   * Example: `~/.openclaw/agents/genesis-bot`
   */
  workspaceDir?: string;
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
 * Idempotently registers a task_decomposition Capability Card for this agent.
 * Uses raw SQL upsert to accept v2.0 card shape (same pattern as websocket-relay.ts).
 * No-op if a task_decomposition card for this owner already exists.
 * Non-fatal: failure is logged to stderr and does not prevent agent startup.
 *
 * @param configDir - Agent config directory (used to locate registry.db).
 * @param owner - Agent owner identifier from AgentBnBConfig.
 */
function registerDecomposerCard(configDir: string, owner: string): void {
  try {
    const db = openDatabase(join(configDir, 'registry.db'));

    // Idempotency: skip if a task_decomposition card for this owner already exists
    const existing = db
      .prepare(
        "SELECT id FROM capability_cards WHERE owner = ? AND json_extract(data, '$.capability_type') = ?"
      )
      .get(owner, 'task_decomposition') as { id: string } | undefined;

    if (existing) return;

    const cardId = randomUUID();
    const now = new Date().toISOString();
    const card = {
      spec_version: '2.0' as const,
      id: cardId,
      owner,
      agent_name: `${owner}-decomposer`,
      capability_type: 'task_decomposition',
      skills: [
        {
          id: 'task-decomposition',
          name: 'Task Decomposition',
          description:
            'Decomposes natural-language tasks into executable sub-task DAGs using the AgentBnB Rule Engine.',
          level: 1 as const,
          category: 'task_decomposition',
          inputs: [
            {
              name: 'task',
              type: 'text' as const,
              description: 'Natural language task description',
              required: true,
            },
          ],
          outputs: [
            {
              name: 'subtasks',
              type: 'json' as const,
              description: 'Array of SubTask objects with id, role, description, dependencies',
              required: true,
            },
          ],
          pricing: { credits_per_call: 1 },
        },
      ],
      availability: { online: true },
      created_at: now,
      updated_at: now,
    };

    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(cardId, owner, JSON.stringify(card), now, now);

    process.stderr.write(
      `[agentbnb] registered task_decomposition card: ${cardId} (owner=${owner})\n`
    );
  } catch (err) {
    // Non-fatal: log and continue. The agent still starts without decomposer card.
    process.stderr.write(
      `[agentbnb] WARNING: failed to register task_decomposition card: ${String(err)}\n`
    );
  }
}

/**
 * Checks if the `agentbnb` CLI is available in PATH.
 * @returns Absolute path to the CLI, or null if not found.
 */
export function findCli(): string | null {
  const result = spawnSync('which', ['agentbnb'], { encoding: 'utf-8', stdio: 'pipe' });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return null;
}

/**
 * Runs a shell command asynchronously. Exported for test injection.
 */
export async function runCommand(cmd: string, env: Record<string, string | undefined>): Promise<{ stdout: string; stderr: string }> {
  return execAsync(cmd, { env });
}

/**
 * Derives a human-readable agent name from the config directory path.
 * If configDir is `~/.openclaw/agents/genesis-bot/.agentbnb`, returns "genesis-bot".
 * Falls back to a random identifier.
 */
function deriveAgentName(configDir: string): string {
  // configDir is typically <workspace>/.agentbnb — parent dir is the agent workspace
  const parent = basename(dirname(configDir));
  if (parent && parent !== '.' && parent !== '.agentbnb' && parent !== homedir().split('/').pop()) {
    return parent;
  }
  return `agent-${randomUUID().slice(0, 8)}`;
}

/**
 * First-time auto-onboarding: initializes identity, publishes capabilities, and
 * grants the Demand Voucher (50 credits). Called when activate() detects no config.json.
 *
 * Steps:
 * 1. Check agentbnb CLI is available
 * 2. Run `agentbnb init --owner <name> --yes --no-detect` (keypair + config)
 * 3. Run `agentbnb openclaw sync` (publish SOUL.md capabilities)
 * 4. Demand Voucher is auto-issued by the registry on first registration
 *
 * @param configDir - The AGENTBNB_DIR for this agent.
 * @returns The loaded AgentBnBConfig after init.
 * @throws {AgentBnBError} INIT_FAILED if CLI not found or init fails.
 */
/** Injectable dependencies for autoOnboard (test seam). */
export interface OnboardDeps {
  findCli: () => string | null;
  runCommand: (cmd: string, env: Record<string, string | undefined>) => Promise<{ stdout: string; stderr: string }>;
}

/** Default production dependencies. */
const defaultDeps: OnboardDeps = { findCli, runCommand };

async function autoOnboard(configDir: string, deps: OnboardDeps = defaultDeps): Promise<import('./../../src/cli/config.js').AgentBnBConfig> {
  process.stderr.write('[agentbnb] First-time setup: initializing agent identity...\n');

  // Step 0: Check CLI exists
  const cliPath = deps.findCli();
  if (!cliPath) {
    process.stderr.write('[agentbnb] CLI not found. Run: npm install -g agentbnb\n');
    throw new AgentBnBError(
      'agentbnb CLI not found in PATH. Install with: npm install -g agentbnb',
      'INIT_FAILED',
    );
  }

  const env = { ...process.env, AGENTBNB_DIR: configDir };
  const agentName = deriveAgentName(configDir);

  // Step 1: Initialize identity (keypair + config.json + credit bootstrap)
  try {
    await deps.runCommand(`agentbnb init --owner "${agentName}" --yes --no-detect`, env);
    process.stderr.write(`[agentbnb] Agent "${agentName}" initialized.\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AgentBnBError(`Auto-init failed: ${msg}`, 'INIT_FAILED');
  }

  // Step 2: Publish capabilities from SOUL.md (if it exists)
  try {
    await deps.runCommand('agentbnb openclaw sync', env);
    process.stderr.write('[agentbnb] Capabilities published from SOUL.md.\n');
  } catch {
    // Non-fatal: SOUL.md may not exist yet, or sync may fail for other reasons.
    // Agent is still initialized and can publish capabilities later.
    process.stderr.write('[agentbnb] Note: openclaw sync skipped (SOUL.md may not exist yet).\n');
  }

  // Step 3: Demand Voucher (50 credits) is auto-issued by bootstrapAgent() during init.
  // No action needed here.

  const config = loadConfig();
  if (!config) {
    throw new AgentBnBError('AgentBnB config still not found after auto-init', 'CONFIG_NOT_FOUND');
  }

  process.stderr.write('[agentbnb] Agent initialized and published to AgentBnB network.\n');
  return config;
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
export async function activate(config: BootstrapConfig = {}, _onboardDeps?: OnboardDeps): Promise<BootstrapContext> {
  // Per-workspace isolation: determine the correct config directory.
  // Priority: config.agentDir > config.workspaceDir/.agentbnb > AGENTBNB_DIR env > resolveWorkspaceDir()
  if (config.agentDir) {
    process.env['AGENTBNB_DIR'] = config.agentDir;
    process.stderr.write(
      `[agentbnb] AGENTBNB_DIR set from config.agentDir: ${config.agentDir}\n`
    );
  } else if (config.workspaceDir) {
    const derived = join(config.workspaceDir, '.agentbnb');
    process.env['AGENTBNB_DIR'] = derived;
    process.stderr.write(
      `[agentbnb] AGENTBNB_DIR derived from config.workspaceDir: ${derived}\n`
    );
  } else if (!process.env['AGENTBNB_DIR']) {
    const workspaceDir = resolveWorkspaceDir();
    process.env['AGENTBNB_DIR'] = workspaceDir;
    process.stderr.write(
      `[agentbnb] AGENTBNB_DIR auto-configured to ${workspaceDir} for workspace isolation.\n`
    );
  }

  const configDir = getConfigDir();

  if (process.env['AGENTBNB_DIR'] !== configDir) {
    process.stderr.write(
      `[agentbnb] WARNING: AGENTBNB_DIR (${process.env['AGENTBNB_DIR']}) differs from resolved configDir (${configDir}).\n`
    );
  }

  let agentConfig = loadConfig();
  if (!agentConfig) {
    // First-time setup: auto-onboard this agent onto the AgentBnB network.
    agentConfig = await autoOnboard(configDir, _onboardDeps);
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

  // Auto-register task_decomposition card so this agent is discoverable as a decomposer peer.
  registerDecomposerCard(configDir, agentConfig.owner);

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

// ---------------------------------------------------------------------------
// OpenClaw Plugin Definition — default export
// ---------------------------------------------------------------------------

import { createAllTools, resetContextCache } from './openclaw-tools.js';
import type { AgentTool } from './openclaw-tools.js';

/**
 * OpenClaw plugin definition. When OpenClaw loads this plugin, `register()`
 * is called to register the AgentBnB tools with the bot's LLM.
 *
 * The existing named exports (activate, deactivate, findCli, runCommand)
 * remain unchanged — they handle the node lifecycle. This default export
 * adds tool registration so the LLM can discover, hire, and orchestrate agents.
 */
export default {
  id: 'agentbnb',
  name: 'AgentBnB',
  description:
    'Where AI agents hire AI agents — discover, request, and orchestrate agent capabilities.',

  register(api: { registerTool: (factory: (toolCtx: { workspaceDir?: string; agentDir?: string }) => AgentTool[]) => void }) {
    api.registerTool(
      (toolCtx: { workspaceDir?: string; agentDir?: string }) => createAllTools(toolCtx),
    );
  },
};
