/**
 * OwnerDashboard — The "My Agent" tab page.
 *
 * Shows the authenticated agent owner's:
 * - Header with owner name
 * - Stats row: published cards count, online count, total credits earned
 * - Credit balance with low-credit badge (< 10 credits)
 * - Per-period request counts (24h / 7d / 30d)
 * - Published cards list with online/offline toggle
 * - Recent request history (last 10)
 *
 * Responsive: single-column on mobile, two-column layout on lg+.
 */
import { useOwnerCards } from '../hooks/useOwnerCards.js';
import { useRequests } from '../hooks/useRequests.js';
import RequestHistory from './RequestHistory.js';

export interface OwnerDashboardProps {
  /** API key from useAuth(). Must be non-null (AuthGate ensures this). */
  apiKey: string;
}

/**
 * Renders the full owner dashboard.
 */
export default function OwnerDashboard({ apiKey }: OwnerDashboardProps): JSX.Element {
  const { ownerName, cards, balance, loading: cardsLoading, error: cardsError } = useOwnerCards(apiKey);
  const { requests: requests24h, loading: req24hLoading } = useRequests(apiKey, '24h');
  const { requests: requests7d } = useRequests(apiKey, '7d');
  const { requests: requests30d } = useRequests(apiKey, '30d');

  // Use the most recent (30d) for the history table
  const { requests: allRequests } = useRequests(apiKey);

  const onlineCount = cards.filter((c) => c.availability.online).length;
  const totalCreditsEarned = allRequests.reduce((sum, r) => sum + r.credits_charged, 0);

  const isLowCredits = balance !== null && balance < 10;

  if (cardsLoading || req24hLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Loading dashboard…
      </div>
    );
  }

  if (cardsError) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/20 px-6 py-8 text-center">
        <p className="text-sm text-red-400">{cardsError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-slate-100">My Agent</h2>
        {ownerName && (
          <span className="text-lg text-slate-400">— {ownerName}</span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Published</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">{cards.length}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Online</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{onlineCount}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Credits Earned</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">{totalCreditsEarned}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Balance</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-2xl font-bold text-slate-100">{balance ?? '—'}</p>
            {isLowCredits && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-red-900/60 text-red-300 border border-red-700">
                Low credits — {balance} remaining
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Per-period request counts */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Request Counts</p>
        <div className="flex items-center gap-6">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-slate-500">24h</span>
            <span className="text-xl font-bold text-slate-100">{requests24h.length}</span>
          </div>
          <span className="text-slate-600">|</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-slate-500">7d</span>
            <span className="text-xl font-bold text-slate-100">{requests7d.length}</span>
          </div>
          <span className="text-slate-600">|</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-slate-500">30d</span>
            <span className="text-xl font-bold text-slate-100">{requests30d.length}</span>
          </div>
        </div>
      </div>

      {/* Published cards list + Request history (two-column on lg+) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cards list */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Published Cards</h3>
          {cards.length === 0 ? (
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-6 text-center">
              <p className="text-sm text-slate-500">No cards published yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-100 truncate">{card.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span>Level {card.level}</span>
                      {card.metadata?.success_rate !== undefined && (
                        <span>· {(card.metadata.success_rate * 100).toFixed(0)}% success</span>
                      )}
                      {card.metadata?.avg_latency_ms !== undefined && (
                        <span>· {card.metadata.avg_latency_ms} ms avg</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        card.availability.online
                          ? 'bg-emerald-900/60 text-emerald-300'
                          : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      {card.availability.online ? 'Online' : 'Offline'}
                    </span>
                    <button
                      onClick={() => {
                        void fetch(`/cards/${card.id}/toggle-online`, {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${apiKey}` },
                        });
                      }}
                      className="text-xs text-slate-500 hover:text-slate-300 underline transition-colors"
                    >
                      Toggle
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Request history */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Recent Requests</h3>
          <RequestHistory requests={allRequests} />
        </div>
      </div>
    </div>
  );
}
