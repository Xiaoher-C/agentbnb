/**
 * DiscoverPage — v10 Agent Maturity Rental discovery surface.
 *
 * Pivot (ADR-022 / ADR-023): the primary tile is now a rentable agent, not a
 * capability skill. Skill search is preserved as a secondary entry but no
 * longer the headline.
 *
 * Structure (top → bottom):
 *   Hero (rental copy)
 *   Filter row (search, runtime, price, rating)
 *   Agent grid → AgentProfileCard
 *   Skills entry (collapsed quick-link to By-Skill view)
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Shield, Search } from 'lucide-react';
import { useCards } from '../hooks/useCards.js';
import { useRentableAgents, type RentableAgent } from '../hooks/useRentableAgents.js';
import AgentProfileCard from '../components/AgentProfileCard.js';
import RentSessionModal from '../components/RentSessionModal.js';
import CardGrid from '../components/CardGrid.js';
import EmptyState from '../components/EmptyState.js';
import ErrorState, { InlineErrorBanner } from '../components/ErrorState.js';
import SkeletonCard from '../components/SkeletonCard.js';

const SKELETON_COUNT = 6;

type RuntimeFilter = 'all' | 'hermes' | 'openclaw';

interface FilterState {
  query: string;
  runtime: RuntimeFilter;
  minRating: number; // 0..5
  maxPricePerMin: number; // upper bound, 0 = no limit
}

const INITIAL_FILTERS: FilterState = {
  query: '',
  runtime: 'all',
  minRating: 0,
  maxPricePerMin: 0,
};

const RUNTIME_OPTIONS: ReadonlyArray<{ value: RuntimeFilter; label: string }> = [
  { value: 'all', label: 'All runtimes' },
  { value: 'hermes', label: 'Hermes' },
  { value: 'openclaw', label: 'OpenClaw' },
];

const RATING_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Any rating' },
  { value: 3, label: '3.0+' },
  { value: 4, label: '4.0+' },
  { value: 4.5, label: '4.5+' },
];

const PRICE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Any price' },
  { value: 1, label: '≤ cr 1/min' },
  { value: 5, label: '≤ cr 5/min' },
  { value: 20, label: '≤ cr 20/min' },
];

const inputCls =
  'bg-transparent border border-hub-border rounded-lg px-3 h-9 text-sm text-hub-text-secondary focus:outline-none focus:border-hub-border-hover focus:ring-1 focus:ring-hub-border-hover transition-colors';
const selectCls = `${inputCls} appearance-none cursor-pointer pr-8`;

/** Apply the in-memory filter set to the agent list. */
function filterAgents(agents: RentableAgent[], filters: FilterState): RentableAgent[] {
  const q = filters.query.trim().toLowerCase();
  return agents.filter((agent) => {
    if (q) {
      const haystack = [agent.name, agent.tagline, agent.owner_did, ...agent.tags]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filters.runtime !== 'all' && agent.runtime !== filters.runtime) {
      return false;
    }
    if (filters.minRating > 0) {
      if (agent.evidence.renter_rating === null) return false;
      if (agent.evidence.renter_rating < filters.minRating) return false;
    }
    if (filters.maxPricePerMin > 0) {
      const perMin = agent.pricing.per_minute;
      if (perMin === undefined) return false;
      if (perMin > filters.maxPricePerMin) return false;
    }
    return true;
  });
}

