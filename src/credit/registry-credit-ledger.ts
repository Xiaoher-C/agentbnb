import Database from 'better-sqlite3';
import { bootstrapAgent, getBalance, getTransactions } from './ledger.js';
import { holdEscrow, settleEscrow, releaseEscrow } from './escrow.js';
import type { CreditLedger, EscrowResult } from './credit-ledger.js';
import type { CreditTransaction } from './ledger.js';
import { AgentBnBError } from '../types/index.js';

/** Direct DB mode — used by the Registry server process to avoid HTTP round-trips to itself. */
interface DirectDbConfig {
  mode: 'direct';
  db: Database.Database;
}

/** HTTP client mode — used by agents that route credit calls to a remote Registry. */
interface HttpClientConfig {
  mode: 'http';
  registryUrl: string;
  ownerPublicKey: string;
}

/**
 * Configuration for RegistryCreditLedger.
 * - `direct` mode: delegates directly to ledger.ts/escrow.ts functions (Registry server process).
 * - `http` mode: makes HTTP calls to the Registry /api/credits/* endpoints (agent nodes).
 */
export type RegistryCreditLedgerConfig = DirectDbConfig | HttpClientConfig;

/** Timeout in milliseconds for HTTP requests to the Registry. */
const HTTP_TIMEOUT_MS = 10_000;

/**
 * RegistryCreditLedger — implements CreditLedger with dual-mode operation.
 *
 * Direct DB mode:
 *   Used by the Registry server itself to handle credit operations without
 *   making HTTP round-trips to itself. Delegates to the same ledger.ts and
 *   escrow.ts functions as LocalCreditLedger.
 *
 * HTTP client mode:
 *   Used by agent nodes configured with a `registryUrl`. All credit operations
 *   are routed to the Registry HTTP API at /api/credits/*. Includes
 *   X-Agent-Owner and X-Agent-PublicKey headers for future auth validation.
 */
export class RegistryCreditLedger implements CreditLedger {
  private readonly config: RegistryCreditLedgerConfig;

  constructor(config: RegistryCreditLedgerConfig) {
    this.config = config;
  }

  /**
   * Holds credits in escrow during capability execution.
   *
   * @param owner - Agent identifier (requester).
   * @param amount - Number of credits to hold.
   * @param cardId - Capability Card ID being requested.
   * @returns EscrowResult with the new escrowId.
   * @throws {AgentBnBError} with code 'INSUFFICIENT_CREDITS' if balance < amount.
   */
  async hold(owner: string, amount: number, cardId: string): Promise<EscrowResult> {
    if (this.config.mode === 'direct') {
      const escrowId = holdEscrow(this.config.db, owner, amount, cardId);
      return { escrowId };
    }
    const data = await this.post<{ escrowId: string }>('/api/credits/hold', owner, {
      owner,
      amount,
      cardId,
    });
    return { escrowId: data.escrowId };
  }

  /**
   * Settles an escrow — transfers held credits to the capability provider.
   *
   * @param escrowId - The escrow ID to settle.
   * @param recipientOwner - Agent identifier who will receive the credits.
   * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
   * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
   */
  async settle(escrowId: string, recipientOwner: string): Promise<void> {
    if (this.config.mode === 'direct') {
      settleEscrow(this.config.db, escrowId, recipientOwner);
      return;
    }
    await this.post('/api/credits/settle', null, { escrowId, recipientOwner });
  }

  /**
   * Releases an escrow — refunds credits back to the requester.
   *
   * @param escrowId - The escrow ID to release.
   * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
   * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
   */
  async release(escrowId: string): Promise<void> {
    if (this.config.mode === 'direct') {
      releaseEscrow(this.config.db, escrowId);
      return;
    }
    await this.post('/api/credits/release', null, { escrowId });
  }

