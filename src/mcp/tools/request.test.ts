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

describe('MCP request auth wiring', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('local card requests pass identity headers alongside bearer token', async () => {
    const requestCapabilityMock = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../../gateway/client.js', () => ({
      requestCapability: requestCapabilityMock,
    }));

    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => ({
        prepare: () => ({
          get: () => ({ data: JSON.stringify({ id: 'card-local', owner: 'test-agent' }) }),
        }),
        close: () => undefined,
      }),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: () => ({
        privateKey: Buffer.from('11'.repeat(48), 'hex'),
        publicKey: Buffer.from('22'.repeat(44), 'hex'),
      }),
    }));

    const { handleRequest } = await import('./request.js');
    const ctx = createMockContext();

    await handleRequest({ card_id: 'card-local', params: { prompt: 'hello' } }, ctx);

    expect(requestCapabilityMock).toHaveBeenCalledTimes(1);
    expect(requestCapabilityMock).toHaveBeenCalledWith(expect.objectContaining({
      gatewayUrl: ctx.config.gateway_url,
      token: ctx.config.token,
      cardId: 'card-local',
      identity: {
        agentId: ctx.identity.agent_id,
        publicKey: ctx.identity.public_key,
        privateKey: expect.any(Buffer),
      },
    }));
  });

  it('remote direct requests pass identity headers without registry escrow', async () => {
    const requestCapabilityMock = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../../gateway/client.js', () => ({
      requestCapability: requestCapabilityMock,
    }));

    vi.doMock('../../registry/store.js', () => ({
      openDatabase: () => ({
        prepare: () => ({
          get: () => undefined,
        }),
        close: () => undefined,
      }),
    }));

    vi.doMock('../../credit/signing.js', () => ({
      loadKeyPair: () => ({
        privateKey: Buffer.from('33'.repeat(48), 'hex'),
        publicKey: Buffer.from('44'.repeat(44), 'hex'),
      }),
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'card-remote',
        owner: 'remote-owner',
        gateway_url: 'http://remote.example:7700',
      }),
    }));

    const { handleRequest } = await import('./request.js');
    const ctx = createMockContext();

    await handleRequest({ card_id: 'card-remote', params: { prompt: 'hello' } }, ctx);

    // No registry escrow — matches CLI behavior (useRegistryLedger = false)
    expect(requestCapabilityMock).toHaveBeenCalledTimes(1);
    expect(requestCapabilityMock).toHaveBeenCalledWith(expect.objectContaining({
      gatewayUrl: 'http://remote.example:7700',
      token: '',
      cardId: 'card-remote',
      identity: {
        agentId: ctx.identity.agent_id,
        publicKey: ctx.identity.public_key,
        privateKey: expect.any(Buffer),
      },
    }));
  });
});

