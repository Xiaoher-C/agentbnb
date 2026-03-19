import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../registry/store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { getBalance } from '../credit/ledger.js';
import type Database from 'better-sqlite3';
import {
  lookupCardPrice,
  holdForRelay,
  settleForRelay,
  releaseForRelay,
  calculateConductorFee,
} from './relay-credit.js';
import { randomUUID } from 'node:crypto';

/** Helper: insert a capability card into the registry DB */
function insertTestCard(
  registryDb: Database.Database,
  id: string,
  cardData: Record<string, unknown>,
): void {
  registryDb.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, cardData.owner ?? 'test-owner', JSON.stringify(cardData), new Date().toISOString(), new Date().toISOString());
}

describe('relay-credit module', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;

  beforeEach(() => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');
  });

  // ── lookupCardPrice ─────────────────────────────────────────────────────────

  describe('lookupCardPrice', () => {
    it('returns credits_per_call for a known card (no skillId)', () => {
      const cardId = randomUUID();
      insertTestCard(registryDb, cardId, {
        id: cardId,
        owner: 'provider-a',
        name: 'Test Card',
        description: 'A test card',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 10 },
        availability: { online: true },
      });

      const price = lookupCardPrice(registryDb, cardId);
      expect(price).toBe(10);
    });

    it('returns skill-level pricing when skillId is provided and skill exists', () => {
      const cardId = randomUUID();
      insertTestCard(registryDb, cardId, {
        id: cardId,
        owner: 'provider-b',
        name: 'Multi-Skill Card',
        description: 'Card with skills',
        level: 2,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
        skills: [
          {
            id: 'skill-one',
            name: 'Skill One',
            description: 'First skill',
            level: 1,
            inputs: [],
            outputs: [],
            pricing: { credits_per_call: 15 },
          },
          {
            id: 'skill-two',
            name: 'Skill Two',
            description: 'Second skill',
            level: 1,
            inputs: [],
            outputs: [],
            pricing: { credits_per_call: 25 },
          },
        ],
      });

      const price = lookupCardPrice(registryDb, cardId, 'skill-two');
      expect(price).toBe(25);
    });

    it('falls back to card-level pricing when skillId is provided but not found in skills array', () => {
      const cardId = randomUUID();
      insertTestCard(registryDb, cardId, {
        id: cardId,
        owner: 'provider-c',
        name: 'Card with skills',
        description: 'Card',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 8 },
        availability: { online: true },
        skills: [
          {
            id: 'skill-existing',
            name: 'Existing Skill',
            description: 'A skill',
            level: 1,
            inputs: [],
            outputs: [],
            pricing: { credits_per_call: 20 },
          },
        ],
      });

      const price = lookupCardPrice(registryDb, cardId, 'skill-nonexistent');
      expect(price).toBe(8);
    });

    it('returns null for a card that does not exist', () => {
      const price = lookupCardPrice(registryDb, randomUUID());
      expect(price).toBeNull();
    });

    it('returns null when card has no pricing field', () => {
      const cardId = randomUUID();
      // Insert a malformed card without pricing
      registryDb.prepare(
        'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(cardId, 'owner-x', JSON.stringify({ id: cardId, owner: 'owner-x', name: 'Bad Card' }), new Date().toISOString(), new Date().toISOString());

      const price = lookupCardPrice(registryDb, cardId);
      expect(price).toBeNull();
    });
  });

  // ── holdForRelay ────────────────────────────────────────────────────────────

  describe('holdForRelay', () => {
    it('returns a non-empty escrowId and deducts from balance', () => {
      bootstrapAgent(creditDb, 'requester-a', 100);
      const cardId = randomUUID();

      const escrowId = holdForRelay(creditDb, 'requester-a', 10, cardId);

      expect(typeof escrowId).toBe('string');
      expect(escrowId.length).toBeGreaterThan(0);
      expect(getBalance(creditDb, 'requester-a')).toBe(90);
    });

    it('throws INSUFFICIENT_CREDITS when balance is too low', () => {
      bootstrapAgent(creditDb, 'requester-poor', 5);
      const cardId = randomUUID();

      expect(() => holdForRelay(creditDb, 'requester-poor', 10, cardId)).toThrow('Insufficient credits');
    });

    it('throws INSUFFICIENT_CREDITS when owner has no balance row', () => {
      const cardId = randomUUID();
      expect(() => holdForRelay(creditDb, 'requester-new', 10, cardId)).toThrow('Insufficient credits');
    });
  });

  // ── settleForRelay ──────────────────────────────────────────────────────────

  describe('settleForRelay', () => {
    it('transfers credits from held escrow to the provider', () => {
      bootstrapAgent(creditDb, 'requester-b', 100);
      bootstrapAgent(creditDb, 'provider-b', 0);
      const cardId = randomUUID();

      const escrowId = holdForRelay(creditDb, 'requester-b', 20, cardId);
      settleForRelay(creditDb, escrowId, 'provider-b');

      expect(getBalance(creditDb, 'requester-b')).toBe(80);
      expect(getBalance(creditDb, 'provider-b')).toBe(20);
    });
  });

  // ── releaseForRelay ─────────────────────────────────────────────────────────

  describe('releaseForRelay', () => {
    it('refunds held credits back to the requester', () => {
      bootstrapAgent(creditDb, 'requester-c', 100);
      const cardId = randomUUID();

      const escrowId = holdForRelay(creditDb, 'requester-c', 30, cardId);
      expect(getBalance(creditDb, 'requester-c')).toBe(70);

      releaseForRelay(creditDb, escrowId);
      expect(getBalance(creditDb, 'requester-c')).toBe(100);
    });

    it('does not throw when escrowId is undefined (no-op guard)', () => {
      expect(() => releaseForRelay(creditDb, undefined)).not.toThrow();
    });
  });

  // ── calculateConductorFee ────────────────────────────────────────────────────

  describe('calculateConductorFee', () => {
    it('returns 0 for zero cost (no fee on zero-cost orchestration)', () => {
      expect(calculateConductorFee(0)).toBe(0);
    });

    it('returns 0 for negative cost (guard against invalid input)', () => {
      expect(calculateConductorFee(-10)).toBe(0);
    });

    it('returns minimum fee of 1 when 10% would be less than 1 (cost=5)', () => {
      expect(calculateConductorFee(5)).toBe(1);
    });

    it('returns 1 when 10% exactly equals minimum (cost=10)', () => {
      expect(calculateConductorFee(10)).toBe(1);
    });

    it('returns ceil of 1.5 = 2 for cost=15', () => {
      expect(calculateConductorFee(15)).toBe(2);
    });

    it('returns exact 10% for cost=100', () => {
      expect(calculateConductorFee(100)).toBe(10);
    });

    it('returns maximum fee of 20 when 10% equals cap (cost=200)', () => {
      expect(calculateConductorFee(200)).toBe(20);
    });

    it('returns maximum fee of 20 when 10% exceeds cap (cost=300)', () => {
      expect(calculateConductorFee(300)).toBe(20);
    });
  });

  // ── calculateConductorFee integration: hold + settle ────────────────────────

  describe('calculateConductorFee integration', () => {
    it('hold + settle conductor fee from requester to conductor agent', () => {
      bootstrapAgent(creditDb, 'requester-cond', 100);
      bootstrapAgent(creditDb, 'conductor-agent', 0);
      const cardRef = randomUUID();

      const totalSubTaskCost = 100;
      const fee = calculateConductorFee(totalSubTaskCost);
      expect(fee).toBe(10);

      const feeEscrowId = holdForRelay(creditDb, 'requester-cond', fee, cardRef);
      expect(getBalance(creditDb, 'requester-cond')).toBe(90);

      settleForRelay(creditDb, feeEscrowId, 'conductor-agent');
      expect(getBalance(creditDb, 'requester-cond')).toBe(90);
      expect(getBalance(creditDb, 'conductor-agent')).toBe(10);
    });

    it('conductor fee release refunds requester when fee settlement fails', () => {
      bootstrapAgent(creditDb, 'requester-cond2', 50);
      const cardRef = randomUUID();

      const fee = calculateConductorFee(50); // 10% of 50 = 5
      expect(fee).toBe(5);

      const feeEscrowId = holdForRelay(creditDb, 'requester-cond2', fee, cardRef);
      expect(getBalance(creditDb, 'requester-cond2')).toBe(45);

      releaseForRelay(creditDb, feeEscrowId);
      expect(getBalance(creditDb, 'requester-cond2')).toBe(50);
    });
  });
});
