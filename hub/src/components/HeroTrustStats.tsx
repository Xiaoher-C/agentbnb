/**
 * HeroTrustStats — Compact live-trust band rendered inside the hero.
 *
 * Fetches `/api/stats` once on mount and shows three pulse-dotted chips:
 *   - agents online  (agents_online)
 *   - executions this week (executions_7d, falls back to total_capabilities
 *     labelled as "skills available" so the slot is never empty)
 *   - verified providers (verified_providers_count)
 *
 * Reserves chip heights with skeletons before data arrives (no layout shift).
 * On fetch failure the component hides silently — the hero must never show
 * a "stats failed" message.
 */
import { useEffect, useState } from 'react';

interface StatsPayload {
  agents_online: number;
  total_capabilities: number;
  total_exchanges: number;
  executions_7d?: number;
  verified_providers_count?: number;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ready'; stats: StatsPayload }
  | { status: 'error' };

interface TrustChip {
  value: number;
  label: string;
}

function buildChips(stats: StatsPayload): TrustChip[] {
  const execs = stats.executions_7d ?? 0;
  const middle: TrustChip =
    execs > 0
      ? { value: execs, label: 'executions this week' }
      : { value: stats.total_capabilities, label: 'skills available' };

  return [
    { value: stats.agents_online, label: 'agents online' },
    middle,
    { value: stats.verified_providers_count ?? 0, label: 'verified providers' },
  ];
}

function formatCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return value.toString();
}

export default function HeroTrustStats(): JSX.Element | null {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function loadStats(): Promise<void> {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) {
          if (!cancelled) setState({ status: 'error' });
          return;
        }
        const data = (await res.json()) as StatsPayload;
        if (!cancelled) setState({ status: 'ready', stats: data });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    }

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, []);

  // Silent hide on error — do not put a failure message inside the hero.
  if (state.status === 'error') return null;

  const chips =
    state.status === 'ready'
      ? buildChips(state.stats)
      : ([null, null, null] as const);

  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2"
      aria-label="Network trust signals"
    >
      {chips.map((chip, i) => (
        <div
          key={i}
          className="inline-flex items-center gap-2 text-sm text-hub-text-secondary"
        >
          <span
            className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400"
            aria-hidden="true"
          >
            <span className="absolute inset-0 rounded-full bg-emerald-400/60 motion-safe:animate-ping" />
          </span>
          {chip ? (
            <span>
              <span
                className="font-mono font-semibold text-hub-text-primary tabular-nums"
                data-testid="hero-trust-value"
              >
                {formatCount(chip.value)}
              </span>
              <span className="ml-1.5 text-hub-text-tertiary">{chip.label}</span>
            </span>
          ) : (
            <span
              className="inline-block h-4 w-28 rounded bg-white/[0.06]"
              data-testid="hero-trust-skeleton"
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}
