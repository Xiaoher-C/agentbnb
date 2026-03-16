/**
 * TransactionHistory — List component for credit transaction records.
 *
 * Shows a list of CreditTransaction items with:
 * - Color-coded reason badge
 * - Credit amount with "cr" prefix (green for positive, red for negative)
 * - Reference ID if present
 * - Relative timestamp
 *
 * Uses hub-* design tokens exclusively.
 */
import type { CreditTransaction } from '../types.js';
import { Skeleton } from './Skeleton.js';

export interface TransactionHistoryProps {
  /** Array of credit transactions to display. */
  transactions: CreditTransaction[];
  /** Whether transactions are still loading. */
  loading: boolean;
}

type ReasonKey = CreditTransaction['reason'];

const REASON_BADGE: Record<ReasonKey, { label: string; className: string }> = {
  bootstrap: {
    label: 'bootstrap',
    className:
      'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-blue-900/60 text-blue-300',
  },
  settlement: {
    label: 'settlement',
    className:
      'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-emerald-900/60 text-emerald-300',
  },
  escrow_hold: {
    label: 'escrow hold',
    className:
      'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-yellow-900/60 text-yellow-300',
  },
  escrow_release: {
    label: 'escrow release',
    className:
      'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-emerald-900/60 text-emerald-300',
  },
  refund: {
    label: 'refund',
    className:
      'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-red-900/60 text-red-300',
  },
};

/** Format an ISO timestamp as a short time string. */
function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Renders a list of credit transactions with color-coded badges and cr prefix.
 */
export default function TransactionHistory({
  transactions,
  loading,
}: TransactionHistoryProps): JSX.Element {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="rounded-lg border border-hub-border bg-hub-surface px-6 py-8 text-center">
        <p className="text-sm text-hub-text-tertiary">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {transactions.map((tx) => {
        const badge = REASON_BADGE[tx.reason];
        const isPositive = tx.amount >= 0;
        const amountClass = isPositive
          ? 'font-mono text-emerald-400'
          : 'font-mono text-red-400';
        const amountDisplay = isPositive ? `cr +${tx.amount}` : `cr ${tx.amount}`;

        return (
          <div
            key={tx.id}
            className="rounded-lg border border-hub-border px-4 py-3 flex items-center justify-between gap-3"
            style={{ backgroundColor: '#111117' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className={badge.className}>{badge.label}</span>
              {tx.reference_id && (
                <span className="text-xs text-hub-text-tertiary truncate hidden sm:block">
                  {tx.reference_id}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={amountClass}>{amountDisplay}</span>
              <span className="text-xs text-hub-text-tertiary">{formatTime(tx.created_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
