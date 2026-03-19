import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './store.js';
import { getPricingStats } from './pricing.js';
import type Database from 'better-sqlite3';
import type { CapabilityCardV2 } from '../types/index.js';

/**
 * Helper: insert a v2.0 card with skills at specified prices into the test DB.
 */
function insertTestCard(
  db: Database.Database,
  owner: string,
  skills: Array<{ name: string; description: string; credits_per_call: number }>,
): void {
  const id = `test-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const card: CapabilityCardV2 = {
    spec_version: '2.0',
    id,
    owner,
    agent_name: `${owner}-agent`,
    skills: skills.map((s, i) => ({
      id: `${id}-skill-${i}`,
      name: s.name,
      description: s.description,
      level: 2 as const,
      inputs: [{ name: 'input', type: 'text' as const, description: 'input', required: true }],
      outputs: [{ name: 'output', type: 'text' as const, description: 'output', required: true }],
      pricing: { credits_per_call: s.credits_per_call },
      availability: { online: true },
    })),
    availability: { online: true },
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, owner, JSON.stringify(card), now, now);
}

describe('getPricingStats', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('returns all zeros when no skills match', () => {
    const stats = getPricingStats(db, 'nonexistent');
    expect(stats).toEqual({ min: 0, max: 0, median: 0, mean: 0, count: 0 });
  });

  it('returns correct stats for 3 matching skills (odd count)', () => {
    insertTestCard(db, 'alice', [{ name: 'translation', description: 'Translates text', credits_per_call: 5 }]);
    insertTestCard(db, 'bob', [{ name: 'translation pro', description: 'Pro translation service', credits_per_call: 10 }]);
    insertTestCard(db, 'carol', [{ name: 'translation ultra', description: 'Ultra translation', credits_per_call: 15 }]);

    const stats = getPricingStats(db, 'translation');
    expect(stats.min).toBe(5);
    expect(stats.max).toBe(15);
    expect(stats.median).toBe(10);
    expect(stats.mean).toBe(10);
    expect(stats.count).toBe(3);
  });

  it('returns correct stats for 1 matching skill', () => {
    insertTestCard(db, 'alice', [{ name: 'code review', description: 'Reviews code quality', credits_per_call: 20 }]);

    const stats = getPricingStats(db, 'code');
    expect(stats.min).toBe(20);
    expect(stats.max).toBe(20);
    expect(stats.median).toBe(20);
    expect(stats.mean).toBe(20);
    expect(stats.count).toBe(1);
  });

  it('computes even-count median as average of two middle values', () => {
    insertTestCard(db, 'alice', [{ name: 'test runner', description: 'Runs tests', credits_per_call: 8 }]);
    insertTestCard(db, 'bob', [{ name: 'test analyzer', description: 'Analyzes test results', credits_per_call: 12 }]);

    const stats = getPricingStats(db, 'test');
    expect(stats.median).toBe(10);
    expect(stats.mean).toBe(10);
    expect(stats.count).toBe(2);
  });

  it('extracts pricing from multi-skill cards', () => {
    insertTestCard(db, 'alice', [
      { name: 'translation', description: 'Translates', credits_per_call: 5 },
      { name: 'summarization', description: 'Summarizes', credits_per_call: 20 },
    ]);

    const statsTranslation = getPricingStats(db, 'translation');
    expect(statsTranslation.count).toBe(1);
    expect(statsTranslation.min).toBe(5);

    const statsSummarization = getPricingStats(db, 'summarization');
    expect(statsSummarization.count).toBe(1);
    expect(statsSummarization.min).toBe(20);
  });
});
