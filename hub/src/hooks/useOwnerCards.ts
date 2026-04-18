/**
 * useOwnerCards — Fetches owner-specific cards and credit balance.
 *
 * Fetches /me (auth-protected) to get the owner name and credit balance,
 * then fetches /cards (public) and filters client-side by owner name.
 * No polling — cards change infrequently. When apiKey is null, no fetch
 * is performed and an empty result with null balance is returned.
 */
import { useState, useEffect } from 'react';
import type { HubCard, CardsResponse } from '../types.js';
import { authedFetch } from '../lib/authHeaders.js';

export interface UseOwnerCardsResult {
  ownerName: string | null;
  cards: HubCard[];
  /** Credit balance extracted from /me response. null only when not authenticated. */
  balance: number | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the authenticated owner's Capability Cards and credit balance.
 *
 * @param apiKey - Owner API key; pass null to disable fetching.
 */
export function useOwnerCards(apiKey: string | null): UseOwnerCardsResult {
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [cards, setCards] = useState<HubCard[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(apiKey !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (apiKey === null) {
      setLoading(false);
      setOwnerName(null);
      setCards([]);
      setBalance(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        // Fetch /me to get owner identity and credit balance
        const isDid = apiKey === '__did__';
        const meRes = isDid
          ? await authedFetch('/me')
          : await fetch('/me', {
              headers: { Authorization: `Bearer ${apiKey}` },
            });

        if (!meRes.ok) {
          if (meRes.status === 401) {
            setError('Invalid API key');
            return;
          }
          throw new Error(`/me returned ${meRes.status}`);
        }

        const me = await meRes.json() as { owner: string; balance: number };

        if (cancelled) return;

        setOwnerName(me.owner);
        setBalance(me.balance);

        // Fetch all public cards and filter by owner
        const cardsRes = await fetch('/cards?limit=100');
        if (!cardsRes.ok) {
          throw new Error(`/cards returned ${cardsRes.status}`);
        }

        const data = await cardsRes.json() as CardsResponse;
        if (!cancelled) {
          setCards(data.items.filter((c) => c.owner === me.owner));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setError(msg);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  return { ownerName, cards, balance, loading, error };
}
