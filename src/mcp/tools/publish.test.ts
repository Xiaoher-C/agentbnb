import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { McpServerContext } from '../server.js';

function createMockContext(): McpServerContext {
  return {
    configDir: '/tmp/agentbnb-mcp-test',
    config: {
      owner: 'test-agent',
      gateway_url: 'http://localhost:7700',
      gateway_port: 7700,
      db_path: ':memory:',
      credit_db_path: ':memory:',
      token: 'test-token',
      registry: 'http://registry.local',
    },
    identity: {
      agent_id: 'agent-id-123',
      owner: 'test-agent',
      public_key: 'ab'.repeat(44),
      created_at: new Date().toISOString(),
    },
  };
}

function makeValidV1Card(overrides: Record<string, unknown> = {}) {
  return {
    spec_version: '1.0' as const,
    id: randomUUID(),
    owner: 'test-agent',
    name: 'Test Card',
    description: 'A test capability',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text' }],
    outputs: [{ name: 'result', type: 'text' }],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    ...overrides,
  };
}

function makeValidV2Card(overrides: Record<string, unknown> = {}) {
  return {
    spec_version: '2.0' as const,
    id: randomUUID(),
    owner: 'test-agent',
    agent_name: 'Test Agent',
    skills: [
      {
        id: 'skill-1',
        name: 'Test Skill',
        description: 'A test skill',
        level: 1,
        inputs: [{ name: 'prompt', type: 'text' }],
        outputs: [{ name: 'result', type: 'text' }],
        pricing: { credits_per_call: 10 },
      },
    ],
    availability: { online: true },
    ...overrides,
  };
}

/**
 * Helper to set up the standard store mock used by most publish tests.
 * Mocking store.js is required because the real module pulls in
 * better-sqlite3 side-effects (FTS5, feedback, evolution tables) that
 * are irrelevant to the publish handler logic.
 */
function mockStore(insertCardImpl: (...args: unknown[]) => void = vi.fn()) {
  vi.doMock('../../registry/store.js', () => ({
    openDatabase: () => ({ close: () => undefined }),
    insertCard: insertCardImpl,
  }));
}

describe('MCP publish tool', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns error for invalid JSON input', async () => {
    mockStore();

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();

    const response = await handlePublish({ card_json: 'not valid json{{{' }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Invalid JSON in card_json');
  });

  it('returns error when card validation fails', async () => {
    mockStore();

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();

    // Valid JSON but missing required fields — AnyCardSchema discriminates on spec_version
    const response = await handlePublish(
      { card_json: JSON.stringify({ spec_version: '1.0', name: 'incomplete' }) },
      ctx,
    );
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Card validation failed');
    expect(parsed.details).toBeDefined();
  });

  it('rejects v1 card with credits_per_call below 1', async () => {
    mockStore();

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();

    const card = makeValidV1Card({ pricing: { credits_per_call: 0 } });
    const response = await handlePublish({ card_json: JSON.stringify(card) }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Minimum price is 1 credit per call');
  });

  it('rejects v2 card when any skill has credits_per_call below 1', async () => {
    mockStore();

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();

    const card = makeValidV2Card({
      skills: [
        {
          id: 'skill-1',
          name: 'Cheap Skill',
          description: 'Too cheap',
          level: 1,
          inputs: [{ name: 'prompt', type: 'text' }],
          outputs: [{ name: 'result', type: 'text' }],
          pricing: { credits_per_call: 0 },
        },
      ],
    });

    const response = await handlePublish({ card_json: JSON.stringify(card) }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Minimum price is 1 credit per call');
  });

  it('publishes a valid v1 card to local registry successfully', async () => {
    const insertCardMock = vi.fn();
    mockStore(insertCardMock);

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    const card = makeValidV1Card();
    const response = await handlePublish({ card_json: JSON.stringify(card) }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.card_id).toBe(card.id);
    expect(parsed.card_name).toBe('Test Card');
    expect(parsed.remote_published).toBe(false);
    expect(insertCardMock).toHaveBeenCalledTimes(1);
  });

  it('publishes a valid v2 card and returns agent_name', async () => {
    const insertCardMock = vi.fn();
    mockStore(insertCardMock);

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    const card = makeValidV2Card();
    const response = await handlePublish({ card_json: JSON.stringify(card) }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.card_id).toBe(card.id);
    expect(parsed.card_name).toBe('Test Agent');
  });

  it('attempts remote publish when registry is configured', async () => {
    mockStore();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();

    const card = makeValidV1Card();
    const response = await handlePublish({ card_json: JSON.stringify(card) }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.remote_published).toBe(true);

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('registry.local/cards');
    expect(opts?.method).toBe('POST');

    const body = JSON.parse(opts?.body as string);
    expect(body.gateway_url).toBe('http://localhost:7700');
  });

  it('sets remote_published false when remote publish fails', async () => {
    mockStore();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();

    const card = makeValidV1Card();
    const response = await handlePublish({ card_json: JSON.stringify(card) }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.remote_published).toBe(false);
  });

  it('sets remote_published false when fetch throws', async () => {
    mockStore();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();

    const card = makeValidV1Card();
    const response = await handlePublish({ card_json: JSON.stringify(card) }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.remote_published).toBe(false);
  });

  it('returns error when insertCard throws', async () => {
    mockStore(() => { throw new Error('DB write failed'); });

    const { handlePublish } = await import('./publish.js');
    const ctx = createMockContext();

    const card = makeValidV1Card();
    const response = await handlePublish({ card_json: JSON.stringify(card) }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('DB write failed');
  });
});
