/**
 * ADR-024 Privacy Boundary — integration test for Layer 2 (program invariant).
 *
 * Verifies that when a request is part of a rental session (`session_mode: true`),
 * NO row is persisted to `request_log`. This is the third leg of the three-layer
 * privacy enforcement defined in `docs/adr/024-privacy-boundary.md`:
 *
 *   Layer 1 (architectural) — AgentBnB never sees host agent main memory; per-sessionId
 *                             session histories cleared on session end. Already in place.
 *   Layer 2 (program)       — `session_mode` flag in SDK / gateway / request-log skip path.
 *                             ENFORCED HERE.
 *   Layer 3 (test)          — THIS FILE. CI must not regress.
 *
 * If you find yourself wanting to weaken or skip this test, you are about to
 * violate the rental contract「租用執行能力，不租用 agent 的腦與鑰匙」.
 * Read ADR-024 before changing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createRequestLogTable,
  insertRequestLog,
  getRequestLog,
  type RequestLogEntry,
} from '../registry/request-log.js';

function makeEntry(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: crypto.randomUUID(),
    card_id: 'test-card',
    card_name: 'Test Card',
    requester: 'renter-did',
    status: 'success',
    latency_ms: 100,
    credits_charged: 5,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ADR-024 Privacy Boundary — request_log skip on session_mode', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createRequestLogTable(db);
  });

  afterEach(() => {
    db.close();
  });

  it('persists log entry when session_mode is absent (legacy capability call)', () => {
    insertRequestLog(db, makeEntry());

    const rows = getRequestLog(db, 100);
    expect(rows).toHaveLength(1);
  });

  it('persists log entry when session_mode is explicitly false', () => {
    insertRequestLog(db, makeEntry(), { sessionMode: false });

    const rows = getRequestLog(db, 100);
    expect(rows).toHaveLength(1);
  });

  it('SKIPS persistence when session_mode is true (rental session)', () => {
    insertRequestLog(db, makeEntry(), { sessionMode: true });

    const rows = getRequestLog(db, 100);
    expect(rows).toHaveLength(0);
  });

  it('SKIPS persistence even when entry would be a successful billable request', () => {
    insertRequestLog(
      db,
      makeEntry({
        status: 'success',
        credits_charged: 100,
        skill_id: 'sensitive-skill',
        team_id: 'team-uuid',
      }),
      { sessionMode: true },
    );

    const rows = getRequestLog(db, 100);
    expect(rows).toHaveLength(0);
  });

  it('mixed traffic — session_mode rows skipped, legacy rows persisted', () => {
    // Three rental session calls + two legacy calls
    insertRequestLog(db, makeEntry({ requester: 'rental-1' }), { sessionMode: true });
    insertRequestLog(db, makeEntry({ requester: 'legacy-1' }));
    insertRequestLog(db, makeEntry({ requester: 'rental-2' }), { sessionMode: true });
    insertRequestLog(db, makeEntry({ requester: 'rental-3' }), { sessionMode: true });
    insertRequestLog(db, makeEntry({ requester: 'legacy-2' }));

    const rows = getRequestLog(db, 100);
    expect(rows).toHaveLength(2);
    const requesters = rows.map(r => r.requester).sort();
    expect(requesters).toEqual(['legacy-1', 'legacy-2']);
  });
});

describe('ADR-024 Privacy Boundary — session_mode flag is exposed on public APIs', () => {
  it('ConsumerRequestOptions exposes session_mode', async () => {
    // Type-level assertion — fails to compile if session_mode is removed
    const { AgentBnBConsumer } = await import('../sdk/consumer.js');
    type ConsumerRequest = Parameters<AgentBnBConsumer['request']>[0];
    const sample: ConsumerRequest = {
      gatewayUrl: 'http://example',
      token: 't',
      cardId: 'c',
      credits: 1,
      session_mode: true,
    };
    expect(sample.session_mode).toBe(true);
  });

  it('GatewayOptions exposes sessionMode', async () => {
    const { createGatewayServer } = await import('../gateway/server.js');
    type GwOpts = Parameters<typeof createGatewayServer>[0];
    // Type-level assertion — fails to compile if sessionMode is removed
    const sample: Partial<GwOpts> = { sessionMode: true };
    expect(sample.sessionMode).toBe(true);
  });

  it('insertRequestLog accepts InsertRequestLogOptions with sessionMode', async () => {
    const { insertRequestLog } = await import('../registry/request-log.js');
    // Type-level assertion — fails to compile if signature is regressed
    type Args = Parameters<typeof insertRequestLog>;
    const sample: Args = [
      new Database(':memory:'),
      makeEntry(),
      { sessionMode: true },
    ];
    expect(sample[2]?.sessionMode).toBe(true);
  });
});
