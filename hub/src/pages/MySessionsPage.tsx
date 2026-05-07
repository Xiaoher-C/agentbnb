/**
 * MySessionsPage — v10 inbox of rental sessions for the authed user.
 *
 * Surfaces:
 *   - Tabs: Active / Past
 *   - Filter: As Renter / As Owner / Both
 *   - List of `SessionInboxCard`s
 *   - Loading skeleton, empty state, error state
 *   - Cursor-based "Load more"
 *
 * Privacy contract (ADR-024): the backend list endpoint scopes to the authed
 * identity — the page never tries to widen the result set client-side.
 *
 * Maturity Evidence framing (ADR-022): the row summary is intentionally
 * descriptive ("3/4 tasks · 42 min") rather than a single score.
 *
 * @see docs/adr/022-agent-maturity-rental.md
 * @see docs/adr/023-session-as-protocol-primitive.md
 */
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router';
import { Loader2, RefreshCw } from 'lucide-react';
import { useMySessions, type RoleFilter, type StatusFilter } from '../hooks/useMySessions.js';
import SessionInboxCard from '../components/SessionInboxCard.js';
import AuthGate from '../components/AuthGate.js';
import type { AppOutletContext } from '../types.js';

type ActiveTab = 'active' | 'past';

const TAB_LABELS: Record<ActiveTab, string> = {
  active: 'Active',
  past: 'Past',
};

const ROLE_LABELS: Record<RoleFilter, string> = {
  either: 'Both',
  renter: 'As Renter',
  owner: 'As Owner',
};

/** The full page, wrapped in the auth gate. */
export default function MySessionsPage(): JSX.Element {
  const { apiKey, login } = useOutletContext<AppOutletContext>();
  return (
    <AuthGate apiKey={apiKey} onLogin={login}>
      <MySessionsInbox />
    </AuthGate>
  );
}

/**
 * Body of the My Sessions page — only mounts when the viewer is authed.
 * Split out so the list hook never fires for anonymous viewers.
 */
function MySessionsInbox(): JSX.Element {
  const [tab, setTab] = useState<ActiveTab>('active');
  const [role, setRole] = useState<RoleFilter>('either');

  const status: StatusFilter = tab === 'active' ? 'active' : 'ended';

  const { sessions, loading, error, refetch, loadMore, hasMore } = useMySessions({
    status,
    role,
    limit: 20,
  });

  // The header counts give the user a sense of inbox shape even when one tab is empty.
  const headline = useMemo(() => {
    if (loading && sessions.length === 0) return 'Loading sessions…';
    if (sessions.length === 0) return tab === 'active' ? 'No active sessions.' : 'No past sessions yet.';
    return `${sessions.length} ${tab === 'active' ? 'active' : 'past'} session${sessions.length === 1 ? '' : 's'}`;
  }, [loading, sessions.length, tab]);

  return (
    <section aria-labelledby="my-sessions-heading" className="max-w-4xl mx-auto py-10">
      <header className="mb-6">
        <h1 id="my-sessions-heading" className="text-3xl font-semibold text-hub-text-primary">
          My Sessions
        </h1>
        <p className="mt-2 text-sm text-hub-text-secondary">
          Active and past rental sessions you own or have rented.
        </p>
      </header>

      {/* Controls bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Session status" className="inline-flex rounded-lg border border-hub-border bg-hub-surface-0 p-1">
          {(['active', 'past'] as ActiveTab[]).map(t => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => { setTab(t); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                tab === t
                  ? 'bg-hub-surface-1 text-hub-text-primary'
                  : 'text-hub-text-secondary hover:text-hub-text-primary'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="role-filter" className="text-xs text-hub-text-muted">
            Showing
          </label>
          <select
            id="role-filter"
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
            aria-label="Refresh sessions"
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-hub-text-tertiary">{headline}</p>

      {/* Body */}
      {error ? (
        <div role="alert" className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] px-5 py-4 text-sm text-rose-300">
          {error}
        </div>
      ) : loading && sessions.length === 0 ? (
        <SessionListSkeleton />
      ) : sessions.length === 0 ? (
        <EmptyInbox tab={tab} />
      ) : (
        <ul className="space-y-3" aria-busy={loading}>
          {sessions.map(s => (
            <li key={s.id}>
              <SessionInboxCard row={s} />
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

/** Skeleton — three placeholder rows so the page doesn't pop on first render. */
function SessionListSkeleton(): JSX.Element {
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
          </div>
        </li>
      ))}
    </ul>
  );
}

interface EmptyInboxProps {
  tab: ActiveTab;
}

function EmptyInbox({ tab }: EmptyInboxProps): JSX.Element {
  return (
    <div className="rounded-card border border-hub-border bg-hub-surface-0 px-6 py-10 text-center">
      <p className="text-base font-medium text-hub-text-primary">
        {tab === 'active' ? 'No active sessions right now.' : 'No past sessions yet.'}
      </p>
      <p className="mt-2 text-sm text-hub-text-secondary">
        {tab === 'active'
          ? 'Rent an agent to start a live session.'
          : 'Once a session ends, the auto-generated outcome page will show up here.'}
      </p>
      <a
        href="#/"
        className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-hub-accent px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 transition"
      >
        Browse rentable agents
      </a>
    </div>
  );
}