export default function DiscoverPage(): JSX.Element {
  const navigate = useNavigate();
  const { cards, retry } = useCards();
  const { agents, loading, error, refetch } = useRentableAgents(cards);

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [rentTarget, setRentTarget] = useState<RentableAgent | null>(null);

  const filtered = useMemo(() => filterAgents(agents, filters), [agents, filters]);

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]): void => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleRetry = (): void => {
    retry();
    void refetch();
  };

  return (
    <>
      {/* Hero — agent-rental positioning */}
      <section className="relative mb-8 py-12 sm:py-14 px-6 sm:px-10 rounded-2xl bg-gradient-to-br from-hub-surface via-hub-bg to-hub-surface border border-hub-border overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-[28rem] h-[28rem] rounded-full opacity-60 blur-3xl"
          style={{
            background:
              'radial-gradient(closest-side, rgba(16, 185, 129, 0.18), transparent 70%)',
          }}
        />
        <div className="relative max-w-2xl">
          <p className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-300 mb-4">
            <Shield size={11} />
            Privacy-first rental · Escrow protected
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-hub-text-primary leading-[1.1] tracking-tight mb-3">
            Rent matured AI agents for short collaborative sessions.
          </h1>
          <p className="text-base sm:text-lg text-hub-text-secondary leading-relaxed max-w-xl mb-2">
            租一個別人調校了半年的 AI 員工 60 分鐘 — 工具在他們本機跑，結果你拿走，
            不污染他們的長期記憶。
          </p>
        </div>
      </section>

      {/* Filter row */}
      <section
        aria-label="Filters"
        className="mb-6 flex flex-wrap items-center gap-2"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search
            size={14}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-hub-text-muted"
          />
          <input
            type="search"
            placeholder="Search agents by name, tagline, or tag…"
            value={filters.query}
            onChange={(e) => updateFilter('query', e.target.value)}
            className={`${inputCls} w-full pl-9`}
          />
        </div>

        <select
          aria-label="Filter by runtime"
          value={filters.runtime}
          onChange={(e) => updateFilter('runtime', e.target.value as RuntimeFilter)}
          className={selectCls}
        >
          {RUNTIME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-hub-surface">
              {opt.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by rating"
          value={filters.minRating}
          onChange={(e) => updateFilter('minRating', Number(e.target.value))}
          className={selectCls}
        >
          {RATING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-hub-surface">
              {opt.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by price"
          value={filters.maxPricePerMin}
          onChange={(e) => updateFilter('maxPricePerMin', Number(e.target.value))}
          className={selectCls}
        >
          {PRICE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-hub-surface">
              {opt.label}
            </option>
          ))}
        </select>
      </section>

      {/* Agent grid */}
      <div id="cards">
        <p className="text-[11px] text-hub-text-muted uppercase tracking-wider mb-3">
          {(() => {
            if (loading) return 'Loading rentable agents…';
            if (error && agents.length === 0) return 'Registry temporarily unavailable';
            if (filtered.length === 0) {
              return filters.query
                ? `No agents match "${filters.query}"`
                : 'No rentable agents yet';
            }
            return `${filtered.length} ${filtered.length === 1 ? 'agent' : 'agents'} ready to rent`;
          })()}
        </p>

        {loading ? (
          <CardGrid>
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </CardGrid>
        ) : error && agents.length === 0 ? (
          <ErrorState onRetry={handleRetry} message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {error ? <InlineErrorBanner onRetry={handleRetry} message={error} /> : null}
            <CardGrid>
              {filtered.map((agent) => (
                <AgentProfileCard
                  key={agent.agent_id}
                  agent={agent}
                  onRent={(a) => setRentTarget(a)}
                  onView={(a) => void navigate(`/agents/${encodeURIComponent(a.owner_did)}`)}
                />
              ))}
            </CardGrid>
          </>
        )}
      </div>

      {/* Browse-by-skill secondary entry */}
      <section className="mt-12 px-5 py-5 rounded-2xl border border-hub-border bg-white/[0.02]">
        <h2 className="text-sm font-semibold text-hub-text-primary mb-1">
          Browse by skill
        </h2>
        <p className="text-xs text-hub-text-secondary leading-relaxed mb-3">
          Looking for a specific capability instead of a long-term collaborator?
          The legacy capability index is still available.
        </p>
        <a
          href="#/agents"
          className="inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 transition-colors"
        >
          Open skill catalogue →
        </a>
      </section>

      <RentSessionModal
        agent={rentTarget}
        renterBalance={null}
        onClose={() => setRentTarget(null)}
      />
    </>
  );
}
