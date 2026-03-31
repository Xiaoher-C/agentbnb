import type { AgentBnBConfig } from '../cli/config.js';
import { getConfigDir } from '../cli/config.js';
import { AgentBnBError } from '../types/index.js';
import { ProcessGuard } from './process-guard.js';
import type { PidFileContent } from './process-guard.js';
import { AgentRuntime } from './agent-runtime.js';
import { createGatewayServer } from '../gateway/server.js';
import { createRegistryServer } from '../registry/server.js';
import { DEFAULT_AUTONOMY_CONFIG } from '../autonomy/tiers.js';
import { IdleMonitor } from '../autonomy/idle-monitor.js';
import { listCards, attachCanonicalAgentId } from '../registry/store.js';
import { announceGateway, stopAnnouncement } from '../discovery/mdns.js';
import { resolveSelfCli } from './resolve-self-cli.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Cron } from 'croner';
import { syncCreditsFromRegistry } from '../credit/registry-sync.js';

export interface ServiceOptions {
  port?: number;
  handlerUrl?: string;
  skillsYamlPath?: string;
  registryPort?: number;
  registryUrl?: string;
  relay?: boolean;
  conductorEnabled?: boolean;
  announce?: boolean;
  /** Internal option: run startup in current process (CLI serve path). */
  foreground?: boolean;
}

export interface ServiceStatus {
  state: 'running' | 'stopped' | 'unknown';
  pid: number | null;
  port: number | null;
  owner: string | null;
  relayConnected: boolean;
  uptime_ms: number | null;
}

export interface HealthResult {
  ok: boolean;
  agentbnb: boolean;
  latency_ms: number;
  version?: string;
  owner?: string;
}

export interface RelayRegistrationCards {
  primaryCard: Record<string, unknown>;
  additionalCards: Record<string, unknown>[];
}

function buildFallbackRelayCard(owner: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    owner,
    name: owner,
    description: 'Agent registered via CLI',
    spec_version: '1.0',
    level: 1,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: 1 },
    availability: { online: true },
  };
}

/**
 * Splits local registry cards into the primary relay registration card and any
 * additional cards that should be published on the same connection.
 */
export function buildRelayRegistrationCards(
  owner: string,
  localCards: Record<string, unknown>[],
): RelayRegistrationCards {
  if (localCards.length === 0) {
    return {
      primaryCard: buildFallbackRelayCard(owner),
      additionalCards: [],
    };
  }

  return {
    primaryCard: localCards[0]!,
    additionalCards: localCards.slice(1),
  };
}

export class ServiceCoordinator {
  private readonly config: AgentBnBConfig;
  private readonly guard: ProcessGuard;
  private runtime: AgentRuntime | null = null;
  private gateway: FastifyInstance | null = null;
  private registryFastify: FastifyInstance | null = null;
  private relayClient: import('../relay/websocket-client.js').RelayClient | null = null;
  private announceEnabled = false;
  private inProcessStartup = false;
  private shutdownPromise: Promise<void> | null = null;
  private signalHandlersRegistered = false;
  private creditSyncJob: Cron | null = null;

  constructor(config: AgentBnBConfig, guard: ProcessGuard) {
    this.config = config;
    this.guard = guard;
  }

  async ensureRunning(opts?: ServiceOptions): Promise<'started' | 'already_running'> {
    const running = this.guard.getRunningMeta();
    if (running) {
      const health = await this.healthCheckForPort(running.port, running.owner);
      if (health.ok && health.agentbnb) {
        return 'already_running';
      }
      // In foreground mode (e.g. Docker), auto-clear stale locks from previous crashes
      if (opts?.foreground) {
        this.guard.release();
      } else {
        throw new AgentBnBError(
          `AgentBnB lock exists but health check failed (pid=${running.pid}, port=${running.port})`,
          'SERVICE_UNHEALTHY',
        );
      }
    }

    if (opts?.foreground) {
      return this.startInProcess(opts);
    }

    let child: ChildProcess | null = null;
    try {
      child = this.spawnManagedProcess(opts);
      const expectedPort = opts?.port ?? this.config.gateway_port;
      await this.waitUntilHealthy(expectedPort, 10_000);
      return 'started';
    } catch (err) {
      await this.rollbackManagedStartup(child);
      throw err;
    }
  }

