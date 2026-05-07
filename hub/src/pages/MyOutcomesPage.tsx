/**
 * MyOutcomesPage — v10 portfolio of completed rental outcome pages.
 *
 * Surfaces:
 *   - Filter: As Renter / As Owner / Both
 *   - List of `SessionInboxCard`s with `status='ended'`, including a Share
 *     button that copies `/o/:share_token` to the clipboard
 *   - Pin-to-profile affordance (no-op for now — see TODO in SessionInboxCard)
 *
 * Privacy / Maturity Evidence (ADR-022 / ADR-024): the public outcome URLs are
 * the canonical "Maturity Evidence" surface — never collapsed into a single
 * score. Pinning is intended to let owners curate which outcomes attach to
 * their public profile in a follow-up PR.
 *
 * @see docs/adr/022-agent-maturity-rental.md
 */
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router';
import { Loader2, RefreshCw } from 'lucide-react';
import { useMyOutcomes } from '../hooks/useMyOutcomes.js';
import type { RoleFilter } from '../hooks/useMySessions.js';
import SessionInboxCard from '../components/SessionInboxCard.js';
import AuthGate from '../components/AuthGate.js';
import type { AppOutletContext } from '../types.js';

const ROLE_LABELS: Record<RoleFilter, string> = {
  either: 'Both',
  renter: 'As Renter',
  owner: 'As Owner',
};

/** Outer page — gated behind auth. */
export default function MyOutcomesPage(): JSX.Element {
  const { apiKey, login } = useOutletContext<AppOutletContext>();
  return (
    <AuthGate apiKey={apiKey} onLogin={login}>
      <MyOutcomesList />
    </AuthGate>
  );
}

/**
 * Body — only mounts when authed. Pulls the ended-only slice via `useMyOutcomes`
 * (a thin wrapper around `useMySessions` with `status='ended'`).
 */
function MyOutcomesList(): JSX.Element {
  const [role, setRole] = useState<RoleFilter>('either');

  const { sessions, loading, error, refetch, loadMore, hasMore } = useMyOutcomes({
    role,
    limit: 20,
  });

  const headline = useMemo(() => {
    if (loading && sessions.length === 0) return 'Loading outcomes…';
    if (sessions.length === 0) return 'No outcomes yet.';
    return `${sessions.length} outcome${sessions.length === 1 ? '' : 's'}`;
  }, [loading, sessions.length]);

  return (
    <section aria-labelledby="my-outcomes-heading" className="max-w-4xl mx-auto py-10">
      <header className="mb-6">
        <h1 id="my-outcomes-heading" className="text-3xl font-semibold text-hub-text-primary">
          My Outcomes
        </h1>
        <p className="mt-2 text-sm text-hub-text-secondary">
          Shareable artifacts from your completed rental sessions. Each one is a public
          page anyone with the link can read — share them as portfolio evidence.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="outcome-role-filter" className="text-xs text-hub-text-muted">
            Showing
          </label>
          <select
            id="outcome-role-filter"
            value={role}
            onChange={(e) => { setRole(e.target.value as RoleFilter); }}
            className="rounded-md border border-hub-border-default bg-hub-surface-0 px-2 py-1.5 text-xs text-hub-text-primary focus:border-hub-accent focus:outline-none"
          >
            {(['either', 'renter', 'owner'] as RoleFilter[]).map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { void refetch(); }}
            className="inline-flex items-center gap-1 rounded-md border border-hub-border-default px-2 py-1.5 text-xs text-hub-text-secondary hover:border-hub-border-emphasis hover:text-hub-text-primary transition"
            aria-label="Refresh outcomes"
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            Refresh
          </button>
        </div>
        <p className="text-xs text-hub-text-tertiary">{headline}</p>
      </div>

      {error ? (
        <div role="alert" className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] px-5 py-4 text-sm text-rose-300">
          {error}
        </div>
      ) : loading && sessions.length === 0 ? (
        <OutcomeListSkeleton />
      ) : sessions.length === 0 ? (
        <EmptyOutcomes />
      ) : (
        <ul className="space-y-3" aria-busy={loading}>
          {sessions.map(s => (
            <li key={s.id}>
              <SessionInboxCard row={s} showShare showPin />
            </li>
          ))}
        </ul>
      )}

      {hasMore && sessions.length > 0 ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => { void loadMore(); }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-hub-border-default px-4 py-2 text-sm text-hub-text-secondary hover:border-hub-border-emphasis hover:text-hub-text-primary transition disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : null}
            Load more
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Skeleton — matches `MySessionsPage` for visual consistency. */
function OutcomeListSkeleton(): JSX.Element {
  return (
    <ul className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <li key={i} className="rounded-card border border-hub-border bg-hub-surface-0 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                <div className="h-9 w-9 rounded-full bg-hub-surface-1" />
                <div className="h-9 w-9 rounded-full bg-hub-surface-1" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-32 rounded bg-hub-surface-1" />
                <div className="h-2.5 w-48 rounded bg-hub-surface-1" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-4 w-12 rounded-full bg-hub-surface-1" />
              <div className="h-2.5 w-20 rounded bg-hub-surface-1" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <div className="h-7 w-24 rounded-md bg-hub-surface-1" />
            <div className="h-7 w-20 rounded-md bg-hub-surface-1" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyOutcomes(): JSX.Element {
  return (
    <div className="rounded-card border border-hub-border bg-hub-surface-0 px-6 py-10 text-center">
      <p className="text-base font-medium text-hub-text-primary">No outcomes yet.</p>
      <p className="mt-2 text-sm text-hub-text-secondary">
        Once a rental session ends, the auto-generated Outcome Page lands here. Share
        the public link as portfolio evidence — Maturity Evidence is built one
        outcome at a time.
      </p>
      <a
        href="#/sessions"
        className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-hub-accent px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 transition"
      >
        Go to active sessions
      </a>
    </div>
  );
}
