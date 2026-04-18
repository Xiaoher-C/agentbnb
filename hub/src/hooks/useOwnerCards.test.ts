/**
 * useOwnerCards hook tests.
 * Covers /me + /cards fetching with balance extraction.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useOwnerCards } from './useOwnerCards.js';
import type { HubCard } from '../types.js';

vi.mock('../lib/authHeaders.js', () => ({
  authedFetch: vi.fn(),
}));

const aliceCard: HubCard = {
  id: 'card-001',
  owner: 'alice',
  name: 'Text Summarizer',
  description: 'Summarizes text.',
  level: 1,
  inputs: [],
  outputs: [],
  pricing: { credits_per_call: 5 },
  availability: { online: true },
};

const bobCard: HubCard = {
  ...aliceCard,
  id: 'card-002',
  owner: 'bob',
  name: 'Image Renderer',
};

describe('useOwnerCards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches /me and extracts owner name AND balance', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes('/me')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ owner: 'alice', balance: 250 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ total: 2, limit: 100, offset: 0, items: [aliceCard, bobCard] }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useOwnerCards('alice-api-key'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.ownerName).toBe('alice');
    expect(result.current.balance).toBe(250);
  });

  it('fetches /cards and filters by owner name', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes('/me')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ owner: 'alice', balance: 100 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ total: 2, limit: 100, offset: 0, items: [aliceCard, bobCard] }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useOwnerCards('alice-api-key'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Only alice's card
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].owner).toBe('alice');
  });

  it('returns balance as number from /me response (NOT null)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes('/me')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ owner: 'alice', balance: 0 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ total: 0, limit: 100, offset: 0, items: [] }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useOwnerCards('alice-api-key'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(typeof result.current.balance).toBe('number');
    expect(result.current.balance).toBe(0);
  });

  it('does not fetch when apiKey is null', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useOwnerCards(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.cards).toHaveLength(0);
    expect(result.current.balance).toBeNull();
  });

  it('uses DID auth flow when apiKey is __did__', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 1, limit: 100, offset: 0, items: [aliceCard] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { authedFetch } = await import('../lib/authHeaders.js');
    vi.mocked(authedFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ owner: 'alice', balance: 321 }),
    } as Response);

    const { result } = renderHook(() => useOwnerCards('__did__'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(authedFetch).toHaveBeenCalledWith('/me');
    expect(fetchMock).toHaveBeenCalledWith('/cards?limit=100');
    expect(result.current.ownerName).toBe('alice');
    expect(result.current.balance).toBe(321);
  });
});
