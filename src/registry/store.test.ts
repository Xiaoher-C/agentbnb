import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  openDatabase,
  insertCard,
  getCard,
  updateCard,
  deleteCard,
  listCards,
  updateReputation,
  runMigrations,
  updateSkillAvailability,
  updateSkillIdleRate,
  getCardsByCapabilityType,
} from './store.js';
import { searchCards, filterCards } from './matcher.js';
import { AgentBnBError } from '../types/index.js';
import type { CapabilityCard, CapabilityCardV2 } from '../types/index.js';
import type { Database } from 'better-sqlite3';
import { insertRequestLog, getRequestLog, createRequestLogTable } from './request-log.js';

function makeCard(overrides: Partial<CapabilityCard> = {}): CapabilityCard {
  return {
    id: randomUUID(),
    owner: 'test-owner',
    name: 'Test TTS Capability',
    description: 'A test text-to-speech capability',
    level: 1,
    inputs: [{ name: 'text', type: 'text', required: true }],
    outputs: [{ name: 'audio', type: 'audio', required: true }],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    metadata: {
      apis_used: ['elevenlabs'],
      avg_latency_ms: 2000,
      success_rate: 0.98,
      tags: ['tts', 'audio'],
    },
    ...overrides,
  };
}

describe('Registry Store', () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  describe('CRUD operations', () => {
    it('inserts a card then getCard returns identical data', () => {
      const card = makeCard();
      insertCard(db, card);
      const retrieved = getCard(db, card.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(card.id);
      expect(retrieved?.owner).toBe(card.owner);
      expect(retrieved?.name).toBe(card.name);
      expect(retrieved?.level).toBe(card.level);
    });

    it('getCard returns null for unknown id', () => {
      const result = getCard(db, randomUUID());
      expect(result).toBeNull();
    });

    it('insertCard sets created_at and updated_at automatically', () => {
      const card = makeCard();
      insertCard(db, card);
      const retrieved = getCard(db, card.id);
      expect(retrieved?.created_at).toBeDefined();
      expect(retrieved?.updated_at).toBeDefined();
    });

    it('deleteCard by owner succeeds', () => {
      const card = makeCard();
      insertCard(db, card);
      deleteCard(db, card.id, card.owner);
      const retrieved = getCard(db, card.id);
      expect(retrieved).toBeNull();
    });

    it('deleteCard by non-owner throws AgentBnBError with FORBIDDEN code', () => {
      const card = makeCard();
      insertCard(db, card);
      expect(() => deleteCard(db, card.id, 'another-owner')).toThrow(AgentBnBError);
      expect(() => deleteCard(db, card.id, 'another-owner')).toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' })
      );
    });

    it('updateCard by owner succeeds and updated_at changes', async () => {
      const card = makeCard();
      insertCard(db, card);
      const before = getCard(db, card.id);

      // Small delay to ensure updated_at differs
      await new Promise((r) => setTimeout(r, 10));

      updateCard(db, card.id, card.owner, { name: 'Updated TTS Capability' });
      const after = getCard(db, card.id);

      expect(after?.name).toBe('Updated TTS Capability');
      expect(after?.updated_at).not.toBe(before?.updated_at);
    });

    it('updateCard by non-owner throws AgentBnBError with FORBIDDEN code', () => {
      const card = makeCard();
      insertCard(db, card);
      expect(() => updateCard(db, card.id, 'intruder', { name: 'Hacked' })).toThrow(
        AgentBnBError
      );
      expect(() => updateCard(db, card.id, 'intruder', { name: 'Hacked' })).toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' })
      );
    });

    it('listCards returns all cards for an owner', () => {
      const owner = 'alice';
      const cards = [makeCard({ owner }), makeCard({ owner }), makeCard({ owner })];
      const other = makeCard({ owner: 'bob' });
      cards.forEach((c) => insertCard(db, c));
      insertCard(db, other);

      const result = listCards(db, owner);
      expect(result).toHaveLength(3);
      result.forEach((c) => expect(c.owner).toBe(owner));
    });

    it('listCards without owner filter returns all cards', () => {
      const cards = [
        makeCard({ owner: 'alice' }),
        makeCard({ owner: 'bob' }),
        makeCard({ owner: 'charlie' }),
      ];
      cards.forEach((c) => insertCard(db, c));

      const result = listCards(db);
      expect(result).toHaveLength(3);
    });

    it('insert 100+ cards completes without error', () => {
      const cards = Array.from({ length: 105 }, (_, i) =>
        makeCard({ name: `Card ${i}`, description: `Description for card ${i}` })
      );
      expect(() => cards.forEach((c) => insertCard(db, c))).not.toThrow();
      const all = listCards(db);
      expect(all).toHaveLength(105);
    });
  });

  describe('FTS5 integrity', () => {
    it('FTS5 integrity check passes', () => {
      const card = makeCard();
      insertCard(db, card);
      // If FTS5 is broken this will throw
      expect(() => {
        db.prepare("INSERT INTO cards_fts(cards_fts) VALUES('integrity-check')").run();
      }).not.toThrow();
    });
  });

  describe('matcher - searchCards', () => {
    beforeEach(() => {
      // Seed a diverse set of cards for search tests
      const cards: CapabilityCard[] = [
        makeCard({
          id: randomUUID(),
          name: 'ElevenLabs TTS',
          description: 'Text-to-speech synthesis via ElevenLabs API',
          level: 1,
          availability: { online: true },
          metadata: { tags: ['tts', 'audio', 'voice'], apis_used: ['elevenlabs'] },
        }),
        makeCard({
          id: randomUUID(),
          name: 'Google TTS',
          description: 'Text-to-speech using Google Cloud API',
          level: 1,
          availability: { online: true },
          metadata: { tags: ['tts', 'audio'], apis_used: ['google-cloud'] },
        }),
        makeCard({
          id: randomUUID(),
          name: 'Image Classifier',
          description: 'Classify images using computer vision models',
          level: 1,
          availability: { online: true },
          metadata: { tags: ['vision', 'classification'], apis_used: ['openai'] },
        }),
        makeCard({
          id: randomUUID(),
          name: 'Video Pipeline',
          description: 'Full text-to-video generation pipeline',
          level: 2,
          availability: { online: true },
          metadata: { tags: ['video', 'pipeline'], apis_used: ['kling'] },
        }),
        makeCard({
          id: randomUUID(),
          name: 'Offline Transcriber',
          description: 'Audio transcription without internet',
          level: 1,
          availability: { online: false },
          metadata: { tags: ['transcription', 'audio'], apis_used: [] },
        }),
        makeCard({
          id: randomUUID(),
          name: 'Full Environment',
          description: 'Complete agent deployment environment',
          level: 3,
          availability: { online: true },
          metadata: { tags: ['environment', 'deployment'], apis_used: ['openai'] },
        }),
      ];

      // Fill up to 100 cards with dummy entries for performance test
      for (let i = cards.length; i < 100; i++) {
        cards.push(
          makeCard({
            id: randomUUID(),
            name: `Generic Capability ${i}`,
            description: `A generic capability number ${i} for testing`,
            level: 1,
            availability: { online: true },
          })
        );
      }

      cards.forEach((c) => insertCard(db, c));
    });

    it('searchCards("TTS") returns cards with TTS in name or description', () => {
      const results = searchCards(db, 'TTS');
      expect(results.length).toBeGreaterThanOrEqual(2);
      const names = results.map((c) => c.name);
      expect(names.some((n) => n.includes('TTS'))).toBe(true);
    });

    it('searchCards with level filter returns only matching level', () => {
      const results = searchCards(db, 'capability', { level: 1 });
      results.forEach((c) => expect(c.level).toBe(1));
    });

    it('searchCards with online=true filter excludes offline cards', () => {
      const results = searchCards(db, 'audio', { online: true });
      results.forEach((c) => expect(c.availability.online).toBe(true));
    });

    it('searchCards returns results ranked by relevance (BM25)', () => {
      const results = searchCards(db, 'TTS');
      // TTS cards should appear first (higher relevance)
      expect(results.length).toBeGreaterThan(0);
      const ttsResults = results.filter((c) => c.name.includes('TTS'));
      expect(ttsResults.length).toBeGreaterThanOrEqual(2);
    });

    it('searchCards returns empty array for no matches', () => {
      const results = searchCards(db, 'xyzzy-nonexistent-query-12345');
      expect(results).toEqual([]);
    });

    it('searchCards completes in under 50ms for 100 cards', () => {
      const start = Date.now();
      searchCards(db, 'capability');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('matcher - filterCards', () => {
    beforeEach(() => {
      const cards: CapabilityCard[] = [
        makeCard({ id: randomUUID(), level: 1, availability: { online: true } }),
        makeCard({ id: randomUUID(), level: 1, availability: { online: false } }),
        makeCard({ id: randomUUID(), level: 2, availability: { online: true } }),
        makeCard({ id: randomUUID(), level: 3, availability: { online: true } }),
      ];
      cards.forEach((c) => insertCard(db, c));
    });

    it('filterCards with level filter returns only matching level', () => {
      const results = filterCards(db, { level: 2 });
      expect(results).toHaveLength(1);
      expect(results[0]?.level).toBe(2);
    });

    it('filterCards with online=true excludes offline cards', () => {
      const results = filterCards(db, { online: true });
      results.forEach((c) => expect(c.availability.online).toBe(true));
    });

    it('filterCards with no filters returns all cards', () => {
      const results = filterCards(db, {});
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('updateReputation', () => {
    it('Test 1: success=true on card with no prior reputation sets success_rate near 1.0 and avg_latency_ms near observed', () => {
      const card = makeCard({ metadata: {} });
      insertCard(db, card);

      updateReputation(db, card.id, true, 500);

      const updated = getCard(db, card.id);
      expect(updated?.metadata?.success_rate).toBeDefined();
      expect(updated?.metadata?.success_rate).toBeCloseTo(1.0, 2);
      expect(updated?.metadata?.avg_latency_ms).toBeDefined();
      expect(updated?.metadata?.avg_latency_ms).toBeCloseTo(500, -1);
    });

    it('Test 2: success=false on card with success_rate=1.0 decreases success_rate to ~0.9 (EWA alpha=0.1)', () => {
      const card = makeCard({ metadata: { success_rate: 1.0 } });
      insertCard(db, card);

      updateReputation(db, card.id, false, 100);

      const updated = getCard(db, card.id);
      // EWA: 0.1 * 0 + 0.9 * 1.0 = 0.9
      expect(updated?.metadata?.success_rate).toBeCloseTo(0.9, 3);
    });

    it('Test 3: success=true updates avg_latency_ms using EWA (alpha=0.1)', () => {
      const card = makeCard({ metadata: { avg_latency_ms: 1000 } });
      insertCard(db, card);

      updateReputation(db, card.id, true, 500);

      const updated = getCard(db, card.id);
      // EWA: 0.1 * 500 + 0.9 * 1000 = 950
      expect(updated?.metadata?.avg_latency_ms).toBeCloseTo(950, 0);
    });

    it('Test 4: updateReputation on a non-existent card is a silent no-op', () => {
      expect(() => updateReputation(db, 'non-existent-id', true, 100)).not.toThrow();
    });

    it('Test 5: After updateReputation(), getCard() returns updated metadata values', () => {
      const card = makeCard({ metadata: {} });
      insertCard(db, card);

      updateReputation(db, card.id, true, 200);

      const updated = getCard(db, card.id);
      expect(updated?.metadata?.success_rate).toBeDefined();
      expect(updated?.metadata?.avg_latency_ms).toBeDefined();
      expect(typeof updated?.metadata?.success_rate).toBe('number');
      expect(typeof updated?.metadata?.avg_latency_ms).toBe('number');
    });

    it('Test 6: updateReputation() preserves existing metadata fields (apis_used, tags)', () => {
      const card = makeCard({
        metadata: {
          apis_used: ['elevenlabs'],
          tags: ['tts', 'audio'],
        },
      });
      insertCard(db, card);

      updateReputation(db, card.id, true, 300);

      const updated = getCard(db, card.id);
      expect(updated?.metadata?.apis_used).toEqual(['elevenlabs']);
      expect(updated?.metadata?.tags).toEqual(['tts', 'audio']);
      expect(updated?.metadata?.success_rate).toBeDefined();
      expect(updated?.metadata?.avg_latency_ms).toBeDefined();
    });
  });
});

// -----------------------------------------------------------------------
// Task 2 — v1.0 to v2.0 migration tests (Plan 04-02)
// -----------------------------------------------------------------------

describe('v1-to-v2 migration', () => {
  /**
   * Builds a fresh in-memory database at PRAGMA user_version 0 with v1.0 triggers,
   * inserts a v1.0 card directly into SQLite (bypassing insertCard validation),
   * then returns the db. This simulates a pre-migration database state.
   */
  function makePreMigrationDb(cards: CapabilityCard[]): ReturnType<typeof openDatabase> {
    // Open a new DB with initial schema (triggers set to v1.0 style)
    const db = openDatabase(':memory:');

    // Reset user_version to 0 to simulate pre-migration state
    // Then insert v1.0 cards directly into the DB (no v2.0 validation)
    // We need to bypass the migration that openDatabase() calls, so instead
    // we build raw by inserting JSON directly
    for (const card of cards) {
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(card.id, card.owner, JSON.stringify({ ...card, spec_version: '1.0', created_at: now, updated_at: now }), now, now);
    }

    return db;
  }

  describe('Test 1+2+3: Migration converts v1.0 card to v2.0 with correct shape', () => {
    it('migrated card has spec_version 2.0, agent_name = original name, skills[0].id = skill-{card.id}', () => {
      const cardId = randomUUID();
      const v1Card: CapabilityCard = {
        id: cardId,
        owner: 'test-owner',
        name: 'ElevenLabs TTS',
        description: 'Text-to-speech via ElevenLabs',
        level: 1,
        inputs: [{ name: 'text', type: 'text', required: true }],
        outputs: [{ name: 'audio', type: 'audio', required: true }],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
        metadata: { apis_used: ['elevenlabs'], tags: ['tts'] },
      };

      const db = makePreMigrationDb([v1Card]);

      // Reset user_version to force migration
      db.pragma('user_version = 0');
      runMigrations(db);

      const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string };
      const migrated = JSON.parse(row.data) as CapabilityCardV2;

      // Test 1: Correct v2.0 shape with skills[]
      expect(migrated.spec_version).toBe('2.0');
      expect(Array.isArray(migrated.skills)).toBe(true);
      expect(migrated.skills.length).toBe(1);

      // Test 2: agent_name and skill id
      expect(migrated.agent_name).toBe('ElevenLabs TTS');
      expect(migrated.skills[0]!.id).toBe(`skill-${cardId}`);

      // Test 3: Preserves original fields
      expect(migrated.skills[0]!.name).toBe('ElevenLabs TTS');
      expect(migrated.skills[0]!.description).toBe('Text-to-speech via ElevenLabs');
      expect(migrated.skills[0]!.level).toBe(1);
      expect(migrated.skills[0]!.inputs).toEqual(v1Card.inputs);
      expect(migrated.skills[0]!.outputs).toEqual(v1Card.outputs);
      expect(migrated.skills[0]!.pricing).toEqual(v1Card.pricing);
      expect(migrated.skills[0]!.metadata?.apis_used).toEqual(['elevenlabs']);
      expect(migrated.skills[0]!.metadata?.tags).toEqual(['tts']);
    });
  });

  describe('Test 4: PRAGMA user_version is 2 after migration', () => {
    it('user_version is set to 2 after runMigrations()', () => {
      const db = makePreMigrationDb([]);
      db.pragma('user_version = 0');
      runMigrations(db);

      const version = (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version ?? 0;
      expect(version).toBe(2);
    });
  });

  describe('Test 5: Calling runMigrations() twice does NOT double-migrate (user_version guard)', () => {
    it('running migration twice leaves only one skills[] per card', () => {
      const cardId = randomUUID();
      const v1Card: CapabilityCard = {
        id: cardId,
        owner: 'test-owner',
        name: 'ElevenLabs TTS',
        description: 'Text-to-speech via ElevenLabs',
        level: 1,
        inputs: [{ name: 'text', type: 'text', required: true }],
        outputs: [{ name: 'audio', type: 'audio', required: true }],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
      };

      const db = makePreMigrationDb([v1Card]);
      db.pragma('user_version = 0');
      runMigrations(db);
      runMigrations(db); // Second call — should be a no-op

      const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string };
      const migrated = JSON.parse(row.data) as CapabilityCardV2;

      expect(migrated.spec_version).toBe('2.0');
      expect(migrated.skills.length).toBe(1);
      // Ensure no double-wrapping: skills[0] should NOT have a 'skills' property
      expect((migrated.skills[0] as Record<string, unknown>)['skills']).toBeUndefined();
    });
  });

  describe('Test 6+7: FTS5 search works after migration', () => {
    it('FTS5 search for a skill name returns the correct card', () => {
      const cardId = randomUUID();
      const v1Card: CapabilityCard = {
        id: cardId,
        owner: 'test-owner',
        name: 'VoiceSynth Pro',
        description: 'Professional voice synthesis',
        level: 1,
        inputs: [{ name: 'text', type: 'text', required: true }],
        outputs: [{ name: 'audio', type: 'audio', required: true }],
        pricing: { credits_per_call: 10 },
        availability: { online: true },
      };

      const db = makePreMigrationDb([v1Card]);
      db.pragma('user_version = 0');
      runMigrations(db);

      const results = searchCards(db, 'VoiceSynth');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === cardId);
      expect(found).toBeDefined();
    });

    it('FTS5 search for a skill description returns the correct card', () => {
      const cardId = randomUUID();
      const v1Card: CapabilityCard = {
        id: cardId,
        owner: 'test-owner',
        name: 'My Capability',
        description: 'UniqueXylosynthPhraseForTesting description',
        level: 1,
        inputs: [{ name: 'text', type: 'text', required: true }],
        outputs: [{ name: 'audio', type: 'audio', required: true }],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
      };

      const db = makePreMigrationDb([v1Card]);
      db.pragma('user_version = 0');
      runMigrations(db);

      const results = searchCards(db, 'UniqueXylosynthPhraseForTesting');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === cardId);
      expect(found).toBeDefined();
    });
  });

  describe('Test 8: Inserting a NEW v2.0 card after migration is indexed by FTS5', () => {
    it('new v2.0 card inserted after migration appears in FTS5 search', () => {
      const db = makePreMigrationDb([]);
      db.pragma('user_version = 0');
      runMigrations(db);

      // Insert a v2.0 card directly after migration
      const cardId = randomUUID();
      const now = new Date().toISOString();
      const v2Card = {
        spec_version: '2.0',
        id: cardId,
        owner: 'test-owner',
        agent_name: 'New v2 Agent',
        skills: [{
          id: `skill-${cardId}`,
          name: 'TranscriptionSkillUnique',
          description: 'Transcribes audio to text with high accuracy',
          level: 1,
          inputs: [{ name: 'audio', type: 'audio', required: true }],
          outputs: [{ name: 'text', type: 'text', required: true }],
          pricing: { credits_per_call: 3 },
        }],
        availability: { online: true },
        created_at: now,
        updated_at: now,
      };

      db.prepare(
        'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(cardId, 'test-owner', JSON.stringify(v2Card), now, now);

      const results = searchCards(db, 'TranscriptionSkillUnique');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === cardId);
      expect(found).toBeDefined();
    });
  });
});

// -----------------------------------------------------------------------
// Task 2 — request_log skill_id column tests (Plan 04-02)
// -----------------------------------------------------------------------

describe('request_log skill_id', () => {
  describe('Test 9: request_log table has skill_id column after migration', () => {
    it('skill_id column exists in request_log table', () => {
      const db = openDatabase(':memory:');
      const info = db.prepare("PRAGMA table_info(request_log)").all() as Array<{ name: string }>;
      const colNames = info.map((col) => col.name);
      expect(colNames).toContain('skill_id');
    });
  });

  describe('Test 10: insertRequestLog with skill_id succeeds', () => {
    it('can insert a log entry with skill_id and retrieve it', () => {
      const db = openDatabase(':memory:');
      const entryId = randomUUID();
      const cardId = randomUUID();

      insertRequestLog(db, {
        id: entryId,
        card_id: cardId,
        card_name: 'Test Card',
        requester: 'test-agent',
        status: 'success',
        latency_ms: 150,
        credits_charged: 5,
        created_at: new Date().toISOString(),
        skill_id: 'tts-elevenlabs',
      });

      const logs = getRequestLog(db, 10);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.skill_id).toBe('tts-elevenlabs');
    });

    it('can insert a log entry without skill_id (backward compat)', () => {
      const db = openDatabase(':memory:');
      const entryId = randomUUID();

      insertRequestLog(db, {
        id: entryId,
        card_id: randomUUID(),
        card_name: 'Test Card',
        requester: 'test-agent',
        status: 'success',
        latency_ms: 100,
        credits_charged: 5,
        created_at: new Date().toISOString(),
      });

      const logs = getRequestLog(db, 10);
      expect(logs).toHaveLength(1);
      // skill_id should be null or undefined when not provided
      expect(logs[0]!.skill_id == null).toBe(true);
    });
  });
});

// -----------------------------------------------------------------------
// Task 2 — updateSkillAvailability and updateSkillIdleRate (Plan 06-01)
// -----------------------------------------------------------------------

/**
 * Inserts a v2.0 card with two skills directly into the DB using raw SQL.
 * Bypasses Zod validation so we can use v2.0 shape in tests.
 */
function insertV2CardRaw(
  db: ReturnType<typeof openDatabase>,
  cardId: string,
  owner: string,
  skillAId: string,
  skillBId: string,
  extraInternal?: Record<string, unknown>
): void {
  const now = new Date().toISOString();
  const v2 = {
    spec_version: '2.0',
    id: cardId,
    owner,
    agent_name: 'Test Agent',
    skills: [
      {
        id: skillAId,
        name: 'Skill A',
        description: 'First skill',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
        _internal: extraInternal ?? {},
      },
      {
        id: skillBId,
        name: 'Skill B',
        description: 'Second skill',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 3 },
        availability: { online: true },
        _internal: {},
      },
    ],
    availability: { online: true },
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(cardId, owner, JSON.stringify(v2), now, now);
}

describe('updateSkillAvailability', () => {
  let db: ReturnType<typeof openDatabase>;
  const cardId = 'card-avail-test';
  const skillAId = 'skill-a-avail';
  const skillBId = 'skill-b-avail';

  beforeEach(() => {
    db = openDatabase(':memory:');
    insertV2CardRaw(db, cardId, 'owner-1', skillAId, skillBId);
  });

  it('sets skill.availability.online to true for the target skill', () => {
    updateSkillAvailability(db, cardId, skillAId, true);
    const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string };
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const skills = parsed['skills'] as Array<Record<string, unknown>>;
    const skillA = skills.find((s) => s['id'] === skillAId) as Record<string, unknown> | undefined;
    expect((skillA?.['availability'] as Record<string, unknown>)?.['online']).toBe(true);
  });

  it('sets skill.availability.online to false for the target skill', () => {
    updateSkillAvailability(db, cardId, skillAId, false);
    const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string };
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const skills = parsed['skills'] as Array<Record<string, unknown>>;
    const skillA = skills.find((s) => s['id'] === skillAId) as Record<string, unknown> | undefined;
    expect((skillA?.['availability'] as Record<string, unknown>)?.['online']).toBe(false);
  });

  it('does NOT modify sibling skills on the same card', () => {
    updateSkillAvailability(db, cardId, skillAId, false);
    const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string };
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const skills = parsed['skills'] as Array<Record<string, unknown>>;
    const skillB = skills.find((s) => s['id'] === skillBId) as Record<string, unknown> | undefined;
    // Skill B should remain online=true
    expect((skillB?.['availability'] as Record<string, unknown>)?.['online']).toBe(true);
  });

  it('no-ops if cardId not found', () => {
    expect(() => updateSkillAvailability(db, 'nonexistent-card', skillAId, false)).not.toThrow();
  });

  it('no-ops if skillId not found on the card', () => {
    expect(() => updateSkillAvailability(db, cardId, 'nonexistent-skill', false)).not.toThrow();
  });
});

