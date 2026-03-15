import type Database from 'better-sqlite3';

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

  // Add skill_id column if it does not already exist.
  // ALTER TABLE ADD COLUMN is idempotent via try/catch — SQLite will throw if the
  // column already exists, which we silently ignore.
  try {
    db.exec('ALTER TABLE request_log ADD COLUMN skill_id TEXT');
  } catch {
    // Column already exists — ignore
  }

  // Add action_type column for autonomy audit events (Phase 5+).
  try {
    db.exec('ALTER TABLE request_log ADD COLUMN action_type TEXT');
  } catch {
    // Column already exists — ignore
  }

  // Add tier_invoked column for autonomy audit events (Phase 5+).
  try {
    db.exec('ALTER TABLE request_log ADD COLUMN tier_invoked INTEGER');
  } catch {
    // Column already exists — ignore
  }
}

/**
 * Inserts a request log entry into the request_log table.
 *
 * @param db - Open database instance.
 * @param entry - The log entry to insert.
 */
export function insertRequestLog(db: Database.Database, entry: RequestLogEntry): void {
  const stmt = db.prepare(`
    INSERT INTO request_log (id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at, skill_id, action_type, tier_invoked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    entry.tier_invoked ?? null
  );
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
export function getRequestLog(
  db: Database.Database,
  limit = 10,
  since?: SincePeriod
): RequestLogEntry[] {
  if (since !== undefined) {
    const cutoff = new Date(Date.now() - SINCE_MS[since]).toISOString();
    const stmt = db.prepare(`
      SELECT id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at, skill_id, action_type, tier_invoked
      FROM request_log
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(cutoff, limit) as RequestLogEntry[];
  }

  const stmt = db.prepare(`
    SELECT id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at, skill_id
    FROM request_log
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as RequestLogEntry[];
}
