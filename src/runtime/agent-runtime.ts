import { Cron } from 'croner';
import { openDatabase } from '../registry/store.js';
import { openCreditDb } from '../credit/ledger.js';
import { releaseEscrow } from '../credit/escrow.js';
import type Database from 'better-sqlite3';

/**
 * Options for constructing an AgentRuntime instance.
 */
export interface RuntimeOptions {
  /** File path to the registry SQLite database. Use ':memory:' for in-memory. */
  registryDbPath: string;
  /** File path to the credit SQLite database. Use ':memory:' for in-memory. */
  creditDbPath: string;
  /** Agent owner identifier */
  owner: string;
  /**
   * Age threshold in minutes for orphaned escrow recovery.
   * Escrows older than this are released on start().
   * Defaults to 10 minutes.
   */
  orphanedEscrowAgeMinutes?: number;
}

/**
 * Represents a held escrow row from the credit_escrow table.
 */
interface HeldEscrowRow {
  id: string;
}

/**
 * AgentRuntime centralizes database handle ownership, background job lifecycle,
 * and graceful shutdown for the AgentBnB agent process.
 *
 * Every background loop and subsequent phase depends on AgentRuntime for DB access
 * and timer management. Without centralized lifecycle, background loops create
 * SQLITE_BUSY conflicts and orphaned resources.
 */
export class AgentRuntime {
  /** The registry SQLite database instance */
  readonly registryDb: Database.Database;
  /** The credit SQLite database instance */
  readonly creditDb: Database.Database;
  /** The agent owner identifier */
  readonly owner: string;
  /** Registered background Cron jobs */
  readonly jobs: Cron[] = [];

  private draining: boolean = false;
  private readonly orphanedEscrowAgeMinutes: number;

  /**
   * Creates a new AgentRuntime instance.
   * Opens both databases with WAL mode, foreign_keys=ON, and busy_timeout=5000.
   * Schema migrations are applied via openDatabase() and openCreditDb().
   *
   * @param options - Runtime configuration options.
   */
  constructor(options: RuntimeOptions) {
    this.owner = options.owner;
    this.orphanedEscrowAgeMinutes = options.orphanedEscrowAgeMinutes ?? 10;

    // Open databases with schema migrations (WAL + foreign_keys already applied by these functions)
    this.registryDb = openDatabase(options.registryDbPath);
    this.creditDb = openCreditDb(options.creditDbPath);

    // Apply busy_timeout pragma to prevent SQLITE_BUSY errors under concurrent access
    this.registryDb.pragma('busy_timeout = 5000');
    this.creditDb.pragma('busy_timeout = 5000');
  }

  /**
   * Registers a Cron job to be managed by this runtime.
   * Registered jobs will be stopped automatically on shutdown().
   *
   * @param job - The Cron job instance to register.
   */
  registerJob(job: Cron): void {
    this.jobs.push(job);
  }

  /**
   * Starts the runtime.
   * Recovers orphaned escrows (held escrows older than orphanedEscrowAgeMinutes).
   *
   * Call this after creating the runtime and before accepting requests.
   */
  async start(): Promise<void> {
    await this.recoverOrphanedEscrows();
  }

  /**
   * Recovers orphaned escrows by releasing them.
   * Orphaned escrows are 'held' escrows older than the configured age threshold.
   * Errors during individual release are swallowed (escrow may have settled between query and release).
   */
  private async recoverOrphanedEscrows(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.orphanedEscrowAgeMinutes * 60 * 1000,
    ).toISOString();

    const orphaned = this.creditDb
      .prepare(
        "SELECT id FROM credit_escrow WHERE status = 'held' AND created_at < ?",
      )
      .all(cutoff) as HeldEscrowRow[];

    for (const row of orphaned) {
      try {
        releaseEscrow(this.creditDb, row.id);
      } catch {
        // Silently ignore — escrow may have settled between query and release
      }
    }
  }

  /**
   * Shuts down the runtime gracefully.
   * Sets draining flag, stops all registered Cron jobs, and closes both databases.
   * Idempotent — safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    if (this.draining) {
      // Already shut down — idempotent
      return;
    }

    this.draining = true;

    // Stop all registered background jobs
    for (const job of this.jobs) {
      job.stop();
    }

    // Close both database handles
    try {
      this.registryDb.close();
    } catch {
      // Ignore if already closed
    }

    try {
      this.creditDb.close();
    } catch {
      // Ignore if already closed
    }
  }

  /**
   * Returns true if the runtime is shutting down or has shut down.
   * Background handlers should check this before processing new requests.
   */
  get isDraining(): boolean {
    return this.draining;
  }
}