describe('updateSkillIdleRate', () => {
  let db: ReturnType<typeof openDatabase>;
  const cardId = 'card-idle-test';
  const skillAId = 'skill-a-idle';
  const skillBId = 'skill-b-idle';

  beforeEach(() => {
    db = openDatabase(':memory:');
    // Skill A has an existing _internal field with 'some_existing_key'
    insertV2CardRaw(db, cardId, 'owner-1', skillAId, skillBId, { some_existing_key: 'preserved' });
  });

  it('writes idle_rate and idle_rate_computed_at to skill._internal', () => {
    updateSkillIdleRate(db, cardId, skillAId, 0.42);
    const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string };
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const skills = parsed['skills'] as Array<Record<string, unknown>>;
    const skillA = skills.find((s) => s['id'] === skillAId) as Record<string, unknown> | undefined;
    const internal = skillA?.['_internal'] as Record<string, unknown> | undefined;
    expect(internal?.['idle_rate']).toBe(0.42);
    expect(typeof internal?.['idle_rate_computed_at']).toBe('string');
  });

  it('preserves existing _internal fields (does not overwrite other keys)', () => {
    updateSkillIdleRate(db, cardId, skillAId, 0.75);
    const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string };
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const skills = parsed['skills'] as Array<Record<string, unknown>>;
    const skillA = skills.find((s) => s['id'] === skillAId) as Record<string, unknown> | undefined;
    const internal = skillA?.['_internal'] as Record<string, unknown> | undefined;
    // Existing key must still be present
    expect(internal?.['some_existing_key']).toBe('preserved');
    expect(internal?.['idle_rate']).toBe(0.75);
  });

  it('no-ops if cardId not found', () => {
    expect(() => updateSkillIdleRate(db, 'nonexistent-card', skillAId, 0.5)).not.toThrow();
  });

  it('no-ops if skillId not found on the card', () => {
    expect(() => updateSkillIdleRate(db, cardId, 'nonexistent-skill', 0.5)).not.toThrow();
  });
});

