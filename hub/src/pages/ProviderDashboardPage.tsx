/**
 * ProviderDashboardPage — Provider observability dashboard.
 *
 * Shows the provider's real-time event stream, aggregated stats,
 * skill performance, and active sessions. Reads from:
 * - GET /me/events (5s polling)
 * - GET /me/stats (15s polling)
 *
 * Requires authentication via AuthGate (wrapped in main.tsx).
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useProviderEvents } from '../hooks/useProviderEvents.js';
import { useProviderStats } from '../hooks/useProviderStats.js';
import type { ProviderEvent } from '../hooks/useProviderEvents.js';
import type { AppOutletContext } from '../types.js';
import AuthGate from '../components/AuthGate.js';
import { Skeleton } from '../components/Skeleton.js';
import { authedFetch } from '../lib/authHeaders.js';

/** Emoji prefix for event types. */
const EVENT_EMOJI: Record<string, string> = {
  'skill.received': '📥',
  'skill.executed': '✅',
  'skill.failed': '❌',
  'skill.rejected': '🚫',
  'session.opened': '🔗',
  'session.message': '💬',
  'session.ended': '🏁',
  'session.failed': '💥',
};

/** Event type display labels. */
const EVENT_LABEL: Record<string, string> = {
  'skill.received': 'Received',
  'skill.executed': 'Executed',
  'skill.failed': 'Failed',
  'skill.rejected': 'Rejected',
  'session.opened': 'Session opened',
  'session.message': 'Session msg',
  'session.ended': 'Session ended',
  'session.failed': 'Session failed',
};

const ALL_EVENT_TYPES = Object.keys(EVENT_EMOJI);

