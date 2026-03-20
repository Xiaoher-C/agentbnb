import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { openDatabase, insertCard } from './store.js';
import { initFeedbackTable, insertFeedback } from '../feedback/store.js';
import { filterCards, buildReputationMap } from './matcher.js';
import type { CapabilityCard } from '../types/index.js';
import type { StructuredFeedback } from '../feedback/schema.js';

/** Creates an in-memory DB with both registry and feedback tables. */
function createTestDb(): Database.Database {
  const db = openDatabase(':memory:');
  initFeedbackTable(db);
  return db;
}

function makeCard(overrides: Partial<CapabilityCard> = {}): CapabilityCard {
  return {
    id: randomUUID(),
    owner: `owner-${randomUUID()}`,
    name: 'Test Capability',
    description: 'A test capability for reputation filtering',
    level: 1,
    inputs: [{ name: 'text', type: 'text', required: true }],
    outputs: [{ name: 'result', type: 'text', required: true }],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    ...overrides,
  };
}

function makeFeedback(overrides: Partial<StructuredFeedback> = {}): StructuredFeedback {
  return {
    transaction_id: randomUUID(),
    provider_agent: 'agent-alpha',
    skill_id: 'default-skill',
    requester_agent: 'agent-beta',
    rating: 4,
    latency_ms: 800,
    result_quality: 'good',
    would_reuse: true,
    cost_value_ratio: 'fair',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('filterCards — min_reputation filter', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns all cards when min_reputation is undefined', () => {
    const card1 = makeCard({ owner: 'owner-a' });
    const card2 = makeCard({ owner: 'owner-b' });
    insertCard(db, card1);
    insertCard(db, card2);

    const results = filterCards(db, {});
    expect(results.map((c) => c.id).sort()).toEqual([card1.id, card2.id].sort());
  });

  it('returns all cards when min_reputation is 0', () => {
    const card = makeCard({ owner: 'owner-a' });
    insertCard(db, card);

    const results = filterCards(db, { min_reputation: 0 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(card.id);
  });

  it('includes cards whose owner reputation >= min_reputation', () => {
    // owner-high has excellent feedback → reputation well above 0.7
    const highCard = makeCard({ owner: 'owner-high' });
    insertCard(db, highCard);
    insertFeedback(db, makeFeedback({
      provider_agent: 'owner-high',
      rating: 5,
      result_quality: 'excellent',
      would_reuse: true,
      cost_value_ratio: 'great',
    }));
    insertFeedback(db, makeFeedback({
      provider_agent: 'owner-high',
      rating: 5,
      result_quality: 'excellent',
      would_reuse: true,
      cost_value_ratio: 'great',
    }));

    const results = filterCards(db, { min_reputation: 0.7 });
    expect(results.some((c) => c.id === highCard.id)).toBe(true);
  });

  it('excludes cards whose owner reputation < min_reputation', () => {
    // owner-low has only poor feedback → reputation below 0.7
    const lowCard = makeCard({ owner: 'owner-low' });
    insertCard(db, lowCard);
    insertFeedback(db, makeFeedback({
      provider_agent: 'owner-low',
      rating: 1,
      result_quality: 'failed',
      would_reuse: false,
      cost_value_ratio: 'overpriced',
    }));
    insertFeedback(db, makeFeedback({
      provider_agent: 'owner-low',
      rating: 1,
      result_quality: 'failed',
      would_reuse: false,
      cost_value_ratio: 'overpriced',
    }));

    const results = filterCards(db, { min_reputation: 0.7 });
    expect(results.some((c) => c.id === lowCard.id)).toBe(false);
  });

  it('cards with no feedback default to 0.5 reputation', () => {
    const noFeedbackCard = makeCard({ owner: 'owner-no-feedback' });
    insertCard(db, noFeedbackCard);

    // min_reputation=0.5 → cold-start (0.5) passes (>= 0.5)
    const resultsPass = filterCards(db, { min_reputation: 0.5 });
    expect(resultsPass.some((c) => c.id === noFeedbackCard.id)).toBe(true);

    // min_reputation=0.7 → cold-start (0.5) fails (< 0.7)
    const resultsFail = filterCards(db, { min_reputation: 0.7 });
    expect(resultsFail.some((c) => c.id === noFeedbackCard.id)).toBe(false);
  });

  it('filters correctly with a mix of high and low reputation owners', () => {
    const highCard = makeCard({ owner: 'owner-high' });
    const lowCard = makeCard({ owner: 'owner-low' });
    insertCard(db, highCard);
    insertCard(db, lowCard);

    // High reputation owner
    for (let i = 0; i < 3; i++) {
      insertFeedback(db, makeFeedback({
        provider_agent: 'owner-high',
        rating: 5,
        result_quality: 'excellent',
        would_reuse: true,
        cost_value_ratio: 'great',
      }));
    }
    // Low reputation owner
    for (let i = 0; i < 3; i++) {
      insertFeedback(db, makeFeedback({
        provider_agent: 'owner-low',
        rating: 1,
        result_quality: 'failed',
        would_reuse: false,
        cost_value_ratio: 'overpriced',
      }));
    }

    const results = filterCards(db, { min_reputation: 0.7 });
    const ids = results.map((c) => c.id);
    expect(ids).toContain(highCard.id);
    expect(ids).not.toContain(lowCard.id);
  });
});

describe('buildReputationMap', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns 0.5 for owners with no feedback (cold-start)', () => {
    const map = buildReputationMap(db, ['owner-unknown']);
    expect(map.get('owner-unknown')).toBe(0.5);
  });

  it('returns higher score for owners with positive feedback', () => {
    insertFeedback(db, makeFeedback({
      provider_agent: 'owner-good',
      rating: 5,
      result_quality: 'excellent',
      would_reuse: true,
      cost_value_ratio: 'great',
    }));
    const map = buildReputationMap(db, ['owner-good']);
    expect(map.get('owner-good')).toBeGreaterThan(0.5);
  });

  it('returns lower score for owners with negative feedback', () => {
    insertFeedback(db, makeFeedback({
      provider_agent: 'owner-bad',
      rating: 1,
      result_quality: 'failed',
      would_reuse: false,
      cost_value_ratio: 'overpriced',
    }));
    const map = buildReputationMap(db, ['owner-bad']);
    expect(map.get('owner-bad')).toBeLessThan(0.5);
  });

  it('handles multiple owners in one call', () => {
    insertFeedback(db, makeFeedback({
      provider_agent: 'owner-a',
      rating: 5,
      result_quality: 'excellent',
      would_reuse: true,
      cost_value_ratio: 'great',
    }));
    insertFeedback(db, makeFeedback({
      provider_agent: 'owner-b',
      rating: 1,
      result_quality: 'failed',
      would_reuse: false,
      cost_value_ratio: 'overpriced',
    }));

    const map = buildReputationMap(db, ['owner-a', 'owner-b', 'owner-unknown']);
    expect(map.size).toBe(3);
    expect(map.get('owner-a')).toBeGreaterThan(map.get('owner-b')!);
    expect(map.get('owner-unknown')).toBe(0.5);
  });

  it('deduplicates owners — same entry returned for duplicate inputs', () => {
    const map = buildReputationMap(db, ['owner-x', 'owner-x', 'owner-x']);
    expect(map.size).toBe(1);
    expect(map.has('owner-x')).toBe(true);
  });
});

