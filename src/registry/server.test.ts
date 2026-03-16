import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRegistryServer } from './server.js';
import { openDatabase, insertCard } from './store.js';
import { insertRequestLog } from './request-log.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { createPendingRequest } from '../autonomy/pending-requests.js';
import type { CapabilityCard } from '../types/index.js';
import type Database from 'better-sqlite3';

// Module-level mock for onboarding — allows per-test reconfiguration via vi.mocked()
vi.mock('../cli/onboarding.js', () => ({
  detectApiKeys: vi.fn().mockReturnValue([]),
  buildDraftCard: vi.fn().mockReturnValue(null),
  KNOWN_API_KEYS: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
}));

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
    const { detectApiKeys, buildDraftCard } = await import('../cli/onboarding.js');
    vi.mocked(detectApiKeys).mockReturnValue(['OPENAI_API_KEY']);
    vi.mocked(buildDraftCard).mockReturnValue({
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
    });

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
    expect(body.cards).toHaveLength(1);

    await server.close();
    vi.restoreAllMocks();
  });

  // Test: GET /draft returns { cards: [] } when no API keys detected
  it('GET /draft returns { cards: [] } when no API keys detected', async () => {
    const { detectApiKeys, buildDraftCard } = await import('../cli/onboarding.js');
    vi.mocked(detectApiKeys).mockReturnValue([]);
    vi.mocked(buildDraftCard).mockReturnValue(null);

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

describe('createRegistryServer — pending-requests endpoints', () => {
  let db: Database.Database;
  let creditDb: Database.Database;
  const OWNER = 'test-owner';
  const API_KEY = 'test-api-key';

  beforeEach(() => {
    db = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');
    bootstrapAgent(creditDb, OWNER, 250);
  });

  function makeServer() {
    return createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb,
    });
  }

  it('GET /me/pending-requests returns 200 with empty array when no pending requests', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/pending-requests',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);

    await server.close();
  });

  it('GET /me/pending-requests returns only status=pending rows', async () => {
    const id1 = createPendingRequest(db, {
      skill_query: 'pending query',
      max_cost_credits: 50,
      credits: 10,
    });
    const id2 = createPendingRequest(db, {
      skill_query: 'another pending query',
      max_cost_credits: 30,
      credits: 8,
    });

    // Resolve id2 — should not appear
    const { resolvePendingRequest } = await import('../autonomy/pending-requests.js');
    resolvePendingRequest(db, id2, 'approved');

    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/pending-requests',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(id1);

    await server.close();
  });

  it('POST /me/pending-requests/:id/approve returns 200 and sets status=approved', async () => {
    const id = createPendingRequest(db, {
      skill_query: 'approve this',
      max_cost_credits: 20,
      credits: 5,
    });

    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/me/pending-requests/${id}/approve`,
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; id: string };
    expect(body.status).toBe('approved');
    expect(body.id).toBe(id);

    // Should no longer be in pending list
    const listResponse = await server.inject({
      method: 'GET',
      url: '/me/pending-requests',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(listResponse.json()).toHaveLength(0);

    await server.close();
  });

  it('POST /me/pending-requests/:id/reject returns 200 and sets status=rejected', async () => {
    const id = createPendingRequest(db, {
      skill_query: 'reject this',
      max_cost_credits: 20,
      credits: 5,
    });

    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/me/pending-requests/${id}/reject`,
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; id: string };
    expect(body.status).toBe('rejected');
    expect(body.id).toBe(id);

    await server.close();
  });

  it('POST /me/pending-requests/:id/approve with invalid id returns 404', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/me/pending-requests/nonexistent-id/approve',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(404);

    await server.close();
  });

  it('POST /me/pending-requests/:id/reject with invalid id returns 404', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/me/pending-requests/nonexistent-id/reject',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(404);

    await server.close();
  });

  it('GET /me/pending-requests returns 401 without auth header', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/pending-requests',
    });
    expect(response.statusCode).toBe(401);

    await server.close();
  });

  it('POST /me/pending-requests/:id/approve returns 401 without auth header', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/me/pending-requests/some-id/approve',
    });
    expect(response.statusCode).toBe(401);

    await server.close();
  });

  it('POST /me/pending-requests/:id/reject returns 401 without auth header', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/me/pending-requests/some-id/reject',
    });
    expect(response.statusCode).toBe(401);

    await server.close();
  });
});

