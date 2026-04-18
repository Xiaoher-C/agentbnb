/**
 * Registry-unreachable error surfaces for the Hub.
 *
 * Two shapes are exported:
 *   - `ErrorState` (default) — empty-grid fallback surface. Rendered inside
 *     the card grid area when there is no cached data to fall back on.
 *     Explains the situation so the homepage still communicates value even
 *     when the backend is down.
 *   - `InlineErrorBanner` — compact amber banner. Rendered above stale/cached
 *     cards when a refetch fails but we still have data to show.
 *
 * Dark SaaS design: uses hub- design tokens + amber warning accent
 * (amber-500 family, already used elsewhere in the hub for warnings).
 */
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  onRetry: () => void;
  /** Raw error from the data layer — surfaced as a secondary monospace line. */
  message?: string | null;
}

/**
 * Fallback surface used when the registry is unreachable and we have no
 * cached cards to display. Far more modest than a full-page block — it
 * sits inside the card grid area and leaves the surrounding sections
 * (hero, how-it-works, provider value, FAQ) visible.
 */
export default function ErrorState({ onRetry, message }: ErrorStateProps): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-6 py-8 text-center"
    >
      <div className="inline-flex items-center gap-2 text-amber-400">
        <AlertTriangle size={16} aria-hidden="true" />
        <p className="text-sm font-semibold">We can't reach the registry right now</p>
      </div>
      <p className="mt-2 text-sm text-hub-text-secondary">
        Showing what AgentBnB does in the meantime — live agents will appear here once the registry is back.
      </p>
      {message ? (
        <p className="mt-1 text-xs text-hub-text-muted font-mono">{message}</p>
      ) : null}
      <button
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 bg-hub-accent hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition"
      >
        <RefreshCw size={14} aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

/**
 * Compact amber banner shown above the card grid when the registry fetch
 * failed but `useCards` retained previously-fetched cards (graceful
 * degradation). Keeps the page feeling alive while still being honest
 * about the error.
 */
export function InlineErrorBanner({ onRetry, message }: ErrorStateProps): JSX.Element {
  return (
    <div
      role="alert"
      className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2"
    >
      <AlertTriangle size={14} className="text-amber-400 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-amber-400">
          Registry unreachable — results may be stale
        </p>
        {message ? (
          <p className="mt-0.5 text-[11px] text-hub-text-muted font-mono truncate">
            {message}
          </p>
        ) : null}
      </div>
      <button
        onClick={onRetry}
        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs font-medium transition"
      >
        <RefreshCw size={12} aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}
