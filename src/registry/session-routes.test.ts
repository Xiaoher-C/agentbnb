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
