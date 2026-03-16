/**
 * useTransactions — Polling hook for auth-protected /me/transactions endpoint.
 *
 * Follows the useRequests() polling pattern with a 30-second interval.
 * Transactions change less frequently than the activity feed, so 30s is appropriate.
 * When apiKey is null, no fetch is performed and an empty result is returned immediately.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { CreditTransaction } from '../types.js';

const POLL_INTERVAL_MS = 30_000;

export interface UseTransactionsResult {
  transactions: CreditTransaction[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches /me/transactions with a Bearer token. Polls every 30s.
 *
 * @param apiKey - Owner API key; pass null to disable fetching.
 * @param limit  - Maximum number of transactions to return (default 20).
 */
export function useTransactions(
  apiKey: string | null,
  limit: number = 20,
): UseTransactionsResult {
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(apiKey !== null);
  const [error, setError] = useState<string | null>(null);
  const isFirstFetch = useRef(true);

  const fetchTransactions = useCallback(async () => {
    if (apiKey === null) return;

    try {
      const params = new URLSearchParams({ limit: String(limit) });

      const res = await fetch(`/me/transactions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (res.status === 401) {
        setError('Invalid API key');
        return;
      }

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json() as { items: CreditTransaction[]; limit: number };
      setTransactions(data.items);
      setError(null);
    } catch (err) {
      if (error !== 'Invalid API key') {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(`Transactions unreachable: ${msg}`);
      }
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, [apiKey, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (apiKey === null) {
      setLoading(false);
      setTransactions([]);
      setError(null);
      return;
    }

    isFirstFetch.current = true;
    setLoading(true);
    void fetchTransactions();

    const interval = setInterval(() => {
      void fetchTransactions();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchTransactions, apiKey]);

  return { transactions, loading, error };
}
