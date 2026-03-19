import { describe, it, expect } from 'vitest';
import { convertToGptActions } from './openapi-gpt-actions.js';

/** Minimal OpenAPI spec fixture for testing the converter. */
function makeSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: 'Test API', version: '1.0.0' },
    servers: [{ url: '/' }],
    tags: [
      { name: 'cards', description: 'Card endpoints' },
      { name: 'credits', description: 'Credit endpoints' },
      { name: 'owner', description: 'Owner endpoints' },
      { name: 'system', description: 'System endpoints' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        ed25519Auth: { type: 'apiKey', in: 'header', name: 'X-Agent-PublicKey' },
      },
    },
    paths: {
      '/cards': {
        get: { tags: ['cards'], summary: 'List cards' },
        post: { tags: ['cards'], summary: 'Create card' },
        delete: { tags: ['cards'], summary: 'Delete all cards' },
      },
      '/cards/{id}': {
        get: { tags: ['cards'], summary: 'Get card', operationId: 'getCardById' },
        delete: { tags: ['cards'], summary: 'Delete card' },
        patch: { tags: ['cards'], summary: 'Update card' },
      },
      '/me': {
        get: { tags: ['owner'], summary: 'Get owner', security: [{ bearerAuth: [] }] },
      },
      '/draft': {
        get: { tags: ['owner'], summary: 'Get drafts' },
      },
      '/api/credits/hold': {
        post: { tags: ['credits'], summary: 'Hold credits', security: [{ ed25519Auth: [] }] },
      },
      '/api/credits/{owner}': {
        get: { tags: ['credits'], summary: 'Get balance' },
      },
      '/docs/json': {
        get: { tags: ['system'], summary: 'Swagger JSON' },
      },
      '/health': {
        get: { tags: ['system'], summary: 'Health check' },
      },
      '/api/pricing': {
        get: { tags: ['system'], summary: 'Pricing stats' },
      },
    },
  };
}

describe('convertToGptActions', () => {
  it('sets server URL to the provided value', () => {
    const result = convertToGptActions(makeSpec(), 'https://registry.agentbnb.dev');
    const servers = result.servers as Array<{ url: string }>;
    expect(servers).toHaveLength(1);
    expect(servers[0].url).toBe('https://registry.agentbnb.dev');
  });

  it('filters out owner-only paths (/me, /draft)', () => {
    const result = convertToGptActions(makeSpec(), 'https://example.com');
    const paths = result.paths as Record<string, unknown>;
    expect(paths['/me']).toBeUndefined();
    expect(paths['/draft']).toBeUndefined();
  });

  it('filters out credit paths (/api/credits/*)', () => {
    const result = convertToGptActions(makeSpec(), 'https://example.com');
    const paths = result.paths as Record<string, unknown>;
    expect(paths['/api/credits/hold']).toBeUndefined();
    expect(paths['/api/credits/{owner}']).toBeUndefined();
  });

  it('filters out /docs paths', () => {
    const result = convertToGptActions(makeSpec(), 'https://example.com');
    const paths = result.paths as Record<string, unknown>;
    expect(paths['/docs/json']).toBeUndefined();
  });

  it('removes DELETE and PATCH methods, keeps GET and POST', () => {
    const result = convertToGptActions(makeSpec(), 'https://example.com');
    const paths = result.paths as Record<string, Record<string, unknown>>;

    // /cards should have get and post but not delete
    expect(paths['/cards'].get).toBeDefined();
    expect(paths['/cards'].post).toBeDefined();
    expect(paths['/cards'].delete).toBeUndefined();

    // /cards/{id} should have get but not delete or patch
    expect(paths['/cards/{id}'].get).toBeDefined();
    expect(paths['/cards/{id}'].delete).toBeUndefined();
    expect(paths['/cards/{id}'].patch).toBeUndefined();
  });

  it('adds operationId to operations without one', () => {
    const result = convertToGptActions(makeSpec(), 'https://example.com');
    const paths = result.paths as Record<string, Record<string, Record<string, unknown>>>;

    // /cards GET should get auto-generated operationId
    expect(paths['/cards'].get.operationId).toBe('getCards');
    expect(paths['/cards'].post.operationId).toBe('postCards');

    // /health GET
    expect(paths['/health'].get.operationId).toBe('getHealth');

    // /api/pricing GET
    expect(paths['/api/pricing'].get.operationId).toBe('getApiPricing');
  });

  it('preserves existing operationId if already present', () => {
    const result = convertToGptActions(makeSpec(), 'https://example.com');
    const paths = result.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths['/cards/{id}'].get.operationId).toBe('getCardById');
  });

  it('removes security from individual operations', () => {
    // Add security to a public path operation for testing
    const spec = makeSpec();
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    paths['/cards'].get.security = [{ bearerAuth: [] }];

    const result = convertToGptActions(spec, 'https://example.com');
    const resultPaths = result.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(resultPaths['/cards'].get.security).toBeUndefined();
  });

  it('removes securitySchemes from components', () => {
    const result = convertToGptActions(makeSpec(), 'https://example.com');
    const components = result.components as Record<string, unknown>;
    expect(components.securitySchemes).toBeUndefined();
  });

  it('filters tags to only those still referenced', () => {
    const result = convertToGptActions(makeSpec(), 'https://example.com');
    const tags = result.tags as Array<{ name: string }>;
    const tagNames = tags.map((t) => t.name);

    // 'cards' and 'system' should be kept (referenced by /cards, /health, /api/pricing)
    expect(tagNames).toContain('cards');
    expect(tagNames).toContain('system');

    // 'credits' and 'owner' paths were all removed
    expect(tagNames).not.toContain('credits');
    expect(tagNames).not.toContain('owner');
  });

  it('does not mutate the original spec', () => {
    const original = makeSpec();
    const originalPaths = Object.keys(original.paths as Record<string, unknown>);
    convertToGptActions(original, 'https://example.com');
    const afterPaths = Object.keys(original.paths as Record<string, unknown>);
    expect(afterPaths).toEqual(originalPaths);
  });
});
