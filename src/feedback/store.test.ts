import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initFeedbackTable, insertFeedback, getFeedbackForSkill, getFeedbackForProvider } from './store.js';
import type { StructuredFeedback } from './schema.js';

/** Creates a fresh in-memory DB with the feedback table initialized. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  // Also create the request_log table stub so foreign key lookups don't fail in other tests
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_log (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL DEFAULT '',
      card_name TEXT NOT NULL DEFAULT '',
      requester TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      credits_charged REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  initFeedbackTable(db);
  return db;
}

function makeFeedback(overrides: Partial<StructuredFeedback> = {}): StructuredFeedback {
  return {
    transaction_id: `00000000-0000-4000-8000-${String(Math.random()).replace('.', '').slice(0, 12).padEnd(12, '0')}`,
    provider_agent: 'agent-alpha',
    skill_id: 'tts-elevenlabs',
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

describe('initFeedbackTable', () => {
  it('creates the feedback table without error', () => {
    const db = new Database(':memory:');
    expect(() => initFeedbackTable(db)).not.toThrow();
  });

  it('is idempotent — can be called multiple times', () => {
    const db = new Database(':memory:');
    expect(() => {
      initFeedbackTable(db);
      initFeedbackTable(db);
    }).not.toThrow();
  });
});

describe('insertFeedback', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns a UUID string', () => {
    const id = insertFeedback(db, makeFeedback());
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('inserts a record that can be retrieved', () => {
    const feedback = makeFeedback({ provider_agent: 'agent-x', skill_id: 'code-review' });
    const id = insertFeedback(db, feedback);

    const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row['provider_agent']).toBe('agent-x');
    expect(row['skill_id']).toBe('code-review');
  });

  it('stores would_reuse as 1 (true) or 0 (false)', () => {
    const trueId = insertFeedback(db, makeFeedback({ would_reuse: true }));
    const falseId = insertFeedback(db, makeFeedback({ would_reuse: false }));

    const trueRow = db.prepare('SELECT would_reuse FROM feedback WHERE id = ?').get(trueId) as { would_reuse: number };
    const falseRow = db.prepare('SELECT would_reuse FROM feedback WHERE id = ?').get(falseId) as { would_reuse: number };

    expect(trueRow.would_reuse).toBe(1);
    expect(falseRow.would_reuse).toBe(0);
  });

  it('inserts null for optional quality_details when not provided', () => {
    const id = insertFeedback(db, makeFeedback());
    const row = db.prepare('SELECT quality_details FROM feedback WHERE id = ?').get(id) as { quality_details: null };
    expect(row.quality_details).toBeNull();
  });
});

describe('getFeedbackForSkill', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns an empty array when no feedback exists', () => {
    const results = getFeedbackForSkill(db, 'nonexistent-skill');
    expect(results).toEqual([]);
  });

  it('returns only feedback for the requested skill_id', () => {
    insertFeedback(db, makeFeedback({ skill_id: 'skill-a' }));
    insertFeedback(db, makeFeedback({ skill_id: 'skill-b' }));
    insertFeedback(db, makeFeedback({ skill_id: 'skill-a' }));

    const results = getFeedbackForSkill(db, 'skill-a');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.skill_id === 'skill-a')).toBe(true);
  });

  it('converts would_reuse back to boolean', () => {
    insertFeedback(db, makeFeedback({ skill_id: 'test-skill', would_reuse: false }));
    const results = getFeedbackForSkill(db, 'test-skill');
    expect(results[0]?.would_reuse).toBe(false);
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      insertFeedback(db, makeFeedback({ skill_id: 'limited-skill' }));
    }
    const results = getFeedbackForSkill(db, 'limited-skill', 3);
    expect(results).toHaveLength(3);
  });
});

describe('getFeedbackForProvider', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns an empty array when no feedback exists for provider', () => {
    const results = getFeedbackForProvider(db, 'nonexistent-agent');
    expect(results).toEqual([]);
  });

  it('returns only feedback for the requested provider_agent', () => {
    insertFeedback(db, makeFeedback({ provider_agent: 'agent-1' }));
    insertFeedback(db, makeFeedback({ provider_agent: 'agent-2' }));

    const results = getFeedbackForProvider(db, 'agent-1');
    expect(results).toHaveLength(1);
    expect(results[0]?.provider_agent).toBe('agent-1');
  });

  it('filters by sinceDays — excludes old records', () => {
    const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const newTimestamp = new Date().toISOString();

    insertFeedback(db, makeFeedback({ provider_agent: 'agent-decay', timestamp: oldTimestamp }));
    insertFeedback(db, makeFeedback({ provider_agent: 'agent-decay', timestamp: newTimestamp }));

    const results = getFeedbackForProvider(db, 'agent-decay', 5);
    // Only the new feedback (within 5 days) should be returned
    expect(results).toHaveLength(1);
    expect(results[0]?.timestamp).toBe(newTimestamp);
  });

  it('returns all records when sinceDays is not provided', () => {
    const oldTimestamp = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    insertFeedback(db, makeFeedback({ provider_agent: 'agent-all', timestamp: oldTimestamp }));
    insertFeedback(db, makeFeedback({ provider_agent: 'agent-all' }));

    const results = getFeedbackForProvider(db, 'agent-all');
    expect(results).toHaveLength(2);
  });
});
