import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('MCP discover tool', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns local-only results when no registry is configured', async () => {
    const fakeCards = [
      {
        id: 'card-1',
        name: 'Test Card',
        owner: 'test-agent',
        description: 'A test card',
        level: 1,
        pricing: { credits_per_call: 5 },
        source: 'local' as const,
        availability: { online: true },
      },
    ];

    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => ({
        close: () => undefined,
      }),
    }));

    vi.doMock('../../registry/matcher.js', () => ({
      searchCards: () => fakeCards,
    }));

    vi.doMock('../../cli/remote-registry.js', () => ({
      fetchRemoteCards: vi.fn(),
      mergeResults: (local: unknown[]) => local,
    }));

    const { handleDiscover } = await import('./discover.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    const response = await handleDiscover({ query: 'test' }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.count).toBe(1);
    expect(parsed.results[0].id).toBe('card-1');
    expect(parsed.results[0].name).toBe('Test Card');
    expect(parsed.results[0].online).toBe(true);
  });

  it('filters results by query via searchCards', async () => {
    const searchCardsMock = vi.fn().mockReturnValue([]);

    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => ({
        close: () => undefined,
      }),
    }));

    vi.doMock('../../registry/matcher.js', () => ({
      searchCards: searchCardsMock,
    }));

    vi.doMock('../../cli/remote-registry.js', () => ({
      fetchRemoteCards: vi.fn(),
      mergeResults: (local: unknown[]) => local,
    }));

    const { handleDiscover } = await import('./discover.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    await handleDiscover({ query: 'audio generation', level: 2, online_only: true }, ctx);

    expect(searchCardsMock).toHaveBeenCalledTimes(1);
    expect(searchCardsMock).toHaveBeenCalledWith(
      expect.anything(),
      'audio generation',
      { level: 2, online: true },
    );
  });

  it('returns empty results when no cards match', async () => {
    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => ({
        close: () => undefined,
      }),
    }));

    vi.doMock('../../registry/matcher.js', () => ({
      searchCards: () => [],
    }));

    vi.doMock('../../cli/remote-registry.js', () => ({
      fetchRemoteCards: vi.fn().mockResolvedValue([]),
      mergeResults: () => [],
    }));

    const { handleDiscover } = await import('./discover.js');
    const ctx = createMockContext();

    const response = await handleDiscover({ query: 'nonexistent' }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.count).toBe(0);
    expect(parsed.results).toEqual([]);
  });

  it('merges local and remote results when registry is configured', async () => {
    const localCards = [
      {
        id: 'card-local',
        name: 'Local',
        owner: 'test-agent',
        description: 'local',
        level: 1,
        pricing: { credits_per_call: 1 },
        source: 'local' as const,
        availability: { online: true },
      },
    ];

    const remoteCards = [
      {
        id: 'card-remote',
        name: 'Remote',
        owner: 'other-agent',
        description: 'remote',
        level: 1,
        pricing: { credits_per_call: 2 },
        source: 'remote' as const,
        availability: { online: true },
      },
    ];

    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => ({
        close: () => undefined,
      }),
    }));

    vi.doMock('../../registry/matcher.js', () => ({
      searchCards: () => localCards,
    }));

    vi.doMock('../../cli/remote-registry.js', () => ({
      fetchRemoteCards: vi.fn().mockResolvedValue(remoteCards),
      mergeResults: () => [...localCards, ...remoteCards],
    }));

    const { handleDiscover } = await import('./discover.js');
    const ctx = createMockContext();

    const response = await handleDiscover({ query: 'test' }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.count).toBe(2);
    expect(parsed.results[0].source).toBe('local');
    expect(parsed.results[1].source).toBe('remote');
  });

  it('continues with local results when remote registry fails', async () => {
    const localCards = [
      {
        id: 'card-1',
        name: 'Local Card',
        owner: 'test-agent',
        description: 'survives remote failure',
        level: 1,
        pricing: { credits_per_call: 1 },
        source: 'local' as const,
        availability: { online: false },
      },
    ];

    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => ({
        close: () => undefined,
      }),
    }));

    vi.doMock('../../registry/matcher.js', () => ({
      searchCards: () => localCards,
    }));

    vi.doMock('../../cli/remote-registry.js', () => ({
      fetchRemoteCards: vi.fn().mockRejectedValue(new Error('Network error')),
      mergeResults: (local: unknown[]) => local,
    }));

    const { handleDiscover } = await import('./discover.js');
    const ctx = createMockContext();

    const response = await handleDiscover({ query: 'test' }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.count).toBe(1);
    expect(parsed.results[0].online).toBe(false);
  });

  it('maps v2 skills into flat skill summaries', async () => {
    const v2Card = {
      id: 'card-v2',
      name: 'V2 Agent',
      owner: 'test-agent',
      description: 'multi-skill agent',
      level: 2,
      pricing: { credits_per_call: 0 },
      source: 'local' as const,
      availability: { online: true },
      skills: [
        {
          id: 'skill-tts',
          name: 'Text to Speech',
          description: 'Converts text to audio',
          pricing: { credits_per_call: 5 },
        },
        {
          id: 'skill-stt',
          name: 'Speech to Text',
          description: 'Converts audio to text',
          pricing: { credits_per_call: 3 },
        },
      ],
    };

    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => ({
        close: () => undefined,
      }),
    }));

    vi.doMock('../../registry/matcher.js', () => ({
      searchCards: () => [v2Card],
    }));

    vi.doMock('../../cli/remote-registry.js', () => ({
      fetchRemoteCards: vi.fn(),
      mergeResults: (local: unknown[]) => local,
    }));

    const { handleDiscover } = await import('./discover.js');
    const ctx = createMockContext();
    ctx.config.registry = undefined as unknown as string;

    const response = await handleDiscover({ query: 'audio' }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.results[0].skills).toHaveLength(2);
    expect(parsed.results[0].skills[0]).toEqual({
      id: 'skill-tts',
      name: 'Text to Speech',
      description: 'Converts text to audio',
      credits_per_call: 5,
    });
  });

  it('returns error JSON when openDatabase throws', async () => {
    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => { throw new Error('DB open failed'); },
    }));

    vi.doMock('../../registry/matcher.js', () => ({
      searchCards: vi.fn(),
    }));

    vi.doMock('../../cli/remote-registry.js', () => ({
      fetchRemoteCards: vi.fn(),
      mergeResults: vi.fn(),
    }));

    const { handleDiscover } = await import('./discover.js');
    const ctx = createMockContext();

    const response = await handleDiscover({ query: 'test' }, ctx);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('DB open failed');
  });
});
