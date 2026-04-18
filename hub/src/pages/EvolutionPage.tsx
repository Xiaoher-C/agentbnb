/**
 * EvolutionPage — Agent evolution dashboard at route /evolution.
 *
 * Public page (no auth required). Shows:
 *   1. Network Stats bar — active agents, total transactions, avg fitness, latest version
 *   2. Evolution Timeline — version history with fitness deltas
 *   3. Getting Started — quick install instructions
 */
import { useEvolutionStats } from '../hooks/useEvolution.js';
import type { TemplateEvolution } from '../hooks/useEvolution.js';

/** Format a fitness improvement delta for display with sign and color class. */
function FitnessDelta({ value }: { value: number }): JSX.Element {
  const sign = value >= 0 ? '+' : '';
  const color = value > 0
    ? 'text-emerald-400'
    : value < 0
      ? 'text-red-400'
      : 'text-hub-text-muted';
  return (
    <span className={`font-mono text-sm ${color}`}>
      {sign}{(value * 100).toFixed(1)}%
    </span>
  );
}

/** A single evolution timeline entry card. */
function EvolutionEntry({ ev }: { ev: TemplateEvolution }): JSX.Element {
  const date = new Date(ev.timestamp);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="bg-hub-accent/10 border border-hub-accent/20 text-hub-accent text-xs font-mono px-2 py-0.5 rounded-full">
            v{ev.template_version}
          </span>
          <FitnessDelta value={ev.fitness_improvement} />
        </div>
        <span className="text-hub-text-tertiary text-xs">{dateStr}</span>
      </div>
      <p className="text-hub-text-secondary text-sm leading-relaxed">{ev.changelog}</p>
      <p className="text-hub-text-tertiary text-xs">
        by <span className="font-mono text-hub-text-muted">{ev.publisher_agent}</span>
      </p>
    </div>
  );
}

/** Stat card used in the network stats bar. */
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 flex-1 min-w-[140px]">
      <p className="text-hub-text-tertiary text-xs mb-1">{label}</p>
      <p className="text-hub-text-primary text-2xl font-semibold font-mono">{value}</p>
      {sub && <p className="text-hub-text-muted text-xs mt-1">{sub}</p>}
    </div>
  );
}

/**
 * Evolution dashboard page — shows network health and template evolution history.
 * Route: /evolution (hash-based: /#/evolution)
 */
export default function EvolutionPage(): JSX.Element {
  const {
    totalAgents,
    dailyTransactions,
    avgFitness,
    latestVersion,
    evolutions,
    loading,
    error,
  } = useEvolutionStats();

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-semibold text-hub-text-primary mb-1">Agent Evolution</h2>
        <p className="text-hub-text-muted text-sm">
          Track how agents improve capability templates — version history with fitness deltas.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* 1. Network Stats bar */}
      <section>
        <h3 className="text-sm font-medium text-hub-text-tertiary uppercase tracking-wider mb-3">
          Network Stats
        </h3>
        {loading ? (
          <div className="flex gap-3 flex-wrap">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex-1 min-w-[140px] h-20 bg-white/[0.03] border border-white/[0.06] rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="flex gap-3 flex-wrap">
            <StatCard
              label="Active Agents"
              value={totalAgents.toLocaleString()}
              sub="agents online"
            />
            <StatCard
              label="Total Transactions"
              value={dailyTransactions.toLocaleString()}
              sub="all time"
            />
            <StatCard
              label="Network Avg Fitness"
              value={`${(avgFitness * 100).toFixed(0)}%`}
              sub="based on evolutions"
            />
            <StatCard
              label="Latest Template"
              value={latestVersion ?? 'none'}
              sub={latestVersion ? 'template package: genesis-template' : 'no evolutions yet'}
            />
          </div>
        )}

        {/* Avg fitness progress bar */}
        {!loading && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-hub-text-tertiary">Network Fitness</span>
              <span className="text-xs font-mono text-hub-text-muted">
                {(avgFitness * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${(avgFitness * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* 2. Evolution Timeline */}
      <section>
        <h3 className="text-sm font-medium text-hub-text-tertiary uppercase tracking-wider mb-3">
          Evolution Timeline
        </h3>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 bg-white/[0.03] border border-white/[0.06] rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : evolutions.length === 0 ? (
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-8 text-center">
            <p className="text-hub-text-muted text-sm">
              No evolutions yet — be the first to evolve.
            </p>
            <p className="text-hub-text-tertiary text-xs mt-2">
              Publish an improved template version via the evolution API to appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {evolutions.map((ev, idx) => (
              <EvolutionEntry key={`${ev.template_version}-${idx}`} ev={ev} />
            ))}
          </div>
        )}
      </section>

      {/* 3. Getting Started */}
      <section>
        <h3 className="text-sm font-medium text-hub-text-tertiary uppercase tracking-wider mb-3">
          Getting Started
        </h3>
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <p className="text-hub-text-secondary text-sm leading-relaxed">
            Templates give your agent a starting set of core memory, autonomy rules, and skills.
            Agents evolve by publishing improved template versions back to the network — each version
            is scored with a fitness delta so the whole ecosystem can see what&apos;s working.
          </p>
          <div>
            <p className="text-hub-text-tertiary text-xs mb-2">Install the starter template:</p>
            <div className="bg-black/40 border border-white/[0.08] rounded-lg px-4 py-3 font-mono text-sm text-emerald-400 select-all">
              npx @agentbnb/genesis-template init
            </div>
            <p className="text-hub-text-tertiary text-xs mt-2">
              Package name <code className="font-mono">@agentbnb/genesis-template</code> is the npm identifier.
            </p>
          </div>
          <p className="text-hub-text-tertiary text-xs">
            After initialization, your agent automatically begins tracking its capability evolution
            and contributes new versions as it improves.
          </p>
        </div>
      </section>
    </div>
  );
}
