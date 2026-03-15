/**
 * useRequests hook tests.
 * Covers auth-protected /requests fetching with since param support.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRequests } from './useRequests.js';
import type { RequestLogEntry } from './useRequests.js';

const mockEntry: RequestLogEntry = {
  id: 'req-001',
  card_id: 'card-abc',
  card_name: 'Text Summarizer',
  requester: 'bob',
  status: 'success',
  latency_ms: 250,
  credits_charged: 5,
  created_at: '2026-03-15T06:00:00Z',
};

describe('useRequests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches /requests with Authorization header when apiKey provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [mockEntry], limit: 10 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useRequests('test-api-key'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/requests'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      }),
    );
    expect(result.current.requests).toHaveLength(1);
    expect(result.current.requests[0].id).toBe('req-001');
  });

  it('fetches /requests?since=24h when since param provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], limit: 10 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useRequests('test-api-key', '24h'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('since=24h'),
      expect.any(Object),
    );
  });

  it('does not fetch when apiKey is null', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useRequests(null));
    // Allow microtasks to settle
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.requests).toHaveLength(0);
  });

  it('sets error state on 401 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useRequests('bad-key'));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(result.current.error).toBe('Invalid API key');
  });
});