  async getStatus(): Promise<ServiceStatus> {
    const meta = this.guard.getRunningMeta();
    if (!meta) {
      return {
        state: 'stopped',
        pid: null,
        port: null,
        owner: null,
        relayConnected: false,
        uptime_ms: null,
      };
    }

    const health = await this.healthCheckForPort(meta.port, meta.owner);
    const startedAtMs = Date.parse(meta.started_at);
    const uptimeMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : null;

    return {
      state: health.ok ? 'running' : 'unknown',
      pid: meta.pid,
      port: meta.port,
      owner: meta.owner,
      relayConnected: this.relayClient !== null,
      uptime_ms: uptimeMs,
    };
  }

  async stop(): Promise<void> {
    if (this.inProcessStartup) {
      await this.shutdownInProcess();
      return;
    }

    const meta = this.guard.getRunningMeta();
    if (!meta) return;

    try {
      process.kill(meta.pid, 'SIGTERM');
    } catch (err) {
      const killErr = err as NodeJS.ErrnoException;
      if (killErr.code !== 'ESRCH') {
        throw err;
      }
    }

    await this.waitForPidExit(meta.pid, 10_000);
    this.guard.release();
  }

  async restart(opts?: ServiceOptions): Promise<void> {
    await this.stop();
    await this.ensureRunning(opts);
  }

  async healthCheck(): Promise<HealthResult> {
    const meta = this.guard.getRunningMeta();
    const port = meta?.port ?? this.config.gateway_port;
    return this.healthCheckForPort(port, meta?.owner);
  }

  private async startInProcess(opts?: ServiceOptions): Promise<'started'> {
    const resolved = this.resolveOptions(opts);
    const lockMeta: Omit<PidFileContent, 'pid'> = {
      started_at: new Date().toISOString(),
      port: resolved.port,
      owner: this.config.owner,
    };
    this.guard.acquire(lockMeta);

    try {
      await this.startServiceStack(resolved);
      this.inProcessStartup = true;
      this.registerSignalHandlers();
      return 'started';
    } catch (err) {
      await this.shutdownInProcess();
      this.guard.release();
      throw err;
    }
  }

  private resolveOptions(opts?: ServiceOptions): Required<Omit<ServiceOptions, 'foreground'>> {
    return {
      port: opts?.port ?? this.config.gateway_port,
      handlerUrl: opts?.handlerUrl ?? 'http://localhost:8080',
      skillsYamlPath: opts?.skillsYamlPath ?? join(getConfigDir(), 'skills.yaml'),
      registryPort: opts?.registryPort ?? 7701,
      registryUrl: opts?.registryUrl ?? this.config.registry ?? '',
      relay: opts?.relay ?? true,
      conductorEnabled: opts?.conductorEnabled ?? false,
      announce: opts?.announce ?? false,
    };
  }

  private async startServiceStack(
    opts: Required<Omit<ServiceOptions, 'foreground'>>,
  ): Promise<void> {
    this.runtime = new AgentRuntime({
      registryDbPath: this.config.db_path,
      creditDbPath: this.config.credit_db_path,
      owner: this.config.owner,
      skillsYamlPath: opts.skillsYamlPath,
      conductorEnabled: opts.conductorEnabled,
      conductorToken: this.config.token,
    });
    await this.runtime.start();

    if (this.runtime.skillExecutor) {
      console.log(`SkillExecutor initialized from ${opts.skillsYamlPath}`);
    }
    if (opts.conductorEnabled) {
      console.log('Conductor mode enabled — orchestrate/plan skills available via gateway');
    }

    if (opts.conductorEnabled && this.config.conductor?.public) {
      const { buildConductorCard } = await import('../conductor/card.js');
      const conductorCard = attachCanonicalAgentId(
        this.runtime.registryDb,
        buildConductorCard(this.config.owner),
      );
      const now = new Date().toISOString();
      const existing = this.runtime.registryDb
        .prepare('SELECT id FROM capability_cards WHERE id = ?')
        .get(conductorCard.id) as { id: string } | undefined;
      if (existing) {
        this.runtime.registryDb
          .prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(conductorCard), now, conductorCard.id);
      } else {
        this.runtime.registryDb
          .prepare(
            'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            conductorCard.id,
            this.config.owner,
            JSON.stringify(conductorCard),
            now,
            now,
          );
      }
      console.log('Conductor card registered locally (conductor.public: true)');
    }