  /**
   * Returns the current credit balance for an agent.
   *
   * @param owner - Agent identifier.
   * @returns Current balance in credits (0 if agent is unknown).
   */
  async getBalance(owner: string): Promise<number> {
    if (this.config.mode === 'direct') {
      return getBalance(this.config.db, owner);
    }
    const data = await this.get<{ balance: number }>(`/api/credits/${owner}`, owner);
    return data.balance;
  }

  /**
   * Returns the transaction history for an agent, newest first.
   *
   * @param owner - Agent identifier.
   * @param limit - Maximum number of transactions to return. Defaults to 100.
   * @returns Array of credit transactions ordered newest first.
   */
  async getHistory(owner: string, limit: number = 100): Promise<CreditTransaction[]> {
    if (this.config.mode === 'direct') {
      return getTransactions(this.config.db, owner, limit);
    }
    const data = await this.get<{ transactions: CreditTransaction[] }>(
      `/api/credits/${owner}/history?limit=${limit}`,
      owner,
    );
    return data.transactions;
  }

  /**
   * Grants initial credits to an agent (bootstrap grant).
   * Idempotent — calling multiple times has no additional effect on balance.
   *
   * @param owner - Agent identifier.
   * @param amount - Number of credits to grant. Defaults to 100.
   */
  async grant(owner: string, amount: number = 100): Promise<void> {
    if (this.config.mode === 'direct') {
      bootstrapAgent(this.config.db, owner, amount);
      return;
    }
    await this.post('/api/credits/grant', owner, { owner, amount });
  }

  // ─── Private HTTP helpers ─────────────────────────────────────────────────

  /**
   * Makes an authenticated POST request to the Registry HTTP API.
   * Includes a 10s timeout via AbortController.
   *
   * @param path - API path (e.g., '/api/credits/hold').
   * @param ownerForHeader - Agent owner identifier for X-Agent-Owner header, or null to omit.
   * @param body - JSON body to send.
   * @returns Parsed JSON response body.
   * @throws {AgentBnBError} on non-2xx responses or network errors.
   */
  private async post<T>(path: string, ownerForHeader: string | null, body: unknown): Promise<T> {
    const cfg = this.config as HttpClientConfig;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Agent-PublicKey': cfg.ownerPublicKey,
      };
      if (ownerForHeader !== null) {
        headers['X-Agent-Owner'] = ownerForHeader;
      }

      const res = await fetch(`${cfg.registryUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      return await this.handleResponse<T>(res);
    } catch (err) {
      if (err instanceof AgentBnBError) throw err;
      throw new AgentBnBError(
        `Registry unreachable: ${(err as Error).message}`,
        'REGISTRY_UNREACHABLE',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Makes an authenticated GET request to the Registry HTTP API.
   * Includes a 10s timeout via AbortController.
   *
   * @param path - API path (e.g., '/api/credits/owner-id').
   * @param owner - Agent owner identifier for X-Agent-Owner header.
   * @returns Parsed JSON response body.
   * @throws {AgentBnBError} on non-2xx responses or network errors.
   */
  private async get<T>(path: string, owner: string): Promise<T> {
    const cfg = this.config as HttpClientConfig;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      const res = await fetch(`${cfg.registryUrl}${path}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Owner': owner,
          'X-Agent-PublicKey': cfg.ownerPublicKey,
        },
        signal: controller.signal,
      });

      return await this.handleResponse<T>(res);
    } catch (err) {
      if (err instanceof AgentBnBError) throw err;
      throw new AgentBnBError(
        `Registry unreachable: ${(err as Error).message}`,
        'REGISTRY_UNREACHABLE',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handles an HTTP response — returns parsed JSON on 2xx, throws AgentBnBError on error.
   */
  private async handleResponse<T>(res: Response): Promise<T> {
    const json = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const code = typeof json['code'] === 'string' ? json['code'] : 'REGISTRY_ERROR';
      const message = typeof json['error'] === 'string' ? json['error'] : `HTTP ${res.status}`;
      throw new AgentBnBError(message, code);
    }

    return json as T;
  }
}
