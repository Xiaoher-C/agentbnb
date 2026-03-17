/**
 * DiscoverPage — The "Discover" route page.
 *
 * Extracted from App.tsx (plan 09) as a standalone route component
 * for the react-router SPA navigation (plan 12-01).
 *
 * Reads setSelectedCard from Outlet context to open the card detail modal.
 */
import { useOutletContext } from 'react-router';
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

/**
 * Discover route — shows the full capability card grid with stats, search, and filters.
 * Reads setSelectedCard from router Outlet context to open the modal overlay.
 */
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
    availableCategories,
    retry,
    agentsOnline,
    totalCapabilities,
    totalExchanges,
  } = useCards();

  return (
    <>
      <StatsBar
        agentsOnline={agentsOnline}
        totalCapabilities={totalCapabilities}
        totalExchanges={totalExchanges}
      />

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
              onClick={() => { setSelectedCard(card); }}
            />
          ))}
        </CardGrid>
      )}

      <CompatibleWithSection />
      <FAQSection />
      <ValuePropSection />
    </>
  );
}
