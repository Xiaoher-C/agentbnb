import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const PROVIDER_EVENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS provider_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    skill_id TEXT,
    session_id TEXT,
    requester TEXT,
    credits INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_provider_events_type
    ON provider_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_provider_events_created
    ON provider_events(created_at DESC);
`;

/**
 * Creates the provider_events table if it does not exist.
 */
export function ensureProviderEventsTable(db: Database.Database): void {
  db.exec(PROVIDER_EVENTS_SCHEMA);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dot-notation event types. Designed for multi-consumer subscription (Telegram, Hub, Kizuna). */
export type ProviderEventType =
  | 'skill.received'
  | 'skill.executed'
  | 'skill.failed'
  | 'skill.rejected'
  | 'session.opened'
  | 'session.message'
  | 'session.ended'
  | 'session.failed';

/** A single provider event record. */
export interface ProviderEvent {
  id: string;
  event_type: ProviderEventType;
  skill_id: string | null;
  session_id: string | null;
  requester: string | null;
  credits: number;
  duration_ms: number;
  /** JSON-serialized metadata blob. Future-proof for Kizuna and other consumers. */
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Input for emitting a new event (id and created_at are auto-generated). */
export type EmitEventInput = Omit<ProviderEvent, 'id' | 'created_at'>;

/** Aggregated provider stats for a time period. */
export interface ProviderStats {
  total_earnings: number;
  total_executions: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  active_sessions: number;
  top_skills: Array<{ skill_id: string; count: number; earnings: number }>;
  top_requesters: Array<{ requester: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/**
 * Emits a provider event into the events table.
 *
 * @param db - Registry database instance.
 * @param event - Event data (id and created_at are auto-generated).
 * @returns The emitted event with generated fields.
 */
export function emitProviderEvent(db: Database.Database, event: EmitEventInput): ProviderEvent {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const metadataJson = event.metadata ? JSON.stringify(event.metadata) : null;

  db.prepare(`
    INSERT INTO provider_events (id, event_type, skill_id, session_id, requester, credits, duration_ms, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, event.event_type, event.skill_id, event.session_id, event.requester, event.credits, event.duration_ms, metadataJson, created_at);

  return { ...event, id, created_at };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Options for querying provider events. */
export interface GetEventsOptions {
  limit?: number;
  since?: string;
  event_type?: ProviderEventType;
}

/**
 * Queries provider events with optional filtering.
 *
 * @param db - Registry database instance.
 * @param opts - Query options: limit (default 50, max 200), since (ISO timestamp), event_type filter.
 * @returns Array of ProviderEvent objects, newest first.
 */
export function getProviderEvents(db: Database.Database, opts: GetEventsOptions = {}): ProviderEvent[] {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.since) {
    conditions.push('created_at > ?');
    params.push(opts.since);
  }

  if (opts.event_type) {
    conditions.push('event_type = ?');
    params.push(opts.event_type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM provider_events ${where} ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(parseEventRow);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const PERIOD_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/**
 * Computes aggregated provider stats for a time period.
 *
 * @param db - Registry database instance.
 * @param period - Time window: '24h', '7d', or '30d'.
 * @returns Aggregated stats.
 */
export function getProviderStats(db: Database.Database, period: '24h' | '7d' | '30d' = '7d'): ProviderStats {
  const cutoff = new Date(Date.now() - (PERIOD_MS[period] ?? PERIOD_MS['7d']!)).toISOString();

  // Earnings + execution counts
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN event_type = 'skill.executed' THEN credits ELSE 0 END), 0) as total_earnings,
      COUNT(CASE WHEN event_type IN ('skill.executed', 'skill.failed') THEN 1 END) as total_executions,
      COUNT(CASE WHEN event_type = 'skill.executed' THEN 1 END) as success_count,
      COUNT(CASE WHEN event_type = 'skill.failed' THEN 1 END) as failure_count
    FROM provider_events
    WHERE created_at >= ?
  `).get(cutoff) as { total_earnings: number; total_executions: number; success_count: number; failure_count: number };

  // Active sessions (opened but not ended)
  const activeSessions = db.prepare(`
    SELECT COUNT(DISTINCT session_id) as cnt
    FROM provider_events
    WHERE event_type = 'session.opened'
      AND session_id NOT IN (
        SELECT DISTINCT session_id FROM provider_events
        WHERE event_type IN ('session.ended', 'session.failed')
          AND session_id IS NOT NULL
      )
      AND session_id IS NOT NULL
  `).get() as { cnt: number };

  // Top skills
  const topSkills = db.prepare(`
    SELECT skill_id, COUNT(*) as count, COALESCE(SUM(credits), 0) as earnings
    FROM provider_events
    WHERE event_type = 'skill.executed' AND created_at >= ? AND skill_id IS NOT NULL
    GROUP BY skill_id
    ORDER BY count DESC
    LIMIT 10
  `).all(cutoff) as Array<{ skill_id: string; count: number; earnings: number }>;

  // Top requesters
  const topRequesters = db.prepare(`
    SELECT requester, COUNT(*) as count
    FROM provider_events
    WHERE event_type IN ('skill.executed', 'session.opened') AND created_at >= ? AND requester IS NOT NULL
    GROUP BY requester
    ORDER BY count DESC
    LIMIT 10
  `).all(cutoff) as Array<{ requester: string; count: number }>;

  const successRate = summary.total_executions > 0
    ? summary.success_count / summary.total_executions
    : 1.0;

  return {
    total_earnings: summary.total_earnings,
    total_executions: summary.total_executions,
    success_count: summary.success_count,
    failure_count: summary.failure_count,
    success_rate: Math.round(successRate * 1000) / 1000,
    active_sessions: activeSessions.cnt,
    top_skills: topSkills,
    top_requesters: topRequesters,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEventRow(row: Record<string, unknown>): ProviderEvent {
  let metadata: Record<string, unknown> | null = null;
  if (typeof row['metadata'] === 'string') {
    try {
      metadata = JSON.parse(row['metadata'] as string);
    } catch {
      metadata = null;
    }
  }

  return {
    id: row['id'] as string,
    event_type: row['event_type'] as ProviderEventType,
    skill_id: (row['skill_id'] as string) ?? null,
    session_id: (row['session_id'] as string) ?? null,
    requester: (row['requester'] as string) ?? null,
    credits: (row['credits'] as number) ?? 0,
    duration_ms: (row['duration_ms'] as number) ?? 0,
    metadata,
    created_at: row['created_at'] as string,
  };
}
