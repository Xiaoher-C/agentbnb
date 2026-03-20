import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { initEvolutionTable } from './store.js';
import evolutionPlugin from './api.js';

/** Creates a test Fastify instance with the evolution plugin registered. */
async function createTestServer(db: Database.Database): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(evolutionPlugin, { db });
  await server.ready();
  return server;
}

/** Creates an in-memory DB with the evolution_versions table. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initEvolutionTable(db);
  return db;
}

function validEvolutionBody(overrides?: Record<string, unknown>) {
  return {
    template_name: 'genesis-template',
    template_version: '1.0.0',
    publisher_agent: 'agent-test',
    changelog: 'Initial test evolution',
    core_memory_snapshot: [
      { category: 'identity', importance: 0.9, content: 'I am a helpful agent' },
    ],
    fitness_improvement: 0.15,
    timestamp: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('POST /api/evolution/publish', () => {
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

  it('returns 201 with evolution_id for a valid body', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/evolution/publish',
      payload: validEvolutionBody(),
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { evolution_id: string; published_at: string };
    expect(body.evolution_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.published_at).toBeDefined();
  });

  it('returns 400 for invalid semver version', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/evolution/publish',
      payload: validEvolutionBody({ template_version: '1.2' }),
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string; issues: unknown[] };
    expect(body.error).toBe('Validation failed');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('returns 400 for fitness_improvement out of range', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/evolution/publish',
      payload: validEvolutionBody({ fitness_improvement: 2.0 }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/evolution/publish',
      payload: { template_name: 'genesis-template' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for invalid timestamp format', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/evolution/publish',
      payload: validEvolutionBody({ timestamp: 'not-a-date' }),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/evolution/latest', () => {
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

  it('returns { evolution: null } when no records exist', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/evolution/latest?template=genesis-template',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { evolution: unknown };
    expect(body.evolution).toBeNull();
  });

  it('returns the latest evolution after publishing one', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/evolution/publish',
      payload: validEvolutionBody({ changelog: 'first published' }),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/evolution/latest?template=genesis-template',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { evolution: { changelog: string } };
    expect(body.evolution).not.toBeNull();
    expect(body.evolution.changelog).toBe('first published');
  });

  it('returns 400 when template parameter is missing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/evolution/latest',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/evolution/history', () => {
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

  it('returns { evolutions: [], count: 0 } when no records exist', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/evolution/history?template=genesis-template',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { evolutions: unknown[]; count: number };
    expect(body.evolutions).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('returns ordered list after publishing multiple evolutions', async () => {
    for (let i = 1; i <= 3; i++) {
      await server.inject({
        method: 'POST',
        url: '/api/evolution/publish',
        payload: validEvolutionBody({ template_version: `1.${i}.0`, changelog: `v${i}` }),
      });
    }

    const response = await server.inject({
      method: 'GET',
      url: '/api/evolution/history?template=genesis-template&limit=10',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { evolutions: Array<{ changelog: string }>; count: number };
    expect(body.count).toBe(3);
    expect(body.evolutions).toHaveLength(3);
  });

  it('respects the limit query parameter', async () => {
    for (let i = 1; i <= 5; i++) {
      await server.inject({
        method: 'POST',
        url: '/api/evolution/publish',
        payload: validEvolutionBody({ template_version: `1.${i}.0` }),
      });
    }

    const response = await server.inject({
      method: 'GET',
      url: '/api/evolution/history?template=genesis-template&limit=2',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { evolutions: unknown[]; count: number };
    expect(body.evolutions).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it('returns 400 when template parameter is missing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/evolution/history',
    });
    expect(response.statusCode).toBe(400);
  });
});
