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
    created_at TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_provider_events_type
    ON provider_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_provider_events_created
    ON provider_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_provider_events_agent_id
    ON provider_events(agent_id, created_at DESC);
`;

/**
 * Creates the provider_events table if it does not exist.
 *
 * Idempotent: safe to call after the registry migration runner has already
 * added the agent_id column on existing databases. Tests that construct a
 * provider_events table directly via this function get the new schema with
 * the column already present.
 */
export function ensureProviderEventsTable(db: Database.Database): void {
  db.exec(PROVIDER_EVENTS_SCHEMA);

  // Migration safety: production DBs created before the agent_id column may
  // already have the table without the column. Add it idempotently.
  try {
    const cols = db.prepare("PRAGMA table_info(provider_events)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'agent_id')) {
      db.exec("ALTER TABLE provider_events ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_provider_events_agent_id
          ON provider_events(agent_id, created_at DESC);
      `);
    }
  } catch {
    // PRAGMA fail is non-fatal — schema CREATE above already enforces the column.
  }
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
  /**
   * Canonical agent_id of the PROVIDER (event owner). Used to filter
   * /me/events and /me/stats per-identity (audit P0, findings #3-#5).
   *
   * Stored as empty string for legacy events written before the column
   * existed. Empty-string events are NEVER returned by per-identity queries —
   * they are only visible via internal audit reads.
   */
  agent_id: string;
}

/**
 * Input for emitting a new event (id and created_at are auto-generated).
 *
 * `agent_id` is optional in the input type for backward compatibility — when
 * omitted it is stored as the empty string and the event is excluded from
 * per-identity dashboard queries. NEW production callers MUST always pass
 * the canonical provider agent_id; only legacy / test callers may rely on
 * the empty default.
 */
export type EmitEventInput = Omit<ProviderEvent, 'id' | 'created_at' | 'agent_id'> & {
  agent_id?: string;
};

/** Aggregated provider stats for a time period. */
export interface ProviderStats {
  total_earnings: number;
  total_spending: number;
  net_pnl: number;
  total_executions: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  active_sessions: number;
  top_skills: Array<{ skill_id: string; count: number; earnings: number }>;
  top_requesters: Array<{ requester: string; count: number }>;
  /** Daily earnings for the last 7 days (oldest first). */
  earnings_timeline: Array<{ date: string; earnings: number }>;
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
  // agent_id is required for per-identity scoping but defaults to '' for
  // backward compatibility with legacy callers that have not yet been threaded
  // through the canonicalize -> emit pipeline.
  const agentId = event.agent_id ?? '';

  db.prepare(`
    INSERT INTO provider_events (id, event_type, skill_id, session_id, requester, credits, duration_ms, metadata, created_at, agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.event_type,
    event.skill_id,
    event.session_id,
    event.requester,
    event.credits,
    event.duration_ms,
    metadataJson,
    created_at,
    agentId,
  );

  return { ...event, id, created_at, agent_id: agentId };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Options for querying provider events. */
export interface GetEventsOptions {
  limit?: number;
  since?: string;
  event_type?: ProviderEventType;
  /**
   * Canonical agent_id of the provider whose events should be returned.
   *
   * REQUIRED for per-identity scoping after audit P0 (findings #3-#5). When
   * provided, the query filters by `agent_id = ?` AND skips legacy rows whose
   * agent_id is the empty string. When omitted, the query returns ALL events
   * regardless of provider — preserve this only for internal admin audit
   * reads, never for owner dashboards.
   */
  agent_id?: string;
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

  if (opts.agent_id !== undefined) {
    // Empty agent_id is filtered out so legacy unscoped rows never leak across
    // identities. A caller passing an empty string still gets nothing.
    conditions.push("agent_id = ? AND agent_id <> ''");
    params.push(opts.agent_id);
  }

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
 * @param agentId - REQUIRED canonical agent_id for per-identity scoping (audit
 *   P0). When omitted, the function aggregates across ALL providers — keep
 *   that path for internal admin reads only, never for owner dashboards.
 * @returns Aggregated stats.
 */
export function getProviderStats(
  db: Database.Database,
  period: '24h' | '7d' | '30d' = '7d',
  agentId?: string,
): ProviderStats {
  const cutoff = new Date(Date.now() - (PERIOD_MS[period] ?? PERIOD_MS['7d']!)).toISOString();

  // Per-identity scoping clause — applied to every aggregation query so the
  // owner dashboard never sees totals from a different identity.
  const identityClause = agentId !== undefined ? "AND agent_id = ? AND agent_id <> ''" : '';
  const identityParam: unknown[] = agentId !== undefined ? [agentId] : [];

  // Earnings + execution counts
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN event_type = 'skill.executed' THEN credits ELSE 0 END), 0) as total_earnings,
      COUNT(CASE WHEN event_type IN ('skill.executed', 'skill.failed') THEN 1 END) as total_executions,
      COUNT(CASE WHEN event_type = 'skill.executed' THEN 1 END) as success_count,
      COUNT(CASE WHEN event_type = 'skill.failed' THEN 1 END) as failure_count
    FROM provider_events
    WHERE created_at >= ? ${identityClause}
  `).get(cutoff, ...identityParam) as { total_earnings: number; total_executions: number; success_count: number; failure_count: number };

