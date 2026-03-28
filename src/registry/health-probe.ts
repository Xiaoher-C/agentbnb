import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SKILL_HEALTH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS skill_health (
    card_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    last_check TEXT,
    avg_latency_ms INTEGER DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    total_checks INTEGER NOT NULL DEFAULT 0,
    total_successes INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (card_id, skill_id)
  );
`;

/** Skill health status */
export type SkillHealthStatus = 'ok' | 'degraded' | 'offline' | 'unknown';

/** Skill health record */
export interface SkillHealth {
  card_id: string;
  skill_id: string;
  status: SkillHealthStatus;
  last_check: string | null;
  avg_latency_ms: number;
  consecutive_failures: number;
  total_checks: number;
  total_successes: number;
}

/** Health probe result from an agent */
export interface HealthProbeResult {
  skill_id: string;
  status: 'ok' | 'error';
  latency_ms: number;
  error_message?: string;
}

/** Agent trust level based on transaction history */
export type TrustLevel = 'new' | 'unverified' | 'verified';

/**
 * Creates the skill_health table if it does not exist.
 */
export function ensureSkillHealthTable(db: Database.Database): void {
  db.exec(SKILL_HEALTH_SCHEMA);
}

// ---------------------------------------------------------------------------
// Health tracking
// ---------------------------------------------------------------------------

/**
 * Records a health probe result for a skill.
 * Updates status, latency, and failure counters.
 *
 * Status transitions:
 * - 0 consecutive failures → 'ok'
 * - 1-2 consecutive failures → 'degraded'
 * - 3+ consecutive failures → 'offline'
 */
export function recordHealthProbe(
  db: Database.Database,
  cardId: string,
  skillId: string,
  result: HealthProbeResult,
): void {
  const now = new Date().toISOString();

  // Ensure row exists
  db.prepare(
    `INSERT OR IGNORE INTO skill_health
     (card_id, skill_id, status, last_check, avg_latency_ms, consecutive_failures, total_checks, total_successes, updated_at)
     VALUES (?, ?, 'unknown', NULL, 0, 0, 0, 0, ?)`,
  ).run(cardId, skillId, now);

  if (result.status === 'ok') {
    // Update rolling average latency: avg = (avg * (n-1) + new) / n
    db.prepare(
      `UPDATE skill_health
       SET status = 'ok',
           last_check = ?,
           avg_latency_ms = CASE WHEN total_checks = 0 THEN ? ELSE (avg_latency_ms * total_checks + ?) / (total_checks + 1) END,
           consecutive_failures = 0,
           total_checks = total_checks + 1,
           total_successes = total_successes + 1,
           updated_at = ?
       WHERE card_id = ? AND skill_id = ?`,
    ).run(now, result.latency_ms, result.latency_ms, now, cardId, skillId);
  } else {
    // Increment failure counter and update status
    const row = db.prepare(
      'SELECT consecutive_failures FROM skill_health WHERE card_id = ? AND skill_id = ?',
    ).get(cardId, skillId) as { consecutive_failures: number } | undefined;

    const failures = (row?.consecutive_failures ?? 0) + 1;
    const status: SkillHealthStatus = failures >= 3 ? 'offline' : 'degraded';

    db.prepare(
      `UPDATE skill_health
       SET status = ?,
           last_check = ?,
           consecutive_failures = ?,
           total_checks = total_checks + 1,
           updated_at = ?
       WHERE card_id = ? AND skill_id = ?`,
    ).run(status, now, failures, now, cardId, skillId);
  }
}

/**
 * Returns health status for all skills of a card.
 */
export function getCardHealth(
  db: Database.Database,
  cardId: string,
): SkillHealth[] {
  return db.prepare(
    'SELECT * FROM skill_health WHERE card_id = ? ORDER BY skill_id',
  ).all(cardId) as SkillHealth[];
}

/**
 * Returns health status for a specific skill.
 */
export function getSkillHealth(
  db: Database.Database,
  cardId: string,
  skillId: string,
): SkillHealth | null {
  return (db.prepare(
    'SELECT * FROM skill_health WHERE card_id = ? AND skill_id = ?',
  ).get(cardId, skillId) as SkillHealth | undefined) ?? null;
}

/**
 * Returns all skills with a specific health status.
 */
export function getSkillsByStatus(
  db: Database.Database,
  status: SkillHealthStatus,
): SkillHealth[] {
  return db.prepare(
    'SELECT * FROM skill_health WHERE status = ? ORDER BY card_id, skill_id',
  ).all(status) as SkillHealth[];
}

// ---------------------------------------------------------------------------
// Security scanning (Phase 6C — basic trust level)
// ---------------------------------------------------------------------------

/**
 * Determines the trust level of an agent based on transaction history.
 *
 * - 'new': agent registered but has < 10 successful transactions
 * - 'unverified': placeholder (no verification engine yet)
 * - 'verified': >= 10 successful transactions with no disputes
 *
 * @param db - Registry or credit database with request_log or credit_transactions.
 * @param owner - Agent identifier.
 * @returns Trust level.
 */
export function getAgentTrustLevel(
  db: Database.Database,
  owner: string,
): TrustLevel {
  // Check if request_log table exists (registry DB)
  const hasRequestLog = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='request_log'",
  ).get() as { name: string } | undefined;

  if (hasRequestLog) {
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM request_log
       WHERE requester = ? AND status = 'success'`,
    ).get(owner) as { cnt: number };

    return row.cnt >= 10 ? 'verified' : 'new';
  }

  // Fallback: check credit_transactions (credit DB)
  const hasCreditTx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='credit_transactions'",
  ).get() as { name: string } | undefined;

  if (hasCreditTx) {
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM credit_transactions
       WHERE owner = ? AND reason = 'settlement'`,
    ).get(owner) as { cnt: number };

    return row.cnt >= 10 ? 'verified' : 'new';
  }

  return 'new';
}

/** Suspicious command patterns for CommandExecutor skills */
const SUSPICIOUS_PATTERNS = [
  /curl\s+.*\d+\.\d+\.\d+\.\d+/i,        // curl to raw IP
  /base64\s+-d/i,                           // base64 decode (payload obfuscation)
  /wget\s+.*\d+\.\d+\.\d+\.\d+/i,         // wget to raw IP
  /eval\s*\(/i,                             // eval() in commands
  /\$\(.*curl/i,                            // command substitution with curl
  /nc\s+-[le]/i,                            // netcat listeners
  /rm\s+-rf\s+\//i,                         // destructive rm
];

/**
 * Scans a skill configuration for suspicious patterns.
 * Returns an array of warning strings (empty if clean).
 *
 * @param skillConfig - The skill configuration object.
 * @returns Array of warning messages.
 */
export function scanSkillConfig(
  skillConfig: Record<string, unknown>,
): string[] {
  const warnings: string[] = [];
  const configStr = JSON.stringify(skillConfig);

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(configStr)) {
      warnings.push(`Suspicious pattern detected: ${pattern.source}`);
    }
  }

  return warnings;
}
