/**
 * EarningsChart — 30-day AreaChart of credits earned per day.
 *
 * Aggregates RequestLogEntry data by day and renders a dark-themed AreaChart
 * using recharts. Fills 30 days including zero-credit days so the chart always
 * shows a full 30-day window.
 *
 * Uses React.memo to prevent re-renders from parent polling.
 */
import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { RequestLogEntry } from '../hooks/useRequests.js';

interface DayBucket {
  date: string; // YYYY-MM-DD
  label: string; // MM-DD
  credits: number;
}

/**
 * Groups request log entries by day, fills zero-credit days, returns 30 buckets.
 * @param requests - Array of request log entries.
 * @returns 30 day buckets sorted oldest first.
 */
export function aggregateByDay(requests: RequestLogEntry[]): DayBucket[] {
  // Build a map of YYYY-MM-DD -> total credits
  const map = new Map<string, number>();

  for (const req of requests) {
    const d = new Date(req.created_at);
    const key = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
    map.set(key, (map.get(key) ?? 0) + req.credits_charged);
  }

  // Fill all 30 days (today is day 29, 29 days ago is day 0)
  const buckets: DayBucket[] = [];
  const now = new Date();

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA');
    const label = key.slice(5); // MM-DD
    buckets.push({ date: key, label, credits: map.get(key) ?? 0 });
  }

  return buckets;
}

/** Custom dark-themed tooltip for recharts. */
function CreditsTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }): JSX.Element | null {
  if (!active || !payload?.length) return null;

  const credits = payload[0]?.value ?? 0;

  return (
    <div
      style={{
        backgroundColor: '#111117',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '6px',
        padding: '8px 12px',
      }}
    >
      <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px', margin: 0 }}>{label}</p>
      <p style={{ color: '#10B981', fontSize: '13px', fontWeight: 600, margin: '2px 0 0' }}>
        cr {credits}
      </p>
    </div>
  );
}

export interface EarningsChartProps {
  /** Array of request log entries for the 30-day window. */
  requests: RequestLogEntry[];
}

/**
 * Renders a 30-day AreaChart with emerald gradient fill and custom dark tooltip.
 */
const EarningsChart = React.memo(function EarningsChart({ requests }: EarningsChartProps): JSX.Element {
  const data = useMemo(() => aggregateByDay(requests), [requests]);

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: -24, bottom: 0 }}>
        <defs>
          <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255,255,255,0.04)"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={6}
        />
        <YAxis
          tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `cr ${v}`}
          width={48}
        />
        <Tooltip content={<CreditsTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)' }} />
        <Area
          type="monotone"
          dataKey="credits"
          stroke="#10B981"
          strokeWidth={1.5}
          fill="url(#emeraldGradient)"
          dot={false}
          activeDot={{ r: 4, fill: '#10B981', strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export default EarningsChart;