  // Active sessions (opened but not ended)
  const activeSessions = db.prepare(`
    SELECT COUNT(DISTINCT session_id) as cnt
    FROM provider_events
    WHERE event_type = 'session.opened'
      ${identityClause}
      AND session_id NOT IN (
        SELECT DISTINCT session_id FROM provider_events
        WHERE event_type IN ('session.ended', 'session.failed')
          AND session_id IS NOT NULL
          ${identityClause}
      )
      AND session_id IS NOT NULL
  `).get(...identityParam, ...identityParam) as { cnt: number };

  // Top skills
  const topSkills = db.prepare(`
    SELECT skill_id, COUNT(*) as count, COALESCE(SUM(credits), 0) as earnings
    FROM provider_events
    WHERE event_type = 'skill.executed' AND created_at >= ? AND skill_id IS NOT NULL ${identityClause}
    GROUP BY skill_id
    ORDER BY count DESC
    LIMIT 10
  `).all(cutoff, ...identityParam) as Array<{ skill_id: string; count: number; earnings: number }>;

  // Top requesters
  const topRequesters = db.prepare(`
    SELECT requester, COUNT(*) as count
    FROM provider_events
    WHERE event_type IN ('skill.executed', 'session.opened') AND created_at >= ? AND requester IS NOT NULL ${identityClause}
    GROUP BY requester
    ORDER BY count DESC
    LIMIT 10
  `).all(cutoff, ...identityParam) as Array<{ requester: string; count: number }>;

  // Earnings timeline — last 7 days, grouped by date (UTC)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const timelineRows = db.prepare(`
    SELECT DATE(created_at) as date, COALESCE(SUM(credits), 0) as earnings
    FROM provider_events
    WHERE event_type = 'skill.executed' AND created_at >= ? ${identityClause}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(sevenDaysAgo, ...identityParam) as Array<{ date: string; earnings: number }>;

  // Fill missing days with 0
  const timelineMap = new Map(timelineRows.map((r) => [r.date, r.earnings]));
  const earnings_timeline: Array<{ date: string; earnings: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    earnings_timeline.push({ date: dateStr, earnings: timelineMap.get(dateStr) ?? 0 });
  }

  const successRate = summary.total_executions > 0
    ? summary.success_count / summary.total_executions
    : 1.0;

  return {
    total_earnings: summary.total_earnings,
    total_spending: 0, // Filled by API layer (reads credit_transactions)
    net_pnl: summary.total_earnings,
    total_executions: summary.total_executions,
    success_count: summary.success_count,
    failure_count: summary.failure_count,
    success_rate: Math.round(successRate * 1000) / 1000,
    active_sessions: activeSessions.cnt,
    top_skills: topSkills,
    top_requesters: topRequesters,
    earnings_timeline,
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
    agent_id: (row['agent_id'] as string) ?? '',
  };
}
