/**
 * Tests for executeCapabilityBatch() — batch capability request execution.
 *
 * All dependencies (store, ledger, escrow, request-log) are mocked so we test
 * only the orchestration logic inside executeCapabilityBatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../registry/store.js', () => ({
  getCard: vi.fn(),
  updateReputation: vi.fn(),
}));

vi.mock('../credit/ledger.js', () => ({
  getBalance: vi.fn(),
}));

vi.mock('../credit/escrow.js', () => ({
  holdEscrow: vi.fn(),
  settleEscrow: vi.fn(),
  releaseEscrow: vi.fn(),
}));

vi.mock('../registry/request-log.js', () => ({
  insertRequestLog: vi.fn(),
}));

vi.mock('../credit/signing.js', () => ({
  verifyEscrowReceipt: vi.fn(),
}));

vi.mock('../credit/settlement.js', () => ({
  settleProviderEarning: vi.fn(),
}));

vi.mock('./resolve-target-capability.js', () => ({
  resolveTargetCapability: vi.fn(),
}));

// ── Import after mocking ─────────────────────────────────────────────────────

import { executeCapabilityBatch } from './execute.js';
import { getCard, updateReputation } from '../registry/store.js';
import { getBalance } from '../credit/ledger.js';
import { holdEscrow, settleEscrow } from '../credit/escrow.js';
import { resolveTargetCapability } from './resolve-target-capability.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal fake CapabilityCard (v1 pricing). */
const makeCard = (id: string, creditsPerCall = 5) => ({
  id,
  owner: `owner-${id}`,
  name: `Card ${id}`,
  description: 'Test',
  spec_version: '1.0',
  level: 1 as const,
  inputs: [],
  outputs: [],
  pricing: { credits_per_call: creditsPerCall },
  availability: { online: true },
});

/** Minimal fake v2 CapabilityCard with skills array. */
const makeV2Card = (id: string, skillId: string, creditsPerCall = 5) => ({
  id,
  owner: `owner-${id}`,
  name: `Card ${id}`,
  description: 'Test',
  spec_version: '2.0',
  level: 1 as const,
  skills: [
    {
      id: skillId,
      name: `Skill ${skillId}`,
      description: 'Does stuff',
      level: 1 as const,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: creditsPerCall },
    },
  ],
  inputs: [],
  outputs: [],
  pricing: { credits_per_call: creditsPerCall },
  availability: { online: true },
});

const makeResolvedTarget = (
  skillOrCardId: string,
  opts: { cost?: number; owner?: string; viaRelay?: boolean; gatewayUrl?: string } = {},
) => ({
  cardId: skillOrCardId,
  skillId: skillOrCardId,
  owner: opts.owner ?? `owner-${skillOrCardId}`,
  gateway_url: opts.gatewayUrl ?? (opts.viaRelay ? '' : 'http://peer.local'),
  via_relay: opts.viaRelay ?? false,
  credits_per_call: opts.cost ?? 5,
  source: (opts.viaRelay ? 'relay' : 'local') as const,
});

/** Fake Database handle — no real SQLite needed. */
const fakeDb = {} as Database;

