import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { registerSearchSkillsTool } from './search-skills.js';
import type { AdapterConfig } from '../config.js';

/**
 * Capture the tool handler registered by registerSearchSkillsTool.
 * McpServer.tool() is called once; we grab the last argument (the handler).
 */
function captureHandler(config: AdapterConfig) {
  const toolSpy = vi.fn();
  const fakeServer = { tool: toolSpy } as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
  registerSearchSkillsTool(fakeServer, config);
  expect(toolSpy).toHaveBeenCalledOnce();
  // handler is the 4th argument: (name, description, schema, handler)
  const handler = toolSpy.mock.calls[0][3] as (args: Record<string, unknown>) => Promise<unknown>;
  return handler;
}

const BASE_CONFIG: AdapterConfig = {
  registryUrl: 'https://registry.test',
  managedAgentsBetaHeader: 'managed-agents-2026-04-01',
  port: 7702,
  keystorePath: '/tmp/test',
  maxSessionCost: 5,
  serviceAccountOwner: 'test-owner',
};

describe('agentbnb_search_skills', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return correctly shaped results on successful search', async () => {
    // Arrange
    const registryCards = [
      {
        id: 'card-1',
        owner: 'provider-a',
        name: 'Web Scraper',
        description: 'Scrapes web pages',
        level: 1,
        pricing: { credits_per_call: 5 },
        reputation: 0.95,
        skills: [
          { id: 'skill-1a', name: 'Scrape URL', description: 'Fetch and parse a URL', pricing: { credits_per_call: 3 } },
        ],
      },
      {
        id: 'card-2',
        owner: 'provider-b',
        name: 'Translator',
        description: 'Translates text',
        level: 2,
        pricing: { credits_per_call: 10 },
        reputation: 0.88,
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => registryCards,
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ query: 'scrape', max_results: 10 });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.query).toBe('scrape');
    expect(body.total).toBe(2);
    expect(body.results).toHaveLength(2);

    // First card has explicit skills array
    const first = body.results[0];
    expect(first.card_id).toBe('card-1');
    expect(first.layer).toBe('atomic');
    expect(first.provider_reputation).toBe(0.95);
    expect(first.skills).toHaveLength(1);
    expect(first.skills[0].skill_id).toBe('skill-1a');
    expect(first.skills[0].credits_per_call).toBe(3);

    // Second card falls back to card-level pricing
    const second = body.results[1];
    expect(second.card_id).toBe('card-2');
    expect(second.layer).toBe('pipeline');
    expect(second.skills[0].credits_per_call).toBe(10);

    // Verify fetch was called with correct URL
    const fetchCall = (globalThis.fetch as Mock).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain('/cards?');
    expect(url).toContain('q=scrape');
    expect(url).toContain('online=true');
    expect(url).toContain('limit=10');
  });

  it('should pass layer filter as numeric level', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    await handler({ query: 'deploy', layer: 'environment', max_results: 5 });

    // Assert
    const url = (globalThis.fetch as Mock).mock.calls[0][0] as string;
    expect(url).toContain('level=3');
    expect(url).toContain('limit=5');
  });

  it('should return error object when registry returns non-OK status', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ query: 'anything', max_results: 10 });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.error).toContain('Registry returned 503');
    expect(body.query).toBe('anything');
  });

  it('should handle empty results gracefully', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ query: 'nonexistent', max_results: 10 });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.results).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.query).toBe('nonexistent');
  });

  it('should return error when fetch throws (network failure)', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed')) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ query: 'test', max_results: 10 });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.error).toContain('Registry unreachable');
    expect(body.error).toContain('DNS resolution failed');
    expect(body.query).toBe('test');
  });

  it('should strip trailing slash from registry URL', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as Mock;

    const config = { ...BASE_CONFIG, registryUrl: 'https://registry.test/' };
    const handler = captureHandler(config);

    // Act
    await handler({ query: 'test', max_results: 10 });

    // Assert
    const url = (globalThis.fetch as Mock).mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/registry\.test\/cards\?/);
    expect(url).not.toContain('//cards');
  });

  it('should map level 3 to environment layer label', async () => {
    // Arrange
    const cards = [
      { id: 'c-3', owner: 'o', name: 'Env', description: 'Full env', level: 3 },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => cards,
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ query: 'env', max_results: 10 });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.results[0].layer).toBe('environment');
  });
});