describe('createRegistryServer — GET /api/agents', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('returns { items: [], total: 0 } when no cards registered', async () => {
    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], total: 0 });

    await server.close();
  });

  it('returns agents with required fields: owner, skill_count, success_rate, total_earned, member_since', async () => {
    insertCard(db, {
      spec_version: '1.0',
      id: crypto.randomUUID(),
      owner: 'agent-alice',
      name: 'Alice Capability',
      description: 'Alice does things',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: { success_rate: 0.9 },
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    const agent = body.items[0] as {
      owner: string;
      skill_count: number;
      success_rate: number | null;
      total_earned: number;
      member_since: string;
    };
    expect(agent.owner).toBe('agent-alice');
    expect(typeof agent.skill_count).toBe('number');
    expect(typeof agent.total_earned).toBe('number');
    expect(typeof agent.member_since).toBe('string');

    await server.close();
  });

  it('returns agents sorted by success_rate DESC then total_earned DESC', async () => {
    const cardIdHigh = crypto.randomUUID();
    const cardIdLow = crypto.randomUUID();

    // Agent "high-rep" has success_rate 0.95
    insertCard(db, {
      spec_version: '1.0',
      id: cardIdHigh,
      owner: 'agent-high-rep',
      name: 'High Rep',
      description: 'High reputation',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: { success_rate: 0.95 },
    });

    // Agent "low-rep" has success_rate 0.5
    insertCard(db, {
      spec_version: '1.0',
      id: cardIdLow,
      owner: 'agent-low-rep',
      name: 'Low Rep',
      description: 'Low reputation',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: { success_rate: 0.5 },
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ owner: string }> };
    expect(body.items[0].owner).toBe('agent-high-rep');
    expect(body.items[1].owner).toBe('agent-low-rep');

    await server.close();
  });

  it('total_earned is 0 for agent with no request_log entries', async () => {
    insertCard(db, {
      spec_version: '1.0',
      id: crypto.randomUUID(),
      owner: 'agent-no-log',
      name: 'No Log',
      description: 'Agent with no requests',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents' });
    const body = response.json() as { items: Array<{ total_earned: number; success_rate: number | null }> };
    expect(body.items[0].total_earned).toBe(0);
    expect(body.items[0].success_rate).toBeNull();

    await server.close();
  });

  it('total_earned is computed from request_log success entries only', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'agent-with-log',
      name: 'Logged Agent',
      description: 'Agent with requests',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 10 },
      availability: { online: true },
      metadata: {},
    });

    // Insert a success log entry (10 credits)
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Logged Agent',
      requester: 'some-requester',
      status: 'success',
      latency_ms: 100,
      credits_charged: 10,
      created_at: new Date().toISOString(),
    });

    // Insert a failure log entry (0 credits — should not count)
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Logged Agent',
      requester: 'some-requester',
      status: 'failure',
      latency_ms: 50,
      credits_charged: 0,
      created_at: new Date().toISOString(),
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents' });
    const body = response.json() as { items: Array<{ total_earned: number }> };
    expect(body.items[0].total_earned).toBe(10);

    await server.close();
  });
});

