import type Database from 'better-sqlite3';
import type { FailureReason } from '../types/index.js';
import { runPendingMigrations } from '../migrations/runner.js';
import { registryMigrations } from '../migrations/registry-migrations.js';

/**
 * A single entry in the request log table.
 */
export interface RequestLogEntry {
  /** UUID for this log entry. */
  id: string;
  /** UUID of the capability card that was requested. */
  card_id: string;
  /** Human-readable name of the capability card at time of request. */
  card_name: string;
  /** Owner identifier of the requesting agent. */
  requester: string;
  /** Outcome of the capability execution. */
  status: 'success' | 'failure' | 'timeout';
  /** End-to-end latency in milliseconds from escrow hold to settle/release. */
  latency_ms: number;
  /** Credits charged for this request (0 on failure/timeout). */
  credits_charged: number;
  /** ISO 8601 timestamp when this log entry was created. */
  created_at: string;
  /**
   * Identifier of the specific skill that was invoked on the card.
   * Null for v1.0 cards (no skills[] array). Used by Phase 6 for per-skill idle rate tracking.
   */
  skill_id?: string | null;
  /**
   * Type of autonomous action that created this log entry.
   * Only set for autonomy audit events (e.g. 'auto_share', 'auto_request').
   * Null for regular capability request log entries.
   */
  action_type?: string | null;
  /**
   * The autonomy tier (1, 2, or 3) that was invoked for this audit event.
   * Only set for autonomy audit events. Null for regular request log entries.
   */
  tier_invoked?: number | null;
  /**
   * Categorizes the cause of a terminal failure.
   * Null for successful requests and for rows predating the Phase 51 migration.
   * Overload failures (failure_reason = 'overload') are excluded from reputation computations.
   */
  failure_reason?: FailureReason | null;
  /**
   * UUID of the team that originated this execution.
   * Null for solo (non-team) executions and for rows predating the Phase 53 migration.
   */
  team_id?: string | null;
  /**
   * Role hint of the TeamMember that executed this subtask.
   * One of: 'researcher' | 'executor' | 'validator' | 'coordinator'.
   * Null for solo executions and for rows predating the Phase 53 migration.
   * @deprecated Use capability_type instead (Phase 52 refactor).
   */
  role?: string | null;
  /**
   * Capability type fulfilled by the TeamMember that executed this subtask.
   * Equals SubTask.required_capability (e.g. 'text_gen', 'tts').
   * Null for solo executions and for rows predating the Phase 52 migration.
   */
  capability_type?: string | null;
}

/**
 * Time window for filtering request log entries.
 * '24h' = last 24 hours, '7d' = last 7 days, '30d' = last 30 days.
 */
export type SincePeriod = '24h' | '7d' | '30d';

/** Milliseconds for each SincePeriod. */
const SINCE_MS: Record<SincePeriod, number> = {
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};

/**
 * Creates the request_log table in the given database if it does not already exist.
 * Also creates an index on created_at DESC for efficient period-filtered queries.
 * Adds skill_id column via ALTER TABLE if it does not already exist (idempotent).
 *
 * @param db - Open database instance.
 */
export function createRequestLogTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_log (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      card_name TEXT NOT NULL,
      requester TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'timeout')),
      latency_ms INTEGER NOT NULL,
      credits_charged INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS request_log_created_at_idx
      ON request_log (created_at DESC);
  `);

  // Column additions are handled by the centralized migration runner.
  // We run it here so that callers using createRequestLogTable directly
  // (e.g., tests) get a fully-migrated table without extra setup.
  runPendingMigrations(db, registryMigrations);
}

/**
 * Options affecting how a request log entry is persisted.
 */
export interface InsertRequestLogOptions {
  /**
   * When true, this request is part of a rental session (ADR-022 / ADR-024).
   * The function SKIPS the database insert entirely so no execution metadata
   * leaks into request_log for rental traffic. This is part of the
   * three-layer privacy enforcement (architectural + program invariant + test).
   *
   * Default false (legacy capability-call mode — entry is persisted).
   */
  sessionMode?: boolean;
}

/**
 * Inserts a request log entry into the request_log table.
 *
 * Privacy invariant (ADR-024): when `options.sessionMode === true`, this
 * function SKIPS persistence to enforce the rental-session privacy contract.
 * No metadata about rental session execution leaves the in-memory session
 * histories. See `src/session/privacy.test.ts` for enforcement test.
 *
 * @param db - Open database instance.
 * @param entry - The log entry to insert.
 * @param options - Optional flags. Set `sessionMode: true` for rental sessions
 *   to skip persistence entirely.
 */
export function insertRequestLog(
  db: Database.Database,
  entry: RequestLogEntry,
  options?: InsertRequestLogOptions,
): void {
  if (options?.sessionMode === true) {
    // Privacy contract (ADR-024): rental session execution leaves no trace
    // in request_log. Caller is responsible for any session-scoped accounting
    // (escrow / outcome page) which lives in src/session/* and src/credit/*.
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO request_log (id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at, skill_id, action_type, tier_invoked, failure_reason, team_id, role, capability_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    entry.id,
    entry.card_id,
    entry.card_name,
    entry.requester,
    entry.status,
    entry.latency_ms,
    entry.credits_charged,
    entry.created_at,
    entry.skill_id ?? null,
    entry.action_type ?? null,
    entry.tier_invoked ?? null,
    entry.failure_reason ?? null,
    entry.team_id ?? null,
    entry.role ?? null,
    entry.capability_type ?? null
  );
}

/**
 * Returns the count of successful capability requests for a specific skill within
 * a sliding time window. Autonomy audit rows (action_type IS NOT NULL) are excluded
 * so that auto_share / auto_request events do not inflate the request count.
 *
 * @param db - Open database instance.
 * @param skillId - The skill ID to count requests for.
 * @param windowMs - The sliding window duration in milliseconds (e.g. 60 * 60 * 1000 for 60 min).
 * @returns Number of successful non-audit requests for the skill within the window.
 */
export function getSkillRequestCount(
  db: Database.Database,
  skillId: string,
  windowMs: number
): number {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const stmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM request_log
     WHERE skill_id = ? AND created_at >= ? AND status = 'success' AND action_type IS NULL`
  );
  const row = stmt.get(skillId, cutoff) as { cnt: number };
  return row.cnt;
}