    const autonomyConfig = this.config.autonomy ?? DEFAULT_AUTONOMY_CONFIG;
    const idleMonitor = new IdleMonitor({
      owner: this.config.owner,
      db: this.runtime.registryDb,
      autonomyConfig,
    });
    const idleJob = idleMonitor.start();
    this.runtime.registerJob(idleJob);
    console.log('IdleMonitor started (60s poll interval, 70% idle threshold)');

    if (this.config.registry) {
      const startupSync = await syncCreditsFromRegistry(this.config, this.runtime.creditDb);
      if (startupSync.synced) {
        console.log(`[agentbnb] credits synced: ${startupSync.remoteBalance} (was ${startupSync.localWas})`);
      } else {
        console.warn(`[agentbnb] credit sync skipped: ${startupSync.error}`);
      }

      this.creditSyncJob = new Cron('*/5 * * * *', async () => {
        const result = await syncCreditsFromRegistry(this.config, this.runtime.creditDb);
        if (result.synced) {
          console.log(`[agentbnb] credits synced: ${result.remoteBalance} (was ${result.localWas})`);
        } else {
          console.warn(`[agentbnb] credit sync failed: ${result.error}`);
        }
      });
    }

    this.gateway = createGatewayServer({
      port: opts.port,
      registryDb: this.runtime.registryDb,
      creditDb: this.runtime.creditDb,
      tokens: [this.config.token],
      handlerUrl: opts.handlerUrl,
      skillExecutor: this.runtime.skillExecutor,
    });

    await this.gateway.listen({ port: opts.port, host: '0.0.0.0' });
    console.log(`Gateway running on port ${opts.port}`);

    if (opts.registryPort > 0) {
      if (!this.config.api_key) {
        console.warn('No API key found. Run `agentbnb init` to enable dashboard features.');
      }
      const { server: regServer, relayState } = createRegistryServer({
        registryDb: this.runtime.registryDb,
        silent: false,
        ownerName: this.config.owner,
        ownerApiKey: this.config.api_key,
        creditDb: this.runtime.creditDb,
      });
      this.registryFastify = regServer;
      await this.registryFastify.listen({ port: opts.registryPort, host: '0.0.0.0' });
      console.log(`Registry API: http://0.0.0.0:${opts.registryPort}/cards`);
      if (relayState) {
        console.log('WebSocket relay active on /ws');
      }
    }

    if (opts.registryUrl && opts.relay) {
      const { RelayClient } = await import('../relay/websocket-client.js');
      const { executeCapabilityRequest } = await import('../gateway/execute.js');

      const localCards = listCards(this.runtime.registryDb, this.config.owner) as unknown as Record<string, unknown>[];
      const { primaryCard, additionalCards } = buildRelayRegistrationCards(this.config.owner, localCards);
      if (this.config.conductor?.public) {
        console.log('Conductor card will be published to registry (conductor.public: true)');
      }

      this.relayClient = new RelayClient({
        registryUrl: opts.registryUrl,
        owner: this.config.owner,
        agent_id: this.config.agent_id,
        token: this.config.token,
        card: primaryCard,
        cards: additionalCards.length > 0 ? additionalCards : undefined,
        onRequest: async (req) => {
          this.relayClient?.sendStarted(req.id, 'provider acknowledged');
          const onProgress: import('../skills/executor.js').ProgressCallback = (info) => {
            this.relayClient!.sendProgress(req.id, info);
          };
          const result = await executeCapabilityRequest({
            registryDb: this.runtime!.registryDb,
            creditDb: this.runtime!.creditDb,
            cardId: req.card_id,
            skillId: req.skill_id,
            params: req.params as Record<string, unknown>,
            requester: req.requester ?? req.from_owner,
            escrowReceipt:
              req.escrow_receipt as import('../types/index.js').EscrowReceipt | undefined,
            skillExecutor: this.runtime!.skillExecutor,
            handlerUrl: opts.handlerUrl,
            onProgress,
            relayAuthorized: true,
          });
          if (result.success) {
            return { result: result.result };
          }
          return { error: { code: result.error.code, message: result.error.message } };
        },
      });

      try {
        await this.relayClient.connect();
        console.log(`Connected to registry: ${opts.registryUrl}`);
      } catch (err) {
        console.warn(
          `Warning: could not connect to registry ${opts.registryUrl}: ${err instanceof Error ? err.message : err}`,
        );
        console.warn('Will auto-reconnect in background...');
      }
    }