describe('createRegistryServer — GET /api/agents/:owner', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('returns 404 for unknown owner', async () => {
    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents/nonexistent-owner' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Agent not found' });

    await server.close();
  });

  it('returns profile, skills, and recent_activity for known owner', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'agent-bob',
      name: 'Bob Capability',
      description: 'Bob does things',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: { success_rate: 0.8 },
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents/agent-bob' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      profile: { owner: string; skill_count: number; success_rate: number | null; total_earned: number; member_since: string };
      skills: unknown[];
      recent_activity: unknown[];
    };
    expect(body.profile.owner).toBe('agent-bob');
    expect(typeof body.profile.skill_count).toBe('number');
    expect(typeof body.profile.total_earned).toBe('number');
    expect(typeof body.profile.member_since).toBe('string');
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.skills).toHaveLength(1);
    expect(Array.isArray(body.recent_activity)).toBe(true);

    await server.close();
  });

  it('skills array contains the owner\'s cards', async () => {
    const cardId1 = crypto.randomUUID();
    const cardId2 = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId1,
      owner: 'agent-charlie',
      name: 'Charlie Skill One',
      description: 'First skill',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });
    insertCard(db, {
      spec_version: '1.0',
      id: cardId2,
      owner: 'agent-charlie',
      name: 'Charlie Skill Two',
      description: 'Second skill',
      level: 2,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 10 },
      availability: { online: false },
      metadata: {},
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents/agent-charlie' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { skills: Array<{ owner: string }> };
    expect(body.skills).toHaveLength(2);
    for (const skill of body.skills) {
      expect(skill.owner).toBe('agent-charlie');
    }

    await server.close();
  });

  it('recent_activity contains request log entries for the owner', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'agent-diana',
      name: 'Diana Cap',
      description: 'Diana capability',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });

    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Diana Cap',
      requester: 'some-agent',
      status: 'success',
      latency_ms: 200,
      credits_charged: 5,
      created_at: new Date().toISOString(),
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/agents/agent-diana' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { recent_activity: Array<{ card_name: string }> };
    expect(body.recent_activity).toHaveLength(1);
    expect(body.recent_activity[0].card_name).toBe('Diana Cap');

    await server.close();
  });
});

describe('createRegistryServer — GET /api/activity', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('returns { items: [], total: 0, limit: 20 } when no log entries', async () => {
    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/activity' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; total: number; limit: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.limit).toBe(20);

    await server.close();
  });

  it('returns items with required fields including provider from JOIN', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'provider-agent',
      name: 'Text Synthesis',
      description: 'Generates text',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Text Synthesis',
      requester: 'requester-agent',
      status: 'success',
      latency_ms: 150,
      credits_charged: 5,
      created_at: new Date().toISOString(),
      action_type: null,
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/activity' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{
        id: string;
        card_name: string;
        requester: string;
        provider: string | null;
        status: string;
        credits_charged: number;
        latency_ms: number;
        created_at: string;
        action_type: string | null;
      }>;
      total: number;
      limit: number;
    };
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.card_name).toBe('Text Synthesis');
    expect(item.requester).toBe('requester-agent');
    expect(item.provider).toBe('provider-agent');
    expect(item.status).toBe('success');
    expect(item.credits_charged).toBe(5);
    expect(item.latency_ms).toBe(150);
    expect(typeof item.created_at).toBe('string');

    await server.close();
  });

  it('excludes auto_request audit rows', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'provider-agent',
      name: 'Cap A',
      description: 'Capability A',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });

    // Regular exchange — should be included
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Cap A',
      requester: 'requester-agent',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: new Date().toISOString(),
      action_type: null,
    });

    // auto_request audit row — should be excluded
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Cap A',
      requester: 'auto-requestor',
      status: 'success',
      latency_ms: 50,
      credits_charged: 0,
      created_at: new Date().toISOString(),
      action_type: 'auto_request',
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/activity' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ action_type: string | null }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    // The remaining item should not be auto_request
    expect(body.items[0].action_type).not.toBe('auto_request');

    await server.close();
  });

  it('includes auto_share rows (capability_shared events)', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'provider-agent',
      name: 'Shared Cap',
      description: 'Shared capability',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });

    // auto_share event — should be included
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Shared Cap',
      requester: 'auto-sharer',
      status: 'success',
      latency_ms: 30,
      credits_charged: 0,
      created_at: new Date().toISOString(),
      action_type: 'auto_share',
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/activity' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ action_type: string | null }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].action_type).toBe('auto_share');

    await server.close();
  });

  it('?since=ISO returns only entries newer than that timestamp', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'provider-agent',
      name: 'Timely Cap',
      description: 'Time-based capability',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });

    const oldTime = new Date(Date.now() - 5000).toISOString();
    const sinceTime = new Date(Date.now() - 2000).toISOString();
    const newTime = new Date().toISOString();

    // Old entry — should be excluded
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Timely Cap',
      requester: 'old-requester',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: oldTime,
      action_type: null,
    });

    // New entry — should be included
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Timely Cap',
      requester: 'new-requester',
      status: 'success',
      latency_ms: 80,
      credits_charged: 5,
      created_at: newTime,
      action_type: null,
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/api/activity?since=${encodeURIComponent(sinceTime)}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ requester: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].requester).toBe('new-requester');

    await server.close();
  });

  it('?limit=2 caps results at 2 items', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'provider-agent',
      name: 'Limit Cap',
      description: 'Limit test',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });

    // Insert 5 entries
    for (let i = 0; i < 5; i++) {
      insertRequestLog(db, {
        id: crypto.randomUUID(),
        card_id: cardId,
        card_name: 'Limit Cap',
        requester: `requester-${i}`,
        status: 'success',
        latency_ms: 100,
        credits_charged: 5,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
        action_type: null,
      });
    }

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/activity?limit=2' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number };
    expect(body.items).toHaveLength(2);
    expect(body.limit).toBe(2);

    await server.close();
  });

  it('results are ordered by created_at DESC (newest first)', async () => {
    const cardId = crypto.randomUUID();
    insertCard(db, {
      spec_version: '1.0',
      id: cardId,
      owner: 'provider-agent',
      name: 'Order Cap',
      description: 'Order test',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    });

    const earlier = new Date(Date.now() - 2000).toISOString();
    const later = new Date().toISOString();

    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Order Cap',
      requester: 'earlier-requester',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: earlier,
      action_type: null,
    });
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Order Cap',
      requester: 'later-requester',
      status: 'success',
      latency_ms: 80,
      credits_charged: 5,
      created_at: later,
      action_type: null,
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/activity' });
    const body = response.json() as { items: Array<{ requester: string }> };
    expect(body.items[0].requester).toBe('later-requester');
    expect(body.items[1].requester).toBe('earlier-requester');

    await server.close();
  });

  it('provider is null when capability_card has been deleted', async () => {
    const cardId = crypto.randomUUID();
    // Insert log entry with non-existent card (simulates deleted card)
    insertRequestLog(db, {
      id: crypto.randomUUID(),
      card_id: cardId,
      card_name: 'Deleted Cap',
      requester: 'some-requester',
      status: 'success',
      latency_ms: 100,
      credits_charged: 5,
      created_at: new Date().toISOString(),
      action_type: null,
    });

    const server = createRegistryServer({ registryDb: db, silent: true });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/api/activity' });
    const body = response.json() as { items: Array<{ provider: string | null }> };
    expect(body.items[0].provider).toBeNull();

    await server.close();
  });
});

