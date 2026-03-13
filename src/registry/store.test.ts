import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  openDatabase,
  insertCard,
  getCard,
  updateCard,
  deleteCard,
  listCards,
} from './store.js';
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
});
