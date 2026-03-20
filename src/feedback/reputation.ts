import type Database from 'better-sqlite3';
import type { StructuredFeedback } from './schema.js';
import { getFeedbackForProvider } from './store.js';

/** Mapping from result_quality enum to numeric score (0.0 - 1.0). */
const QUALITY_SCORES: Record<StructuredFeedback['result_quality'], number> = {
  excellent: 1.0,
  good: 0.8,
  acceptable: 0.6,
  poor: 0.3,
  failed: 0.0,
};

/** Mapping from cost_value_ratio enum to numeric score (0.0 - 1.0). */
const COST_VALUE_SCORES: Record<StructuredFeedback['cost_value_ratio'], number> = {
  great: 1.0,
  fair: 0.6,
  overpriced: 0.2,
};

/** Decay constant for recency weighting: half-life ~= 21 days. */
const DECAY_DAYS = 30;

/** Component weights — must sum to 1.0. */
const WEIGHTS = {
  rating: 0.4,
  quality: 0.3,
  would_reuse: 0.2,
  cost_value: 0.1,
} as const;

/**
 * Computes a reputation score (0.0 - 1.0) from an array of StructuredFeedback entries.
 *
 * - Returns 0.5 (cold-start default) for empty arrays.
 * - Applies exponential recency decay: weight = e^(-age_days / 30).
 * - Component weights: rating 0.4, quality 0.3, would_reuse 0.2, cost_value 0.1.
 *
 * @param feedbacks - Array of StructuredFeedback records (may be empty).
 * @returns Reputation score in range [0.0, 1.0].
 */
export function computeReputation(feedbacks: StructuredFeedback[]): number {
  if (feedbacks.length === 0) return 0.5;

  const now = Date.now();
  let weightedSum = 0;
  let totalWeight = 0;

  for (const fb of feedbacks) {
    const feedbackDate = new Date(fb.timestamp).getTime();
    const ageDays = Math.max(0, (now - feedbackDate) / (1000 * 60 * 60 * 24));
    const recencyWeight = Math.exp(-ageDays / DECAY_DAYS);

    // Normalise rating (1-5) to 0.0-1.0
    const ratingScore = (fb.rating - 1) / 4;
    const qualityScore = QUALITY_SCORES[fb.result_quality];
    const reuseScore = fb.would_reuse ? 1.0 : 0.0;
    const costScore = COST_VALUE_SCORES[fb.cost_value_ratio];

    const componentScore =
      WEIGHTS.rating * ratingScore +
      WEIGHTS.quality * qualityScore +
      WEIGHTS.would_reuse * reuseScore +
      WEIGHTS.cost_value * costScore;

    weightedSum += recencyWeight * componentScore;
    totalWeight += recencyWeight;
  }

  if (totalWeight === 0) return 0.5;

  const raw = weightedSum / totalWeight;
  // Clamp to [0.0, 1.0] to guard against floating-point edge cases
  return Math.max(0.0, Math.min(1.0, raw));
}

/**
 * Retrieves all feedback for a provider agent and computes their reputation score.
 *
 * @param db - Open database instance.
 * @param agentId - Provider agent identifier.
 * @returns Reputation score in range [0.0, 1.0] (0.5 if no feedback exists).
 */
export function getReputationScore(db: Database.Database, agentId: string): number {
  const feedbacks = getFeedbackForProvider(db, agentId);
  return computeReputation(feedbacks);
}
