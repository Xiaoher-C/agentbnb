/**
 * Regression tests for serve-skill.ts onRequest handler.
 *
 * Verifies that the relay's IncomingRequestMessage fields (card_id, skill_id,
 * params, requester) are read from the top-level message — NOT from inside
 * req.params — and correctly forwarded to executeCapabilityRequest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockExecuteCapabilityRequest = vi.fn();

vi.mock('../../gateway/execute.js', () => ({
  executeCapabilityRequest: (...args: unknown[]) => mockExecuteCapabilityRequest(...args),
}));

vi.mock('../../registry/store.js', () => ({
  openDatabase: vi.fn(() => ({ close: vi.fn() })),
  listCards: vi.fn(() => [
    {
      id: 'card-provider',
      owner: 'provider-owner',
      name: 'Provider Card',
      skills: [
        { id: 'skill-alpha', name: 'Alpha', pricing: { credits_per_call: 5 } },
        { id: 'skill-beta', name: 'Beta', pricing: { credits_per_call: 10 } },
      ],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
    },
  ]),
}));

vi.mock('../../credit/ledger.js', () => ({
  openCreditDb: vi.fn(() => ({ close: vi.fn() })),
}));

// ── Import after mocking ─────────────────────────────────────────────────────

import { handleServeSkill } from './serve-skill.js';
import type { McpServerContext } from '../server.js';
import type { RelayClient } from '../../relay/websocket-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Capture the onRequest handler from RelayClient constructor */
let capturedOnRequest: ((req: Record<string, unknown>) => Promise<unknown>) | undefined;

vi.mock('../../relay/websocket-client.js', () => ({
  RelayClient: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    capturedOnRequest = opts.onRequest as typeof capturedOnRequest;
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };
  }),
}));

function makeCtx(): McpServerContext {
  return {
    configDir: '/tmp/test-agentbnb',
    config: {
      owner: 'provider-owner',
      gateway_url: 'http://localhost:7700',
      gateway_port: 7700,
      db_path: '/tmp/test-registry.db',
      credit_db_path: '/tmp/test-credit.db',
      token: 'test-token',
      registry: 'https://test-registry.example.com',
    },
    identity: {
      agent_id: 'test-agent-id',
      owner: 'provider-owner',
      public_key: 'test-pubkey',
      created_at: '2026-01-01T00:00:00Z',
      did: 'did:agentbnb:test-agent-id',
    },
  };
}

/** Simulate an IncomingRequestMessage as the relay would send it */
function makeIncomingRequest(overrides: Record<string, unknown> = {}) {
  return {
    type: 'incoming_request',
    id: '00000000-0000-0000-0000-000000000001',
    from_owner: 'requester-owner',
    card_id: 'card-provider',
    skill_id: 'skill-beta',
    params: { ticker: 'AAPL', depth: 'deep' },
    requester: 'agent-requester-123',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('serve-skill onRequest field routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnRequest = undefined;
    mockExecuteCapabilityRequest.mockResolvedValue({
      success: true,
      result: { data: 'test-result' },
    });
  });

  async function setupAndGetHandler() {
    const ctx = makeCtx();
    await handleServeSkill({}, ctx);
    expect(capturedOnRequest).toBeDefined();
    return capturedOnRequest!;
  }

  it('reads card_id from top-level, not from params', async () => {
    const handler = await setupAndGetHandler();
    await handler(makeIncomingRequest());

    const callArgs = mockExecuteCapabilityRequest.mock.calls[0]![0];
    expect(callArgs.cardId).toBe('card-provider');
  });

  it('reads skill_id from top-level, not from params', async () => {
    const handler = await setupAndGetHandler();
    await handler(makeIncomingRequest({ skill_id: 'skill-beta' }));

    const callArgs = mockExecuteCapabilityRequest.mock.calls[0]![0];
    expect(callArgs.skillId).toBe('skill-beta');
  });

  it('does not fallback to skills[0] when skill_id is explicitly provided', async () => {
    const handler = await setupAndGetHandler();
    await handler(makeIncomingRequest({ skill_id: 'skill-beta' }));

    const callArgs = mockExecuteCapabilityRequest.mock.calls[0]![0];
    // Must be 'skill-beta', NOT 'skill-alpha' (the first skill)
    expect(callArgs.skillId).toBe('skill-beta');
    expect(callArgs.skillId).not.toBe('skill-alpha');
  });

  it('passes params directly from top-level message', async () => {
    const handler = await setupAndGetHandler();
    await handler(makeIncomingRequest({ params: { ticker: 'META', style: 'deep' } }));

    const callArgs = mockExecuteCapabilityRequest.mock.calls[0]![0];
    expect(callArgs.params).toEqual({ ticker: 'META', style: 'deep' });
  });

  it('reads requester from top-level, falls back to from_owner', async () => {
    const handler = await setupAndGetHandler();
    await handler(makeIncomingRequest({ requester: 'agent-explicit' }));

    const callArgs = mockExecuteCapabilityRequest.mock.calls[0]![0];
    expect(callArgs.requester).toBe('agent-explicit');
  });

  it('falls back to from_owner when requester is missing', async () => {
    const handler = await setupAndGetHandler();
    await handler(makeIncomingRequest({ requester: undefined }));

    const callArgs = mockExecuteCapabilityRequest.mock.calls[0]![0];
    expect(callArgs.requester).toBe('requester-owner');
  });

  it('sets relayAuthorized to true (relay already held escrow)', async () => {
    const handler = await setupAndGetHandler();
    await handler(makeIncomingRequest());

    const callArgs = mockExecuteCapabilityRequest.mock.calls[0]![0];
    expect(callArgs.relayAuthorized).toBe(true);
  });

  it('falls back to card.id when card_id is missing from message', async () => {
    const handler = await setupAndGetHandler();
    await handler(makeIncomingRequest({ card_id: undefined }));

    const callArgs = mockExecuteCapabilityRequest.mock.calls[0]![0];
    // Should fall back to the provider card's id
    expect(callArgs.cardId).toBe('card-provider');
  });
});
