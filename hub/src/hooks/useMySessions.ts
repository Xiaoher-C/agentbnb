/**
 * useMySessions — v10 inbox hook for "My Sessions" / "My Outcomes".
 *
 * Fetches `GET /api/sessions/list` scoped to the authed identity. The backend
 * privacy contract (ADR-024) ensures only sessions the caller participated in
 * are returned — this hook does NOT do client-side filtering for privacy, only
 * for UI state (role + status tabs).
 *
 * Usage:
 *   const { sessions, loading, error, refetch, loadMore, hasMore } =
 *     useMySessions({ status: 'active', role: 'either' });
 *
 * The hook resets and refetches whenever its filter args change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authedFetch } from '../lib/authHeaders.js';

/** Backend status set — matches `RentalSessionRow['status']` in `session-routes.ts`. */
export type SessionStatus = 'open' | 'active' | 'paused' | 'closing' | 'settled' | 'closed';

/** Filter passed by the UI; maps 1:1 to `?role=` query string. */
export type RoleFilter = 'renter' | 'owner' | 'either';

/** Filter passed by the UI; maps 1:1 to `?status=` query string. */
export type StatusFilter = 'active' | 'ended' | 'all';

/** Row shape returned by `GET /api/sessions/list`. Mirrors `SessionListRow` server-side. */
export interface MySessionRow {
  id: string;
  status: SessionStatus;
  agent_id: string;
  owner_did: string;
  renter_did: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_min: number;
  has_outcome: boolean;
  share_token: string | null;
  /** One-line summary built server-side; null for active sessions. */
  summary: string | null;
}

interface ListResponse {
  sessions: MySessionRow[];
  next_cursor: string | null;
}

export interface UseMySessionsArgs {
  /** Filter by side (default 'either' — show all sessions the caller is on). */
  role?: RoleFilter;
  /** Filter by lifecycle bucket (default 'all'). */
  status?: StatusFilter;
  /** Page size (default 20, max 100). */
  limit?: number;
  /**
   * When `false`, the hook performs no fetching and returns an empty result.
   * Use this to gate the call until the user is authenticated.
   */
  enabled?: boolean;
}

export interface UseMySessionsResult {
  sessions: MySessionRow[];
  loading: boolean;
  error: string | null;
  /** Reset and refetch from the first page. */
  refetch: () => Promise<void>;
  /** Append the next page to `sessions`. No-op when `hasMore` is false. */
  loadMore: () => Promise<void>;
  /** True when there is at least one more page to fetch. */
  hasMore: boolean;
}

/**
 * Build the query string for `/api/sessions/list`. Pure helper — exported so
 * callers (and tests) can audit exactly what the hook will send.
 */
export function buildListQuery(args: {
  role?: RoleFilter;
  status?: StatusFilter;
  limit?: number;
  cursor?: string | null;
}): string {
  const params = new URLSearchParams();
  if (args.role && args.role !== 'either') params.set('role', args.role);
  if (args.status && args.status !== 'all') params.set('status', args.status);
  if (args.limit) params.set('limit', String(args.limit));
  if (args.cursor) params.set('cursor', args.cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Fetch the authed identity's session inbox. Cursor-paginated.
 *
 * The hook is deliberately minimal — no polling, no optimistic mutations. The
 * inbox is a slow-moving surface and the user can pull-to-refresh via
 * `refetch()`.
 */
export function useMySessions(args: UseMySessionsArgs = {}): UseMySessionsResult {
  const { role = 'either', status = 'all', limit = 20, enabled = true } = args;

  const [sessions, setSessions] = useState<MySessionRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  // Cancellation guard — avoids stale state writes when filters change rapidly.
  const requestSeqRef = useRef(0);

  const fetchPage = useCallback(
    async (nextCursor: string | null, append: boolean): Promise<void> => {
      if (!enabled) {
        setLoading(false);
        return;
      }

      const seq = ++requestSeqRef.current;
      if (!append) {
        setLoading(true);
        setError(null);
      }

      try {
        const qs = buildListQuery({ role, status, limit, cursor: nextCursor });
        const res = await authedFetch(`/api/sessions/list${qs}`);

        if (seq !== requestSeqRef.current) return; // stale

        if (res.status === 401) {
          setError('Sign in to see your sessions.');
          setSessions([]);
          setHasMore(false);
          setCursor(null);
          return;
        }
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }

        const data = (await res.json()) as ListResponse;
        if (seq !== requestSeqRef.current) return; // stale

        setSessions(prev => (append ? [...prev, ...data.sessions] : data.sessions));
        setCursor(data.next_cursor);
        setHasMore(data.next_cursor !== null);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(`Failed to load sessions: ${msg}`);
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [role, status, limit, enabled],
  );

  // Refetch from page 1 whenever the filter args change.
  useEffect(() => {
    void fetchPage(null, false);
  }, [fetchPage]);

  const refetch = useCallback(async () => {
    await fetchPage(null, false);
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor) return;
    await fetchPage(cursor, true);
  }, [fetchPage, hasMore, cursor]);

  return { sessions, loading, error, refetch, loadMore, hasMore };
}

/**
 * useMyOutcomes — convenience wrapper that hard-pins `status='ended'`.
 *
 * The Outcomes page is a filtered view of the sessions inbox. We expose it as
 * a separate hook so the page contract stays small and the filter is colocated
 * with the UI that depends on it.
 */
export function useMyOutcomes(args: Omit<UseMySessionsArgs, 'status'> = {}): UseMySessionsResult {
  return useMySessions({ ...args, status: 'ended' });
}