function StatCard({
  label,
  value,
  sub,
  hero,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  hero?: boolean;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const toneClass =
    tone === 'positive' ? 'text-emerald-400'
    : tone === 'negative' ? 'text-rose-400'
    : 'text-hub-text';
  return (
    <div className="rounded-xl border border-hub-border bg-hub-card p-4">
      <div className="text-sm text-hub-text-muted">{label}</div>
      <div className={`mt-1 font-bold ${hero ? 'text-4xl' : 'text-2xl'} ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-hub-text-muted">{sub}</div>}
    </div>
  );
}

function EventRow({ event }: { event: ProviderEvent }) {
  const emoji = EVENT_EMOJI[event.event_type] ?? '📋';
  const label = EVENT_LABEL[event.event_type] ?? event.event_type;
  const time = new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const meta = event.metadata ?? {};

  let detail = event.skill_id ?? '';
  if (event.credits > 0 && event.event_type === 'skill.executed') {
    detail += ` (+${event.credits} cr)`;
  } else if (event.event_type === 'skill.rejected') {
    detail += ` — ${meta['reason'] ?? ''}`;
  } else if (event.event_type === 'session.message') {
    detail = `#${meta['message_count'] ?? '?'} (${meta['running_cost'] ?? 0} cr)`;
  } else if (event.event_type === 'session.ended') {
    detail = `${meta['total_messages'] ?? '?'} msgs, ${event.credits} cr`;
  }

  return (
    <div className="flex items-center gap-3 border-b border-hub-border px-3 py-2 text-sm last:border-b-0">
      <span className="w-16 shrink-0 text-hub-text-muted">{time}</span>
      <span className="w-5 text-center">{emoji}</span>
      <span className="font-medium text-hub-text">{label}</span>
      <span className="truncate text-hub-text-muted">{detail}</span>
      {event.requester && (
        <span className="ml-auto shrink-0 text-xs text-hub-text-muted">
          {event.requester.slice(0, 12)}
        </span>
      )}
    </div>
  );
}

function ProviderDashboardInner({ apiKey }: { apiKey: string }) {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d');
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(ALL_EVENT_TYPES));
  const [balance, setBalance] = useState<number | null>(null);

  const { stats, loading: statsLoading } = useProviderStats(apiKey, period);
  const { events, loading: eventsLoading } = useProviderEvents(apiKey);

  // Fetch balance from /me, poll every 15s
  useEffect(() => {
    let cancelled = false;
    const fetchBalance = async () => {
      try {
        const isDid = apiKey === '__did__';
        const res = isDid
          ? await authedFetch('/me')
          : await fetch('/me', { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!res.ok) return;
        const data = await res.json() as { balance?: number };
        if (!cancelled && typeof data.balance === 'number') setBalance(data.balance);
      } catch { /* silent */ }
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [apiKey]);

  const filteredEvents = events.filter((e) => visibleTypes.has(e.event_type));

  const toggleType = (type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (statsLoading && eventsLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + period selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-hub-text">Provider Dashboard</h1>
        <div className="flex gap-1 rounded-lg border border-hub-border bg-hub-card p-0.5">
          {(['24h', '7d', '30d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-sm transition ${
                period === p
                  ? 'bg-hub-accent text-white'
                  : 'text-hub-text-muted hover:text-hub-text'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Hero: Balance */}
      <StatCard
        label="Current Balance"
        value={balance !== null ? `${balance} cr` : '—'}
        sub={stats.active_sessions > 0 ? `${stats.active_sessions} active session${stats.active_sessions > 1 ? 's' : ''} running` : 'No active sessions'}
        hero
      />

      {/* P&L row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label={`Earned (${period})`}
          value={`+${stats.total_earnings} cr`}
          sub={`${stats.success_count} successful execution${stats.success_count !== 1 ? 's' : ''}`}
          tone="positive"
        />
        <StatCard
          label={`Spent (${period})`}
          value={`-${stats.total_spending} cr`}
          sub="Escrow holds + fees"
          tone="negative"
        />
        <StatCard
          label={`Net P&L (${period})`}
          value={`${stats.net_pnl >= 0 ? '+' : ''}${stats.net_pnl} cr`}
          tone={stats.net_pnl >= 0 ? 'positive' : 'negative'}
        />
        <StatCard
          label="Success Rate"
          value={`${Math.round(stats.success_rate * 100)}%`}
          sub={`${stats.failure_count} failed`}
        />
      </div>

      {/* 7-day earnings chart (or empty state) */}
      {(() => {
        const totalEarnings = stats.earnings_timeline.reduce((sum, d) => sum + d.earnings, 0);
        if (totalEarnings === 0) {
          return (
            <div className="rounded-xl border border-dashed border-hub-border bg-hub-card/30 p-6 text-center">
              <div className="text-sm font-semibold text-hub-text">Earnings — Last 7 Days</div>
              <div className="mt-2 text-xs text-hub-text-muted">
                Start earning to see trends here. Your skills will appear once rented.
              </div>
            </div>
          );
        }
        return (
          <div className="rounded-xl border border-hub-border bg-hub-card p-4">
            <div className="mb-3 text-sm font-semibold text-hub-text">Earnings — Last 7 Days</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.earnings_timeline}>
                  <defs>
                    <linearGradient id="earningsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => d.slice(5)}
                    stroke="#6b7280"
                    fontSize={11}
                  />
                  <YAxis stroke="#6b7280" fontSize={11} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 6 }}
                    labelStyle={{ color: '#9ca3af' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="earnings"
                    stroke="#10b981"
                    fill="url(#earningsGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Skill performance */}
      {stats.top_skills.length > 0 && (
        <div className="rounded-xl border border-hub-border bg-hub-card">
          <div className="border-b border-hub-border px-4 py-3 text-sm font-semibold text-hub-text">
            Skill Performance
          </div>
          <div className="divide-y divide-hub-border">
            {stats.top_skills.map((s) => (
              <div key={s.skill_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-medium text-hub-text">{s.skill_id}</span>
                <div className="flex gap-6 text-hub-text-muted">
                  <span>{s.count} calls</span>
                  <span>{s.earnings} cr</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event filter chips */}
      <div className="flex flex-wrap gap-2">
        {ALL_EVENT_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => toggleType(type)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              visibleTypes.has(type)
                ? 'border-hub-accent bg-hub-accent/10 text-hub-accent'
                : 'border-hub-border text-hub-text-muted'
            }`}
          >
            {EVENT_EMOJI[type]} {type.split('.')[1]}
          </button>
        ))}
      </div>

      {/* Event feed */}
      <div className="rounded-xl border border-hub-border bg-hub-card">
        <div className="border-b border-hub-border px-4 py-3 text-sm font-semibold text-hub-text">
          Recent Events
          <span className="ml-2 text-xs font-normal text-hub-text-muted">
            ({filteredEvents.length} shown, polling every 5s)
          </span>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {filteredEvents.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-hub-text-muted">
              No events yet. Events will appear here when your skills are rented.
            </div>
          ) : (
            filteredEvents.map((e) => <EventRow key={e.id} event={e} />)
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProviderDashboardPage(): JSX.Element {
  const { apiKey, login } = useOutletContext<AppOutletContext>();
  return (
    <AuthGate apiKey={apiKey} onLogin={login}>
      {apiKey && <ProviderDashboardInner apiKey={apiKey} />}
    </AuthGate>
  );
}
