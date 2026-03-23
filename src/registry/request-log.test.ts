import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './store.js';
import {
  createRequestLogTable,
  insertRequestLog,
  getRequestLog,
  getSkillRequestCount,
  type RequestLogEntry,
} from './request-log.js';
import type { FailureReason } from '../types/index.js';
import type Database from 'better-sqlite3';

describe('request-log: createRequestLogTable', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('creates request_log table without error', () => {
    expect(() => createRequestLogTable(db)).not.toThrow();
  });

  it('is idempotent (CREATE TABLE IF NOT EXISTS)', () => {
    createRequestLogTable(db);
    expect(() => createRequestLogTable(db)).not.toThrow();
  });

  it('openDatabase() already creates request_log table', () => {
    // Table should exist because openDatabase calls createRequestLogTable
    const tableInfo = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='request_log'`)
      .get() as { name: string } | undefined;
    expect(tableInfo).toBeDefined();
    expect(tableInfo?.name).toBe('request_log');
  });
});

describe('request-log: insertRequestLog', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('inserts a row with all fields', () => {
    const entry: RequestLogEntry = {
      id: 'test-uuid-1',
      card_id: 'card-uuid-1',
      card_name: 'Test Card',
      requester: 'agent-alice',
      status: 'success',
      latency_ms: 120,
      credits_charged: 10,
      created_at: new Date().toISOString(),
    };
    expect(() => insertRequestLog(db, entry)).not.toThrow();

    const rows = db.prepare('SELECT * FROM request_log WHERE id = ?').all(entry.id) as RequestLogEntry[];
    expect(rows).toHaveLength(1);
    expect(rows[0].card_id).toBe('card-uuid-1');
    expect(rows[0].card_name).toBe('Test Card');
    expect(rows[0].requester).toBe('agent-alice');
    expect(rows[0].status).toBe('success');
    expect(rows[0].latency_ms).toBe(120);
    expect(rows[0].credits_charged).toBe(10);
  });

  it('inserts entries with all three status values', () => {
    const base: Omit<RequestLogEntry, 'id' | 'status'> = {
      card_id: 'card-uuid-2',
      card_name: 'Status Test Card',
      requester: 'agent-bob',
      latency_ms: 50,
      credits_charged: 0,
      created_at: new Date().toISOString(),
    };
    insertRequestLog(db, { ...base, id: 'entry-success', status: 'success' });
    insertRequestLog(db, { ...base, id: 'entry-failure', status: 'failure' });
    insertRequestLog(db, { ...base, id: 'entry-timeout', status: 'timeout' });

    const all = db.prepare('SELECT id, status FROM request_log').all() as { id: string; status: string }[];
    expect(all).toHaveLength(3);
  });
});

// -----------------------------------------------------------------------
// Task 1 — getSkillRequestCount sliding-window query (Plan 06-01)
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// Task 1 — failure_reason field (Plan 51-01)
// -----------------------------------------------------------------------

describe('request-log: failure_reason field', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('insertRequestLog with failure_reason: overload stores it correctly', () => {
    const entry: RequestLogEntry = {
      id: 'fr-overload-1',
      card_id: 'card-fr-1',
      card_name: 'FR Test Card',
      requester: 'agent-test',
      status: 'failure',
      latency_ms: 0,
      credits_charged: 0,
      created_at: new Date().toISOString(),
      failure_reason: 'overload',
    };
    insertRequestLog(db, entry);

    const row = db.prepare('SELECT failure_reason FROM request_log WHERE id = ?').get(entry.id) as { failure_reason: string | null };
    expect(row).toBeDefined();
    expect(row.failure_reason).toBe('overload');
  });

  it('insertRequestLog with no failure_reason stores NULL', () => {
    const entry: RequestLogEntry = {
      id: 'fr-null-1',
      card_id: 'card-fr-2',
      card_name: 'FR Test Card',
      requester: 'agent-test',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: new Date().toISOString(),
      // failure_reason intentionally omitted
    };
    insertRequestLog(db, entry);

    const row = db.prepare('SELECT failure_reason FROM request_log WHERE id = ?').get(entry.id) as { failure_reason: string | null };
    expect(row).toBeDefined();
    expect(row.failure_reason).toBeNull();
  });

  it('createRequestLogTable is idempotent when failure_reason column already exists', () => {
    // First call — creates table and column
    createRequestLogTable(db);
    // Second call — must NOT throw (ALTER TABLE try/catch)
    expect(() => createRequestLogTable(db)).not.toThrow();
  });

  it('getRequestLog returns failure_reason field in result rows', () => {
    const reasons: (FailureReason | null)[] = ['bad_execution', 'timeout', null];
    reasons.forEach((reason, i) => {
      const entry: RequestLogEntry = {
        id: `fr-get-${i}`,
        card_id: 'card-fr-3',
        card_name: 'FR Get Test',
        requester: 'agent-test',
        status: reason === 'timeout' ? 'timeout' : reason ? 'failure' : 'success',
        latency_ms: 50,
        credits_charged: reason ? 0 : 5,
        created_at: new Date(Date.now() + i * 100).toISOString(),
        failure_reason: reason,
      };
      insertRequestLog(db, entry);
    });

    const rows = getRequestLog(db, 10);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Find the overload-tagged row
    const timeoutRow = rows.find((r) => r.id === 'fr-get-1');
    expect(timeoutRow).toBeDefined();
    expect(timeoutRow?.failure_reason).toBe('timeout');

    // Find the null-reason row
    const nullRow = rows.find((r) => r.id === 'fr-get-2');
    expect(nullRow).toBeDefined();
    expect(nullRow?.failure_reason).toBeNull();
  });

  it('stores all FailureReason values correctly', () => {
    const allReasons: FailureReason[] = ['bad_execution', 'overload', 'timeout', 'auth_error', 'not_found'];
    allReasons.forEach((reason, i) => {
      insertRequestLog(db, {
        id: `fr-all-${i}`,
        card_id: 'card-fr-4',
        card_name: 'FR All Reasons',
        requester: 'agent-test',
        status: 'failure',
        latency_ms: 0,
        credits_charged: 0,
        created_at: new Date().toISOString(),
        failure_reason: reason,
      });
    });

    allReasons.forEach((reason, i) => {
      const row = db.prepare('SELECT failure_reason FROM request_log WHERE id = ?').get(`fr-all-${i}`) as { failure_reason: string };
      expect(row.failure_reason).toBe(reason);
    });
  });
});

describe('request-log: getSkillRequestCount', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('returns 0 for a skill with no requests in the window', () => {
    const count = getSkillRequestCount(db, 'skill-a', 60 * 60 * 1000);
    expect(count).toBe(0);
  });

  it('returns correct count for a skill with N successful requests in the 60-minute window', () => {
    const now = Date.now();
    const inWindow = new Date(now - 10 * 60 * 1000).toISOString(); // 10 min ago
    for (let i = 0; i < 5; i++) {
      insertRequestLog(db, {
        id: `req-in-${i}`,
        card_id: 'card-1',
        card_name: 'Card',
        requester: 'agent',
        status: 'success',
        latency_ms: 100,
        credits_charged: 5,
        created_at: inWindow,
        skill_id: 'skill-a',
        action_type: null,
      });
    }
    const count = getSkillRequestCount(db, 'skill-a', 60 * 60 * 1000);
    expect(count).toBe(5);
  });

  it('does NOT count requests outside the sliding window', () => {
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 60 minutes
    const outOfWindow = new Date(now - windowMs - 1000).toISOString(); // 61 min ago
    const inWindow = new Date(now - 30 * 60 * 1000).toISOString(); // 30 min ago

    insertRequestLog(db, {
      id: 'req-old',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: outOfWindow,
      skill_id: 'skill-a',
      action_type: null,
    });
    insertRequestLog(db, {
      id: 'req-new',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: inWindow,
      skill_id: 'skill-a',
      action_type: null,
    });

    const count = getSkillRequestCount(db, 'skill-a', windowMs);
    expect(count).toBe(1); // Only in-window request counted
  });

  it('excludes autonomy audit rows (action_type IS NOT NULL) even if skill_id matches and status is success', () => {
    const now = Date.now();
    const inWindow = new Date(now - 5 * 60 * 1000).toISOString(); // 5 min ago

    // Regular request
    insertRequestLog(db, {
      id: 'req-regular',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: inWindow,
      skill_id: 'skill-a',
      action_type: null,
    });
    // Audit event (auto_share) — must NOT be counted
    insertRequestLog(db, {
      id: 'req-audit',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 10,
      credits_charged: 0,
      created_at: inWindow,
      skill_id: 'skill-a',
      action_type: 'auto_share',
    });

    const count = getSkillRequestCount(db, 'skill-a', 60 * 60 * 1000);
    expect(count).toBe(1); // Only regular request counted
  });

  it('excludes failed/timeout requests from count', () => {
    const now = Date.now();
    const inWindow = new Date(now - 5 * 60 * 1000).toISOString();

    insertRequestLog(db, {
      id: 'req-fail',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'failure',
      latency_ms: 100,
      credits_charged: 0,
      created_at: inWindow,
      skill_id: 'skill-a',
      action_type: null,
    });
    insertRequestLog(db, {
      id: 'req-timeout',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'timeout',
      latency_ms: 30000,
      credits_charged: 0,
      created_at: inWindow,
      skill_id: 'skill-a',
      action_type: null,
    });
    insertRequestLog(db, {
      id: 'req-success',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: inWindow,
      skill_id: 'skill-a',
      action_type: null,
    });

    const count = getSkillRequestCount(db, 'skill-a', 60 * 60 * 1000);
    expect(count).toBe(1); // Only success counted
  });

  it('does NOT count requests for a different skill_id', () => {
    const now = Date.now();
    const inWindow = new Date(now - 5 * 60 * 1000).toISOString();

    insertRequestLog(db, {
      id: 'req-skill-b',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: inWindow,
      skill_id: 'skill-b',
      action_type: null,
    });
    insertRequestLog(db, {
      id: 'req-skill-a',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: inWindow,
      skill_id: 'skill-a',
      action_type: null,
    });

    const count = getSkillRequestCount(db, 'skill-a', 60 * 60 * 1000);
    expect(count).toBe(1); // Only skill-a counted
  });
});

describe('request-log: getRequestLog', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('returns empty array on empty table', () => {
    const result = getRequestLog(db, 10);
    expect(result).toEqual([]);
  });

  it('returns up to limit entries newest-first', () => {
    const now = Date.now();
    // Insert 5 entries with different created_at timestamps (oldest to newest)
    for (let i = 0; i < 5; i++) {
      insertRequestLog(db, {
        id: `entry-${i}`,
        card_id: 'card-1',
        card_name: 'Card',
        requester: 'agent',
        status: 'success',
        latency_ms: 10,
        credits_charged: 5,
        created_at: new Date(now + i * 1000).toISOString(),
      });
    }

    const result = getRequestLog(db, 3);
    expect(result).toHaveLength(3);
    // Newest first: entry-4, entry-3, entry-2
    expect(result[0].id).toBe('entry-4');
    expect(result[1].id).toBe('entry-3');
    expect(result[2].id).toBe('entry-2');
  });

  it('returns all entries when limit is large', () => {
    for (let i = 0; i < 5; i++) {
      insertRequestLog(db, {
        id: `all-${i}`,
        card_id: 'card-1',
        card_name: 'Card',
        requester: 'agent',
        status: 'success',
        latency_ms: 10,
        credits_charged: 5,
        created_at: new Date().toISOString(),
      });
    }

    const result = getRequestLog(db, 100);
    expect(result).toHaveLength(5);
  });

  it('getRequestLog(db, 100, "24h") returns only entries from last 24 hours', () => {
    const now = Date.now();
    const inWindow = new Date(now - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
    const outOfWindow = new Date(now - 36 * 60 * 60 * 1000).toISOString(); // 36h ago

    insertRequestLog(db, {
      id: 'in-24h',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 10,
      credits_charged: 5,
      created_at: inWindow,
    });
    insertRequestLog(db, {
      id: 'out-24h',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 10,
      credits_charged: 5,
      created_at: outOfWindow,
    });

    const result = getRequestLog(db, 100, '24h');
    expect(result.some((r) => r.id === 'in-24h')).toBe(true);
    expect(result.some((r) => r.id === 'out-24h')).toBe(false);
  });

  it('getRequestLog(db, 100, "7d") returns only entries from last 7 days', () => {
    const now = Date.now();
    const inWindow = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
    const outOfWindow = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago

    insertRequestLog(db, {
      id: 'in-7d',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 10,
      credits_charged: 5,
      created_at: inWindow,
    });
    insertRequestLog(db, {
      id: 'out-7d',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'failure',
      latency_ms: 10,
      credits_charged: 0,
      created_at: outOfWindow,
    });

    const result = getRequestLog(db, 100, '7d');
    expect(result.some((r) => r.id === 'in-7d')).toBe(true);
    expect(result.some((r) => r.id === 'out-7d')).toBe(false);
  });

  it('getRequestLog(db, 100, "30d") returns only entries from last 30 days', () => {
    const now = Date.now();
    const inWindow = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(); // 15 days ago
    const outOfWindow = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString(); // 45 days ago

    insertRequestLog(db, {
      id: 'in-30d',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'timeout',
      latency_ms: 30000,
      credits_charged: 0,
      created_at: inWindow,
    });
    insertRequestLog(db, {
      id: 'out-30d',
      card_id: 'card-1',
      card_name: 'Card',
      requester: 'agent',
      status: 'success',
      latency_ms: 10,
      credits_charged: 5,
      created_at: outOfWindow,
    });

    const result = getRequestLog(db, 100, '30d');
    expect(result.some((r) => r.id === 'in-30d')).toBe(true);
    expect(result.some((r) => r.id === 'out-30d')).toBe(false);
  });
});
