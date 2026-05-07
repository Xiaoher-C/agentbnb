/**
 * useMaturityEvidence tests.
 * Covers happy path, graceful 404, network/5xx errors, null agentId skip,
 * and re-fetch on agentId change.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useMaturityEvidence } from './useMaturityEvidence.js';

const happyPayload = {
  agent_id: 'did:agentbnb:abc',
  evidence: {
    platform_observed_sessions: 12,
    completed_tasks: 47,
    repeat_renters: 3,
    artifact_examples: [
      { share_token: 'tok_aaaaaaaa', ended_at: 1_700_000_000_000, summary: 'completed' },
    ],
    verified_tools: ['serpapi', 'sec-filings'],
    response_reliability: 0.94,
    renter_rating_avg: 4.8,
    renter_rating_count: 32,
  },
  evidence_categories: [
    { key: 'platform_observed_sessions', value: 12, kind: 'count' as const },
    { key: 'response_reliability', value: 0.94, kind: 'rate' as const },
  ],
};

describe('useMaturityEvidence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not fetch when agentId is null', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMaturityEvidence(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.evidence).toBeNull();
    expect(result.current.categories).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when agentId is empty string', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMaturityEvidence(''));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.evidence).toBeNull();
  });

  it('fetches and surfaces evidence + categories on the happy path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => happyPayload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMaturityEvidence('did:agentbnb:abc'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/did%3Aagentbnb%3Aabc/maturity-evidence',
    );
    expect(result.current.evidence).toEqual(happyPayload.evidence);
    expect(result.current.categories).toEqual(happyPayload.evidence_categories);
    expect(result.current.error).toBeNull();
  });

  it('treats 404 as a graceful empty state (no error, evidence null)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Agent not found' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMaturityEvidence('did:agentbnb:fresh'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.evidence).toBeNull();
    expect(result.current.categories).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces 500 as an error message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMaturityEvidence('did:agentbnb:abc'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/Server returned 500/);
    expect(result.current.evidence).toBeNull();
  });

  it('surfaces network failures as an error message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMaturityEvidence('did:agentbnb:abc'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/network down/);
    expect(result.current.evidence).toBeNull();
  });

  it('re-fetches when agentId changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => happyPayload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useMaturityEvidence(id),
      { initialProps: { id: 'did:agentbnb:abc' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ id: 'did:agentbnb:xyz' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/agents/did%3Aagentbnb%3Axyz/maturity-evidence',
    );
  });

  it('refetch() re-runs the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => happyPayload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMaturityEvidence('did:agentbnb:abc'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
