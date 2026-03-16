/**
 * useActivity — Data fetching hook for the public activity feed.
 *
 * Polls GET /api/activity every 10 seconds. On subsequent polls, only fetches
 * entries newer than the last-seen timestamp and prepends them to the list
 * without resetting scroll position.
 *
 * Follows the isFirstFetch pattern from useAgents.ts:
 * - loading is only set to false on the first fetch
 * - existing data is kept on subsequent fetch errors (graceful degradation)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ActivityEvent } from '../types.js';

const POLL_INTERVAL_MS = 10_000;

interface ActivityFeedItem {
  id: string;
  card_name: string;
  requester: string;
  provider: string | null;
  status: 'success' | 'failure' | 'timeout';
  credits_charged: number;
  latency_ms: number;
  created_at: string;
  action_type: string | null;
}

interface ActivityResponse {
  items: ActivityFeedItem[];
  total: number;
  limit: number;
}

interface UseActivityResult {
  items: ActivityEvent[];
  loading: boolean;
  error: string | null;
}

/**
 * Maps raw API item to ActivityEvent, deriving event type client-side.
 * auto_share → capability_shared, all others → exchange_completed.
 */
function toActivityEvent(item: ActivityFeedItem): ActivityEvent {
  return {
    id: item.id,
    type: item.action_type === 'auto_share' ? 'capability_shared' : 'exchange_completed',
    card_name: item.card_name,
    requester: item.requester,
    provider: item.provider,
    status: item.status,
    credits_charged: item.credits_charged,
    latency_ms: item.latency_ms,
    created_at: item.created_at,
  };
}

/**
 * Fetches the public activity feed from GET /api/activity and polls every 10s.
 *
 * On the first fetch: replaces the full list (limit=50).
 * On subsequent polls: prepends only new entries (since=lastSeenAt, limit=20).
 * This preserves scroll position for the user.
 *
 * Returns { items: ActivityEvent[], loading: boolean, error: string | null }.
 */
export function useActivity(): UseActivityResult {
  const [items, setItems] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFirstFetch = useRef(true);
  const lastSeenAt = useRef<string | null>(null);

  const fetchActivity = useCallback(async () => {
    try {
      let url: string;
      if (isFirstFetch.current) {
        url = '/api/activity?limit=50';
      } else {
        const params = new URLSearchParams({ limit: '20' });
        if (lastSeenAt.current !== null) {
          params.set('since', lastSeenAt.current);
        }
        url = `/api/activity?${params.toString()}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as ActivityResponse;
      const newEvents = data.items.map(toActivityEvent);

      if (isFirstFetch.current) {
        setItems(newEvents);
      } else {
        // Prepend only new events — preserves scroll position
        setItems((prev) => [...newEvents, ...prev]);
      }

      // Update lastSeenAt to the newest item's created_at
      if (data.items.length > 0) {
        // Items are already ordered by created_at DESC — first item is newest
        lastSeenAt.current = data.items[0].created_at;
      }

      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load activity: ${msg}`);
      // Keep existing items on error (graceful degradation)
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    isFirstFetch.current = true;
    lastSeenAt.current = null;
    setLoading(true);
    void fetchActivity();
  }, [fetchActivity]);

  // Poll every 10s
  useEffect(() => {
    const id = setInterval(() => void fetchActivity(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchActivity]);

  return { items, loading, error };
}
