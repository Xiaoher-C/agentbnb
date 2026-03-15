/**
 * AgentBnB Hub — Root App component.
 * Full hub page wiring all components and the data-fetching hook together.
 * Now includes tab navigation: Discover | Share | My Agent.
 * Modal overlay (CardModal) wired in plan 02 — clicking a card opens a detail modal.
 */
import { useState } from 'react';
import { useCards } from './hooks/useCards.js';
import { useAuth } from './hooks/useAuth.js';
import type { HubCard } from './types.js';
import CapabilityCard from './components/CapabilityCard.js';
import CardGrid from './components/CardGrid.js';
import CardModal from './components/CardModal.js';
import EmptyState from './components/EmptyState.js';
import ErrorState from './components/ErrorState.js';
import SearchFilter from './components/SearchFilter.js';
import SkeletonCard from './components/SkeletonCard.js';
import StatsBar from './components/StatsBar.js';
import AuthGate from './components/AuthGate.js';
import OwnerDashboard from './components/OwnerDashboard.js';
import SharePage from './components/SharePage.js';

const SKELETON_COUNT = 6;

type ActiveTab = 'discover' | 'share' | 'myagent';

const TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'discover', label: 'Discover' },
  { id: 'share', label: 'Share' },
  { id: 'myagent', label: 'My Agent' },
];

/**
 * Hub page with tab navigation: Discover, Share, and My Agent.
 * selectedCard state drives the detail modal overlay.
 */
export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('discover');
  const [selectedCard, setSelectedCard] = useState<HubCard | null>(null);

  const { apiKey, login, logout } = useAuth();

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
    <div className="min-h-screen bg-hub-bg text-hub-text-primary">
      <header className="max-w-7xl mx-auto px-4 pt-8 pb-0">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-semibold text-hub-text-primary">AgentBnB</h1>
          {apiKey && (
            <button
              onClick={logout}
              className="text-xs text-hub-text-tertiary hover:text-hub-text-secondary mt-1 transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>

        {/* Tab navigation — pill switcher */}
        <nav className="mt-6 flex gap-1 bg-white/[0.04] rounded-lg p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); }}
              className={[
                'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-white/[0.08] text-hub-text-primary'
                  : 'bg-transparent text-hub-text-muted hover:text-hub-text-secondary',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 pb-12">
        {/* Discover tab */}
        {activeTab === 'discover' && (
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
          </>
        )}

        {/* Share tab */}
        {activeTab === 'share' && (
          <SharePage apiKey={apiKey} />
        )}

        {/* My Agent tab */}
        {activeTab === 'myagent' && (
          <AuthGate apiKey={apiKey} onLogin={login}>
            {apiKey && <OwnerDashboard apiKey={apiKey} />}
          </AuthGate>
        )}
      </main>

      {/* Modal overlay — renders above all content */}
      <CardModal card={selectedCard} onClose={() => { setSelectedCard(null); }} />
    </div>
  );
}
