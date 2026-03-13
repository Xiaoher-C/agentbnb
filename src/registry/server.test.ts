import { describe, it, expect, beforeEach } from 'vitest';
import { createRegistryServer } from './server.js';
import { openDatabase } from './store.js';
import { insertCard } from './store.js';
import type { CapabilityCard } from '../types/index.js';
import type Database from 'better-sqlite3';

/** Creates a minimal valid CapabilityCard for testing. */
function makeCard(overrides: Partial<CapabilityCard> = {}): CapabilityCard {
  return {
    spec_version: '1.0',
    id: crypto.randomUUID(),
    owner: 'test-owner',
    name: 'Test Capability',
    description: 'A test capability for unit tests',
    level: 1,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    metadata: {},
    ...overrides,
  };
}

describe('createRegistryServer', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  // Test 1: GET /health returns { status: 'ok' }
  it('GET /health returns { status: "ok" }', async () => {
    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await server.close();
  });

  // Test 2: GET /cards with no cards returns empty paginated result
  it('GET /cards with no cards returns empty paginated result', async () => {
    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ total: 0, limit: 20, offset: 0, items: [] });

    await server.close();
  });

  // Test 3: GET /cards with 3 published cards returns all 3 in items
  it('GET /cards returns all cards', async () => {
    insertCard(db, makeCard({ name: 'Card One', description: 'First capability' }));
    insertCard(db, makeCard({ name: 'Card Two', description: 'Second capability' }));
    insertCard(db, makeCard({ name: 'Card Three', description: 'Third capability' }));

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);

    await server.close();
  });

  // Test 4: GET /cards?q=voice returns only cards matching "voice" via FTS5
  it('GET /cards?q=voice returns matching cards via FTS5', async () => {
    insertCard(db, makeCard({ name: 'Voice Synthesis', description: 'TTS capability' }));
    insertCard(db, makeCard({ name: 'Image Classifier', description: 'Classify images' }));

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?q=voice' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe('Voice Synthesis');

    await server.close();
  });

  // Test 5: GET /cards?level=1 returns only level 1 cards
  it('GET /cards?level=1 returns only level 1 cards', async () => {
    insertCard(db, makeCard({ name: 'Atomic Cap', description: 'Level 1', level: 1 }));
    insertCard(db, makeCard({ name: 'Pipeline Cap', description: 'Level 2', level: 2 }));
    insertCard(db, makeCard({ name: 'Env Cap', description: 'Level 3', level: 3 }));

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?level=1' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].level).toBe(1);

    await server.close();
  });

  // Test 6: GET /cards?online=true returns only online cards
  it('GET /cards?online=true returns only online cards', async () => {
    insertCard(
      db,
      makeCard({ name: 'Online Card', description: 'Online', availability: { online: true } })
    );
    insertCard(
      db,
      makeCard({ name: 'Offline Card', description: 'Offline', availability: { online: false } })
    );

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?online=true' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].availability.online).toBe(true);

    await server.close();
  });

  // Test 7: GET /cards?tag=tts returns only cards with "tts" in metadata.tags
  it('GET /cards?tag=tts returns only cards with matching tag', async () => {
    insertCard(
      db,
      makeCard({
        name: 'TTS Card',
        description: 'Text to speech',
        metadata: { tags: ['tts', 'audio'] },
      })
    );
    insertCard(
      db,
      makeCard({
        name: 'STT Card',
        description: 'Speech to text',
        metadata: { tags: ['stt'] },
      })
    );

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?tag=tts' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe('TTS Card');

    await server.close();
  });

  // Test 8: GET /cards?min_success_rate=0.8 returns only cards with success_rate >= 0.8
  it('GET /cards?min_success_rate=0.8 returns cards with high success rate', async () => {
    insertCard(
      db,
      makeCard({
        name: 'High Success',
        description: 'High success rate',
        metadata: { success_rate: 0.95 },
      })
    );
    insertCard(
      db,
      makeCard({
        name: 'Low Success',
        description: 'Low success rate',
        metadata: { success_rate: 0.5 },
      })
    );
    insertCard(
      db,
      makeCard({ name: 'No Success', description: 'No success rate', metadata: {} })
    );

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?min_success_rate=0.8' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe('High Success');

    await server.close();
  });

  // Test 9: GET /cards?max_latency_ms=100 returns only cards with avg_latency_ms <= 100
  it('GET /cards?max_latency_ms=100 returns cards with low latency', async () => {
    insertCard(
      db,
      makeCard({
        name: 'Fast Card',
        description: 'Low latency',
        metadata: { avg_latency_ms: 50 },
      })
    );
    insertCard(
      db,
      makeCard({
        name: 'Slow Card',
        description: 'High latency',
        metadata: { avg_latency_ms: 500 },
      })
    );
    insertCard(
      db,
      makeCard({ name: 'No Latency', description: 'No latency data', metadata: {} })
    );

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?max_latency_ms=100' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe('Fast Card');

    await server.close();
  });

  // Test 10: GET /cards?sort=success_rate returns cards sorted by success_rate descending
  it('GET /cards?sort=success_rate returns cards sorted by success_rate descending', async () => {
    insertCard(
      db,
      makeCard({
        name: 'Mid Success',
        description: 'Mid',
        metadata: { success_rate: 0.7 },
      })
    );
    insertCard(
      db,
      makeCard({
        name: 'High Success',
        description: 'High',
        metadata: { success_rate: 0.95 },
      })
    );
    insertCard(
      db,
      makeCard({
        name: 'No Rating',
        description: 'No rating',
        metadata: {},
      })
    );

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?sort=success_rate' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items[0].name).toBe('High Success');
    expect(body.items[1].name).toBe('Mid Success');
    expect(body.items[2].name).toBe('No Rating');

    await server.close();
  });

  // Test 11: GET /cards?sort=latency returns cards sorted by avg_latency_ms ascending
  it('GET /cards?sort=latency returns cards sorted by latency ascending', async () => {
    insertCard(
      db,
      makeCard({
        name: 'Mid Latency',
        description: 'Mid latency',
        metadata: { avg_latency_ms: 200 },
      })
    );
    insertCard(
      db,
      makeCard({
        name: 'Fast Card',
        description: 'Low latency',
        metadata: { avg_latency_ms: 50 },
      })
    );
    insertCard(
      db,
      makeCard({
        name: 'No Latency',
        description: 'No latency data',
        metadata: {},
      })
    );

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?sort=latency' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items[0].name).toBe('Fast Card');
    expect(body.items[1].name).toBe('Mid Latency');
    expect(body.items[2].name).toBe('No Latency');

    await server.close();
  });

  // Test 12: GET /cards?limit=2&offset=1 returns correct pagination slice
  it('GET /cards?limit=2&offset=1 returns correct pagination slice', async () => {
    insertCard(db, makeCard({ name: 'Card A', description: 'First' }));
    insertCard(db, makeCard({ name: 'Card B', description: 'Second' }));
    insertCard(db, makeCard({ name: 'Card C', description: 'Third' }));

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?limit=2&offset=1' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.items).toHaveLength(2);

    await server.close();
  });

  // Test 13: GET /cards?limit=200 is capped at 100
  it('GET /cards?limit=200 is capped at 100', async () => {
    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards?limit=200' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.limit).toBe(100);

    await server.close();
  });

  // Test 14: GET /cards/:id returns the specific card
  it('GET /cards/:id returns the specific card', async () => {
    const card = makeCard({ name: 'Specific Card', description: 'A specific capability' });
    insertCard(db, card);

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: `/cards/${card.id}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(card.id);
    expect(body.name).toBe('Specific Card');

    await server.close();
  });

  // Test 15: GET /cards/:id with non-existent ID returns 404
  it('GET /cards/:id with non-existent ID returns 404', async () => {
    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/cards/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Not found' });

    await server.close();
  });

  // Test 16: Response headers include access-control-allow-origin (CORS)
  it('Response headers include CORS access-control-allow-origin', async () => {
    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/cards',
      headers: { origin: 'http://example.com' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeDefined();

    await server.close();
  });
});
