import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { initFeedbackTable } from './store.js';
import feedbackPlugin from './api.js';

/** Creates a test Fastify instance with the feedback plugin registered. */
async function createTestServer(db: Database.Database): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(feedbackPlugin, { db });
  await server.ready();
  return server;
}

/** Creates an in-memory DB with both request_log and feedback tables. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

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

/** Inserts a stub request_log entry and returns its id. */
function insertTransaction(db: Database.Database, id?: string): string {
  const txId = id ?? randomUUID();
  db.prepare(`
    INSERT INTO request_log (id, card_id, card_name, requester, status, latency_ms, credits_charged)
    VALUES (?, 'card-1', 'Test Skill', 'requester-agent', 'success', 1000, 5)
  `).run(txId);
  return txId;
}

function validFeedbackBody(transactionId: string) {
  return {
    transaction_id: transactionId,
    provider_agent: 'agent-provider',
    skill_id: 'skill-tts',
    requester_agent: 'agent-requester',
    rating: 4,
    latency_ms: 1100,
    result_quality: 'good',
    would_reuse: true,
    cost_value_ratio: 'fair',
    timestamp: new Date().toISOString(),
  };
}

describe('POST /api/feedback', () => {
  let db: Database.Database;
  let server: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    server = await createTestServer(db);
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it('returns 400 for invalid body (missing required fields)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { rating: 3 },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBeDefined();
  });

  it('returns 400 for invalid rating value', async () => {
    const txId = insertTransaction(db);
    const response = await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { ...validFeedbackBody(txId), rating: 10 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when transaction_id does not exist in request_log', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: validFeedbackBody(randomUUID()),
    });
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe('transaction_not_found');
  });

  it('returns 201 with feedback_id for a valid request', async () => {
    const txId = insertTransaction(db);
    const response = await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: validFeedbackBody(txId),
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { feedback_id: string; received_at: string };
    expect(body.feedback_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(body.received_at).toBeDefined();
  });

  it('returns 409 for duplicate transaction_id', async () => {
    const txId = insertTransaction(db);

    // First submission
    const first = await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: validFeedbackBody(txId),
    });
    expect(first.statusCode).toBe(201);

    // Duplicate submission
    const second = await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: validFeedbackBody(txId),
    });
    expect(second.statusCode).toBe(409);
    const body = JSON.parse(second.body) as { error: string };
    expect(body.error).toBe('feedback_already_submitted');
  });
});

describe('GET /api/feedback/:skill_id', () => {
  let db: Database.Database;
  let server: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    server = await createTestServer(db);
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it('returns empty feedbacks array for unknown skill', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/feedback/unknown-skill',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { feedbacks: unknown[]; count: number };
    expect(body.feedbacks).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('returns feedbacks for a known skill', async () => {
    const txId1 = insertTransaction(db);
    const txId2 = insertTransaction(db);

    await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { ...validFeedbackBody(txId1), skill_id: 'skill-x' },
    });
    await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { ...validFeedbackBody(txId2), skill_id: 'skill-x' },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/feedback/skill-x',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { feedbacks: unknown[]; count: number };
    expect(body.count).toBe(2);
    expect(body.feedbacks).toHaveLength(2);
  });
});

describe('GET /api/reputation/:agent_id', () => {
  let db: Database.Database;
  let server: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    server = await createTestServer(db);
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it('returns reputation_score 0.5 for agent with no feedback (cold start)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/reputation/new-agent',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      agent_id: string;
      reputation_score: number;
      feedback_count: number;
      last_updated: string;
    };
    expect(body.agent_id).toBe('new-agent');
    expect(body.reputation_score).toBe(0.5);
    expect(body.feedback_count).toBe(0);
    expect(body.last_updated).toBeDefined();
  });

  it('returns a computed reputation_score for an agent with feedback history', async () => {
    const txId = insertTransaction(db);

    // Submit a perfect feedback
    await server.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: {
        ...validFeedbackBody(txId),
        provider_agent: 'agent-with-history',
        rating: 5,
        result_quality: 'excellent',
        would_reuse: true,
        cost_value_ratio: 'great',
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/reputation/agent-with-history',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      agent_id: string;
      reputation_score: number;
      feedback_count: number;
    };
    expect(body.agent_id).toBe('agent-with-history');
    expect(body.feedback_count).toBe(1);
    // Perfect feedback → score should be close to 1.0
    expect(body.reputation_score).toBeGreaterThan(0.9);
  });

  it('returns agent_id in the response body', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/reputation/some-agent-id',
    });
    const body = JSON.parse(response.body) as { agent_id: string };
    expect(body.agent_id).toBe('some-agent-id');
  });
});
