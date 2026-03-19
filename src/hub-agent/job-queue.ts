import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Job interface
// ---------------------------------------------------------------------------

/** Job status progression: queued -> dispatched -> completed | failed */
export type JobStatus = 'queued' | 'dispatched' | 'completed' | 'failed';

/**
 * A queued job record for Hub Agent skill execution.
 * Jobs are created when a relay/queue-mode skill target is offline.
 */
export interface Job {
  id: string;
  hub_agent_id: string;
  skill_id: string;
  requester_owner: string;
  /** JSON-stringified input parameters */
  params: string;
  status: JobStatus;
  /** JSON-stringified result or error (set on completed/failed) */
  result: string | null;
  /** Credit escrow ID held for this job */
  escrow_id: string | null;
  /** The relay owner this job targets (for dispatch on reconnect) */
  relay_owner: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Table init
// ---------------------------------------------------------------------------

/**
 * Creates the hub_agent_jobs table if it does not already exist.
 * Idempotent -- safe to call multiple times.
 *
 * @param db - The SQLite database instance (registryDb).
 */
export function initJobQueue(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_agent_jobs (
      id TEXT PRIMARY KEY,
      hub_agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      requester_owner TEXT NOT NULL,
      params TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      escrow_id TEXT,
      relay_owner TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/** Input for creating a new job */
export interface InsertJobInput {
  hub_agent_id: string;
  skill_id: string;
  requester_owner: string;
  params: Record<string, unknown>;
  escrow_id?: string;
  relay_owner?: string;
}

/**
 * Inserts a new job into the queue with status 'queued'.
 *
 * @param db - The SQLite database instance.
 * @param input - Job creation parameters.
 * @returns The newly created Job object.
 */
export function insertJob(db: Database.Database, input: InsertJobInput): Job {
  const id = randomUUID();
  const now = new Date().toISOString();
  const paramsJson = JSON.stringify(input.params);

  db.prepare(`
    INSERT INTO hub_agent_jobs (id, hub_agent_id, skill_id, requester_owner, params, status, escrow_id, relay_owner, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
  `).run(
    id,
    input.hub_agent_id,
    input.skill_id,
    input.requester_owner,
    paramsJson,
    input.escrow_id ?? null,
    input.relay_owner ?? null,
    now,
    now,
  );

  return {
    id,
    hub_agent_id: input.hub_agent_id,
    skill_id: input.skill_id,
    requester_owner: input.requester_owner,
    params: paramsJson,
    status: 'queued',
    result: null,
    escrow_id: input.escrow_id ?? null,
    relay_owner: input.relay_owner ?? null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Retrieves a single job by ID.
 *
 * @param db - The SQLite database instance.
 * @param jobId - The job ID to look up.
 * @returns The Job object or null if not found.
 */
export function getJob(db: Database.Database, jobId: string): Job | null {
  const row = db.prepare('SELECT * FROM hub_agent_jobs WHERE id = ?').get(jobId) as Job | undefined;
  return row ?? null;
}

/**
 * Lists all jobs for a given Hub Agent, ordered by created_at DESC.
 * Optionally filters by status.
 *
 * @param db - The SQLite database instance.
 * @param hubAgentId - The Hub Agent ID to list jobs for.
 * @param status - Optional status filter.
 * @returns Array of Job objects.
 */
export function listJobs(db: Database.Database, hubAgentId: string, status?: JobStatus): Job[] {
  if (status) {
    return db.prepare(
      'SELECT * FROM hub_agent_jobs WHERE hub_agent_id = ? AND status = ? ORDER BY created_at DESC',
    ).all(hubAgentId, status) as Job[];
  }
  return db.prepare(
    'SELECT * FROM hub_agent_jobs WHERE hub_agent_id = ? ORDER BY created_at DESC',
  ).all(hubAgentId) as Job[];
}

/**
 * Updates the status (and optionally result) of a job.
 *
 * @param db - The SQLite database instance.
 * @param jobId - The job ID to update.
 * @param status - New status value.
 * @param result - Optional JSON-stringified result or error message.
 */
export function updateJobStatus(
  db: Database.Database,
  jobId: string,
  status: JobStatus,
  result?: string,
): void {
  const now = new Date().toISOString();
  if (result !== undefined) {
    db.prepare('UPDATE hub_agent_jobs SET status = ?, result = ?, updated_at = ? WHERE id = ?')
      .run(status, result, now, jobId);
  } else {
    db.prepare('UPDATE hub_agent_jobs SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, jobId);
  }
}

/**
 * Returns all queued jobs that target a given relay_owner.
 * Used by the relay bridge to find jobs to dispatch when an agent reconnects.
 *
 * @param db - The SQLite database instance.
 * @param relayOwner - The relay owner identifier.
 * @returns Array of queued Job objects for this relay owner.
 */
export function getJobsByRelayOwner(db: Database.Database, relayOwner: string): Job[] {
  return db.prepare(
    'SELECT * FROM hub_agent_jobs WHERE relay_owner = ? AND status = ? ORDER BY created_at ASC',
  ).all(relayOwner, 'queued') as Job[];
}
