/**
 * useRentableAgents — pure transformer tests.
 *
 * The hook itself is exercised through the DiscoverPage integration; here we
 * cover the deterministic AgentProfile → RentableAgent mapping so future
 * regressions show up locally.
 */
import { describe, expect, it } from 'vitest';
import { buildRentableAgent } from './useRentableAgents.js';
import type { AgentProfile, HubCard } from '../types.js';

const baseProfile: AgentProfile = {
  owner: 'did:agentbnb:abc',
  agent_id: 'did:agentbnb:abc',
  skill_count: 3,
  success_rate: 0.92,
  total_earned: 480,
  member_since: '2026-04-12T00:00:00Z',
};

const baseCard: HubCard = {
  id: 'card_1',
  owner: 'did:agentbnb:abc',
  name: 'Hannah · senior research analyst',
  description: 'Long-context investment research with verified market data tools.',
  level: 2,
  inputs: [],
  outputs: [],
  pricing: { credits_per_call: 4, credits_per_minute: 2 },
  availability: { online: true },
  metadata: {
    tags: ['research', 'finance'],
    apis_used: ['serpapi', 'sec-filings'],
    success_rate: 0.92,
  },
  capability_types: ['analysis'],
};

describe('buildRentableAgent', () => {
  it('returns null/empty fields when no card data is available', () => {
    const result = buildRentableAgent(baseProfile, []);
    expect(result.agent_id).toBe('did:agentbnb:abc');
    expect(result.name).toBe(baseProfile.owner);
    expect(result.tags).toHaveLength(0);
    expect(result.evidence.verified_tools).toHaveLength(0);
    expect(result.pricing.per_minute).toBeUndefined();
    expect(result.evidence.response_reliability).toBe(0.92);
  });

  it('extracts tags, tools, and pricing from a HubCard', () => {
    const result = buildRentableAgent(baseProfile, [baseCard]);
    expect(result.name).toContain('Hannah');
    expect(result.tags).toEqual(expect.arrayContaining(['research', 'finance', 'analysis']));
    expect(result.evidence.verified_tools).toEqual(
      expect.arrayContaining(['serpapi', 'sec-filings']),
    );
    expect(result.pricing.per_minute).toBe(2);
  });

  it('falls back to credits_per_call when per-minute is unset', () => {
    const card: HubCard = {
      ...baseCard,
      pricing: { credits_per_call: 7 },
    };
    const result = buildRentableAgent(baseProfile, [card]);
    expect(result.pricing.per_minute).toBe(7);
  });

  it('does not collapse maturity into a single score', () => {
    const result = buildRentableAgent(baseProfile, [baseCard]);
    // ADR-022: discrete categories, never a single number
    expect(result.evidence).toMatchObject({
      response_reliability: expect.any(Number),
      verified_tools: expect.any(Array),
    });
    expect(result.evidence.platform_sessions).toBeNull();
    expect(result.evidence.repeat_renters).toBeNull();
    expect(result.evidence.renter_rating).toBeNull();
  });
});
