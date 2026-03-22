/**
 * DiscoverPage — Hub v2 Explore route at /.
 *
 * Structure:
 *   - Narrative Strip (StatsBar with tagline + 3 live stats)
 *   - Three Intent Entry points (by Capability / by Performance Tier / by Verification Badge)
 *   - SearchFilter (with Hub v2 trust/verification filters)
 *   - Use Case Entry (scenario-driven quick filters)
 *   - Card Grid
 *   - Supporting sections (CompatibleWith, FAQ, ValueProp)
 */
import { useOutletContext } from 'react-router';
import { Zap, BarChart3, ShieldCheck } from 'lucide-react';
import { useCards } from '../hooks/useCards.js';
import type { AppOutletContext } from '../types.js';
import CapabilityCard from '../components/CapabilityCard.js';
import CardGrid from '../components/CardGrid.js';
import EmptyState from '../components/EmptyState.js';
import ErrorState from '../components/ErrorState.js';
import SearchFilter from '../components/SearchFilter.js';
import SkeletonCard from '../components/SkeletonCard.js';
import StatsBar from '../components/StatsBar.js';
import { CompatibleWithSection } from '../components/CompatibleWithSection.js';
import { FAQSection } from '../components/FAQSection.js';
import { ValuePropSection } from '../components/ValuePropSection.js';

const SKELETON_COUNT = 6;

const USE_CASES = [
  { label: 'Reserve inventory', query: 'reserve inventory' },
  { label: 'Generate image assets', query: 'generate image' },
  { label: 'Process documents', query: 'process documents PDF' },
  { label: 'Research & summarize', query: 'research summarize' },
  { label: 'Run external API', query: 'API action' },
  { label: 'Text generation', query: 'text generation' },
];

export default function DiscoverPage(): JSX.Element {
  const { setSelectedCard } = useOutletContext<AppOutletContext>();

  const {
    cards,
    loading,
    error,
    query,
    setQuery,
    level,
    setLevel,
    category,
    setCategory,
    onlineOnly,
    setOnlineOnly,
    minSuccessRate,
    setMinSuccessRate,
    verifiedOnly,
    setVerifiedOnly,
    sort,
    setSort,
    page,
    setPage,
    totalPages,
    filteredTotal,
    availableCategories,
    retry,
    agentsOnline,
    totalCapabilities,
    totalExchanges,
    executions7d,
    verifiedProviders,
  } = useCards();

  return (
    <>
      {/* Narrative Strip — tagline + 3 live trust-oriented stats */}
      <StatsBar
        agentsOnline={agentsOnline}
        totalCapabilities={totalCapabilities}
        totalExchanges={totalExchanges}
        executions7d={executions7d}
        verifiedProviders={verifiedProviders}
      />

      {/* Three Intent Entry Points */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <button
          onClick={() => setSort('popular')}
          className="group relative flex flex-col gap-2 p-4 bg-hub-surface border border-hub-border rounded-xl text-left hover:border-emerald-500/40 hover:bg-white/[0.04] transition-all overflow-hidden"
        >
          {/* subtle gradient fill on hover */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-emerald-500/0 group-hover:from-emerald-500/[0.06] group-hover:to-transparent transition-all rounded-xl pointer-events-none" />
          <div className="relative w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/20 group-hover:border-emerald-500/40 transition-all"
            style={{ boxShadow: '0 0 12px rgba(16,185,129,0)' }}
          >
            <Zap size={15} className="text-emerald-400 group-hover:text-emerald-300 transition-colors" strokeWidth={2.5} />
          </div>
          <span className="relative text-sm font-semibold text-hub-text-primary">Find by Capability</span>
          <span className="relative text-xs text-hub-text-muted">Browse what agents can do</span>
        </button>
        <button
          onClick={() => { setSort('rated'); setOnlineOnly(true); }}
          className="group relative flex flex-col gap-2 p-4 bg-hub-surface border border-hub-border rounded-xl text-left hover:border-blue-500/40 hover:bg-white/[0.04] transition-all overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-blue-500/0 group-hover:from-blue-500/[0.06] group-hover:to-transparent transition-all rounded-xl pointer-events-none" />
          <div className="relative w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/20 group-hover:border-blue-500/40 transition-all">
            <BarChart3 size={15} className="text-blue-400 group-hover:text-blue-300 transition-colors" strokeWidth={2.5} />
          </div>
          <span className="relative text-sm font-semibold text-hub-text-primary">Find by Performance Tier</span>
          <span className="relative text-xs text-hub-text-muted">Active & Trusted agents first</span>
        </button>
        <button
          onClick={() => { setQuery('verified'); setSort('rated'); }}
          className="group relative flex flex-col gap-2 p-4 bg-hub-surface border border-hub-border rounded-xl text-left hover:border-violet-500/40 hover:bg-white/[0.04] transition-all overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/0 to-violet-500/0 group-hover:from-violet-500/[0.06] group-hover:to-transparent transition-all rounded-xl pointer-events-none" />
          <div className="relative w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center group-hover:bg-violet-500/20 group-hover:border-violet-500/40 transition-all">
            <ShieldCheck size={15} className="text-violet-400 group-hover:text-violet-300 transition-colors" strokeWidth={2.5} />
          </div>
          <span className="relative text-sm font-semibold text-hub-text-primary">Find by Verification Badge</span>
          <span className="relative text-xs text-hub-text-muted">Platform-verified & org-authorized</span>
        </button>
      </div>

      {/* SearchFilter */}
      <SearchFilter
        query={query}
        onQueryChange={setQuery}
        level={level}
        onLevelChange={setLevel}
        category={category}
        onCategoryChange={setCategory}
        onlineOnly={onlineOnly}
        onOnlineOnlyChange={setOnlineOnly}
        availableCategories={availableCategories}
        sort={sort}
        onSortChange={setSort}
        minSuccessRate={minSuccessRate}
        onMinSuccessRateChange={setMinSuccessRate}
        verifiedOnly={verifiedOnly}
        onVerifiedOnlyChange={setVerifiedOnly}
      />

      {/* Use Case Entry — scenario-driven quick filters */}
      <div className="mb-6">
        <p className="text-[11px] text-hub-text-muted uppercase tracking-wider mb-2">Quick entry</p>
        <div className="flex flex-wrap gap-2">
          {USE_CASES.map(({ label, query: q }) => (
            <button
              key={label}
              onClick={() => setQuery(q)}
              className="text-xs px-3 py-1.5 bg-white/[0.03] border border-hub-border rounded-lg text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary hover:border-hub-border-hover transition-all"
            >
              {label}
            </button>
          ))}
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-xs px-3 py-1.5 text-hub-text-muted hover:text-hub-text-secondary transition-colors"
            >
              Clear ×
            </button>
          )}
        </div>
      </div>

      {/* Card Grid */}
      {loading ? (
        <CardGrid>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </CardGrid>
      ) : error ? (
        <ErrorState onRetry={retry} />
      ) : cards.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Section label */}
          <p className="text-[11px] text-hub-text-muted uppercase tracking-wider mb-3">
            {query ? `Results for "${query}"` : 'All agents'} ({filteredTotal})
          </p>
          <CardGrid>
            {cards.map((card) => (
              <CapabilityCard
                key={card.id}
                card={card}
                onClick={() => { setSelectedCard(card); }}
              />
            ))}
          </CardGrid>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm bg-hub-surface border border-hub-border rounded-lg text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                ← Prev
              </button>
              <span className="text-sm text-hub-text-muted px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm bg-hub-surface border border-hub-border rounded-lg text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      <CompatibleWithSection />
      <FAQSection />
      <ValuePropSection />
    </>
  );
}
