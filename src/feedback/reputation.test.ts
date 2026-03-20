import { describe, it, expect } from 'vitest';
import { computeReputation } from './reputation.js';
import type { StructuredFeedback } from './schema.js';

/** Helper to build a StructuredFeedback with a specific age in days from now. */
function makeFeedback(
  overrides: Partial<StructuredFeedback> & { ageDays?: number },
): StructuredFeedback {
  const ageDays = overrides.ageDays ?? 0;
  const timestamp = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
  const { ageDays: _, ...rest } = overrides;
  return {
    transaction_id: '00000000-0000-4000-8000-000000000001',
    provider_agent: 'agent-alpha',
    skill_id: 'skill-1',
    requester_agent: 'agent-beta',
    rating: 3,
    latency_ms: 1000,
    result_quality: 'acceptable',
    would_reuse: true,
    cost_value_ratio: 'fair',
    timestamp,
    ...rest,
  };
}

describe('computeReputation', () => {
  it('returns 0.5 (cold start) for empty feedbacks array', () => {
    expect(computeReputation([])).toBe(0.5);
  });

  it('returns near 1.0 for all perfect signals', () => {
    const feedback = makeFeedback({
      rating: 5,
      result_quality: 'excellent',
      would_reuse: true,
      cost_value_ratio: 'great',
      ageDays: 0,
    });
    const score = computeReputation([feedback]);
    // rating=5→1.0, quality=excellent→1.0, would_reuse=true→1.0, cost=great→1.0
    // weighted: 0.4*1.0 + 0.3*1.0 + 0.2*1.0 + 0.1*1.0 = 1.0
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('returns near 0 for all worst-case signals', () => {
    const feedback = makeFeedback({
      rating: 1,
      result_quality: 'failed',
      would_reuse: false,
      cost_value_ratio: 'overpriced',
      ageDays: 0,
    });
    const score = computeReputation([feedback]);
    // rating=1→0.0, quality=failed→0.0, would_reuse=false→0.0, cost=overpriced→0.2
    // weighted: 0.4*0 + 0.3*0 + 0.2*0 + 0.1*0.2 = 0.02
    expect(score).toBeCloseTo(0.02, 2);
  });

  it('recent poor feedback drops score more than old poor feedback', () => {
    const recentPoor = makeFeedback({
      rating: 1,
      result_quality: 'failed',
      would_reuse: false,
      cost_value_ratio: 'overpriced',
      ageDays: 0,
    });
    const oldPoor = makeFeedback({
      rating: 1,
      result_quality: 'failed',
      would_reuse: false,
      cost_value_ratio: 'overpriced',
      ageDays: 60,
    });

    const scoreRecent = computeReputation([recentPoor]);
    const scoreOld = computeReputation([oldPoor]);

    // Both compute the same raw component score; but they are both single items.
    // With recency decay, same component score → same normalized result.
    // Both should be near 0.02 (the worst case for a single feedback).
    // To test decay impact, compare mixed: perfect + recent-poor vs perfect + old-poor.
    const perfectBase = makeFeedback({
      rating: 5,
      result_quality: 'excellent',
      would_reuse: true,
      cost_value_ratio: 'great',
      ageDays: 1,
    });

    const mixedRecent = computeReputation([perfectBase, recentPoor]);
    const mixedOld = computeReputation([perfectBase, oldPoor]);

    // Recent poor feedback should pull the score down more than old poor feedback
    expect(mixedRecent).toBeLessThan(mixedOld);

    // Individual scores should both be low
    expect(scoreRecent).toBeLessThan(0.1);
    expect(scoreOld).toBeLessThan(0.1);
  });

  it('produces a weighted average for mixed ratings', () => {
    // One perfect and one middling feedback at the same age
    const perfect = makeFeedback({
      rating: 5,
      result_quality: 'excellent',
      would_reuse: true,
      cost_value_ratio: 'great',
      ageDays: 1,
    });
    const middling = makeFeedback({
      rating: 3,
      result_quality: 'acceptable',
      would_reuse: true,
      cost_value_ratio: 'fair',
      ageDays: 1,
    });

    const score = computeReputation([perfect, middling]);
    // Should be between the two individual scores and between 0 and 1
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);

    const perfectScore = computeReputation([perfect]);
    const middlingScore = computeReputation([middling]);
    expect(score).toBeGreaterThan(middlingScore * 0.9);
    expect(score).toBeLessThan(perfectScore * 1.1);
  });

  it('clamps result to [0.0, 1.0] range', () => {
    const feedbacks = Array.from({ length: 5 }, () =>
      makeFeedback({ rating: 5, result_quality: 'excellent', would_reuse: true, cost_value_ratio: 'great' })
    );
    const score = computeReputation(feedbacks);
    expect(score).toBeGreaterThanOrEqual(0.0);
    expect(score).toBeLessThanOrEqual(1.0);
  });
});