    if (opts.announce) {
      announceGateway(this.config.owner, opts.port);
      this.announceEnabled = true;
      console.log('Announcing on local network via mDNS');
    }
  }

  private async shutdownInProcess(): Promise<void> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
      return;
    }

    this.shutdownPromise = (async () => {
      if (this.creditSyncJob) {
        this.creditSyncJob.stop();
        this.creditSyncJob = null;
      }
      if (this.relayClient) {
        this.relayClient.disconnect();
        this.relayClient = null;
      }
      if (this.announceEnabled) {
        await stopAnnouncement();
        this.announceEnabled = false;
      }
      if (this.registryFastify) {
        await this.registryFastify.close().catch(() => undefined);
        this.registryFastify = null;
      }
      if (this.gateway) {
        await this.gateway.close().catch(() => undefined);
        this.gateway = null;
      }
      if (this.runtime) {
        await this.runtime.shutdown().catch(() => undefined);
        this.runtime = null;
      }
      this.unregisterSignalHandlers();
      this.inProcessStartup = false;
      this.guard.release();
    })();

    try {
      await this.shutdownPromise;
    } finally {
      this.shutdownPromise = null;
    }
  }

  private spawnManagedProcess(opts?: ServiceOptions): ChildProcess {
    const runtime = loadPersistedRuntime(getConfigDir());
    const nodeExec = resolveNodeExecutable(runtime);
    const cliPath = resolveSelfCli();
    const cliArgs = [cliPath, 'serve', ...this.buildServeArgs(opts)];
    const child = spawn(nodeExec, cliArgs, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    return child;
  }

  private buildServeArgs(opts?: ServiceOptions): string[] {
    const args: string[] = [];
    if (opts?.port !== undefined) args.push('--port', String(opts.port));
    if (opts?.handlerUrl) args.push('--handler-url', opts.handlerUrl);
    if (opts?.skillsYamlPath) args.push('--skills-yaml', opts.skillsYamlPath);
    if (opts?.registryPort !== undefined) {
      args.push('--registry-port', String(opts.registryPort));
    }
    if (opts?.registryUrl) args.push('--registry', opts.registryUrl);
    if (opts?.conductorEnabled) args.push('--conductor');
    if (opts?.announce) args.push('--announce');
    if (opts?.relay === false) args.push('--no-relay');
    return args;
  }

  private async rollbackManagedStartup(child: ChildProcess | null): Promise<void> {
    if (child?.pid) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch (err) {
        const killErr = err as NodeJS.ErrnoException;
        if (killErr.code !== 'ESRCH') {
          throw err;
        }
      }
      await this.waitForPidExit(child.pid, 3_000).catch(() => undefined);
    }
    this.guard.release();
  }

  private async waitUntilHealthy(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const health = await this.healthCheckForPort(port, this.config.owner);
      if (health.ok && health.agentbnb) {
        return;
      }
      await sleep(250);
    }
    throw new AgentBnBError(
      `Timed out waiting for AgentBnB service on port ${port}`,
      'SERVICE_START_TIMEOUT',
    );
  }

  private async healthCheckForPort(port: number, owner?: string): Promise<HealthResult> {
    const startedAt = Date.now();
    const baseUrl = this.getGatewayBaseUrl(port);

    try {
      const healthResponse = await this.fetchWithTimeout(`${baseUrl}/health`, {
        method: 'GET',
      });
      if (!healthResponse.ok) {
        return {
          ok: false,
          agentbnb: false,
          latency_ms: Date.now() - startedAt,
          owner,
        };
      }

      const body = (await healthResponse.json()) as {
        status?: string;
        version?: string;
      };

      if (body.status !== 'ok') {
        return {
          ok: false,
          agentbnb: false,
          latency_ms: Date.now() - startedAt,
          version: body.version,
          owner,
        };
      }

      const probeId = 'agentbnb-health-signature';
      const probeResponse = await this.fetchWithTimeout(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: probeId,
          method: 'agentbnb.signature.probe',
          params: {},
        }),
      });

      let agentbnb = false;
      if (probeResponse.ok) {
        const probe = (await probeResponse.json()) as {
          jsonrpc?: string;
          id?: string;
          error?: { code?: number };
        };
        agentbnb =
          probe.jsonrpc === '2.0' &&
          probe.id === probeId &&
          probe.error?.code === -32601;
      }

      return {
        ok: body.status === 'ok' && agentbnb,
        agentbnb,
        latency_ms: Date.now() - startedAt,
        version: body.version,
        owner,
      };
    } catch {
      return {
        ok: false,
        agentbnb: false,
        latency_ms: Date.now() - startedAt,
        owner,
      };
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 3_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private getGatewayBaseUrl(port: number): string {
    try {
      const configured = new URL(this.config.gateway_url);
      return `${configured.protocol}//${configured.hostname}:${port}`;
    } catch {
      return `http://127.0.0.1:${port}`;
    }
  }

  private async waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!isPidAlive(pid)) return;
      await sleep(100);
    }
    if (isPidAlive(pid)) {
      throw new AgentBnBError(
        `Timed out waiting for process ${pid} to exit`,
        'PROCESS_STOP_TIMEOUT',
      );
    }
  }

  private registerSignalHandlers(): void {
    if (this.signalHandlersRegistered) return;
    process.once('SIGTERM', this.handleSignal);
    process.once('SIGINT', this.handleSignal);
    this.signalHandlersRegistered = true;
  }

  private unregisterSignalHandlers(): void {
    if (!this.signalHandlersRegistered) return;
    process.removeListener('SIGTERM', this.handleSignal);
    process.removeListener('SIGINT', this.handleSignal);
    this.signalHandlersRegistered = false;
  }

  private readonly handleSignal = (): void => {
    void (async () => {
      await this.shutdownInProcess();
      process.exit(0);
    })();
  };
}