describe('reputation_desc sort via buildReputationMap', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('highest reputation card sorts first when sorted reputation_desc', () => {
    const highCard = makeCard({ owner: 'owner-high' });
    const midCard = makeCard({ owner: 'owner-mid' });
    const lowCard = makeCard({ owner: 'owner-low' });
    insertCard(db, highCard);
    insertCard(db, midCard);
    insertCard(db, lowCard);

    // Seed feedback
    for (let i = 0; i < 3; i++) {
      insertFeedback(db, makeFeedback({ provider_agent: 'owner-high', rating: 5, result_quality: 'excellent', would_reuse: true, cost_value_ratio: 'great' }));
      insertFeedback(db, makeFeedback({ provider_agent: 'owner-mid', rating: 3, result_quality: 'acceptable', would_reuse: true, cost_value_ratio: 'fair' }));
      insertFeedback(db, makeFeedback({ provider_agent: 'owner-low', rating: 1, result_quality: 'failed', would_reuse: false, cost_value_ratio: 'overpriced' }));
    }

    const cards = [lowCard, highCard, midCard];
    const repMap = buildReputationMap(db, cards.map((c) => c.owner));

    const sorted = [...cards].sort((a, b) => {
      const aScore = repMap.get(a.owner) ?? 0.5;
      const bScore = repMap.get(b.owner) ?? 0.5;
      return bScore - aScore; // desc
    });

    expect(sorted[0].id).toBe(highCard.id);
    expect(sorted[sorted.length - 1].id).toBe(lowCard.id);
  });

  it('lowest reputation card sorts first when sorted reputation_asc', () => {
    const highCard = makeCard({ owner: 'owner-high-asc' });
    const lowCard = makeCard({ owner: 'owner-low-asc' });
    insertCard(db, highCard);
    insertCard(db, lowCard);

    insertFeedback(db, makeFeedback({ provider_agent: 'owner-high-asc', rating: 5, result_quality: 'excellent', would_reuse: true, cost_value_ratio: 'great' }));
    insertFeedback(db, makeFeedback({ provider_agent: 'owner-low-asc', rating: 1, result_quality: 'failed', would_reuse: false, cost_value_ratio: 'overpriced' }));

    const cards = [highCard, lowCard];
    const repMap = buildReputationMap(db, cards.map((c) => c.owner));

    const sorted = [...cards].sort((a, b) => {
      const aScore = repMap.get(a.owner) ?? 0.5;
      const bScore = repMap.get(b.owner) ?? 0.5;
      return aScore - bScore; // asc
    });

    expect(sorted[0].id).toBe(lowCard.id);
    expect(sorted[1].id).toBe(highCard.id);
  });

  it('cards with same reputation maintain stable relative order', () => {
    const card1 = makeCard({ owner: 'same-owner' });
    const card2 = makeCard({ owner: 'same-owner' });
    insertCard(db, card1);
    insertCard(db, card2);

    const cards = [card1, card2];
    const repMap = buildReputationMap(db, cards.map((c) => c.owner));

    // Both have same reputation (same owner). Sort should not swap them.
    const sorted = [...cards].sort((a, b) => {
      const aScore = repMap.get(a.owner) ?? 0.5;
      const bScore = repMap.get(b.owner) ?? 0.5;
      return bScore - aScore;
    });

    // Scores are equal so order is preserved (sort is stable in V8 / modern JS)
    expect(sorted[0].id).toBe(card1.id);
    expect(sorted[1].id).toBe(card2.id);
  });
});
