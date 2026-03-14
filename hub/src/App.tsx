/**
 * AgentBnB Hub — Root App component.
 * Full hub page wiring all components and the data-fetching hook together.
 */
import { useState } from 'react';
import { useCards } from './hooks/useCards.js';
import CapabilityCard from './components/CapabilityCard.js';
import CardGrid from './components/CardGrid.js';
import EmptyState from './components/EmptyState.js';
import ErrorState from './components/ErrorState.js';
import SearchFilter from './components/SearchFilter.js';
import SkeletonCard from './components/SkeletonCard.js';
import StatsBar from './components/StatsBar.js';

const SKELETON_COUNT = 6;

/**
 * Hub page that renders a live, searchable, filterable grid of capability cards.
 */
export default function App() {
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
    availableCategories,
    retry,
    agentsOnline,
    totalCapabilities,
    totalExchanges,
  } = useCards();

  // Track which card.id is currently expanded (null = none)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-slate-100">AgentBnB Hub</h1>
        <p className="text-slate-400 mt-1">Browse available agent capabilities</p>
        <StatsBar
          agentsOnline={agentsOnline}
          totalCapabilities={totalCapabilities}
          totalExchanges={totalExchanges}
        />
      </header>

      <main className="max-w-7xl mx-auto px-4 pb-12">
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
        />

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
          <CardGrid>
            {cards.map((card) => (
              <CapabilityCard
                key={card.id}
                card={card}
                expanded={expandedId === card.id}
                onToggle={() => handleToggle(card.id)}
              />
            ))}
          </CardGrid>
        )}
      </main>
    </div>
  );
}
