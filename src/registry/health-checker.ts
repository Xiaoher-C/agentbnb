import type Database from 'better-sqlite3';
import { recordAvailabilityCheck } from '../credit/reliability-metrics.js';

/**
 * Options for configuring the HealthChecker.
 */
export interface HealthCheckerOptions {
  /** Open SQLite database instance for the capability card registry. */
  db: Database.Database;
  /** Number of consecutive failures before marking a card offline. Default: 3 */
  maxFailures?: number;
  /** Interval between health check sweeps in milliseconds. Default: 120000 (2 min) */
  checkIntervalMs?: number;
  /** Timeout for each ping request in milliseconds. Default: 5000 */
  pingTimeoutMs?: number;
  /** Returns owners currently connected via WebSocket (skip health check for these). */
  getWebSocketOwners?: () => string[];
  /** Optional credit database for recording availability metrics. */
  creditDb?: Database.Database;
}

/**
 * HealthChecker periodically pings agents that have cards marked online
 * and marks them offline after consecutive health check failures.
 *
 * Agents connected via WebSocket are skipped since their liveness is
 * already tracked by the relay layer.
 */
export class HealthChecker {
  private failureCounts: Map<string, number> = new Map();
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly maxFailures: number;
  private readonly checkIntervalMs: number;
  private readonly pingTimeoutMs: number;
  private readonly db: Database.Database;
  private readonly creditDb?: Database.Database;
  private readonly getWebSocketOwners: () => string[];

  constructor(opts: HealthCheckerOptions) {
    this.db = opts.db;
    this.creditDb = opts.creditDb;
    this.maxFailures = opts.maxFailures ?? 3;
    this.checkIntervalMs = opts.checkIntervalMs ?? 2 * 60 * 1000;
    this.pingTimeoutMs = opts.pingTimeoutMs ?? 5000;
    this.getWebSocketOwners = opts.getWebSocketOwners ?? (() => []);
  }

  /**
   * Start the periodic health check interval.
   */
  start(): void {
    this.interval = setInterval(() => {
      void this.checkAll();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the periodic health check interval.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Run a single health check sweep across all online cards.
   *
   * @returns Summary of the sweep: how many cards were checked and which were marked offline.
   */
  async checkAll(): Promise<{ checked: number; markedOffline: string[] }> {
    const wsOwners = new Set(this.getWebSocketOwners());
    const onlineCards = this.getOnlineCards();
    const markedOffline: string[] = [];
    let checked = 0;

    for (const card of onlineCards) {
      if (wsOwners.has(card.owner)) continue; // Skip WS-connected agents
      checked++;

      const reachable = await this.pingAgent(card.gateway_url);

      // Record availability metric for reliability tracking
      if (this.creditDb) {
        try {
          recordAvailabilityCheck(this.creditDb, card.owner, reachable);
        } catch { /* non-fatal */ }
      }

      if (!reachable) {
        const count = (this.failureCounts.get(card.id) ?? 0) + 1;
        this.failureCounts.set(card.id, count);
        if (count >= this.maxFailures) {
          this.markOffline(card.id);
          this.failureCounts.delete(card.id);
          markedOffline.push(card.id);
        }
      } else {
        this.failureCounts.delete(card.id);
      }
    }
    return { checked, markedOffline };
  }

  /**
   * Ping an agent's health endpoint.
   *
   * @param gatewayUrl - The agent's gateway base URL.
   * @returns true if the agent responded with an OK status, false otherwise.
   */
  private async pingAgent(gatewayUrl: string | undefined): Promise<boolean> {
    if (!gatewayUrl) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.pingTimeoutMs);
      const url = gatewayUrl.endsWith('/')
        ? gatewayUrl + 'health'
        : gatewayUrl + '/health';
      const res = await fetch(url, { signal: controller.signal, method: 'GET' });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Query the database for all cards marked online.
   *
   * @returns Array of card metadata including id, owner, and gateway_url.
   */
  private getOnlineCards(): Array<{
    id: string;
    owner: string;
    gateway_url?: string;
  }> {
    const rows = this.db
      .prepare('SELECT id, owner, data FROM capability_cards')
      .all() as Array<{ id: string; owner: string; data: string }>;
    const results: Array<{
      id: string;
      owner: string;
      gateway_url?: string;
    }> = [];
    for (const row of rows) {
      try {
        const card = JSON.parse(row.data);
        if (card.availability?.online) {
          results.push({
            id: row.id,
            owner: row.owner,
            gateway_url: card._internal?.gateway_url,
          });
        }
      } catch {
        /* skip malformed card data */
      }
    }
    return results;
  }

  /**
   * Mark a card as offline in the database.
   *
   * @param cardId - The card UUID to mark offline.
   */
  private markOffline(cardId: string): void {
    try {
      const row = this.db
        .prepare('SELECT data FROM capability_cards WHERE id = ?')
        .get(cardId) as { data: string } | undefined;
      if (!row) return;
      const card = JSON.parse(row.data);
      card.availability = { ...card.availability, online: false };
      const now = new Date().toISOString();
      this.db
        .prepare(
          'UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?',
        )
        .run(JSON.stringify(card), now, cardId);
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Returns the current consecutive failure count for a card.
   *
   * @param cardId - The card UUID.
   * @returns Number of consecutive failures (0 if healthy or unknown).
   */
  getFailureCount(cardId: string): number {
    return this.failureCounts.get(cardId) ?? 0;
  }
}
