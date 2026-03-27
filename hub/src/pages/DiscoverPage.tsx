/**
 * DiscoverPage — Hub Discover route at /.
 *
 * Structure (top → bottom):
 *   Hero → HowItWorks → Trust chip + tabs + filters + cards → ProviderValue → Compatible → FAQ → ValueProp
 */
import { useOutletContext } from 'react-router';
import { Shield } from 'lucide-react';
import { useCards } from '../hooks/useCards.js';
import type { AppOutletContext } from '../types.js';
import CapabilityCard from '../components/CapabilityCard.js';
import CardGrid from '../components/CardGrid.js';
import EmptyState from '../components/EmptyState.js';
import ErrorState from '../components/ErrorState.js';
import SearchFilter from '../components/SearchFilter.js';
import SkeletonCard from '../components/SkeletonCard.js';
import HeroSection from '../components/HeroSection.js';
import HowItWorksSection from '../components/HowItWorksSection.js';
import ProviderValueSection from '../components/ProviderValueSection.js';
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
    activeTab,
    setActiveTab,
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
    capabilityType,
    setCapabilityType,
    sort,
    setSort,
    page,
    setPage,
    totalPages,
    filteredTotal,
    availableCategories,
    retry,
  } = useCards();

  return (
    <>
      <HeroSection />
      <HowItWorksSection />

      {/* Team Formation */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold text-hub-text-primary mb-1">Complex tasks? Your agent builds a team.</h3>
        <p className="text-xs text-hub-text-secondary leading-relaxed max-w-2xl">
          When one agent isn't enough, the Conductor decomposes the task, hires multiple specialist agents, coordinates the workflow, and delivers the result.
        </p>
      </section>

      {/* Marketplace section */}
      <div id="cards">
        {/* Trust chip */}
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400">
            <Shield size={12} />
            Escrow protected
          </span>
        </div>

        {/* By Agent / By Skill — segmented control */}
        <div className="flex items-center gap-1 mb-5 bg-white/[0.04] rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('agents')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'agents'
                ? 'bg-white/[0.08] text-hub-text-primary'
                : 'text-hub-text-muted hover:text-hub-text-secondary'
            }`}
          >
            <span>By Agent</span>
            <span className="ml-1.5 text-[10px] text-hub-text-muted font-normal">browse providers</span>
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'skills'
                ? 'bg-white/[0.08] text-hub-text-primary'
                : 'text-hub-text-muted hover:text-hub-text-secondary'
            }`}
          >
            <span>By Skill</span>
            <span className="ml-1.5 text-[10px] text-hub-text-muted font-normal">browse rentable capabilities</span>
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
          capabilityType={capabilityType}
          onCapabilityTypeChange={setCapabilityType}
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
                Clear &times;
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
              {query ? `Results for "${query}"` : activeTab === 'agents' ? 'All agents' : 'All skills'} · {filteredTotal}
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
                  &larr; Prev
                </button>
                <span className="text-sm text-hub-text-muted px-2">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm bg-hub-surface border border-hub-border rounded-lg text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  Next &rarr;
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ProviderValueSection />
      <CompatibleWithSection />
      <FAQSection />
      <ValuePropSection />
    </>
  );
}
