import { useState, useEffect, useCallback } from 'react';

export interface ProviderStats {
  total_earnings: number;
  total_spending: number;
  net_pnl: number;
  total_executions: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  active_sessions: number;
  top_skills: Array<{ skill_id: string; count: number; earnings: number }>;
  top_requesters: Array<{ requester: string; count: number }>;
  earnings_timeline: Array<{ date: string; earnings: number }>;
}

const EMPTY_STATS: ProviderStats = {
  total_earnings: 0,
  total_spending: 0,
  net_pnl: 0,
  total_executions: 0,
  success_count: 0,
  failure_count: 0,
  success_rate: 1,
  active_sessions: 0,
  top_skills: [],
  top_requesters: [],
  earnings_timeline: [],
};

/**
 * Polls GET /me/stats every 15s with configurable period.
 */
export function useProviderStats(apiKey: string | null, period: '24h' | '7d' | '30d' = '7d') {
  const [stats, setStats] = useState<ProviderStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!apiKey) return;
    try {
      const res = await fetch(`/me/stats?period=${period}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as ProviderStats;
      setStats(data);
    } catch {
      // Silent — keep existing data
    } finally {
      setLoading(false);
    }
  }, [apiKey, period]);

  useEffect(() => {
    if (!apiKey) {
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, [apiKey, period, fetchStats]);

  return { stats, loading };
}
