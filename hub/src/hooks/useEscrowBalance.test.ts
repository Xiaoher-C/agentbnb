/**
 * useEscrowBalance — unit tests.
 *
 * Mocks `authedFetch` and `loadSession` so the hook can be exercised in
 * isolation without depending on a live `/me` endpoint or a Hub session.
 *
 * Covers:
 *   - returns null balance when no session is active
 *   - reads `balance` from a successful `/me` payload
 *   - surfaces a user-friendly error on a 5xx response
 *   - surfaces "sign in expired" on 401
 *   - refetches on the BALANCE_CHANGED_EVENT
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadSessionMock = vi.fn();
const authedFetchMock = vi.fn();

vi.mock('../lib/authHeaders.js', () => ({
  loadSession: () => loadSessionMock(),
  authedFetch: (...args: unknown[]) => authedFetchMock(...args),
}));

import { useEscrowBalance, BALANCE_CHANGED_EVENT } from './useEscrowBalance.js';

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  loadSessionMock.mockReset();
  authedFetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useEscrowBalance', () => {
  it('returns null balance immediately when no session exists', async () => {
    loadSessionMock.mockReturnValue(null);

    const { result } = renderHook(() => useEscrowBalance());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.balance).toBeNull();
    expect(result.current.error).toBeNull();
    expect(authedFetchMock).not.toHaveBeenCalled();
  });

  it('reads balance from a successful /me payload', async () => {
    loadSessionMock.mockReturnValue({
      agentId: 'aaaaaaaaaaaaaaaa',
      publicKeyHex: 'pk',
      createdAt: '2026-05-04T00:00:00.000Z',
    });
    authedFetchMock.mockResolvedValue(jsonResponse({ owner: 'alice', balance: 250 }));

    const { result } = renderHook(() => useEscrowBalance());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.balance).toBe(250);
    expect(result.current.currency).toBe('credits');
    expect(result.current.error).toBeNull();
    expect(authedFetchMock).toHaveBeenCalledWith('/me');
  });

  it('surfaces an error message on 5xx', async () => {
    loadSessionMock.mockReturnValue({
      agentId: 'aaaaaaaaaaaaaaaa',
      publicKeyHex: 'pk',
      createdAt: '2026-05-04T00:00:00.000Z',
    });
    authedFetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    const { result } = renderHook(() => useEscrowBalance());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.balance).toBeNull();
    expect(result.current.error).toMatch(/500/);
  });

  it('surfaces a sign-in-expired message on 401', async () => {
    loadSessionMock.mockReturnValue({
      agentId: 'aaaaaaaaaaaaaaaa',
      publicKeyHex: 'pk',
      createdAt: '2026-05-04T00:00:00.000Z',
    });
    authedFetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const { result } = renderHook(() => useEscrowBalance());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toMatch(/sign in/i);
  });

  it('refetches when BALANCE_CHANGED_EVENT fires', async () => {
    loadSessionMock.mockReturnValue({
      agentId: 'aaaaaaaaaaaaaaaa',
      publicKeyHex: 'pk',
      createdAt: '2026-05-04T00:00:00.000Z',
    });
    authedFetchMock
      .mockResolvedValueOnce(jsonResponse({ owner: 'alice', balance: 100 }))
      .mockResolvedValueOnce(jsonResponse({ owner: 'alice', balance: 75 }));

    const { result } = renderHook(() => useEscrowBalance());

    await waitFor(() => {
      expect(result.current.balance).toBe(100);
    });

    act(() => {
      window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(result.current.balance).toBe(75);
    });
    expect(authedFetchMock).toHaveBeenCalledTimes(2);
  });
});
