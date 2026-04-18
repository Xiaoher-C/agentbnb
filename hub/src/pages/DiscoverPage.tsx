/**
 * DiscoverPage — Hub Discover route at /.
 *
 * Structure (top → bottom):
 *   Hero → HowItWorks → Trust chip + tabs + filters + cards → ProviderValue → Compatible → FAQ → ValueProp
 */
import { useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import { Shield } from 'lucide-react';
import Avatar from 'boring-avatars';
import { useCards } from '../hooks/useCards.js';
import type { AppOutletContext, HubCard } from '../types.js';
import CapabilityCard from '../components/CapabilityCard.js';
import CardGrid from '../components/CardGrid.js';
import EmptyState from '../components/EmptyState.js';
import ErrorState, { InlineErrorBanner } from '../components/ErrorState.js';
import SearchFilter from '../components/SearchFilter.js';
import SkeletonCard from '../components/SkeletonCard.js';
import HeroSection from '../components/HeroSection.js';
import HowItWorksSection from '../components/HowItWorksSection.js';
import ProviderValueSection from '../components/ProviderValueSection.js';
import { CompatibleWithSection } from '../components/CompatibleWithSection.js';
import { FAQSection } from '../components/FAQSection.js';
import { ValuePropSection } from '../components/ValuePropSection.js';

const SKELETON_COUNT = 6;
const MATCHING_AGENTS_MAX = 6;
const AGENT_NAME_MAX_LEN = 16;

const AVATAR_COLORS = ['#10B981', '#059669', '#047857', '#065F46', '#064E3B'];

const TIER_CHIP_CONFIG = {
  1: { label: 'Active', cls: 'text-blue-400 bg-blue-400/[0.08]' },
  2: { label: 'Trusted', cls: 'text-emerald-400 bg-emerald-400/[0.08]' },
} as const;

function truncateName(name: string): string {
  return name.length > AGENT_NAME_MAX_LEN ? `${name.slice(0, AGENT_NAME_MAX_LEN - 1)}…` : name;
}

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
  const navigate = useNavigate();

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

  // Derive matching agents from the current skill tiles — same signal as the grid,
  // deduped by owner, preserving rank order. Only shown when searching on the Skills tab.
  const showMatchingAgents = query.trim().length > 0 && activeTab === 'skills';
  const matchingAgents = useMemo<HubCard[]>(() => {
    if (!showMatchingAgents) return [];
    const seen = new Set<string>();
    const result: HubCard[] = [];
    for (const card of cards) {
      if (seen.has(card.owner)) continue;
      seen.add(card.owner);
      result.push(card);
      if (result.length >= MATCHING_AGENTS_MAX) break;
    }
    return result;
  }, [cards, showMatchingAgents]);

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

        {/* Agents-matching strip — capability search routes to agent browsing */}
        {showMatchingAgents && matchingAgents.length > 0 && (
          <div className="mb-6">
            <p className="text-[11px] text-hub-text-muted uppercase tracking-wider mb-2">
              Agents with this capability ({matchingAgents.length})
            </p>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {matchingAgents.map((agent) => {
                const tier = agent.performance_tier;
                const tierChip = tier === 1 || tier === 2 ? TIER_CHIP_CONFIG[tier] : null;
                return (
                  <button
                    key={agent.owner}
                    onClick={() => void navigate(`/agents/${agent.owner}`)}
                    className="flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 hover:bg-white/[0.08] transition-colors flex-shrink-0"
                  >
                    <Avatar size={28} name={agent.owner} variant="marble" colors={AVATAR_COLORS} />
                    <span className="text-sm text-hub-text-primary">{truncateName(agent.name)}</span>
                    {tierChip ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${tierChip.cls}`}>
                        {tierChip.label}
                      </span>
                    ) : (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          agent.availability.online ? 'bg-hub-accent' : 'bg-hub-text-tertiary'
                        }`}
                        aria-label={agent.availability.online ? 'Online' : 'Offline'}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Section label + inline By Agent / By Skill toggle */}
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 sm:gap-3 mb-3">
          <p className="text-[11px] text-hub-text-muted uppercase tracking-wider">
            {(() => {
              if (loading) return 'Loading…';
              if (error && cards.length === 0) return 'Registry temporarily unavailable';
              if (cards.length === 0) return query ? `No results for "${query}"` : 'No agents yet';
              return `${query ? `Results for "${query}"` : activeTab === 'agents' ? 'All agents' : 'All skills'} · ${filteredTotal}`;
            })()}
          </p>
          <div className="flex items-center gap-3 text-[11px] self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveTab('agents')}
              className={`transition-colors ${
                activeTab === 'agents'
                  ? 'text-hub-text-primary font-medium'
                  : 'text-hub-text-muted hover:text-hub-text-secondary'
              }`}
            >
              By Agent
            </button>
            <span className="text-hub-text-muted" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveTab('skills')}
              className={`transition-colors ${
                activeTab === 'skills'
                  ? 'text-hub-text-primary font-medium'
                  : 'text-hub-text-muted hover:text-hub-text-secondary'
              }`}
            >
              By Skill
            </button>
          </div>
        </div>

        {/* Card Grid */}
        {loading ? (
          <CardGrid>
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </CardGrid>
        ) : error && cards.length === 0 ? (
          <ErrorState onRetry={retry} message={error} />
        ) : cards.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Inline banner when we have stale data alongside an error */}
            {error ? <InlineErrorBanner onRetry={retry} message={error} /> : null}
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
