import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { openDatabase, insertCard } from '../registry/store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { BudgetManager, DEFAULT_BUDGET_CONFIG } from '../credit/budget.js';
import { DEFAULT_AUTONOMY_CONFIG } from '../autonomy/tiers.js';
import type { CapabilityCard } from '../types/index.js';
import { AutoRequestor, minMaxNormalize, scorePeers } from './auto-request.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../gateway/client.js', () => ({
  requestCapability: vi.fn(),
}));

vi.mock('../cli/peers.js', () => ({
  loadPeers: vi.fn(() => []),
  findPeer: vi.fn(() => null),
}));

vi.mock('../cli/remote-registry.js', () => ({
  fetchRemoteCards: vi.fn(),
}));

vi.mock('../gateway/relay-dispatch.js', () => ({
  requestViaTemporaryRelay: vi.fn(),
}));

import { requestCapability } from '../gateway/client.js';
import { requestViaTemporaryRelay } from '../gateway/relay-dispatch.js';
import { findPeer } from '../cli/peers.js';
import { fetchRemoteCards } from '../cli/remote-registry.js';
import { createAgentRecord } from '../identity/agent-identity.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePeerCard(
  overrides: Partial<CapabilityCard> & { owner: string }
): CapabilityCard {
  return {
    id: randomUUID(),
    owner: overrides.owner,
    name: overrides.name ?? 'Test Card',
    description: overrides.description ?? 'A test capability',
    level: overrides.level ?? 1,
    inputs: [],
    outputs: [],
    pricing: overrides.pricing ?? { credits_per_call: 10 },
    availability: overrides.availability ?? { online: true },
    metadata: overrides.metadata ?? { success_rate: 0.9 },
    _internal: overrides._internal,
    spec_version: '1.0',
    ...overrides,
  } as CapabilityCard;
}

function openMemoryRegistryDb(): Database.Database {
  // Pass '' for in-memory; but openDatabase needs a valid path
  // Use `:memory:` indirectly via the store helper
  const db = openDatabase(':memory:');
  return db;
}

function openMemoryCreditDb(): Database.Database {
  const db = openCreditDb(':memory:');
  return db;
}

// ---------------------------------------------------------------------------
// Unit tests: minMaxNormalize
// ---------------------------------------------------------------------------

