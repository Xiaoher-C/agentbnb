/**
 * Smoke tests for v10 rental session REST surface (ADR-022 / ADR-023).
 *
 * Covers the lifecycle endpoints in `session-routes.ts`:
 * create → read → open thread → complete thread → end → outcome → rating →
 * public outcome by share_token.
 *
 * Real-time messaging lives on the WebSocket relay and is tested separately.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionRoutesPlugin } from './session-routes.js';
import { openDatabase } from './store.js';

async function buildServer(db: Database.Database): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  await fastify.register(sessionRoutesPlugin, { registryDb: db });
  await fastify.ready();
  return fastify;
}

describe('session-routes — v10 rental session lifecycle', () => {
  let db: Database.Database;
  let server: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    server = await buildServer(db);
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it('creates a session and returns id + share_token + relay_url', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        renter_did: 'did:key:renter',
        owner_did: 'did:key:owner',
        agent_id: 'agent-bgm',
        duration_min: 60,
        budget_credits: 100,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { session_id: string; share_token: string; relay_url: string; status: string };
    expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.share_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.relay_url).toBe('/ws');
    expect(body.status).toBe('open');
  });

  it('reads back a created session via GET /api/sessions/:id', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        renter_did: 'did:key:r',
        owner_did: 'did:key:o',
        agent_id: 'agent-x',
        duration_min: 30,
        budget_credits: 50,
        current_mode: 'proxy',
      },
    });
    const { session_id } = create.json() as { session_id: string };

    const read = await server.inject({ method: 'GET', url: `/api/sessions/${session_id}` });
    expect(read.statusCode).toBe(200);
    const body = read.json() as Record<string, unknown>;
    expect(body.id).toBe(session_id);
    expect(body.status).toBe('open');
    expect(body.duration_min).toBe(30);
    expect(body.budget_credits).toBe(50);
    expect(body.current_mode).toBe('proxy');
    expect(body.participants).toEqual([
      { did: 'did:key:r', role: 'renter_human' },
      { did: 'did:key:o', role: 'rented_agent' },
    ]);
    expect(body.threads).toEqual([]);
  });

  it('returns 404 for unknown session', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/sessions/00000000-0000-0000-0000-000000000000' });
    expect(res.statusCode).toBe(404);
  });

  it('opens and completes a task thread, surfacing it in session reads', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        renter_did: 'did:key:r', owner_did: 'did:key:o', agent_id: 'a',
        duration_min: 60, budget_credits: 100,
      },
    });
    const { session_id } = create.json() as { session_id: string };

    const openThread = await server.inject({
      method: 'POST',
      url: `/api/sessions/${session_id}/threads`,
      payload: { title: '室內工作室 BGM', description: '3 個變奏，BPM 70' },
    });
    expect(openThread.statusCode).toBe(201);
    const { thread_id } = openThread.json() as { thread_id: string };

    const beforeComplete = await server.inject({ method: 'GET', url: `/api/sessions/${session_id}` });
    const beforeBody = beforeComplete.json() as { threads: Array<{ id: string; status: string }> };
    expect(beforeBody.threads).toHaveLength(1);
    expect(beforeBody.threads[0].status).toBe('in_progress');

    const complete = await server.inject({
      method: 'POST',
      url: `/api/sessions/${session_id}/threads/${thread_id}/complete`,
    });
    expect(complete.statusCode).toBe(200);

    const afterComplete = await server.inject({ method: 'GET', url: `/api/sessions/${session_id}` });
    const afterBody = afterComplete.json() as { threads: Array<{ id: string; status: string; completed_at: string | null }> };
    expect(afterBody.threads[0].status).toBe('completed');
    expect(afterBody.threads[0].completed_at).toBeTruthy();
  });

  it('ends a session and produces an outcome page accessible via share_token (no auth)', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        renter_did: 'did:key:r', owner_did: 'did:key:o', agent_id: 'a',
        duration_min: 60, budget_credits: 100,
      },
    });
    const { session_id, share_token } = create.json() as { session_id: string; share_token: string };

    // Open + complete a thread so the outcome has a deliverable
    const t = await server.inject({
      method: 'POST',
      url: `/api/sessions/${session_id}/threads`,
      payload: { title: 'task 1' },
    });
    const { thread_id } = t.json() as { thread_id: string };
    await server.inject({
      method: 'POST',
      url: `/api/sessions/${session_id}/threads/${thread_id}/complete`,
    });

    const end = await server.inject({
      method: 'POST',
      url: `/api/sessions/${session_id}/end`,
      payload: { end_reason: 'completed' },
    });
    expect(end.statusCode).toBe(200);
    const endBody = end.json() as { outcome: { summary: { tasks_done: number; credit_refunded: number } } };
    expect(endBody.outcome.summary.tasks_done).toBe(1);
    expect(endBody.outcome.summary.credit_refunded).toBe(100); // nothing spent yet

    // Public outcome read by share_token — NO auth required
    const publicOutcome = await server.inject({ method: 'GET', url: `/o/${share_token}` });
    expect(publicOutcome.statusCode).toBe(200);
    const publicBody = publicOutcome.json() as { share_token: string; threads: unknown[] };
    expect(publicBody.share_token).toBe(share_token);
    expect(publicBody.threads).toHaveLength(1);
  });

  it('rejects double end with 409', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        renter_did: 'did:key:r', owner_did: 'did:key:o', agent_id: 'a',
        duration_min: 60, budget_credits: 100,
      },
    });
    const { session_id } = create.json() as { session_id: string };

    await server.inject({ method: 'POST', url: `/api/sessions/${session_id}/end`, payload: {} });
    const second = await server.inject({ method: 'POST', url: `/api/sessions/${session_id}/end`, payload: {} });
    expect(second.statusCode).toBe(409);
  });

  it('accepts a renter rating after session ends', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        renter_did: 'did:key:r', owner_did: 'did:key:o', agent_id: 'agent-bgm',
        duration_min: 60, budget_credits: 100,
      },
    });
    const { session_id } = create.json() as { session_id: string };
    await server.inject({ method: 'POST', url: `/api/sessions/${session_id}/end`, payload: {} });

    const rate = await server.inject({
      method: 'POST',
      url: `/api/sessions/${session_id}/rating`,
      payload: { rater_did: 'did:key:r', stars: 4, comment: '不錯' },
    });
    expect(rate.statusCode).toBe(201);

    const outcome = await server.inject({ method: 'GET', url: `/api/sessions/${session_id}/outcome` });
    expect(outcome.statusCode).toBe(200);
    // Outcome was persisted at end; rating came after — re-build path picks it up
    // via the unpersisted-outcome fall-through. For the persisted case we'd need
    // to re-end or expose a refresh. v10 acceptable.
  });

  it('returns 404 for unknown share_token', async () => {
    const res = await server.inject({ method: 'GET', url: '/o/00000000-0000-0000-0000-000000000000' });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// v10 Phase 2 — paginated messages + multipart files (B0 unit)
// ---------------------------------------------------------------------------

describe('session-routes — paginated messages', () => {
  let db: Database.Database;
  let server: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    const fastify = Fastify({ logger: false });
    await fastify.register(sessionRoutesPlugin, { registryDb: db });
    await fastify.ready();
    server = fastify;
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  async function createSession(): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        renter_did: 'did:key:renter',
        owner_did: 'did:key:owner',
        agent_id: 'agent-bgm',
        duration_min: 60,
        budget_credits: 100,
      },
    });
    return (res.json() as { session_id: string }).session_id;
  }

  function insertMessages(sessionId: string, count: number): void {
    const stmt = db.prepare(`
      INSERT INTO session_messages
        (id, session_id, thread_id, sender_did, sender_role, content, attachments, is_human_intervention, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, NULL, 0, ?)
    `);
    const baseTime = Date.UTC(2026, 4, 1, 0, 0, 0);
    for (let i = 0; i < count; i += 1) {
      const sender = i % 2 === 0 ? 'did:key:renter' : 'did:key:owner';
      const role = i % 2 === 0 ? 'renter_human' : 'rented_agent';
      stmt.run(
        `msg-${String(i).padStart(4, '0')}`,
        sessionId,
        sender,
        role,
        `message ${i}`,
        baseTime + i * 1000,
      );
    }
  }

  it('paginates 75 messages across two pages with stable ordering', async () => {
    const sessionId = await createSession();
    insertMessages(sessionId, 75);

    const page1 = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/messages?limit=50`,
      headers: { 'x-agent-did': 'did:key:renter' },
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json() as { messages: Array<{ id: string; content: string }>; next_cursor: string | null };
    expect(body1.messages).toHaveLength(50);
    expect(body1.messages[0].id).toBe('msg-0000');
    expect(body1.messages[49].id).toBe('msg-0049');
    expect(body1.next_cursor).toBeTruthy();

    const page2 = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/messages?limit=50&cursor=${encodeURIComponent(body1.next_cursor!)}`,
      headers: { 'x-agent-did': 'did:key:renter' },
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json() as { messages: Array<{ id: string }>; next_cursor: string | null };
    expect(body2.messages).toHaveLength(25);
    expect(body2.messages[0].id).toBe('msg-0050');
    expect(body2.messages[24].id).toBe('msg-0074');
    expect(body2.next_cursor).toBeNull();
  });

  it('rejects non-participant readers with 403', async () => {
    const sessionId = await createSession();
    insertMessages(sessionId, 3);

    const res = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/messages`,
      headers: { 'x-agent-did': 'did:key:stranger' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when no DID header is supplied', async () => {
    const sessionId = await createSession();

    const res = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/messages`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// v10 E3 — GET /api/sessions/list (renter/owner inbox endpoint)
// ---------------------------------------------------------------------------

describe('session-routes — list sessions (E3)', () => {
  let db: Database.Database;
  let server: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    server = await buildServer(db);
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  /** Inserts a session row directly so we can control timestamps & status. */
  function insertSession(opts: {
    id: string;
    renter_did: string;
    owner_did: string;
    agent_id?: string;
    status?: 'open' | 'active' | 'paused' | 'closing' | 'settled' | 'closed';
    created_at: string;
    ended_at?: string | null;
    outcome_json?: string | null;
  }): void {
    db.prepare(`
      INSERT INTO rental_sessions
        (id, renter_did, owner_did, agent_id, card_id, status, escrow_id,
         duration_min, budget_credits, spent_credits, current_mode,
         created_at, started_at, ended_at, end_reason, outcome_json, share_token)
      VALUES (?, ?, ?, ?, NULL, ?, NULL, 60, 100, 0, 'direct', ?, ?, ?, NULL, ?, ?)
    `).run(
      opts.id,
      opts.renter_did,
      opts.owner_did,
      opts.agent_id ?? 'agent-x',
      opts.status ?? 'active',
      opts.created_at,
      opts.created_at,
      opts.ended_at ?? null,
      opts.outcome_json ?? null,
      `share-${opts.id}`,
    );
  }

  it('returns 401 when no caller identity header is supplied', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/sessions/list' });
    expect(res.statusCode).toBe(401);
  });

  it('returns only sessions where caller is a participant (privacy contract)', async () => {
    insertSession({
      id: 's-1', renter_did: 'did:key:renter-A', owner_did: 'did:key:owner-A',
      created_at: '2026-05-01T10:00:00.000Z',
    });
    insertSession({
      id: 's-2', renter_did: 'did:key:renter-A', owner_did: 'did:key:owner-B',
      created_at: '2026-05-02T10:00:00.000Z',
    });
    insertSession({
      id: 's-3', renter_did: 'did:key:renter-B', owner_did: 'did:key:owner-B',
      created_at: '2026-05-03T10:00:00.000Z',
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/sessions/list',
      headers: { 'x-agent-did': 'did:key:renter-A' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: Array<{ id: string }>; next_cursor: string | null };
    const ids = body.sessions.map(s => s.id);
    expect(ids).toEqual(['s-2', 's-1']); // newest first
    expect(ids).not.toContain('s-3');
  });

  it('filters by role=renter vs role=owner', async () => {
    insertSession({
      id: 's-r', renter_did: 'did:key:alice', owner_did: 'did:key:bob',
      created_at: '2026-05-01T10:00:00.000Z',
    });
    insertSession({
      id: 's-o', renter_did: 'did:key:bob', owner_did: 'did:key:alice',
      created_at: '2026-05-02T10:00:00.000Z',
    });

    const asRenter = await server.inject({
      method: 'GET',
      url: '/api/sessions/list?role=renter',
      headers: { 'x-agent-did': 'did:key:alice' },
    });
    expect(asRenter.statusCode).toBe(200);
    const renterBody = asRenter.json() as { sessions: Array<{ id: string }> };
    expect(renterBody.sessions.map(s => s.id)).toEqual(['s-r']);

    const asOwner = await server.inject({
      method: 'GET',
      url: '/api/sessions/list?role=owner',
      headers: { 'x-agent-did': 'did:key:alice' },
    });
    expect(asOwner.statusCode).toBe(200);
    const ownerBody = asOwner.json() as { sessions: Array<{ id: string }> };
    expect(ownerBody.sessions.map(s => s.id)).toEqual(['s-o']);
  });

  it('filters by status=active vs status=ended', async () => {
    insertSession({
      id: 's-active', renter_did: 'did:key:me', owner_did: 'did:key:o',
      status: 'active', created_at: '2026-05-01T10:00:00.000Z',
    });
    insertSession({
      id: 's-paused', renter_did: 'did:key:me', owner_did: 'did:key:o',
      status: 'paused', created_at: '2026-05-02T10:00:00.000Z',
    });
    insertSession({
      id: 's-closed', renter_did: 'did:key:me', owner_did: 'did:key:o',
      status: 'closed', created_at: '2026-05-03T10:00:00.000Z',
      ended_at: '2026-05-03T11:00:00.000Z',
      outcome_json: JSON.stringify({ summary: { tasks_done: 1 } }),
    });

    const active = await server.inject({
      method: 'GET',
      url: '/api/sessions/list?status=active',
      headers: { 'x-agent-did': 'did:key:me' },
    });
    const activeBody = active.json() as { sessions: Array<{ id: string; has_outcome: boolean }> };
    expect(activeBody.sessions.map(s => s.id).sort()).toEqual(['s-active', 's-paused']);

    const ended = await server.inject({
      method: 'GET',
      url: '/api/sessions/list?status=ended',
      headers: { 'x-agent-did': 'did:key:me' },
    });
    const endedBody = ended.json() as { sessions: Array<{ id: string; has_outcome: boolean; share_token: string | null }> };
    expect(endedBody.sessions.map(s => s.id)).toEqual(['s-closed']);
    expect(endedBody.sessions[0].has_outcome).toBe(true);
    expect(endedBody.sessions[0].share_token).toBe('share-s-closed');
  });

  it('paginates with cursor across two pages', async () => {
    for (let i = 0; i < 5; i += 1) {
      insertSession({
        id: `s-${i}`,
        renter_did: 'did:key:p',
        owner_did: 'did:key:o',
        created_at: `2026-05-0${i + 1}T10:00:00.000Z`,
      });
    }

    const page1 = await server.inject({
      method: 'GET',
      url: '/api/sessions/list?limit=2',
      headers: { 'x-agent-did': 'did:key:p' },
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json() as { sessions: Array<{ id: string }>; next_cursor: string | null };
    expect(body1.sessions.map(s => s.id)).toEqual(['s-4', 's-3']);
    expect(body1.next_cursor).toBeTruthy();

    const page2 = await server.inject({
      method: 'GET',
      url: `/api/sessions/list?limit=2&cursor=${encodeURIComponent(body1.next_cursor!)}`,
      headers: { 'x-agent-did': 'did:key:p' },
    });
    const body2 = page2.json() as { sessions: Array<{ id: string }>; next_cursor: string | null };
    expect(body2.sessions.map(s => s.id)).toEqual(['s-2', 's-1']);
    expect(body2.next_cursor).toBeTruthy();

    const page3 = await server.inject({
      method: 'GET',
      url: `/api/sessions/list?limit=2&cursor=${encodeURIComponent(body2.next_cursor!)}`,
      headers: { 'x-agent-did': 'did:key:p' },
    });
    const body3 = page3.json() as { sessions: Array<{ id: string }>; next_cursor: string | null };
    expect(body3.sessions.map(s => s.id)).toEqual(['s-0']);
    expect(body3.next_cursor).toBeNull();
  });

  it('returns empty list + null cursor when caller has no sessions', async () => {
    insertSession({
      id: 's-other', renter_did: 'did:key:other', owner_did: 'did:key:o',
      created_at: '2026-05-01T10:00:00.000Z',
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/sessions/list',
      headers: { 'x-agent-did': 'did:key:nobody' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: unknown[]; next_cursor: string | null };
    expect(body.sessions).toEqual([]);
    expect(body.next_cursor).toBeNull();
  });

  it('includes a summary line for ended sessions, null for active ones', async () => {
    insertSession({
      id: 's-active', renter_did: 'did:key:me', owner_did: 'did:key:o',
      status: 'active', created_at: '2026-05-01T10:00:00.000Z',
    });
    insertSession({
      id: 's-done', renter_did: 'did:key:me', owner_did: 'did:key:o',
      status: 'closed', created_at: '2026-05-02T10:00:00.000Z',
      ended_at: '2026-05-02T10:30:00.000Z',
      outcome_json: '{}',
    });
    db.prepare(`
      INSERT INTO rental_threads (id, session_id, title, description, status, created_at, completed_at)
      VALUES ('t-1', 's-done', 'task', '', 'completed', '2026-05-02T10:05:00.000Z', '2026-05-02T10:25:00.000Z')
    `).run();

    const res = await server.inject({
      method: 'GET',
      url: '/api/sessions/list',
      headers: { 'x-agent-did': 'did:key:me' },
    });
    const body = res.json() as { sessions: Array<{ id: string; summary: string | null; has_outcome: boolean }> };
    const done = body.sessions.find(s => s.id === 's-done');
    const active = body.sessions.find(s => s.id === 's-active');
    expect(done?.summary).toContain('1/1 task');
    expect(done?.summary).toContain('30 min');
    expect(done?.has_outcome).toBe(true);
    expect(active?.summary).toBeNull();
  });

  it('also accepts x-agent-id header (Hub authedFetch flow)', async () => {
    insertSession({
      id: 's-hub', renter_did: 'agent-1234', owner_did: 'did:key:o',
      created_at: '2026-05-01T10:00:00.000Z',
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/sessions/list',
      headers: { 'x-agent-id': 'agent-1234' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: Array<{ id: string }> };
    expect(body.sessions.map(s => s.id)).toEqual(['s-hub']);
  });
});

describe('session-routes — file upload + download', () => {
  let db: Database.Database;
  let server: FastifyInstance;
  let tmpRoot: string;
  let originalAgentbnbDir: string | undefined;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'agentbnb-files-test-'));
    originalAgentbnbDir = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tmpRoot;

    db = openDatabase(':memory:');
    const fastify = Fastify({ logger: false });
    await fastify.register(sessionRoutesPlugin, { registryDb: db });
    await fastify.ready();
    server = fastify;
  });

  afterEach(async () => {
    await server.close();
    db.close();
    rmSync(tmpRoot, { recursive: true, force: true });
    if (originalAgentbnbDir === undefined) {
      delete process.env['AGENTBNB_DIR'];
    } else {
      process.env['AGENTBNB_DIR'] = originalAgentbnbDir;
    }
  });

  async function createSession(): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        renter_did: 'did:key:renter',
        owner_did: 'did:key:owner',
        agent_id: 'agent-bgm',
        duration_min: 60,
        budget_credits: 100,
      },
    });
    return (res.json() as { session_id: string }).session_id;
  }

  function buildMultipart(filename: string, content: Buffer | string, mimeType = 'text/plain'): {
    payload: Buffer;
    headers: Record<string, string>;
  } {
    // form-data is a CommonJS module — interop is fine via default require shape.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FD = require('form-data') as new () => {
      append(field: string, value: Buffer | string, opts?: { filename: string; contentType: string }): void;
      getBuffer(): Buffer;
      getHeaders(): Record<string, string>;
    };
    const form = new FD();
    form.append('file', content, { filename, contentType: mimeType });
    return { payload: form.getBuffer(), headers: form.getHeaders() };
  }

  it('uploads a file and persists FileRef + bytes on disk', async () => {
    const sessionId = await createSession();
    const content = 'hello v10 rental world';
    const { payload, headers } = buildMultipart('hello.txt', content);

    const res = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/files`,
      headers: { ...headers, 'x-agent-did': 'did:key:renter' },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      session_id: string;
      uploader_did: string;
      filename: string;
      size_bytes: number;
      mime_type: string;
      storage_key: string;
    };
    expect(body.session_id).toBe(sessionId);
    expect(body.uploader_did).toBe('did:key:renter');
    expect(body.filename).toBe('hello.txt');
    expect(body.size_bytes).toBe(Buffer.byteLength(content));
    expect(body.mime_type).toContain('text/plain');
    expect(existsSync(body.storage_key)).toBe(true);
    expect(readFileSync(body.storage_key, 'utf8')).toBe(content);

    const dbRow = db
      .prepare('SELECT id, filename, size_bytes FROM session_files WHERE id = ?')
      .get(body.id) as { id: string; filename: string; size_bytes: number } | undefined;
    expect(dbRow).toBeDefined();
    expect(dbRow!.filename).toBe('hello.txt');
  });

  it('returns 413 for files larger than 10 MB', async () => {
    const sessionId = await createSession();
    const big = Buffer.alloc(10 * 1024 * 1024 + 64, 'a');
    const { payload, headers } = buildMultipart('big.bin', big, 'application/octet-stream');

    const res = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/files`,
      headers: { ...headers, 'x-agent-did': 'did:key:renter' },
      payload,
    });
    expect(res.statusCode).toBe(413);
  });

  it('rejects upload from non-participant with 403', async () => {
    const sessionId = await createSession();
    const { payload, headers } = buildMultipart('hi.txt', 'hi');

    const res = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/files`,
      headers: { ...headers, 'x-agent-did': 'did:key:stranger' },
      payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('downloads an uploaded file (200) and rejects strangers (403) and missing ids (404)', async () => {
    const sessionId = await createSession();
    const content = 'download me';
    const { payload, headers } = buildMultipart('dl.txt', content);

    const upload = await server.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/files`,
      headers: { ...headers, 'x-agent-did': 'did:key:owner' },
      payload,
    });
    const fileId = (upload.json() as { id: string }).id;

    // Owner can download
    const ok = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/files/${fileId}`,
      headers: { 'x-agent-did': 'did:key:owner' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe(content);
    expect(ok.headers['content-disposition']).toContain('dl.txt');

    // Stranger rejected
    const blocked = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/files/${fileId}`,
      headers: { 'x-agent-did': 'did:key:stranger' },
    });
    expect(blocked.statusCode).toBe(403);

    // Missing file id → 404
    const missing = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/files/00000000-0000-0000-0000-000000000000`,
      headers: { 'x-agent-did': 'did:key:owner' },
    });
    expect(missing.statusCode).toBe(404);
  });
});