export interface PersistedRuntimeInfo {
  node_exec: string;
  node_version?: string;
  source?: string;
  detected_at?: string;
}

/**
 * Reads persisted runtime info from ~/.agentbnb/runtime.json.
 */
export function loadPersistedRuntime(configDir: string): PersistedRuntimeInfo | null {
  const runtimePath = join(configDir, 'runtime.json');
  if (!existsSync(runtimePath)) return null;

  try {
    const raw = readFileSync(runtimePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nodeExec = parsed['node_exec'];
    if (typeof nodeExec !== 'string' || nodeExec.trim().length === 0) {
      return null;
    }
    return {
      node_exec: nodeExec,
      node_version:
        typeof parsed['node_version'] === 'string' ? parsed['node_version'] : undefined,
      source: typeof parsed['source'] === 'string' ? parsed['source'] : undefined,
      detected_at:
        typeof parsed['detected_at'] === 'string' ? parsed['detected_at'] : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves which Node.js executable should be used to launch managed service.
 * Persisted runtime wins over shell resolution.
 */
export function resolveNodeExecutable(runtime: PersistedRuntimeInfo | null): string {
  if (runtime?.node_exec) {
    return runtime.node_exec;
  }
  return process.execPath;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const killErr = err as NodeJS.ErrnoException;
    return killErr.code === 'EPERM';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
