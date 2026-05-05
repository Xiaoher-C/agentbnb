/**
 * Smoke tests for v10 Maturity Evidence endpoint and existing agent routes.
 *
 * Covers `GET /api/agents/:agent_id/maturity-evidence` (ADR-022):
 *   - empty agent (no sessions) returns all-zero evidence
 *   - agent with sessions / threads / ratings returns correct counts
 *   - unknown agent returns 404
 *   - missing rental tables degrade gracefully to zeros
 *
 * Maturity is intentionally NEVER collapsed into a single score — these tests
 * verify the evidence-first contract from ADR-022.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { agentRoutesPlugin } from './agent-routes.js';
import { sessionRoutesPlugin } from './session-routes.js';
import { openDatabase, insertCard } from './store.js';
import type { CapabilityCard } from '../types/index.js';

interface MaturityEvidenceResponse {
  agent_id: string;
  evidence: {
    platform_observed_sessions: number;
    completed_tasks: number;
    repeat_renters: number;
    artifact_examples: Array<{ share_token: string; ended_at: number; summary: string }>;
    verified_tools: string[];
    response_reliability: number;
    renter_rating_avg: number | null;
    renter_rating_count: number;
  };
  evidence_categories: Array<{
    key: string;
    value: number | string;
    kind: 'count' | 'rate' | 'avg' | 'list';
  }>;
}

function makeCard(owner: string, opts: Partial<CapabilityCard> = {}): CapabilityCard {
  return {
    spec_version: '1.0',
    id: randomUUID(),
    owner,
    name: 'Test Skill',
    description: 'Just a test',
    level: 1,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: 1 },
    availability: { online: true },
    powered_by: [{ provider: 'elevenlabs', model: 'eleven-v3' }],
    metadata: { apis_used: ['tts-api'], tags: ['audio'] },
    ...opts,
  };
}

async function buildServer(db: Database.Database): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  // Register session-routes first so v10 rental tables exist via its migration call
  await fastify.register(sessionRoutesPlugin, { registryDb: db });
  await fastify.register(agentRoutesPlugin, { registryDb: db });
  await fastify.ready();
  return fastify;
}

describe('agent-routes — v10 Maturity Evidence', () => {
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

  it('returns 404 for an unknown agent_id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/agents/no-such-agent/maturity-evidence',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns all-zero evidence for an agent with cards but no rental sessions', async () => {
    insertCard(db, makeCard('agent-fresh'));

    const res = await server.inject({
      method: 'GET',
      url: '/api/agents/agent-fresh/maturity-evidence',
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as MaturityEvidenceResponse;
    expect(body.agent_id).toBe('agent-fresh');
    expect(body.evidence.platform_observed_sessions).toBe(0);
    expect(body.evidence.completed_tasks).toBe(0);
    expect(body.evidence.repeat_renters).toBe(0);
    expect(body.evidence.artifact_examples).toEqual([]);
    // verified_tools surfaces from card metadata even with no sessions
    expect(body.evidence.verified_tools).toContain('elevenlabs');
    expect(body.evidence.verified_tools).toContain('tts-api');
    expect(body.evidence.response_reliability).toBe(0);
    expect(body.evidence.renter_rating_avg).toBeNull();
    expect(body.evidence.renter_rating_count).toBe(0);

    // evidence_categories array stays populated even when most values are zero
    expect(body.evidence_categories.length).toBeGreaterThan(0);
    const keys = body.evidence_categories.map((c) => c.key);
    expect(keys).toContain('platform_observed_sessions');
    expect(keys).toContain('completed_tasks');
    expect(keys).toContain('repeat_renters');
    expect(keys).toContain('verified_tools');
    expect(keys).toContain('response_reliability');
    expect(keys).toContain('renter_rating_avg');
  });

  it('counts ended sessions, completed threads, repeat renters, and ratings', async () => {
    insertCard(db, makeCard('agent-bgm'));

    // Helper — open + end a session for a given renter
    const runSession = async (
      renter: string,
      opts: { addThread?: boolean; complete?: boolean; rate?: number } = {},
    ): Promise<{ session_id: string; share_token: string }> => {
      const create = await server.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          renter_did: renter,
          owner_did: 'did:key:owner',
          agent_id: 'agent-bgm',
          duration_min: 60,
          budget_credits: 100,
        },
      });
      const created = create.json() as { session_id: string; share_token: string };

      if (opts.addThread) {
        const t = await server.inject({
          method: 'POST',
          url: `/api/sessions/${created.session_id}/threads`,
          payload: { title: 'task' },
        });
        const { thread_id } = t.json() as { thread_id: string };
        if (opts.complete) {
          await server.inject({
            method: 'POST',
            url: `/api/sessions/${created.session_id}/threads/${thread_id}/complete`,
          });
        }
      }

      await server.inject({
        method: 'POST',
        url: `/api/sessions/${created.session_id}/end`,
        payload: { end_reason: 'completed' },
      });

      if (opts.rate !== undefined) {
        await server.inject({
          method: 'POST',
          url: `/api/sessions/${created.session_id}/rating`,
          payload: { rater_did: renter, stars: opts.rate },
        });
      }

      return created;
    };

    // 5 sessions total: 3 from did:key:r1 (repeat renter), 2 from did:key:r2
    // 3 of them produce a completed thread → completed_tasks = 3
    // 2 ratings: 4 + 5 → avg = 4.5, count = 2
    await runSession('did:key:r1', { addThread: true, complete: true, rate: 4 });
    await runSession('did:key:r1', { addThread: true, complete: true });
    await runSession('did:key:r1');
    await runSession('did:key:r2', { addThread: true, complete: true, rate: 5 });
    await runSession('did:key:r2');

    const res = await server.inject({
      method: 'GET',
      url: '/api/agents/agent-bgm/maturity-evidence',
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as MaturityEvidenceResponse;
    expect(body.evidence.platform_observed_sessions).toBe(5);
    expect(body.evidence.completed_tasks).toBe(3);
    // r1 has 3 sessions → repeat_renter; r2 has 2 → repeat_renter; total 2
    expect(body.evidence.repeat_renters).toBe(2);
    // artifact_examples capped at 3 most recent
    expect(body.evidence.artifact_examples.length).toBe(3);
    expect(body.evidence.artifact_examples[0]?.share_token).toMatch(/^[0-9a-f-]{36}$/);
    // All sessions ended with end_reason = completed
    expect(body.evidence.response_reliability).toBe(1);
    expect(body.evidence.renter_rating_count).toBe(2);
    expect(body.evidence.renter_rating_avg).toBeCloseTo(4.5, 5);
  });

  it('gracefully returns zero counts when rental tables are not yet migrated', async () => {
    // Open a fresh DB without registering session-routes (so rental tables are absent)
    const bareDb = openDatabase(':memory:');
    const bareServer = Fastify({ logger: false });
    await bareServer.register(agentRoutesPlugin, { registryDb: bareDb });
    await bareServer.ready();

    // Drop rental_sessions / rental_threads / rental_ratings if they exist
    bareDb.exec(`
      DROP TABLE IF EXISTS rental_ratings;
      DROP TABLE IF EXISTS rental_threads;
      DROP TABLE IF EXISTS rental_sessions;
    `);

    insertCard(bareDb, makeCard('agent-legacy'));

    const res = await bareServer.inject({
      method: 'GET',
      url: '/api/agents/agent-legacy/maturity-evidence',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as MaturityEvidenceResponse;
    expect(body.evidence.platform_observed_sessions).toBe(0);
    expect(body.evidence.completed_tasks).toBe(0);
    expect(body.evidence.repeat_renters).toBe(0);
    expect(body.evidence.renter_rating_count).toBe(0);
    expect(body.evidence.renter_rating_avg).toBeNull();

    await bareServer.close();
    bareDb.close();
  });

  it('exposes verified_tools from both v1 powered_by and metadata.apis_used', async () => {
    insertCard(
      db,
      makeCard('agent-toolset', {
        powered_by: [
          { provider: 'openai', model: 'gpt-4' },
          { provider: 'elevenlabs' },
        ],
        metadata: { apis_used: ['stripe', 'twilio'], tags: [] },
      }),
    );

    const res = await server.inject({
      method: 'GET',
      url: '/api/agents/agent-toolset/maturity-evidence',
    });
    const body = res.json() as MaturityEvidenceResponse;
    expect(body.evidence.verified_tools).toEqual(
      expect.arrayContaining(['openai', 'elevenlabs', 'stripe', 'twilio']),
    );
  });
});
