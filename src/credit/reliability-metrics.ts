import type Database from 'better-sqlite3';
import { canonicalizeCreditOwner } from './owner-normalization.js';

/**
 * Provider reliability metrics — tracks streaks, repeat hires, feedback, and availability.
 * Collected incrementally by escrow settlement, failure handling, feedback, and health checks.
 */

/** Schema for the provider_reliability_metrics table */
export const RELIABILITY_METRICS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS provider_reliability_metrics (
    owner TEXT PRIMARY KEY,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    total_hires INTEGER NOT NULL DEFAULT 0,
    repeat_hires INTEGER NOT NULL DEFAULT 0,
    feedback_count INTEGER NOT NULL DEFAULT 0,
    feedback_sum REAL NOT NULL DEFAULT 0,
    availability_checks INTEGER NOT NULL DEFAULT 0,
    availability_hits INTEGER NOT NULL DEFAULT 0,
    cycle_start TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * Read-only metrics returned by getReliabilityMetrics().
 */
export interface ReliabilityMetrics {
  current_streak: number;
  longest_streak: number;
  total_hires: number;
  repeat_hires: number;
  repeat_hire_rate: number;
  avg_feedback_score: number;
  availability_rate: number;
}

/**
 * Ensures the provider_reliability_metrics table exists.
 *
 * @param db - Credit database instance.
 */
export function ensureReliabilityTable(db: Database.Database): void {
  db.exec(RELIABILITY_METRICS_SCHEMA);
}

/**
 * Ensures a row exists for the given owner, creating one if needed.
 */
function ensureRow(db: Database.Database, owner: string): void {
  const canonicalOwner = canonicalizeCreditOwner(db, owner);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO provider_reliability_metrics
     (owner, current_streak, longest_streak, total_hires, repeat_hires,
      feedback_count, feedback_sum, availability_checks, availability_hits,
      cycle_start, updated_at)
     VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
  ).run(canonicalOwner, now, now);
}

/**
 * Records a successful hire (escrow settlement).
 * Increments streak, total_hires, and checks for repeat hire.
 *
 * @param db - Credit database instance.
 * @param providerOwner - The provider who completed the hire.
 * @param consumerOwner - The consumer who requested the hire.
 */
export function recordSuccessfulHire(
  db: Database.Database,
  providerOwner: string,
  consumerOwner: string,
): void {
  const canonicalProviderOwner = canonicalizeCreditOwner(db, providerOwner);
  const canonicalConsumerOwner = canonicalizeCreditOwner(db, consumerOwner);
  const now = new Date().toISOString();
  ensureRow(db, canonicalProviderOwner);

  // Check repeat hire by looking at settlement transactions for this provider from this consumer
  const isRepeat = db.prepare(
    `SELECT COUNT(*) as cnt FROM credit_transactions
     WHERE owner = ? AND reason = 'settlement'
     AND reference_id IN (
       SELECT id FROM credit_escrow WHERE owner = ?
     )`,
  ).get(canonicalProviderOwner, canonicalConsumerOwner) as { cnt: number } | undefined;

  const repeatIncrement = (isRepeat?.cnt ?? 0) > 0 ? 1 : 0;

  db.prepare(
    `UPDATE provider_reliability_metrics
     SET current_streak = current_streak + 1,
         longest_streak = MAX(longest_streak, current_streak + 1),
         total_hires = total_hires + 1,
         repeat_hires = repeat_hires + ?,
         updated_at = ?
     WHERE owner = ?`,
  ).run(repeatIncrement, now, canonicalProviderOwner);
}

/**
 * Records a quality failure (bad_execution or auth_error).
 * Resets the current streak to 0.
 *
 * @param db - Credit database instance.
 * @param providerOwner - The provider who failed.
 */
export function recordQualityFailure(
  db: Database.Database,
  providerOwner: string,
): void {
  const canonicalProviderOwner = canonicalizeCreditOwner(db, providerOwner);
  const now = new Date().toISOString();
  ensureRow(db, canonicalProviderOwner);

  db.prepare(
    `UPDATE provider_reliability_metrics
     SET current_streak = 0, updated_at = ?
     WHERE owner = ?`,
  ).run(now, canonicalProviderOwner);
}

/**
 * Records a feedback submission.
 *
 * @param db - Credit database instance.
 * @param providerOwner - The provider receiving feedback.
 * @param score - The feedback score (0-5 or 0-1 depending on system).
 */
export function recordFeedback(
  db: Database.Database,
  providerOwner: string,
  score: number,
): void {
  const canonicalProviderOwner = canonicalizeCreditOwner(db, providerOwner);
  const now = new Date().toISOString();
  ensureRow(db, canonicalProviderOwner);

  db.prepare(
    `UPDATE provider_reliability_metrics
     SET feedback_count = feedback_count + 1,
         feedback_sum = feedback_sum + ?,
         updated_at = ?
     WHERE owner = ?`,
  ).run(score, now, canonicalProviderOwner);
}

/**
 * Records a health check availability result.
 *
 * @param db - Credit database instance.
 * @param providerOwner - The provider being checked.
 * @param wasAvailable - Whether the provider responded to the ping.
 */
export function recordAvailabilityCheck(
  db: Database.Database,
  providerOwner: string,
  wasAvailable: boolean,
): void {
  const canonicalProviderOwner = canonicalizeCreditOwner(db, providerOwner);
  const now = new Date().toISOString();
  ensureRow(db, canonicalProviderOwner);

  db.prepare(
    `UPDATE provider_reliability_metrics
     SET availability_checks = availability_checks + 1,
         availability_hits = availability_hits + ?,
         updated_at = ?
     WHERE owner = ?`,
  ).run(wasAvailable ? 1 : 0, now, canonicalProviderOwner);
}

/**
 * Returns reliability metrics for a provider, or null if no data exists.
 *
 * @param db - Credit database instance.
 * @param owner - Provider agent identifier.
 * @returns Computed reliability metrics or null.
 */
export function getReliabilityMetrics(
  db: Database.Database,
  owner: string,
): ReliabilityMetrics | null {
  const canonicalOwner = canonicalizeCreditOwner(db, owner);
  const row = db.prepare(
    `SELECT current_streak, longest_streak, total_hires, repeat_hires,
            feedback_count, feedback_sum, availability_checks, availability_hits
     FROM provider_reliability_metrics WHERE owner = ?`,
  ).get(canonicalOwner) as {
    current_streak: number;
    longest_streak: number;
    total_hires: number;
    repeat_hires: number;
    feedback_count: number;
    feedback_sum: number;
    availability_checks: number;
    availability_hits: number;
  } | undefined;

  if (!row) return null;

  return {
    current_streak: row.current_streak,
    longest_streak: row.longest_streak,
    total_hires: row.total_hires,
    repeat_hires: row.repeat_hires,
    repeat_hire_rate: row.total_hires > 0 ? row.repeat_hires / row.total_hires : 0,
    avg_feedback_score: row.feedback_count > 0 ? row.feedback_sum / row.feedback_count : 0,
    availability_rate: row.availability_checks > 0 ? row.availability_hits / row.availability_checks : 0,
  };
}
