import type Database from 'better-sqlite3';
import { ensureIdentity, type AgentIdentity } from '../identity/identity.js';
import { loadConfig, getConfigDir } from '../cli/config.js';
import { loadKeyPair, type KeyPair } from '../credit/signing.js';
import { createSignedEscrowReceipt } from '../credit/escrow-receipt.js';
import { settleRequesterEscrow, releaseRequesterEscrow } from '../credit/settlement.js';
import { requestCapability } from '../gateway/client.js';
import { requestViaTemporaryRelay } from '../gateway/relay-dispatch.js';
import { openCreditDb, getBalance } from '../credit/ledger.js';
import { AgentBnBError } from '../types/index.js';

/**
 * Options for constructing an AgentBnBConsumer.
 */
export interface ConsumerOptions {
  /** Override the config directory (default: ~/.agentbnb or AGENTBNB_DIR). */
  configDir?: string;
}

/**
 * Options for requesting a capability.
 */
export interface ConsumerRequestOptions {
  /** Gateway URL of the target agent. */
  gatewayUrl: string;
  /** Bearer token for the target agent's gateway. */
  token: string;
  /** Capability Card ID to execute. */
  cardId: string;
  /** Optional skill ID within the card. */
  skillId?: string;
  /** Input parameters for the capability. */
  params?: Record<string, unknown>;
  /** Credit amount to commit (escrow). */
  credits: number;
  /** Timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Provider-published expected duration used to derive timeout when timeoutMs is omitted. */
  expectedDurationMs?: number;
  /** Provider-published hard timeout used as fallback timeout hint. */
  providerHardTimeoutMs?: number;
}

/**
 * AgentBnBConsumer — high-level SDK class for agents consuming capabilities.
 *
 * Encapsulates the full request lifecycle: identity loading, escrow creation,
 * capability request, and settlement/release.
 *
 * @example
 * ```typescript
 * const consumer = new AgentBnBConsumer();
 * consumer.authenticate();
 * const result = await consumer.request({
 *   gatewayUrl: 'http://peer:7700',
 *   token: 'peer-token',
 *   cardId: 'uuid-of-card',
 *   credits: 5,
 * });
 * ```
 */
export class AgentBnBConsumer {
  private configDir: string;
  private identity: AgentIdentity | null = null;
  private keys: KeyPair | null = null;
  private creditDb: Database.Database | null = null;

  constructor(opts?: ConsumerOptions) {
    this.configDir = opts?.configDir ?? getConfigDir();
  }

  /**
   * Loads agent identity and keypair from disk.
   * Creates identity if none exists (uses owner from config.json or generates one).
   *
   * @returns The loaded AgentIdentity.
   * @throws {AgentBnBError} if keypair is missing and cannot be created.
   */
  authenticate(): AgentIdentity {
    const config = loadConfig();
    const owner = config?.owner ?? `agent-${Date.now().toString(36)}`;
    this.identity = ensureIdentity(this.configDir, owner);
    this.keys = loadKeyPair(this.configDir);
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
   * Requests a paid capability via the relay. The relay handles escrow + network fee
   * server-side, avoiding the fee bypass bug in the signed receipt path.
   *
   * @param opts - Relay request options.
   * @returns The result from the capability execution.
   * @throws {AgentBnBError} on relay connection failure or execution error.
   */
  async requestViaRelay(opts: {
    registryUrl: string;
    targetOwner: string;
    targetAgentId?: string;
    cardId: string;
    skillId?: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<unknown> {
    const identity = this.getIdentity();
    const config = loadConfig();
    const token = config?.token ?? '';

    return requestViaTemporaryRelay({
      registryUrl: opts.registryUrl,
      owner: identity.owner,
      token,
      targetOwner: opts.targetOwner,
      targetAgentId: opts.targetAgentId,
      cardId: opts.cardId,
      skillId: opts.skillId,
      params: opts.params ?? {},
      timeoutMs: opts.timeoutMs,
    });
  }

  /**
   * @deprecated Use `requestViaRelay()` for paid remote requests. This method uses
   * local escrow + signed receipts which bypass the network fee. Still works for
   * free/local requests.
   *
   * Requests a capability from a remote agent with full escrow lifecycle.
   *
   * 1. Creates a signed escrow receipt (holds credits locally)
   * 2. Sends the request to the target gateway
   * 3. Settles escrow on success, releases on failure
   *
   * @param opts - Request options including target, card, credits, and params.
   * @returns The result from the capability execution.
   * @throws {AgentBnBError} on insufficient credits, network error, or RPC error.
   */
  async request(opts: ConsumerRequestOptions): Promise<unknown> {
    const identity = this.getIdentity();
    if (!this.keys) {
      throw new AgentBnBError('Keypair not loaded. Call authenticate() first.', 'NOT_AUTHENTICATED');
    }

    const db = this.getCreditDb();

    // 1. Create signed escrow receipt
    const { escrowId, receipt } = createSignedEscrowReceipt(
      db,
      this.keys.privateKey,
      this.keys.publicKey,
      {
        owner: identity.owner,
        amount: opts.credits,
        cardId: opts.cardId,
        skillId: opts.skillId,
      },
    );

    // 2. Send request to target gateway
    try {
      const result = await requestCapability({
        gatewayUrl: opts.gatewayUrl,
        token: opts.token,
        cardId: opts.cardId,
        params: opts.params,
        timeoutMs: opts.timeoutMs,
        timeoutHint: {
          expected_duration_ms: opts.expectedDurationMs,
          hard_timeout_ms: opts.providerHardTimeoutMs,
        },
        escrowReceipt: receipt,
        identity: {
          agentId: identity.agent_id,
          publicKey: identity.public_key,
          privateKey: this.keys.privateKey,
        },
      });

      // 3a. Success — settle escrow
      settleRequesterEscrow(db, escrowId);
      return result;
    } catch (err) {
      // 3b. Failure — release escrow back to consumer
      releaseRequesterEscrow(db, escrowId);
      throw err;
    }
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
   * Returns basic reputation data from the local credit database.
   * Note: success_rate is computed from local request history only.
   */
  getReputation(): { success_rate: number; total_requests: number } {
    const identity = this.getIdentity();
    const db = this.getCreditDb();

    const stmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END) as settled
      FROM credit_escrow
      WHERE owner = ?
    `);
    const row = stmt.get(identity.owner) as { total: number; settled: number } | undefined;
    const total = row?.total ?? 0;
    const settled = row?.settled ?? 0;

    return {
      success_rate: total > 0 ? settled / total : 1,
      total_requests: total,
    };
  }

  /**
   * Closes the credit database connection. Call when done.
   */
  close(): void {
    if (this.creditDb) {
      this.creditDb.close();
      this.creditDb = null;
    }
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