/** Default batch options shared across tests. */
const baseOptions = {
  strategy: 'parallel' as const,
  total_budget: 1000,
  registryDb: fakeDb,
  creditDb: fakeDb,
  owner: 'requester-agent',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('executeCapabilityBatch', () => {
  beforeEach(() => {
    // resetAllMocks clears call counts AND resets mockReturnValueOnce queues,
    // preventing state from leaking between tests.
    vi.resetAllMocks();

    // Sensible defaults: card exists, enough balance, escrow succeeds
    vi.mocked(getCard).mockReturnValue(makeCard('card-1') as ReturnType<typeof getCard>);
    vi.mocked(getBalance).mockReturnValue(500);
    vi.mocked(holdEscrow).mockReturnValue('escrow-uuid');
    vi.mocked(settleEscrow).mockReturnValue(undefined);
    vi.mocked(updateReputation).mockReturnValue(undefined);
    vi.mocked(resolveTargetCapability).mockImplementation(async (skillId: string) =>
      makeResolvedTarget(skillId),
    );
  });

  // ── Budget validation ────────────────────────────────────────────────────────

  it('returns immediate rejection with no escrow when sum(max_credits) exceeds total_budget', async () => {
    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [
        { skill_id: 'card-1', params: {}, max_credits: 600 },
        { skill_id: 'card-1', params: {}, max_credits: 600 },
      ],
      total_budget: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.total_credits_spent).toBe(0);
    expect(result.total_credits_refunded).toBe(0);
    // All items should be 'skipped' with an error message
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.status).toBe('skipped');
      expect(r.credits_spent).toBe(0);
      expect(r.error).toMatch(/exceeds total_budget/i);
    }
    // No escrow should have been touched
    expect(holdEscrow).not.toHaveBeenCalled();
  });

  it('accepts batch when sum(max_credits) exactly equals total_budget', async () => {
    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [
        { skill_id: 'card-1', params: {}, max_credits: 500 },
        { skill_id: 'card-1', params: {}, max_credits: 500 },
      ],
      total_budget: 1000,
    });

    expect(result.success).toBe(true);
    expect(holdEscrow).toHaveBeenCalledTimes(2);
  });

  // ── Empty requests ───────────────────────────────────────────────────────────

  it('returns empty results and success=true for an empty requests array', async () => {
    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [],
    });

    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.total_credits_spent).toBe(0);
    expect(result.total_credits_refunded).toBe(0);
    expect(holdEscrow).not.toHaveBeenCalled();
  });

  // ── Parallel strategy ────────────────────────────────────────────────────────

  it('parallel strategy: all 3 requests execute and succeed', async () => {
    vi.mocked(resolveTargetCapability)
      .mockResolvedValueOnce(makeResolvedTarget('card-a', { cost: 5 }))
      .mockResolvedValueOnce(makeResolvedTarget('card-b', { cost: 10 }))
      .mockResolvedValueOnce(makeResolvedTarget('card-c', { cost: 3 }));

    vi.mocked(getCard)
      .mockReturnValueOnce(makeCard('card-a', 5) as ReturnType<typeof getCard>)
      .mockReturnValueOnce(makeCard('card-b', 10) as ReturnType<typeof getCard>)
      .mockReturnValueOnce(makeCard('card-c', 3) as ReturnType<typeof getCard>);

    vi.mocked(holdEscrow)
      .mockReturnValueOnce('escrow-a')
      .mockReturnValueOnce('escrow-b')
      .mockReturnValueOnce('escrow-c');

    const result = await executeCapabilityBatch({
      ...baseOptions,
      strategy: 'parallel',
      requests: [
        { skill_id: 'card-a', params: { x: 1 }, max_credits: 10 },
        { skill_id: 'card-b', params: { x: 2 }, max_credits: 20 },
        { skill_id: 'card-c', params: { x: 3 }, max_credits: 10 },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.status === 'success')).toBe(true);
    expect(result.total_credits_spent).toBe(5 + 10 + 3);
    expect(holdEscrow).toHaveBeenCalledTimes(3);
    expect(settleEscrow).toHaveBeenCalledTimes(3);
  });

  it('parallel strategy: one failed card does NOT affect success of others', async () => {
    vi.mocked(resolveTargetCapability)
      .mockResolvedValueOnce(makeResolvedTarget('card-a', { cost: 5 }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeResolvedTarget('card-c', { cost: 3 }));

    vi.mocked(getCard)
      .mockReturnValueOnce(makeCard('card-a', 5) as ReturnType<typeof getCard>)
      .mockReturnValueOnce(null) // card-b not found
      .mockReturnValueOnce(makeCard('card-c', 3) as ReturnType<typeof getCard>);

    vi.mocked(holdEscrow)
      .mockReturnValueOnce('escrow-a')
      .mockReturnValueOnce('escrow-c');

    const result = await executeCapabilityBatch({
      ...baseOptions,
      strategy: 'parallel',
      requests: [
        { skill_id: 'card-a', params: {}, max_credits: 10 },
        { skill_id: 'card-b', params: {}, max_credits: 10 },
        { skill_id: 'card-c', params: {}, max_credits: 10 },
      ],
    });

    expect(result.success).toBe(false); // overall false because one item failed
    expect(result.results[0]!.status).toBe('success');
    expect(result.results[1]!.status).toBe('failed');
    expect(result.results[1]!.error).toMatch(/not found/i);
    expect(result.results[2]!.status).toBe('success');
  });

  // ── Best-effort strategy ─────────────────────────────────────────────────────

  it('best_effort: other items still succeed when one fails', async () => {
    vi.mocked(resolveTargetCapability)
      .mockResolvedValueOnce(makeResolvedTarget('card-a', { cost: 5 }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeResolvedTarget('card-c', { cost: 3 }));

    vi.mocked(getCard)
      .mockReturnValueOnce(makeCard('card-a', 5) as ReturnType<typeof getCard>)
      .mockReturnValueOnce(null) // card-b not found
      .mockReturnValueOnce(makeCard('card-c', 3) as ReturnType<typeof getCard>);

    vi.mocked(holdEscrow)
      .mockReturnValueOnce('escrow-a')
      .mockReturnValueOnce('escrow-c');

    const result = await executeCapabilityBatch({
      ...baseOptions,
      strategy: 'best_effort',
      requests: [
        { skill_id: 'card-a', params: {}, max_credits: 10 },
        { skill_id: 'card-b', params: {}, max_credits: 10 },
        { skill_id: 'card-c', params: {}, max_credits: 10 },
      ],
    });

    expect(result.results[0]!.status).toBe('success');
    expect(result.results[1]!.status).toBe('failed');
    expect(result.results[2]!.status).toBe('success');
    // Overall success false because one item failed
    expect(result.success).toBe(false);
    // Credits only spent on successful items
    expect(result.total_credits_spent).toBe(5 + 3);
  });

  // ── Sequential strategy ──────────────────────────────────────────────────────

  it('sequential: stops after the first failure and marks remaining as skipped', async () => {
    vi.mocked(resolveTargetCapability)
      .mockResolvedValueOnce(makeResolvedTarget('card-a', { cost: 5 }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeResolvedTarget('card-c', { cost: 3 }));

    vi.mocked(getCard)
      .mockReturnValueOnce(makeCard('card-a', 5) as ReturnType<typeof getCard>)
      .mockReturnValueOnce(null) // card-b not found — will fail
      .mockReturnValueOnce(makeCard('card-c', 3) as ReturnType<typeof getCard>);

    vi.mocked(holdEscrow).mockReturnValueOnce('escrow-a');

    const result = await executeCapabilityBatch({
      ...baseOptions,
      strategy: 'sequential',
      requests: [
        { skill_id: 'card-a', params: {}, max_credits: 10 },
        { skill_id: 'card-b', params: {}, max_credits: 10 }, // fails
        { skill_id: 'card-c', params: {}, max_credits: 10 }, // skipped
      ],
    });

    expect(result.success).toBe(false);
    expect(result.results[0]!.status).toBe('success');
    expect(result.results[1]!.status).toBe('failed');
    expect(result.results[2]!.status).toBe('skipped');
    expect(result.results[2]!.error).toMatch(/skipped/i);

    // card-c should never have been looked up (skipped before iteration)
    expect(getCard).toHaveBeenCalledTimes(1);
  });

  it('sequential: all succeed when no failures', async () => {
    vi.mocked(resolveTargetCapability)
      .mockResolvedValueOnce(makeResolvedTarget('card-a', { cost: 5 }))
      .mockResolvedValueOnce(makeResolvedTarget('card-b', { cost: 10 }));

    vi.mocked(getCard)
      .mockReturnValueOnce(makeCard('card-a', 5) as ReturnType<typeof getCard>)
      .mockReturnValueOnce(makeCard('card-b', 10) as ReturnType<typeof getCard>);

    vi.mocked(holdEscrow)
      .mockReturnValueOnce('escrow-a')
      .mockReturnValueOnce('escrow-b');

    const result = await executeCapabilityBatch({
      ...baseOptions,
      strategy: 'sequential',
      requests: [
        { skill_id: 'card-a', params: {}, max_credits: 20 },
        { skill_id: 'card-b', params: {}, max_credits: 20 },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.results.every((r) => r.status === 'success')).toBe(true);
    expect(settleEscrow).toHaveBeenCalledTimes(2);
  });

  // ── Credit accounting ────────────────────────────────────────────────────────

  it('correctly aggregates total_credits_spent and total_credits_refunded', async () => {
    vi.mocked(resolveTargetCapability)
      .mockResolvedValueOnce(makeResolvedTarget('card-a', { cost: 7 }))
      .mockResolvedValueOnce(makeResolvedTarget('card-b', { cost: 13 }));

    vi.mocked(getCard)
      .mockReturnValueOnce(makeCard('card-a', 7) as ReturnType<typeof getCard>)
      .mockReturnValueOnce(makeCard('card-b', 13) as ReturnType<typeof getCard>);

    vi.mocked(holdEscrow)
      .mockReturnValueOnce('escrow-a')
      .mockReturnValueOnce('escrow-b');

    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [
        { skill_id: 'card-a', params: {}, max_credits: 20 },
        { skill_id: 'card-b', params: {}, max_credits: 20 },
      ],
    });

    expect(result.total_credits_spent).toBe(7 + 13);
    expect(result.total_credits_refunded).toBe(0);
  });

  it('fails item when max_credits is less than skill cost', async () => {
    vi.mocked(resolveTargetCapability).mockResolvedValueOnce(
      makeResolvedTarget('card-1', { cost: 50 }),
    );
    vi.mocked(getCard).mockReturnValue(makeCard('card-1', 50) as ReturnType<typeof getCard>);

    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [
        { skill_id: 'card-1', params: {}, max_credits: 10 }, // card costs 50, max is 10
      ],
    });

    expect(result.success).toBe(false);
    expect(result.results[0]!.status).toBe('failed');
    expect(result.results[0]!.error).toMatch(/max_credits/i);
    expect(holdEscrow).not.toHaveBeenCalled();
  });

  it('fails item when requester has insufficient credits', async () => {
    vi.mocked(resolveTargetCapability).mockResolvedValueOnce(
      makeResolvedTarget('card-1', { cost: 50 }),
    );
    vi.mocked(getCard).mockReturnValue(makeCard('card-1', 50) as ReturnType<typeof getCard>);
    vi.mocked(getBalance).mockReturnValue(10); // only 10 credits available

    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [
        { skill_id: 'card-1', params: {}, max_credits: 100 },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.results[0]!.status).toBe('failed');
    expect(result.results[0]!.error).toMatch(/insufficient credits/i);
    expect(holdEscrow).not.toHaveBeenCalled();
  });

  // ── V2 card (skills array) ───────────────────────────────────────────────────

  it('handles v2 cards with skills array correctly', async () => {
    vi.mocked(resolveTargetCapability).mockResolvedValueOnce(
      makeResolvedTarget('card-v2', { cost: 8 }),
    );
    vi.mocked(getCard).mockReturnValue(makeV2Card('card-v2', 'skill-x', 8) as ReturnType<typeof getCard>);
    vi.mocked(holdEscrow).mockReturnValue('escrow-v2');

    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [
        { skill_id: 'card-v2', params: { data: 'hello' }, max_credits: 20 },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.results[0]!.status).toBe('success');
    expect(result.results[0]!.credits_spent).toBe(8);
    expect(holdEscrow).toHaveBeenCalledWith(fakeDb, 'requester-agent', 8, 'card-v2');
  });

  it('treats request.skill_id as a skill inside a resolved card (not as card_id)', async () => {
    vi.mocked(resolveTargetCapability).mockResolvedValueOnce({
      cardId: 'card-provider',
      skillId: 'skill-stock',
      owner: 'owner-card-provider',
      gateway_url: 'http://peer.local',
      via_relay: false,
      credits_per_call: 11,
      source: 'local',
    });
    vi.mocked(getCard).mockReturnValue(makeV2Card('card-provider', 'skill-stock', 11) as ReturnType<typeof getCard>);
    vi.mocked(holdEscrow).mockReturnValue('escrow-skill');

    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [{ skill_id: 'skill-stock', params: { ticker: 'AAPL' }, max_credits: 20 }],
    });

    expect(result.success).toBe(true);
    expect(holdEscrow).toHaveBeenCalledWith(fakeDb, 'requester-agent', 11, 'card-provider');
  });

  it('routes relay-resolved batch items through dispatchRequest', async () => {
    vi.mocked(resolveTargetCapability).mockResolvedValueOnce(
      makeResolvedTarget('relay-card', {
        cost: 6,
        owner: 'relay-owner',
        viaRelay: true,
        gatewayUrl: '',
      }),
    );
    vi.mocked(getCard).mockReturnValue(makeCard('relay-card', 6) as ReturnType<typeof getCard>);
    vi.mocked(holdEscrow).mockReturnValue('escrow-relay');

    const dispatchRequest = vi.fn().mockResolvedValue({ ok: true, path: 'relay' });
    const result = await executeCapabilityBatch({
      ...baseOptions,
      requests: [{ skill_id: 'relay-card', params: { q: 'stock' }, max_credits: 10 }],
      dispatchRequest,
    });

    expect(result.success).toBe(true);
    expect(dispatchRequest).toHaveBeenCalledTimes(1);
    expect(dispatchRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ cardId: 'relay-card', via_relay: true, owner: 'relay-owner' }),
      }),
    );
    expect(result.results[0]?.result).toEqual({ ok: true, path: 'relay' });
  });
});
