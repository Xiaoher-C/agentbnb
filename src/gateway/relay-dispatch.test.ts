import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('requestViaTemporaryRelay', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards targetAgentId and requester owner to relay requests', async () => {
    const connectMock = vi.fn().mockResolvedValue(undefined);
    const disconnectMock = vi.fn();
    const requestViaRelayMock = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../relay/websocket-client.js', () => ({
      RelayClient: class MockRelayClient {
        connect = connectMock;
        disconnect = disconnectMock;
      },
    }));

    vi.doMock('./client.js', () => ({
      requestViaRelay: requestViaRelayMock,
    }));

    const { requestViaTemporaryRelay } = await import('./relay-dispatch.js');

    const result = await requestViaTemporaryRelay({
      registryUrl: 'https://registry.agentbnb.dev',
      owner: 'requester-owner',
      token: 'registry-token',
      targetOwner: 'legacy-owner-alias',
      targetAgentId: 'target-agent-id',
      cardId: 'card-123',
      skillId: 'skill-xyz',
      params: { prompt: 'hello' },
      timeoutMs: 12_345,
    });

    expect(result).toEqual({ ok: true });
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(requestViaRelayMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      targetOwner: 'legacy-owner-alias',
      targetAgentId: 'target-agent-id',
      requester: 'requester-owner',
      timeoutMs: 12_345,
    }));
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
