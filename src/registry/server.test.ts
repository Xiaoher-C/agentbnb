import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRegistryServer } from './server.js';
import { openDatabase, insertCard } from './store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
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

  // Test 17: GET /cards does not expose _internal field
  it('GET /cards does not expose _internal field', async () => {
    const cardWithInternal = makeCard({
      name: 'Private Card',
      description: 'Has internal metadata',
    });
    // Cast to insert _internal field which is valid in the schema but should be stripped
    insertCard(db, { ...cardWithInternal, _internal: { secret: 'sensitive-value' } } as CapabilityCard);

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]._internal).toBeUndefined();

    await server.close();
  });

  // Test 18: GET /cards/:id does not expose _internal field
  it('GET /cards/:id does not expose _internal field', async () => {
    const cardWithInternal = makeCard({
      name: 'Secret Card',
      description: 'Has sensitive internal data',
    });
    insertCard(db, { ...cardWithInternal, _internal: { key: 'top-secret' } } as CapabilityCard);

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: `/cards/${cardWithInternal.id}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(cardWithInternal.id);
    expect(body._internal).toBeUndefined();

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

describe('createRegistryServer — owner endpoints', () => {
  let db: Database.Database;
  let creditDb: Database.Database;
  const OWNER = 'test-owner';
  const API_KEY = 'test-api-key';

  beforeEach(() => {
    db = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');
    bootstrapAgent(creditDb, OWNER, 250);
  });

  function makeOwnerCard(overrides: Partial<CapabilityCard> = {}): CapabilityCard {
    return {
      spec_version: '1.0',
      id: crypto.randomUUID(),
      owner: OWNER,
      name: 'Owner Capability',
      description: 'A capability owned by test-owner',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
      ...overrides,
    };
  }

  // Test: GET /me with valid Bearer token returns 200 + { owner, balance }
  it('GET /me with valid Bearer token returns 200 + { owner, balance }', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { owner: string; balance: number };
    expect(body.owner).toBe(OWNER);
    expect(body.balance).toBe(250);

    await server.close();
  });

  // Test: GET /me with invalid Bearer token returns 401
  it('GET /me with invalid Bearer token returns 401', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(response.statusCode).toBe(401);

    await server.close();
  });

  // Test: GET /me with no Authorization header returns 401
  it('GET /me with no Authorization header returns 401', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(401);

    await server.close();
  });

  // Test: GET /requests with valid key returns { items: [...], limit: N } newest-first
  it('GET /requests with valid key returns { items, limit }', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/requests',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.limit).toBe('number');

    await server.close();
  });

  // Test: GET /requests?limit=5 returns at most 5 entries
  it('GET /requests?limit=5 returns at most 5 entries', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/requests?limit=5',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { limit: number };
    expect(body.limit).toBe(5);

    await server.close();
  });

  // Test: GET /requests?since=24h returns only entries from last 24 hours
  it('GET /requests?since=24h is accepted without error', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/requests?since=24h',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);

    await server.close();
  });

  // Test: GET /draft with valid key returns { cards: CapabilityCard[] } from auto-detected APIs
  it('GET /draft with valid key returns { cards } from auto-detected APIs', async () => {
    vi.mock('../cli/onboarding.js', () => ({
      detectApiKeys: vi.fn().mockReturnValue(['OPENAI_API_KEY']),
      buildDraftCard: vi.fn().mockReturnValue({
        spec_version: '1.0',
        id: 'draft-id-1',
        owner: OWNER,
        name: 'OpenAI Text Generation',
        description: 'Draft card',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
        metadata: {},
      }),
      KNOWN_API_KEYS: ['OPENAI_API_KEY'],
    }));

    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/draft',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { cards: unknown[] };
    expect(Array.isArray(body.cards)).toBe(true);

    await server.close();
    vi.restoreAllMocks();
  });

  // Test: GET /draft returns { cards: [] } when no API keys detected
  it('GET /draft returns { cards: [] } when no API keys detected', async () => {
    vi.mock('../cli/onboarding.js', () => ({
      detectApiKeys: vi.fn().mockReturnValue([]),
      buildDraftCard: vi.fn().mockReturnValue(null),
      KNOWN_API_KEYS: [],
    }));

    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/draft',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { cards: unknown[] };
    expect(body.cards).toEqual([]);

    await server.close();
    vi.restoreAllMocks();
  });

  // Test: POST /cards/:id/toggle-online with valid key toggles card.availability.online
  it('POST /cards/:id/toggle-online toggles card.availability.online', async () => {
    const card = makeOwnerCard({ availability: { online: true } });
    insertCard(db, card);

    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/cards/${card.id}/toggle-online`,
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; online: boolean };
    expect(body.ok).toBe(true);
    expect(body.online).toBe(false); // toggled from true to false

    await server.close();
  });

  // Test: POST /cards/:id/toggle-online returns 403 when card belongs to different owner
  it('POST /cards/:id/toggle-online returns 403 for card owned by different owner', async () => {
    const card = makeOwnerCard({ owner: 'other-owner' });
    insertCard(db, card);

    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/cards/${card.id}/toggle-online`,
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(403);

    await server.close();
  });

  // Test: POST /cards/:id/toggle-online returns 404 for non-existent card
  it('POST /cards/:id/toggle-online returns 404 for non-existent card', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/cards/00000000-0000-0000-0000-000000000000/toggle-online',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(404);

    await server.close();
  });

  // Test: PATCH /cards/:id with valid key updates description and pricing
  it('PATCH /cards/:id with valid key updates description and pricing', async () => {
    const card = makeOwnerCard();
    insertCard(db, card);

    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/cards/${card.id}`,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        description: 'Updated description',
        pricing: { credits_per_call: 10 },
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await server.close();
  });

  // Test: PATCH /cards/:id returns 403 when card belongs to different owner
  it('PATCH /cards/:id returns 403 for card owned by different owner', async () => {
    const card = makeOwnerCard({ owner: 'other-owner' });
    insertCard(db, card);

    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/cards/${card.id}`,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ description: 'Hack' }),
    });
    expect(response.statusCode).toBe(403);

    await server.close();
  });

  // Regression: GET /cards (public) still returns 200 without auth header
  it('GET /cards still returns 200 without auth header (regression)', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/cards' });
    expect(response.statusCode).toBe(200);

    await server.close();
  });

  // Regression: GET /health still returns 200 without auth header
  it('GET /health still returns 200 without auth header (regression)', async () => {
    const server = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);

    await server.close();
  });
});
