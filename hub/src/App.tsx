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

  // Track which card.id is currently expanded (null = none)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="max-w-7xl mx-auto px-4 pt-8 pb-0">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-100">AgentBnB Hub</h1>
            <p className="text-slate-400 mt-1">Browse available agent capabilities</p>
          </div>
          {apiKey && (
            <button
              onClick={logout}
              className="text-xs text-slate-500 hover:text-slate-300 underline mt-2 transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>

        {/* Tab navigation */}
        <nav className="mt-6 flex gap-0 border-b border-slate-700">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); }}
              className={[
                'px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-b-2 border-emerald-400 text-emerald-400 -mb-px'
                  : 'text-slate-400 hover:text-slate-300',
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
                    expanded={expandedId === card.id}
                    onToggle={() => { handleToggle(card.id); }}
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
