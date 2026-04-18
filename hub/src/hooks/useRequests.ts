/**
 * useRequests — Polling hook for auth-protected /requests endpoint.
 *
 * Mirrors the useCards() 30s polling pattern. Supports period filtering
 * via the `since` parameter. When apiKey is null, no fetch is performed
 * and an empty result is returned immediately.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { authedFetch } from '../lib/authHeaders.js';

const POLL_INTERVAL_MS = 30_000;

export type SincePeriod = '24h' | '7d' | '30d';

export interface RequestLogEntry {
  id: string;
  card_id: string;
  card_name: string;
  requester: string;
  status: 'success' | 'failure' | 'timeout';
  latency_ms: number;
  credits_charged: number;
  created_at: string;
  /**
   * Specific skill invoked on the card. Null for v1.0 cards.
   */
  skill_id?: string | null;
  /**
   * Team UUID if this execution was part of a team pipeline. Null for solo executions.
   */
  team_id?: string | null;
  /**
   * Role hint of the team member that handled this subtask.
   * One of: 'researcher' | 'executor' | 'validator' | 'coordinator'.
   * Null for solo executions.
   * @deprecated Use capability_type instead (Phase 52 refactor).
   */
  role?: string | null;
  /**
   * Capability type fulfilled by the team member that handled this subtask.
   * Equals the subtask's required_capability (e.g. 'text_gen', 'tts').
   * Null for solo executions.
   */
  capability_type?: string | null;
}

export interface UseRequestsResult {
  requests: RequestLogEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches /requests with a Bearer token. Polls every 30s.
 *
 * @param apiKey - Owner API key; pass null to disable fetching.
 * @param since  - Optional period filter: '24h', '7d', or '30d'.
 */
export function useRequests(
  apiKey: string | null,
  since?: SincePeriod,
): UseRequestsResult {
  const [requests, setRequests] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(apiKey !== null);
  const [error, setError] = useState<string | null>(null);
  const isFirstFetch = useRef(true);

  const fetchRequests = useCallback(async () => {
    if (apiKey === null) return;

    try {
      const params = new URLSearchParams({ limit: '10' });
      if (since) params.set('since', since);

      const isDid = apiKey === '__did__';
      const res = isDid
        ? await authedFetch(`/requests?${params.toString()}`)
        : await fetch(`/requests?${params.toString()}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });

      if (res.status === 401) {
        setError('Invalid API key');
        return;
      }

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json() as { items: RequestLogEntry[]; limit: number };
      setRequests(data.items);
      setError(null);
    } catch (err) {
      if (error !== 'Invalid API key') {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(`Requests unreachable: ${msg}`);
      }
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, [apiKey, since]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (apiKey === null) {
      setLoading(false);
      setRequests([]);
      setError(null);
      return;
    }

    isFirstFetch.current = true;
    setLoading(true);
    void fetchRequests();

    const interval = setInterval(() => {
      void fetchRequests();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchRequests, apiKey]);

  return { requests, loading, error };
}
