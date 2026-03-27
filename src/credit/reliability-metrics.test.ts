import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openCreditDb } from './ledger.js';
import {
  ensureReliabilityTable,
  recordSuccessfulHire,
  recordQualityFailure,
  recordFeedback,
  recordAvailabilityCheck,
  getReliabilityMetrics,
} from './reliability-metrics.js';

describe('Provider Reliability Metrics', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    ensureReliabilityTable(db);
  });

  it('returns null for unknown provider', () => {
    expect(getReliabilityMetrics(db, 'unknown')).toBeNull();
  });

  it('records a successful hire and increments streak', () => {
    recordSuccessfulHire(db, 'provider-a', 'consumer-x');
    const m = getReliabilityMetrics(db, 'provider-a');
    expect(m).not.toBeNull();
    expect(m!.current_streak).toBe(1);
    expect(m!.longest_streak).toBe(1);
    expect(m!.total_hires).toBe(1);
  });

  it('increments streak on consecutive successes', () => {
    recordSuccessfulHire(db, 'provider-a', 'consumer-x');
    recordSuccessfulHire(db, 'provider-a', 'consumer-y');
    recordSuccessfulHire(db, 'provider-a', 'consumer-z');
    const m = getReliabilityMetrics(db, 'provider-a')!;
    expect(m.current_streak).toBe(3);
    expect(m.longest_streak).toBe(3);
    expect(m.total_hires).toBe(3);
  });

  it('resets current_streak on quality failure but preserves longest', () => {
    recordSuccessfulHire(db, 'provider-a', 'consumer-x');
    recordSuccessfulHire(db, 'provider-a', 'consumer-y');
    recordQualityFailure(db, 'provider-a');
    const m = getReliabilityMetrics(db, 'provider-a')!;
    expect(m.current_streak).toBe(0);
    expect(m.longest_streak).toBe(2);
    expect(m.total_hires).toBe(2);
  });

  it('tracks feedback score average', () => {
    recordFeedback(db, 'provider-a', 4.0);
    recordFeedback(db, 'provider-a', 5.0);
    recordFeedback(db, 'provider-a', 3.0);
    const m = getReliabilityMetrics(db, 'provider-a')!;
    expect(m.avg_feedback_score).toBe(4.0);
  });

  it('tracks availability rate', () => {
    recordAvailabilityCheck(db, 'provider-a', true);
    recordAvailabilityCheck(db, 'provider-a', true);
    recordAvailabilityCheck(db, 'provider-a', false);
    const m = getReliabilityMetrics(db, 'provider-a')!;
    expect(m.availability_rate).toBeCloseTo(2 / 3);
    expect(m.availability_rate).toBeGreaterThan(0);
  });

  it('returns 0 rates when no data exists yet', () => {
    recordSuccessfulHire(db, 'provider-a', 'consumer-x');
    const m = getReliabilityMetrics(db, 'provider-a')!;
    expect(m.repeat_hire_rate).toBe(0);
    expect(m.avg_feedback_score).toBe(0);
    expect(m.availability_rate).toBe(0);
  });

  it('streak rebuilds after failure', () => {
    recordSuccessfulHire(db, 'provider-a', 'consumer-x');
    recordSuccessfulHire(db, 'provider-a', 'consumer-y');
    recordQualityFailure(db, 'provider-a');
    recordSuccessfulHire(db, 'provider-a', 'consumer-z');
    const m = getReliabilityMetrics(db, 'provider-a')!;
    expect(m.current_streak).toBe(1);
    expect(m.longest_streak).toBe(2);
    expect(m.total_hires).toBe(3);
  });

  it('handles multiple providers independently', () => {
    recordSuccessfulHire(db, 'provider-a', 'consumer-x');
    recordSuccessfulHire(db, 'provider-a', 'consumer-y');
    recordSuccessfulHire(db, 'provider-b', 'consumer-x');
    recordQualityFailure(db, 'provider-a');

    const mA = getReliabilityMetrics(db, 'provider-a')!;
    const mB = getReliabilityMetrics(db, 'provider-b')!;

    expect(mA.current_streak).toBe(0);
    expect(mA.total_hires).toBe(2);
    expect(mB.current_streak).toBe(1);
    expect(mB.total_hires).toBe(1);
  });
});
