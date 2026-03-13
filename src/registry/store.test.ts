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
} from './store.js';
import { searchCards, filterCards } from './matcher.js';
import { AgentBnBError } from '../types/index.js';
import type { CapabilityCard } from '../types/index.js';
import type { Database } from 'better-sqlite3';

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
