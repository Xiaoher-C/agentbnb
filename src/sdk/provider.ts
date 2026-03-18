import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { ensureIdentity, type AgentIdentity } from '../identity/identity.js';
import { loadConfig, getConfigDir } from '../cli/config.js';
import { openDatabase, listCards } from '../registry/store.js';
import { openCreditDb, getBalance } from '../credit/ledger.js';
import { createGatewayServer } from '../gateway/server.js';
import { AgentBnBError } from '../types/index.js';
import type { CapabilityCard } from '../types/index.js';

/**
 * Options for constructing an AgentBnBProvider.
 */
export interface ProviderOptions {
  /** Override the config directory (default: ~/.agentbnb or AGENTBNB_DIR). */
  configDir?: string;
}

/**
 * Options for starting the sharing gateway.
 */
export interface StartSharingOptions {
  /** Port to listen on (default: from config or 7700). */
  port?: number;
  /** Host to bind to (default: '0.0.0.0'). */
  host?: string;
}

/**
 * Context returned after sharing starts.
 */
export interface SharingContext {
  /** The Fastify gateway server instance. */
  gateway: FastifyInstance;
  /** Port the gateway is listening on. */
  port: number;
}

/**
 * AgentBnBProvider — high-level SDK class for agents providing capabilities.
 *
 * Manages identity, gateway lifecycle, and capability listing.
 *
 * @example
 * ```typescript
 * const provider = new AgentBnBProvider();
 * provider.authenticate();
 * const ctx = await provider.startSharing({ port: 7700 });
 * console.log(provider.listCapabilities());
 * await provider.stopSharing();
 * ```
 */
export class AgentBnBProvider {
  private configDir: string;
  private identity: AgentIdentity | null = null;
  private registryDb: Database.Database | null = null;
  private creditDb: Database.Database | null = null;
  private gateway: FastifyInstance | null = null;

  constructor(opts?: ProviderOptions) {
    this.configDir = opts?.configDir ?? getConfigDir();
  }

  /**
   * Loads agent identity from disk.
   * Creates identity if none exists.
   *
   * @returns The loaded AgentIdentity.
   */
  authenticate(): AgentIdentity {
    const config = loadConfig();
    const owner = config?.owner ?? `agent-${Date.now().toString(36)}`;
    this.identity = ensureIdentity(this.configDir, owner);
    return this.identity;
  }

  /**
   * Returns the cached identity. Throws if not yet authenticated.
   */
  getIdentity(): AgentIdentity {
    if (!this.identity) {
      throw new AgentBnBError('Not authenticated. Call authenticate() first.', 'NOT_AUTHENTICATED');
    }
    return this.identity;
  }

  /**
   * Starts the gateway server to share capabilities.
   *
   * @param opts - Optional port and host configuration.
   * @returns Context with the gateway server and port.
   */
  async startSharing(opts?: StartSharingOptions): Promise<SharingContext> {
    this.getIdentity(); // Ensure authenticated before sharing
    const config = loadConfig();
    const port = opts?.port ?? config?.gateway_port ?? 7700;
    const host = opts?.host ?? '0.0.0.0';

    const registryDb = this.getRegistryDb();
    const creditDb = this.getCreditDb();
    const token = config?.token ?? '';

    const gateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [token],
      handlerUrl: `http://localhost:${port}`,
      silent: true,
    });

    await gateway.listen({ port, host });
    this.gateway = gateway;

    return { gateway, port };
  }

  /**
   * Stops the gateway server.
   */
  async stopSharing(): Promise<void> {
    if (this.gateway) {
      await this.gateway.close();
      this.gateway = null;
    }
  }

  /**
   * Returns all capability cards owned by this agent.
   */
  listCapabilities(): CapabilityCard[] {
    const identity = this.getIdentity();
    const db = this.getRegistryDb();
    return listCards(db, identity.owner);
  }

  /**
   * Returns the current credit balance for this agent.
   */
  getBalance(): number {
    const identity = this.getIdentity();
    const db = this.getCreditDb();
    return getBalance(db, identity.owner);
  }

  /**
   * Closes all database connections and stops the gateway. Call when done.
   */
  async close(): Promise<void> {
    await this.stopSharing();
    if (this.registryDb) {
      this.registryDb.close();
      this.registryDb = null;
    }
    if (this.creditDb) {
      this.creditDb.close();
      this.creditDb = null;
    }
  }

  /** Lazily opens and caches the registry database. */
  private getRegistryDb(): Database.Database {
    if (!this.registryDb) {
      const config = loadConfig();
      const dbPath = config?.db_path ?? `${this.configDir}/registry.db`;
      this.registryDb = openDatabase(dbPath);
    }
    return this.registryDb;
  }

  /** Lazily opens and caches the credit database. */
  private getCreditDb(): Database.Database {
    if (!this.creditDb) {
      const config = loadConfig();
      const creditDbPath = config?.credit_db_path ?? `${this.configDir}/credit.db`;
      this.creditDb = openCreditDb(creditDbPath);
    }
    return this.creditDb;
  }
}
