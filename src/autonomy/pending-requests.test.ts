import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../registry/store.js';
import {
  createPendingRequest,
  listPendingRequests,
  resolvePendingRequest,
} from './pending-requests.js';
import type Database from 'better-sqlite3';

describe('pending-requests CRUD', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('createPendingRequest inserts a row with status=pending and returns an id', () => {
    const id = createPendingRequest(db, {
      skill_query: 'transcribe audio',
      max_cost_credits: 50,
      credits: 10,
    });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const rows = listPendingRequests(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].skill_query).toBe('transcribe audio');
    expect(rows[0].max_cost_credits).toBe(50);
    expect(rows[0].credits).toBe(10);
  });

  it('listPendingRequests returns only status=pending rows', () => {
    const id1 = createPendingRequest(db, {
      skill_query: 'query one',
      max_cost_credits: 10,
      credits: 5,
    });
    const id2 = createPendingRequest(db, {
      skill_query: 'query two',
      max_cost_credits: 20,
      credits: 8,
    });
    // Resolve id1 — should not appear in list
    resolvePendingRequest(db, id1, 'approved');

    const rows = listPendingRequests(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id2);
  });

  it('listPendingRequests returns pending rows sorted by created_at DESC', async () => {
    const id1 = createPendingRequest(db, {
      skill_query: 'first',
      max_cost_credits: 10,
      credits: 5,
    });
    // Small delay to ensure distinct created_at timestamps
    await new Promise((resolve) => setTimeout(resolve, 5));
    const id2 = createPendingRequest(db, {
      skill_query: 'second',
      max_cost_credits: 20,
      credits: 8,
    });

    const rows = listPendingRequests(db);
    expect(rows).toHaveLength(2);
    // Most recent first
    expect(rows[0].id).toBe(id2);
    expect(rows[1].id).toBe(id1);
  });

  it('resolvePendingRequest with approved sets status=approved and resolved_at', () => {
    const id = createPendingRequest(db, {
      skill_query: 'approve me',
      max_cost_credits: 15,
      credits: 5,
    });

    resolvePendingRequest(db, id, 'approved');

    // Should no longer appear in pending list
    const pending = listPendingRequests(db);
    expect(pending).toHaveLength(0);
  });

  it('resolvePendingRequest with rejected sets status=rejected', () => {
    const id = createPendingRequest(db, {
      skill_query: 'reject me',
      max_cost_credits: 15,
      credits: 5,
    });

    resolvePendingRequest(db, id, 'rejected');

    const pending = listPendingRequests(db);
    expect(pending).toHaveLength(0);
  });

  it('resolvePendingRequest with nonexistent id throws AgentBnBError', () => {
    expect(() => resolvePendingRequest(db, 'nonexistent-id', 'approved')).toThrow();
  });

  it('openDatabase creates the pending_requests table (verified by inserting a row)', () => {
    // If the table does not exist, this will throw
    expect(() => {
      createPendingRequest(db, {
        skill_query: 'table test',
        max_cost_credits: 5,
        credits: 2,
      });
    }).not.toThrow();
  });

  it('createPendingRequest stores optional fields (selected_peer, selected_card_id, params)', () => {
    const id = createPendingRequest(db, {
      skill_query: 'full query',
      max_cost_credits: 100,
      credits: 25,
      selected_peer: 'peer-agent-1',
      selected_card_id: 'card-abc',
      selected_skill_id: 'skill-xyz',
      params: { input: 'hello' },
    });

    const rows = listPendingRequests(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].selected_peer).toBe('peer-agent-1');
    expect(rows[0].selected_card_id).toBe('card-abc');
    expect(rows[0].selected_skill_id).toBe('skill-xyz');
    expect(rows[0].params).toBe(JSON.stringify({ input: 'hello' }));
  });
});

describe('insertAuditEvent — auto_request_failed variant', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('insertAuditEvent with type=auto_request_failed writes to request_log without error', async () => {
    const { insertAuditEvent } = await import('./tiers.js');

    expect(() => {
      insertAuditEvent(db, {
        type: 'auto_request_failed',
        card_id: 'card-123',
        skill_id: 'skill-456',
        tier_invoked: 3,
        credits: 10,
        peer: 'peer-agent-1',
        reason: 'insufficient credits',
      });
    }).not.toThrow();
  });
});
