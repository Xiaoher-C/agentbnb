import { useState, useEffect, useRef, useCallback } from 'react';

export interface ProviderEvent {
  id: string;
  event_type: string;
  skill_id: string | null;
  session_id: string | null;
  requester: string | null;
  credits: number;
  duration_ms: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Polls GET /me/events every 5s. Prepends new events on subsequent polls.
 */
export function useProviderEvents(apiKey: string | null) {
  const [events, setEvents] = useState<ProviderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const lastSeenRef = useRef<string | null>(null);
  const isFirstFetch = useRef(true);

  const fetchEvents = useCallback(async () => {
    if (!apiKey) return;
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (lastSeenRef.current) params.set('since', lastSeenRef.current);

      const res = await fetch(`/me/events?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return;

      const data = (await res.json()) as { events: ProviderEvent[] };
      const newEvents = data.events ?? [];

      if (newEvents.length > 0) {
        lastSeenRef.current = newEvents[0]!.created_at;
      }

      if (isFirstFetch.current) {
        setEvents(newEvents);
        isFirstFetch.current = false;
      } else if (newEvents.length > 0) {
        setEvents((prev) => [...newEvents, ...prev].slice(0, 200));
      }
    } catch {
      // Silent — keep existing data
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) {
      setEvents([]);
      setLoading(false);
      return;
    }
    isFirstFetch.current = true;
    lastSeenRef.current = null;
    fetchEvents();
    const interval = setInterval(fetchEvents, 5000);
    return () => clearInterval(interval);
  }, [apiKey, fetchEvents]);

  return { events, loading };
}