describe('createRegistryServer — GET /me/transactions', () => {
  let db: Database.Database;
  let creditDb: Database.Database;
  const OWNER = 'test-owner';
  const API_KEY = 'test-api-key';

  beforeEach(() => {
    db = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');
    bootstrapAgent(creditDb, OWNER, 100);
  });

  function makeServer(withCreditDb = true) {
    return createRegistryServer({
      registryDb: db,
      silent: true,
      ownerApiKey: API_KEY,
      ownerName: OWNER,
      creditDb: withCreditDb ? creditDb : undefined,
    });
  }

  it('GET /me/transactions returns 200 with { items, limit } structure', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.limit).toBe('number');

    await server.close();
  });

  it('GET /me/transactions returns bootstrap transaction for newly bootstrapped owner', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ reason: string; amount: number }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].reason).toBe('bootstrap');
    expect(body.items[0].amount).toBe(100);

    await server.close();
  });

  it('GET /me/transactions uses default limit of 20', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { limit: number };
    expect(body.limit).toBe(20);

    await server.close();
  });

  it('GET /me/transactions?limit=5 returns limit 5', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions?limit=5',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { limit: number };
    expect(body.limit).toBe(5);

    await server.close();
  });

  it('GET /me/transactions?limit=200 is capped at 100', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions?limit=200',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { limit: number };
    expect(body.limit).toBe(100);

    await server.close();
  });

  it('GET /me/transactions without auth returns 401', async () => {
    const server = makeServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions',
    });
    expect(response.statusCode).toBe(401);

    await server.close();
  });

  it('GET /me/transactions with no creditDb returns { items: [], limit: 20 }', async () => {
    const server = makeServer(false);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/me/transactions',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number };
    expect(body.items).toEqual([]);
    expect(body.limit).toBe(20);

    await server.close();
  });
});
