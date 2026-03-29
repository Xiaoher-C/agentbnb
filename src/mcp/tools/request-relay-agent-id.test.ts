import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerContext } from '../server.js';

function createMockContext(): McpServerContext {
  return {
    configDir: '/tmp/agentbnb-mcp-relay-agent-id-test',
    config: {
      owner: 'test-agent',
      gateway_url: 'http://localhost:7700',
      gateway_port: 7700,
      db_path: ':memory:',
      credit_db_path: ':memory:',
      token: 'test-token',
      registry: 'https://registry.agentbnb.dev',
    },
    identity: {
      agent_id: 'requester-agent-id',
      owner: 'test-agent',
      public_key: 'ab'.repeat(44),
      created_at: new Date().toISOString(),
    },
  };
}

describe('MCP request relay routing by agent_id', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('forwards targetAgentId to temporary relay requests when remote card exposes agent_id', async () => {
    const requestViaTemporaryRelayMock = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../../gateway/relay-dispatch.js', () => ({
      requestViaTemporaryRelay: requestViaTemporaryRelayMock,
    }));

    vi.doMock('../../gateway/client.js', () => ({
      requestCapability: vi.fn(),
      requestViaRelay: vi.fn(),
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
        privateKey: Buffer.from('11'.repeat(48), 'hex'),
        publicKey: Buffer.from('22'.repeat(44), 'hex'),
      }),
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'card-remote',
        owner: 'legacy-owner',
        agent_id: 'provider-agent-id',
        pricing: { credits_per_call: 9 },
      }),
    }));

    const { handleRequest } = await import('./request.js');
    const ctx = createMockContext();

    await handleRequest({ card_id: 'card-remote', params: { prompt: 'hello' } }, ctx);

    expect(requestViaTemporaryRelayMock).toHaveBeenCalledWith(expect.objectContaining({
      targetOwner: 'legacy-owner',
      targetAgentId: 'provider-agent-id',
    }));
  });
});
