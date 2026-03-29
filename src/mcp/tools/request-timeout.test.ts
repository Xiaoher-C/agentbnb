import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerContext } from '../server.js';

function createMockContext(): McpServerContext {
  return {
    configDir: '/tmp/agentbnb-mcp-timeout-test',
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

describe('MCP request timeout override', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('forwards timeout_ms to direct gateway requests', async () => {
    const requestCapabilityMock = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../../gateway/client.js', () => ({
      requestCapability: requestCapabilityMock,
      requestViaRelay: vi.fn(),
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

    await handleRequest({ card_id: 'card-local', timeout_ms: 12_345, params: { prompt: 'hello' } }, ctx);

    expect(requestCapabilityMock).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 12_345,
    }));
  });
});
