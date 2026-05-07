/**
 * OwnerDashboard — The "My Agent" tab page.
 *
 * Shows the authenticated agent owner's:
 * - Header with owner name
 * - Stats row: published cards count, online count, credits earned (cr prefix), balance with reserve breakdown
 * - Per-period request counts (24h / 7d / 30d)
 * - 30-day earnings AreaChart
 * - Published cards list with online/offline toggle
 * - Recent request history (last 10)
 * - Credit transaction history
 *
 * Uses hub-* design tokens exclusively (migrated from slate-* in v2.2).
 * Responsive: single-column on mobile, multi-column layout on lg+.
 */
import { useOwnerCards } from '../hooks/useOwnerCards.js';
import { useRequests } from '../hooks/useRequests.js';
import { useTransactions } from '../hooks/useTransactions.js';
import { Skeleton } from './Skeleton.js';
import RequestHistory from './RequestHistory.js';
import EarningsChart from './EarningsChart.js';
import TransactionHistory from './TransactionHistory.js';

export interface OwnerDashboardProps {
  /** API key from useAuth(). Must be non-null (AuthGate ensures this). */
  apiKey: string;
}

const RESERVE_FLOOR = 20;

/**
 * Renders the full owner dashboard.
 */
export default function OwnerDashboard({ apiKey }: OwnerDashboardProps): JSX.Element {
  const { ownerName, cards, balance, loading: cardsLoading, error: cardsError } = useOwnerCards(apiKey);
  const { requests: requests24h, loading: req24hLoading } = useRequests(apiKey, '24h');
  const { requests: requests7d } = useRequests(apiKey, '7d');
  const { requests: requests30d } = useRequests(apiKey, '30d');
  const { transactions, loading: txLoading } = useTransactions(apiKey);

  // Use the most recent (30d) for the history table
  const { requests: allRequests } = useRequests(apiKey);

  const onlineCount = cards.filter((c) => c.availability.online).length;
  const totalCreditsEarned = allRequests.reduce((sum, r) => sum + r.credits_charged, 0);

  const isLowCredits = balance !== null && balance < 10;
  const available = balance !== null && balance > RESERVE_FLOOR ? balance - RESERVE_FLOOR : null;

  if (cardsLoading || req24hLoading) {
    return (
      <div className="space-y-6">
        {/* Stats row skeletons */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        {/* Chart skeleton */}
        <Skeleton className="h-[160px] w-full" />
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
        <h2 className="text-2xl font-bold text-hub-text-primary">My Agent</h2>
        {ownerName && (
          <span className="text-lg text-hub-text-secondary">— {ownerName}</span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div
          className="rounded-lg border border-hub-border px-4 py-3"
          style={{ backgroundColor: '#111117' }}
        >
          <p className="text-xs text-hub-text-tertiary uppercase tracking-wide">Published</p>
          <p className="mt-1 text-2xl font-bold text-hub-text-primary">{cards.length}</p>
        </div>
        <div
          className="rounded-lg border border-hub-border px-4 py-3"
          style={{ backgroundColor: '#111117' }}
        >
          <p className="text-xs text-hub-text-tertiary uppercase tracking-wide">Online</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{onlineCount}</p>
        </div>
        <div
          className="rounded-lg border border-hub-border px-4 py-3"
          style={{ backgroundColor: '#111117' }}
        >
          <p className="text-xs text-hub-text-tertiary uppercase tracking-wide">Credits Earned</p>
          <p className="mt-1 text-2xl font-bold">
            <span className="font-mono text-hub-accent">cr {totalCreditsEarned}</span>
          </p>
        </div>
        <div
          className="rounded-lg border border-hub-border px-4 py-3"
          style={{ backgroundColor: '#111117' }}
        >
          <p className="text-xs text-hub-text-tertiary uppercase tracking-wide">Balance</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <p className="text-2xl font-bold">
              <span className="font-mono text-hub-accent">cr {balance ?? '—'}</span>
            </p>
            {isLowCredits && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-red-900/60 text-red-300 border border-red-700">
                Low credits — {balance} remaining
              </span>
            )}
          </div>
          <p className="text-xs text-hub-text-tertiary mt-1">
            {available !== null
              ? `${available} cr available · 20 cr reserve`
              : '20 cr reserve floor'}
          </p>
        </div>
      </div>

      {/* Per-period request counts */}
      <div
        className="rounded-lg border border-hub-border px-4 py-3"
        style={{ backgroundColor: '#111117' }}
      >
        <p className="text-xs text-hub-text-tertiary uppercase tracking-wide mb-2">Request Counts</p>
        <div className="flex items-center gap-6">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-hub-text-tertiary">24h</span>
            <span className="text-xl font-bold text-hub-text-primary">{requests24h.length}</span>
          </div>
          <span className="text-hub-text-tertiary">|</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-hub-text-tertiary">7d</span>
            <span className="text-xl font-bold text-hub-text-primary">{requests7d.length}</span>
          </div>
          <span className="text-hub-text-tertiary">|</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-hub-text-tertiary">30d</span>
            <span className="text-xl font-bold text-hub-text-primary">{requests30d.length}</span>
          </div>
        </div>
      </div>

      {/* 30-Day Earnings Chart */}
      <div
        className="rounded-lg border border-hub-border p-4"
        style={{ backgroundColor: '#111117' }}
      >
        <p className="text-xs text-hub-text-tertiary uppercase tracking-wide mb-3">30-Day Earnings</p>
        <EarningsChart requests={requests30d} />
      </div>

      {/* Three-section layout: Published Agents / Recent Requests / Credit Transactions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Published agent profiles */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-hub-text-secondary uppercase tracking-wide">Published Agents</h3>
          {cards.length === 0 ? (
            <div
              className="rounded-lg border border-hub-border px-4 py-6 text-center bg-hub-surface"
            >
              <p className="text-sm text-hub-text-tertiary">No agent published yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-lg border border-hub-border px-4 py-3 flex items-start justify-between gap-3"
                  style={{ backgroundColor: '#111117' }}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-hub-text-primary truncate">{card.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-hub-text-tertiary">
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
                          : 'bg-white/5 text-hub-text-tertiary'
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
                      className="text-xs text-hub-text-tertiary hover:text-hub-text-secondary underline transition-colors"
                    >
                      Toggle
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Requests */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-hub-text-secondary uppercase tracking-wide">Recent Requests</h3>
          <RequestHistory requests={allRequests} />
        </div>

        {/* Credit Transactions */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-hub-text-secondary uppercase tracking-wide">Credit Transactions</h3>
          <TransactionHistory transactions={transactions} loading={txLoading} />
        </div>
      </div>
    </div>
  );
}