/**
 * A public activity feed entry, joining request_log with capability_cards
 * to include the provider (card owner) field.
 */
export interface ActivityFeedEntry {
  /** UUID for this log entry. */
  id: string;
  /** Human-readable name of the capability card at time of request. */
  card_name: string;
  /** Owner identifier of the requesting agent. */
  requester: string;
  /** Owner of the capability card (from LEFT JOIN), null if card was deleted. */
  provider: string | null;
  /** Outcome of the capability execution. */
  status: 'success' | 'failure' | 'timeout';
  /** Credits charged for this request. */
  credits_charged: number;
  /** End-to-end latency in milliseconds. */
  latency_ms: number;
  /** ISO 8601 timestamp when this log entry was created. */
  created_at: string;
  /**
   * Type of autonomous action, if applicable.
   * Only 'auto_share' rows appear in the public feed (auto_request rows are excluded).
   */
  action_type: string | null;
}

/**
 * Returns public activity feed entries from request_log JOIN capability_cards.
 *
 * Autonomy audit rows with action_type = 'auto_request' are excluded.
 * Auto-share events (action_type = 'auto_share') and regular exchanges
 * (action_type IS NULL) are included.
 *
 * @param db - Open database instance.
 * @param limit - Maximum number of entries to return. Defaults to 20, capped at 100.
 * @param since - Optional ISO 8601 timestamp string. When provided, only entries
 *   with created_at > since are returned (for polling-based prepend pattern).
 * @returns Array of ActivityFeedEntry objects, newest first.
 */
export function getActivityFeed(
  db: Database.Database,
  limit = 20,
  since?: string
): ActivityFeedEntry[] {
  const effectiveLimit = Math.min(limit, 100);

  if (since !== undefined) {
    const stmt = db.prepare(`
      SELECT r.id, r.card_name, r.requester, c.owner AS provider,
             r.status, r.credits_charged, r.latency_ms, r.created_at, r.action_type
      FROM request_log r
      LEFT JOIN capability_cards c ON r.card_id = c.id
      WHERE (r.action_type IS NULL OR r.action_type IN ('auto_share', 'agent_joined'))
        AND r.created_at > ?
      ORDER BY r.created_at DESC
      LIMIT ?
    `);
    return stmt.all(since, effectiveLimit) as ActivityFeedEntry[];
  }

  const stmt = db.prepare(`
    SELECT r.id, r.card_name, r.requester, c.owner AS provider,
           r.status, r.credits_charged, r.latency_ms, r.created_at, r.action_type
    FROM request_log r
    LEFT JOIN capability_cards c ON r.card_id = c.id
    WHERE (r.action_type IS NULL OR r.action_type IN ('auto_share', 'agent_joined'))
    ORDER BY r.created_at DESC
    LIMIT ?
  `);
  return stmt.all(effectiveLimit) as ActivityFeedEntry[];
}

/**
 * Retrieves request log entries from the database, newest first.
 *
 * @param db - Open database instance.
 * @param limit - Maximum number of entries to return. Defaults to 10.
 * @param since - Optional time window filter: '24h', '7d', or '30d'.
 *   When provided, only entries created within the specified window are returned.
 *   When omitted, all entries are returned (up to limit).
 * @returns Array of RequestLogEntry objects, newest first.
 */
/**
 * Counts how many skill executions have occurred today (UTC).
 * Used by the provider daily limit gate to cap incoming requests.
 *
 * Only counts non-autonomy entries (action_type IS NULL) to avoid
 * counting auto-share audit events against the daily limit.
 *
 * @param db - Open database instance (provider's registry DB).
 * @returns Number of executions today.
 */
export function countTodayExecutions(db: Database.Database): number {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const stmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM request_log
     WHERE created_at >= ? AND action_type IS NULL`,
  );
  const row = stmt.get(today + 'T00:00:00.000Z') as { cnt: number };
  return row.cnt;
}

export function getRequestLog(
  db: Database.Database,
  limit = 10,
  since?: SincePeriod
): RequestLogEntry[] {
  if (since !== undefined) {
    const cutoff = new Date(Date.now() - SINCE_MS[since]).toISOString();
    const stmt = db.prepare(`
      SELECT id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at, skill_id, action_type, tier_invoked, failure_reason, team_id, role, capability_type
      FROM request_log
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(cutoff, limit) as RequestLogEntry[];
  }

  const stmt = db.prepare(`
    SELECT id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at, skill_id, action_type, tier_invoked, failure_reason, team_id, role
    FROM request_log
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as RequestLogEntry[];
}
