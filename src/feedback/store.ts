import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { StructuredFeedback } from './schema.js';

/**
 * Creates the feedback table and indexes in the given database if they do not already exist.
 * Safe to call multiple times (uses CREATE IF NOT EXISTS).
 *
 * @param db - Open database instance (WAL mode already set by caller).
 */
export function initFeedbackTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      provider_agent TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      requester_agent TEXT NOT NULL,
      rating INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      result_quality TEXT NOT NULL,
      quality_details TEXT,
      would_reuse INTEGER NOT NULL,
      cost_value_ratio TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS feedback_provider_idx ON feedback(provider_agent);
    CREATE INDEX IF NOT EXISTS feedback_skill_idx ON feedback(skill_id);
  `);
}

/**
 * Inserts a StructuredFeedback record into the feedback table.
 * Generates and returns a new UUID as the feedback_id.
 *
 * @param db - Open database instance.
 * @param feedback - Validated feedback data to insert.
 * @returns The generated feedback_id UUID string.
 */
export function insertFeedback(db: Database.Database, feedback: StructuredFeedback): string {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO feedback (
      id, transaction_id, provider_agent, skill_id, requester_agent,
      rating, latency_ms, result_quality, quality_details,
      would_reuse, cost_value_ratio, timestamp, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    feedback.transaction_id,
    feedback.provider_agent,
    feedback.skill_id,
    feedback.requester_agent,
    feedback.rating,
    feedback.latency_ms,
    feedback.result_quality,
    feedback.quality_details ?? null,
    feedback.would_reuse ? 1 : 0,
    feedback.cost_value_ratio,
    feedback.timestamp,
    now,
  );

  return id;
}

/**
 * Retrieves feedback records for a specific skill, ordered by timestamp descending.
 *
 * @param db - Open database instance.
 * @param skillId - The skill ID to query feedback for.
 * @param limit - Maximum number of records to return (default 20).
 * @returns Array of StructuredFeedback objects.
 */
export function getFeedbackForSkill(
  db: Database.Database,
  skillId: string,
  limit = 20,
): StructuredFeedback[] {
  const rows = db.prepare(`
    SELECT * FROM feedback
    WHERE skill_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(skillId, limit) as Array<Record<string, unknown>>;

  return rows.map(rowToFeedback);
}

/**
 * Retrieves all feedback records for a provider agent, optionally filtered by age.
 * Ordered by timestamp descending.
 *
 * @param db - Open database instance.
 * @param providerAgent - The provider agent identifier to query feedback for.
 * @param sinceDays - Optional filter: only include feedback from the last N days.
 * @returns Array of StructuredFeedback objects.
 */
export function getFeedbackForProvider(
  db: Database.Database,
  providerAgent: string,
  sinceDays?: number,
): StructuredFeedback[] {
  let rows: Array<Record<string, unknown>>;

  if (sinceDays !== undefined) {
    rows = db.prepare(`
      SELECT * FROM feedback
      WHERE provider_agent = ?
        AND timestamp >= datetime('now', ? || ' days')
      ORDER BY timestamp DESC
    `).all(providerAgent, `-${sinceDays}`) as Array<Record<string, unknown>>;
  } else {
    rows = db.prepare(`
      SELECT * FROM feedback
      WHERE provider_agent = ?
      ORDER BY timestamp DESC
    `).all(providerAgent) as Array<Record<string, unknown>>;
  }

  return rows.map(rowToFeedback);
}

/**
 * Converts a raw SQLite row to a StructuredFeedback object.
 * SQLite stores booleans as 0/1 integers; this converts them back.
 *
 * @param row - Raw database row.
 * @returns StructuredFeedback object.
 */
function rowToFeedback(row: Record<string, unknown>): StructuredFeedback {
  return {
    transaction_id: row['transaction_id'] as string,
    provider_agent: row['provider_agent'] as string,
    skill_id: row['skill_id'] as string,
    requester_agent: row['requester_agent'] as string,
    rating: row['rating'] as number,
    latency_ms: row['latency_ms'] as number,
    result_quality: row['result_quality'] as StructuredFeedback['result_quality'],
    quality_details: (row['quality_details'] as string | null) ?? undefined,
    would_reuse: (row['would_reuse'] as number) === 1,
    cost_value_ratio: row['cost_value_ratio'] as StructuredFeedback['cost_value_ratio'],
    timestamp: row['timestamp'] as string,
  };
}