describe('minMaxNormalize', () => {
  it('normalizes [5, 10, 15] to [0, 0.5, 1]', () => {
    expect(minMaxNormalize([5, 10, 15])).toEqual([0, 0.5, 1]);
  });

  it('single value returns [1]', () => {
    expect(minMaxNormalize([7])).toEqual([1]);
  });

  it('all equal values returns all 1s', () => {
    expect(minMaxNormalize([3, 3, 3])).toEqual([1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: scorePeers
// ---------------------------------------------------------------------------

describe('scorePeers', () => {
  it('filters out self-owned candidates', () => {
    const selfCard = makePeerCard({ owner: 'alice', metadata: { success_rate: 0.9 } });
    const peerCard = makePeerCard({ owner: 'bob', metadata: { success_rate: 0.8 } });

    const scored = scorePeers(
      [
        { card: selfCard, cost: 10, skillId: undefined },
        { card: peerCard, cost: 10, skillId: undefined },
      ],
      'alice'
    );

    expect(scored).toHaveLength(1);
    expect(scored[0].card.owner).toBe('bob');
  });

  it('handles zero-cost card by mapping 1/0 to inverse 1 (not Infinity)', () => {
    const peerCard = makePeerCard({ owner: 'bob', metadata: { success_rate: 0.8 } });

    const scored = scorePeers(
      [{ card: peerCard, cost: 0, skillId: undefined }],
      'alice'
    );

    expect(scored).toHaveLength(1);
    expect(isFinite(scored[0].rawScore)).toBe(true);
    expect(scored[0].rawScore).toBeGreaterThan(0);
  });

  it('missing _internal.idle_rate defaults to 1.0', () => {
    const cardWithIdle = makePeerCard({
      owner: 'bob',
      metadata: { success_rate: 0.8 },
      _internal: { idle_rate: 0.5 },
    });
    const cardWithoutIdle = makePeerCard({
      owner: 'carol',
      metadata: { success_rate: 0.8 },
      // no _internal — defaults to idle_rate 1.0
    });

    const scored = scorePeers(
      [
        { card: cardWithIdle, cost: 10, skillId: undefined },
        { card: cardWithoutIdle, cost: 10, skillId: undefined },
      ],
      'alice'
    );

    expect(scored).toHaveLength(2);
    // carol (idle=1.0) should score higher than bob (idle=0.5)
    expect(scored[0].card.owner).toBe('carol');
  });

  it('returns candidates sorted by descending rawScore', () => {
    const highScore = makePeerCard({
      owner: 'bob',
      metadata: { success_rate: 0.9 },
      _internal: { idle_rate: 0.9 },
    });
    const lowScore = makePeerCard({
      owner: 'carol',
      metadata: { success_rate: 0.3 },
      _internal: { idle_rate: 0.3 },
    });

    const scored = scorePeers(
      [
        { card: lowScore, cost: 10, skillId: undefined },
        { card: highScore, cost: 10, skillId: undefined },
      ],
      'alice'
    );

    expect(scored[0].rawScore).toBeGreaterThanOrEqual(scored[1].rawScore);
    expect(scored[0].card.owner).toBe('bob');
  });

  it('excludes peers with the same canonical agent_id when registryDb is provided', () => {
    const db = openMemoryRegistryDb();
    createAgentRecord(db, {
      agent_id: 'aaaaaaaaaaaaaaaa',
      display_name: 'self-agent',
      public_key: '33'.repeat(32),
      legacy_owner: 'alice',
    });

    const sameAgentDifferentOwner = makePeerCard({
      owner: 'alice-renamed',
      metadata: { success_rate: 0.9 },
      agent_id: 'aaaaaaaaaaaaaaaa',
    });
    const otherPeer = makePeerCard({
      owner: 'bob',
      metadata: { success_rate: 0.8 },
      agent_id: 'bbbbbbbbbbbbbbbb',
    });

    const scored = scorePeers(
      [
        { card: sameAgentDifferentOwner, cost: 10, skillId: undefined },
        { card: otherPeer, cost: 10, skillId: undefined },
      ],
      'alice',
      db,
    );

    expect(scored).toHaveLength(1);
    expect(scored[0]?.card.owner).toBe('bob');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Integration tests: requestWithAutonomy
// ---------------------------------------------------------------------------

describe('AutoRequestor.requestWithAutonomy', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;
  let requestor: AutoRequestor;

  beforeEach(() => {
    vi.clearAllMocks();

    registryDb = openMemoryRegistryDb();
    creditDb = openMemoryCreditDb();

    bootstrapAgent(creditDb, 'alice', 200);

    const budgetManager = new BudgetManager(creditDb, 'alice', DEFAULT_BUDGET_CONFIG);

    requestor = new AutoRequestor({
      owner: 'alice',
      registryDb,
      creditDb,
      autonomyConfig: { tier1_max_credits: 100, tier2_max_credits: 200 }, // Tier 1 for <100
      budgetManager,
    });
  });

  afterEach(() => {
    registryDb.close();
    creditDb.close();
  });

  it('returns { status: "no_peer" } when searchCards returns empty (no matching cards)', async () => {
    // No cards inserted — search will return empty
    const result = await requestor.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('no_peer');
  });

  it('returns { status: "no_peer" } when all candidates are self-owned', async () => {
    const card = makePeerCard({
      owner: 'alice', // same as requestor.owner
      name: 'text-to-speech',
      description: 'TTS capability',
    });
    insertCard(registryDb, card);

    const result = await requestor.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('no_peer');
  });

  it('returns { status: "budget_blocked" } when canSpend returns false', async () => {
    // Use a requestor with very high tier thresholds so budget check is reached
    // Alice has 200 credits, 20 reserve => 180 available. Cost of 185 > 180 available.
    const requestorWithHighTiers = new AutoRequestor({
      owner: 'alice',
      registryDb,
      creditDb,
      autonomyConfig: { tier1_max_credits: 1000, tier2_max_credits: 2000 }, // Tier 1 for amounts < 1000
      budgetManager: new BudgetManager(creditDb, 'alice', DEFAULT_BUDGET_CONFIG),
    });

    const card = makePeerCard({
      owner: 'bob',
      name: 'text-to-speech',
      description: 'TTS capability',
      pricing: { credits_per_call: 185 }, // exceeds available budget (200 - 20 reserve = 180)
    });
    insertCard(registryDb, card);

    // findPeer returns a valid peer config so we don't get no_peer first
    vi.mocked(findPeer).mockReturnValue({
      name: 'bob',
      url: 'http://localhost:7701',
      token: 'token-bob',
      added_at: new Date().toISOString(),
    });

    // maxCostCredits is high enough to not filter the card
    const result = await requestorWithHighTiers.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 500,
    });

    expect(result.status).toBe('budget_blocked');
  });

  it('returns { status: "tier_blocked" } for Tier 3 and writes to pending_requests', async () => {
    const requestorTier3 = new AutoRequestor({
      owner: 'alice',
      registryDb,
      creditDb,
      autonomyConfig: DEFAULT_AUTONOMY_CONFIG, // All actions = Tier 3
      budgetManager: new BudgetManager(creditDb, 'alice', DEFAULT_BUDGET_CONFIG),
    });

    const card = makePeerCard({
      owner: 'bob',
      name: 'text-to-speech',
      description: 'TTS capability',
      pricing: { credits_per_call: 10 },
    });
    insertCard(registryDb, card);

    vi.mocked(findPeer).mockReturnValue({
      name: 'bob',
      url: 'http://localhost:7701',
      token: 'token-bob',
      added_at: new Date().toISOString(),
    });

    const result = await requestorTier3.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('tier_blocked');

    // Check pending_requests table has a row
    const rows = registryDb
      .prepare('SELECT * FROM pending_requests WHERE status = ?')
      .all('pending');
    expect(rows).toHaveLength(1);
  });

  it('returns { status: "success" } when execution succeeds — escrow settled', async () => {
    const card = makePeerCard({
      owner: 'bob',
      name: 'text-to-speech',
      description: 'TTS capability',
      pricing: { credits_per_call: 10 },
    });
    insertCard(registryDb, card);

    vi.mocked(findPeer).mockReturnValue({
      name: 'bob',
      url: 'http://localhost:7701',
      token: 'token-bob',
      added_at: new Date().toISOString(),
    });

    vi.mocked(requestCapability).mockResolvedValue({ audio_url: 'http://example.com/tts.mp3' });

    const result = await requestor.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('success');
    expect(result.creditsSpent).toBe(10);
    expect(result.peer).toBe('bob');
  });

  it('returns { status: "failed" } when execution throws — escrow released', async () => {
    const card = makePeerCard({
      owner: 'bob',
      name: 'text-to-speech',
      description: 'TTS capability',
      pricing: { credits_per_call: 10 },
    });
    insertCard(registryDb, card);

    vi.mocked(findPeer).mockReturnValue({
      name: 'bob',
      url: 'http://localhost:7701',
      token: 'token-bob',
      added_at: new Date().toISOString(),
    });

    vi.mocked(requestCapability).mockRejectedValue(new Error('Network error'));

    const result = await requestor.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('failed');
    // Voucher used for hold (10 <= 50), release refunds to balance: 200 + 10 = 210
    const { getBalance } = await import('../credit/ledger.js');
    const balance = getBalance(creditDb, 'alice');
    expect(balance).toBe(210);
  });

  it('all non-success outcomes write to request_log (failure logging per REQ-06)', async () => {
    // Test the no_peer case (no cards in DB)
    const result = await requestor.requestWithAutonomy({
      query: 'nonexistent-capability',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('no_peer');

    // Check request_log has an audit event
    const rows = registryDb
      .prepare("SELECT * FROM request_log WHERE action_type = 'auto_request_failed'")
      .all();
    expect(rows.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Remote fallback tests
  // -----------------------------------------------------------------------

  it('falls back to remote registry when local returns 0 cards and registryUrl is set', async () => {
    const remoteCard = makePeerCard({
      owner: 'remote-bob',
      name: 'text-to-speech',
      description: 'Remote TTS capability',
      pricing: { credits_per_call: 10 },
    });

    vi.mocked(fetchRemoteCards).mockResolvedValue([remoteCard]);
    vi.mocked(findPeer).mockReturnValue({
      name: 'remote-bob',
      url: 'http://localhost:7701',
      token: 'token-bob',
      added_at: new Date().toISOString(),
    });
    vi.mocked(requestCapability).mockResolvedValue({ audio_url: 'http://example.com/tts.mp3' });

    const requestorWithRemote = new AutoRequestor({
      owner: 'alice',
      registryDb,
      creditDb,
      autonomyConfig: { tier1_max_credits: 100, tier2_max_credits: 200 },
      budgetManager: new BudgetManager(creditDb, 'alice', DEFAULT_BUDGET_CONFIG),
      registryUrl: 'http://registry.example.com',
    });

    const result = await requestorWithRemote.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('success');
    expect(fetchRemoteCards).toHaveBeenCalledWith('http://registry.example.com', { q: 'text-to-speech', online: true });
  });

  it('--query can route to relay-connected providers when no direct gateway peer config exists', async () => {
    const relayOnlyCard = makePeerCard({
      id: randomUUID(),
      owner: 'relay-provider',
      name: 'stock analysis',
      description: 'Analyze stock trends via relay',
      pricing: { credits_per_call: 12 },
    }) as CapabilityCard & { gateway_url?: string };
    relayOnlyCard.gateway_url = '';

    vi.mocked(fetchRemoteCards).mockResolvedValue([relayOnlyCard]);
    vi.mocked(findPeer).mockReturnValue(null);
    vi.mocked(requestViaTemporaryRelay).mockResolvedValue({ summary: 'relay-ok' });

    const requestorWithRemote = new AutoRequestor({
      owner: 'alice',
      registryDb,
      creditDb,
      autonomyConfig: { tier1_max_credits: 100, tier2_max_credits: 200 },
      budgetManager: new BudgetManager(creditDb, 'alice', DEFAULT_BUDGET_CONFIG),
      registryUrl: 'http://registry.example.com',
    });

    const result = await requestorWithRemote.requestWithAutonomy({
      query: 'stock analysis',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('success');
    expect(result.peer).toBe('relay-provider');
    expect(requestViaTemporaryRelay).toHaveBeenCalledWith(
      expect.objectContaining({
        targetOwner: 'relay-provider',
        cardId: relayOnlyCard.id,
        owner: 'alice',
      }),
    );
  });

  it('does NOT call fetchRemoteCards when local returns 1+ cards', async () => {
    const localCard = makePeerCard({
      owner: 'bob',
      name: 'text-to-speech',
      description: 'TTS capability',
      pricing: { credits_per_call: 10 },
    });
    insertCard(registryDb, localCard);

    vi.mocked(findPeer).mockReturnValue({
      name: 'bob',
      url: 'http://localhost:7701',
      token: 'token-bob',
      added_at: new Date().toISOString(),
    });
    vi.mocked(requestCapability).mockResolvedValue({ audio_url: 'http://example.com/tts.mp3' });

    const requestorWithRemote = new AutoRequestor({
      owner: 'alice',
      registryDb,
      creditDb,
      autonomyConfig: { tier1_max_credits: 100, tier2_max_credits: 200 },
      budgetManager: new BudgetManager(creditDb, 'alice', DEFAULT_BUDGET_CONFIG),
      registryUrl: 'http://registry.example.com',
    });

    const result = await requestorWithRemote.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('success');
    expect(fetchRemoteCards).not.toHaveBeenCalled();
  });

  it('returns no_peer when registryUrl is undefined and local returns 0 cards (no remote fallback)', async () => {
    // No registryUrl set, no cards in DB — should behave as before
    const result = await requestor.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('no_peer');
    expect(fetchRemoteCards).not.toHaveBeenCalled();
  });

  it('returns no_peer when registryUrl is set but remote also returns 0 cards', async () => {
    vi.mocked(fetchRemoteCards).mockResolvedValue([]);

    const requestorWithRemote = new AutoRequestor({
      owner: 'alice',
      registryDb,
      creditDb,
      autonomyConfig: { tier1_max_credits: 100, tier2_max_credits: 200 },
      budgetManager: new BudgetManager(creditDb, 'alice', DEFAULT_BUDGET_CONFIG),
      registryUrl: 'http://registry.example.com',
    });

    const result = await requestorWithRemote.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('no_peer');
    expect(fetchRemoteCards).toHaveBeenCalled();
  });

  it('gracefully falls back to no_peer when fetchRemoteCards throws (network error)', async () => {
    vi.mocked(fetchRemoteCards).mockRejectedValue(new Error('Network error'));

    const requestorWithRemote = new AutoRequestor({
      owner: 'alice',
      registryDb,
      creditDb,
      autonomyConfig: { tier1_max_credits: 100, tier2_max_credits: 200 },
      budgetManager: new BudgetManager(creditDb, 'alice', DEFAULT_BUDGET_CONFIG),
      registryUrl: 'http://registry.example.com',
    });

    const result = await requestorWithRemote.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50,
    });

    expect(result.status).toBe('no_peer');
    // Should not crash — graceful degradation
  });

  it('filters candidates exceeding maxCostCredits', async () => {
    const cheapCard = makePeerCard({
      owner: 'bob',
      name: 'text-to-speech',
      description: 'TTS capability',
      pricing: { credits_per_call: 10 },
    });
    const expensiveCard = makePeerCard({
      owner: 'carol',
      name: 'text-to-speech premium',
      description: 'Premium TTS capability',
      pricing: { credits_per_call: 200 },
    });

    insertCard(registryDb, cheapCard);
    insertCard(registryDb, expensiveCard);

    vi.mocked(findPeer).mockImplementation((name: string) => {
      if (name === 'bob') {
        return { name: 'bob', url: 'http://localhost:7701', token: 'token-bob', added_at: new Date().toISOString() };
      }
      return null;
    });

    vi.mocked(requestCapability).mockResolvedValue({ audio_url: 'http://example.com/tts.mp3' });

    const result = await requestor.requestWithAutonomy({
      query: 'text-to-speech',
      maxCostCredits: 50, // Only cheapCard (10 credits) qualifies, expensiveCard (200) excluded
    });

    expect(result.status).toBe('success');
    expect(result.peer).toBe('bob'); // Only bob's cheap card is eligible
  });

  // ── load_factor scoring tests ──────────────────────────────────────────────

  describe('scorePeers with load_factor', () => {
    it('prefers less loaded agent when all else is equal', () => {
      const cardA = makePeerCard({ owner: 'agent-a', metadata: { success_rate: 0.9 } });
      const cardB = makePeerCard({ owner: 'agent-b', metadata: { success_rate: 0.9 } });

      const candidates = [
        { card: cardA, cost: 10, skillId: undefined, loadFactor: 0.2 }, // 80% loaded
        { card: cardB, cost: 10, skillId: undefined, loadFactor: 0.9 }, // 10% loaded
      ];

      const scored = scorePeers(candidates, 'self');
      expect(scored[0]!.card.owner).toBe('agent-b'); // Less loaded wins
    });

    it('load_factor=0 zeroes out the score (fully loaded agent)', () => {
      const cardA = makePeerCard({ owner: 'agent-a', metadata: { success_rate: 0.9 } });
      const cardB = makePeerCard({ owner: 'agent-b', metadata: { success_rate: 0.9 } });
      const cardC = makePeerCard({ owner: 'agent-c', metadata: { success_rate: 0.9 } });

      const candidates = [
        { card: cardA, cost: 10, skillId: undefined, loadFactor: 0.0 }, // At capacity
        { card: cardB, cost: 10, skillId: undefined, loadFactor: 1.0 }, // Idle
        { card: cardC, cost: 10, skillId: undefined, loadFactor: 0.5 }, // Half loaded
      ];

      const scored = scorePeers(candidates, 'self');
      // Agent at capacity should have score=0 (normLoad=0 zeroes the product)
      const agentAScore = scored.find(s => s.card.owner === 'agent-a')!.rawScore;
      expect(agentAScore).toBe(0);
      // Idle agent should rank highest
      expect(scored[0]!.card.owner).toBe('agent-b');
    });

    it('missing loadFactor defaults to 1.0 (fully available)', () => {
      const cardA = makePeerCard({ owner: 'agent-a', metadata: { success_rate: 0.9 } });
      const cardB = makePeerCard({ owner: 'agent-b', metadata: { success_rate: 0.9 } });

      const candidates = [
        { card: cardA, cost: 10, skillId: undefined }, // No loadFactor = 1.0
        { card: cardB, cost: 10, skillId: undefined, loadFactor: 0.5 }, // Half loaded
      ];

      const scored = scorePeers(candidates, 'self');
      // Agent-a should score higher (loadFactor 1.0 > 0.5)
      expect(scored[0]!.card.owner).toBe('agent-a');
    });
  });
});
