import { describe, it, expect } from 'vitest';
import { buildConductorCard, registerConductorCard, CONDUCTOR_OWNER } from './card.js';
import { CapabilityCardV2Schema } from '../types/index.js';
import { openDatabase } from '../registry/store.js';

describe('Conductor Card', () => {
  describe('CONDUCTOR_OWNER', () => {
    it('is "agentbnb-conductor"', () => {
      expect(CONDUCTOR_OWNER).toBe('agentbnb-conductor');
    });
  });

  describe('buildConductorCard()', () => {
    it('returns a valid CapabilityCardV2 object', () => {
      const card = buildConductorCard();
      const result = CapabilityCardV2Schema.safeParse(card);
      expect(result.success).toBe(true);
    });

    it('has correct owner and agent_name', () => {
      const card = buildConductorCard();
      expect(card.owner).toBe('agentbnb-conductor');
      expect(card.agent_name).toBe('AgentBnB Conductor');
    });

    it('has exactly 2 skills: orchestrate and plan', () => {
      const card = buildConductorCard();
      expect(card.skills).toHaveLength(2);
      expect(card.skills[0].id).toBe('orchestrate');
      expect(card.skills[1].id).toBe('plan');
    });

    it('orchestrate skill costs 5 credits', () => {
      const card = buildConductorCard();
      const orchestrate = card.skills.find((s) => s.id === 'orchestrate');
      expect(orchestrate?.pricing.credits_per_call).toBe(5);
    });

    it('plan skill costs 1 credit', () => {
      const card = buildConductorCard();
      const plan = card.skills.find((s) => s.id === 'plan');
      expect(plan?.pricing.credits_per_call).toBe(1);
    });

    it('has spec_version 2.0', () => {
      const card = buildConductorCard();
      expect(card.spec_version).toBe('2.0');
    });

    it('is available online', () => {
      const card = buildConductorCard();
      expect(card.availability.online).toBe(true);
    });

    it('returns the same card ID on repeated calls (singleton)', () => {
      const c1 = buildConductorCard();
      const c2 = buildConductorCard();
      expect(c1.id).toBe(c2.id);
    });
  });

  describe('buildConductorCard(owner)', () => {
    it('uses provided owner instead of CONDUCTOR_OWNER', () => {
      const card = buildConductorCard('my-agent');
      expect(card.owner).toBe('my-agent');
    });

    it('produces a deterministic card ID per owner', () => {
      const c1 = buildConductorCard('alice');
      const c2 = buildConductorCard('alice');
      expect(c1.id).toBe(c2.id);
    });

    it('produces different card IDs for different owners', () => {
      const c1 = buildConductorCard('alice');
      const c2 = buildConductorCard('bob');
      expect(c1.id).not.toBe(c2.id);
    });

    it('produces a different ID from the default singleton', () => {
      const defaultCard = buildConductorCard();
      const ownerCard = buildConductorCard('my-agent');
      expect(ownerCard.id).not.toBe(defaultCard.id);
    });

    it('returns a valid CapabilityCardV2 when owner is provided', () => {
      const card = buildConductorCard('my-agent');
      const result = CapabilityCardV2Schema.safeParse(card);
      expect(result.success).toBe(true);
    });
  });

  describe('registerConductorCard()', () => {
    it('inserts the card into the database and retrieves it', () => {
      const db = openDatabase();
      const card = registerConductorCard(db);

      const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(card.id) as
        | { data: string }
        | undefined;
      expect(row).toBeDefined();
      const stored = JSON.parse(row!.data);
      expect(stored.owner).toBe('agentbnb-conductor');
      expect(stored.agent_name).toBe('AgentBnB Conductor');
    });

    it('is idempotent — calling twice does not throw', () => {
      const db = openDatabase();
      registerConductorCard(db);
      expect(() => registerConductorCard(db)).not.toThrow();
    });

    it('returns the card after registration', () => {
      const db = openDatabase();
      const card = registerConductorCard(db);
      expect(card.spec_version).toBe('2.0');
      expect(card.skills).toHaveLength(2);
    });
  });
});
