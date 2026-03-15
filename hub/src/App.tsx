/**
 * AgentBnB Hub — Root App component.
 * Full hub page wiring all components and the data-fetching hook together.
 * Now includes tab navigation: Discover | Share | My Agent.
 */
import { useState } from 'react';
import { useCards } from './hooks/useCards.js';
import { useAuth } from './hooks/useAuth.js';
import CapabilityCard from './components/CapabilityCard.js';
import CardGrid from './components/CardGrid.js';
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
 */
export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('discover');

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

  // Modal overlay implemented in plan 02 — onClick wired up, modal state added there
  const handleCardClick = (_id: string) => {
    // No-op until plan 02 adds the modal overlay
  };

  return (
    <div className="min-h-screen bg-hub-bg text-hub-text-primary">
      <header className="max-w-7xl mx-auto px-4 pt-8 pb-0">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-hub-text-primary">AgentBnB Hub</h1>
            <p className="text-hub-text-secondary mt-1">Browse available agent capabilities</p>
          </div>
          {apiKey && (
            <button
              onClick={logout}
              className="text-xs text-hub-text-tertiary hover:text-hub-text-secondary underline mt-2 transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>

        {/* Tab navigation */}
        <nav className="mt-6 flex gap-0 border-b border-hub-border">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); }}
              className={[
                'px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-b-2 border-hub-accent text-hub-accent -mb-px'
                  : 'text-hub-text-secondary hover:text-hub-text-primary',
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
                    onClick={() => { handleCardClick(card.id); }}
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
    </div>
  );
}