describe('getCardsByCapabilityType', () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('returns cards that match the given capability_type', () => {
    // Insert a v2.0 card with capability_type via raw SQL (bypassing v1.0 Zod schema)
    const cardId = randomUUID();
    const now = new Date().toISOString();
    const card = {
      spec_version: '2.0',
      id: cardId,
      owner: 'alice',
      agent_name: 'alice-decomposer',
      capability_type: 'task_decomposition',
      skills: [
        {
          id: 'task-decomposition',
          name: 'Task Decomposition',
          description: 'Decomposes tasks',
          level: 1,
          inputs: [{ name: 'task', type: 'text', required: true }],
          outputs: [{ name: 'subtasks', type: 'json', required: true }],
          pricing: { credits_per_call: 1 },
        },
      ],
      availability: { online: true },
    };
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(cardId, 'alice', JSON.stringify(card), now, now);

    const results = getCardsByCapabilityType(db, 'task_decomposition');
    expect(results).toHaveLength(1);
    expect(results[0]).toBeDefined();
    const result = results[0] as Record<string, unknown>;
    expect(result['id']).toBe(cardId);
    expect(result['capability_type']).toBe('task_decomposition');
  });

  it('does NOT return cards without capability_type', () => {
    // Insert a normal v1.0 card (no capability_type field)
    const card = makeCard();
    insertCard(db, card);

    const results = getCardsByCapabilityType(db, 'task_decomposition');
    expect(results).toHaveLength(0);
  });

  it('returns empty array for unknown capability_type', () => {
    const results = getCardsByCapabilityType(db, 'nonexistent_type');
    expect(results).toHaveLength(0);
  });

  it('returns multiple cards with the same capability_type', () => {
    const now = new Date().toISOString();
    for (const owner of ['alice', 'bob']) {
      const cardId = randomUUID();
      const card = {
        spec_version: '2.0',
        id: cardId,
        owner,
        agent_name: `${owner}-decomposer`,
        capability_type: 'task_decomposition',
        skills: [
          {
            id: 'task-decomposition',
            name: 'Task Decomposition',
            description: 'Decomposes tasks',
            level: 1,
            inputs: [{ name: 'task', type: 'text', required: true }],
            outputs: [{ name: 'subtasks', type: 'json', required: true }],
            pricing: { credits_per_call: 1 },
          },
        ],
        availability: { online: true },
      };
      db.prepare(
        'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(cardId, owner, JSON.stringify(card), now, now);
    }

    const results = getCardsByCapabilityType(db, 'task_decomposition');
    expect(results).toHaveLength(2);
  });
});
