import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const relayConnectMock = vi.fn();
const relayDisconnectMock = vi.fn();
const relayRequestMock = vi.fn();

vi.mock('../relay/websocket-client.js', () => ({
  RelayClient: vi.fn().mockImplementation(() => ({
    connect: relayConnectMock,
    disconnect: relayDisconnectMock,
    request: relayRequestMock,
  })),
}));

vi.mock('./client.js', () => ({
  requestViaRelay: vi.fn(),
}));

import { requestViaRelay } from './client.js';
import { requestViaTemporaryRelay } from './relay-dispatch.js';
import { RelayClient } from '../relay/websocket-client.js';

describe('requestViaTemporaryRelay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(RelayClient).mockImplementation(() => ({
      connect: relayConnectMock,
      disconnect: relayDisconnectMock,
      request: relayRequestMock,
    }) as unknown as InstanceType<typeof RelayClient>);
    relayConnectMock.mockResolvedValue(undefined);
    relayDisconnectMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: connects, calls requestViaRelay, returns result, disconnects', async () => {
    vi.mocked(requestViaRelay).mockResolvedValue({ summary: 'ok' });

    const result = await requestViaTemporaryRelay({
      registryUrl: 'http://registry.example.com',
      owner: 'alice',
      token: 'test-token',
      targetOwner: 'bob',
      cardId: 'card-123',
      skillId: 'skill-abc',
      params: { prompt: 'hello' },
    });

    expect(result).toEqual({ summary: 'ok' });
    expect(RelayClient).toHaveBeenCalledWith(
      expect.objectContaining({
        registryUrl: 'http://registry.example.com',
        owner: expect.stringContaining('alice:req:'),
        token: 'test-token',
        silent: true,
      }),
    );
    expect(requestViaRelay).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetOwner: 'bob',
        cardId: 'card-123',
        skillId: 'skill-abc',
        params: { prompt: 'hello' },
        requester: 'alice',
      }),
    );

    const relayCall = vi.mocked(requestViaRelay).mock.calls[0]![1];
    expect(relayCall).not.toHaveProperty('escrowReceipt');
    expect(relayConnectMock).toHaveBeenCalledTimes(1);
    expect(relayDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it('connection failure throws RELAY_UNAVAILABLE and disconnects', async () => {
    relayConnectMock.mockRejectedValue(new Error('WebSocket closed before registration'));

    await expect(
      requestViaTemporaryRelay({
        registryUrl: 'http://registry.example.com',
        owner: 'alice',
        token: 'test-token',
        targetOwner: 'bob',
        cardId: 'card-123',
        params: {},
      }),
    ).rejects.toThrow('Relay connection failed');

    expect(relayDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it('always disconnects even when requestViaRelay throws', async () => {
    vi.mocked(requestViaRelay).mockRejectedValue(new Error('Relay request timeout'));

    await expect(
      requestViaTemporaryRelay({
        registryUrl: 'http://registry.example.com',
        owner: 'alice',
        token: 'test-token',
        targetOwner: 'bob',
        cardId: 'card-123',
        params: {},
      }),
    ).rejects.toThrow('Relay request timeout');

    expect(relayDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it('passes timeoutMs to requestViaRelay', async () => {
    vi.mocked(requestViaRelay).mockResolvedValue({ ok: true });

    await requestViaTemporaryRelay({
      registryUrl: 'http://registry.example.com',
      owner: 'alice',
      token: 'test-token',
      targetOwner: 'bob',
      cardId: 'card-123',
      params: {},
      timeoutMs: 60_000,
    });

    expect(requestViaRelay).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
  });

  it('forwards targetAgentId and requester owner to relay requests', async () => {
    vi.mocked(requestViaRelay).mockResolvedValue({ ok: true });

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
    expect(requestViaRelay).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetOwner: 'legacy-owner-alias',
        targetAgentId: 'target-agent-id',
        requester: 'requester-owner',
        timeoutMs: 12_345,
      }),
    );
    expect(relayConnectMock).toHaveBeenCalledTimes(1);
    expect(relayDisconnectMock).toHaveBeenCalledTimes(1);
  });
});
