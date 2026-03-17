import { readFileSync, existsSync } from 'node:fs';
import { Cron } from 'croner';
import { openDatabase } from '../registry/store.js';
import { openCreditDb } from '../credit/ledger.js';
import { releaseEscrow } from '../credit/escrow.js';
import type Database from 'better-sqlite3';
import { SkillExecutor, createSkillExecutor } from '../skills/executor.js';
import { parseSkillsFile } from '../skills/skill-config.js';
import { ApiExecutor } from '../skills/api-executor.js';
import { PipelineExecutor } from '../skills/pipeline-executor.js';
import { OpenClawBridge } from '../skills/openclaw-bridge.js';
import { CommandExecutor } from '../skills/command-executor.js';

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
  /**
   * Optional path to a skills.yaml file.
   * If provided and the file exists, SkillExecutor is initialized on start().
   */
  skillsYamlPath?: string;
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
  /**
   * The SkillExecutor instance, populated by start() if skillsYamlPath is set.
   * Undefined if no skills.yaml was provided or the file does not exist.
   */
  skillExecutor?: SkillExecutor;

  private draining: boolean = false;
  private readonly orphanedEscrowAgeMinutes: number;
  private readonly skillsYamlPath?: string;

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
    this.skillsYamlPath = options.skillsYamlPath;

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
   * If skillsYamlPath is set and the file exists, initializes SkillExecutor with
   * all four executor modes (api, pipeline, openclaw, command).
   *
   * Call this after creating the runtime and before accepting requests.
   */
  async start(): Promise<void> {
    await this.recoverOrphanedEscrows();
    await this.initSkillExecutor();
  }

  /**
   * Initializes SkillExecutor from skills.yaml if skillsYamlPath is configured
   * and the file exists on disk.
   *
   * Uses a mutable Map to handle the PipelineExecutor circular dependency:
   * 1. Create an empty modes Map and a SkillExecutor (holds Map reference).
   * 2. Create PipelineExecutor passing the SkillExecutor (for sub-skill dispatch).
   * 3. Populate the Map with all 4 modes — SkillExecutor sees them via reference.
   */
  private async initSkillExecutor(): Promise<void> {
    if (!this.skillsYamlPath || !existsSync(this.skillsYamlPath)) {
      return;
    }

    const yamlContent = readFileSync(this.skillsYamlPath, 'utf8');
    const configs = parseSkillsFile(yamlContent);

    // Step 1: Create the modes Map and the SkillExecutor holding a reference to it.
    // The Map is mutated below — SkillExecutor.modeMap points to the same object.
    const modes = new Map<string, import('../skills/executor.js').ExecutorMode>();
    const executor = createSkillExecutor(configs, modes);

    // Step 2: Create PipelineExecutor with the executor reference (circular dep solved).
    const pipelineExecutor = new PipelineExecutor(executor);

    // Step 3: Register all 4 executor modes into the shared Map.
    modes.set('api', new ApiExecutor());
    modes.set('pipeline', pipelineExecutor);
    modes.set('openclaw', new OpenClawBridge());
    modes.set('command', new CommandExecutor());

    this.skillExecutor = executor;
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
