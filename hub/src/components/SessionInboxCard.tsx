/**
 * SessionInboxCard — single-row card for the My Sessions / My Outcomes inbox.
 *
 * Renders participant avatars, agent name, status badge, duration, summary,
 * and an "Open" CTA. Used by `MySessionsPage` and `MyOutcomesPage`.
 *
 * Variants:
 *   - sessions inbox: "Open" navigates to `/s/:id` (active) or `/o/:share_token` (ended)
 *   - outcomes inbox: includes a "Share" button that copies the public outcome URL
 */
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import Avatar from 'boring-avatars';
import { ArrowRight, Check, Copy, ExternalLink, Pin } from 'lucide-react';
import type { MySessionRow } from '../hooks/useMySessions.js';

const RENTER_PALETTE = ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#D1FAE5'];
const OWNER_PALETTE = ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#EDE9FE'];

const ACTIVE_STATUSES = new Set(['open', 'active', 'paused']);

/** "did:key:abcd…wxyz" — keeps the prefix, truncates the middle. */
function shortDid(did: string): string {
  if (did.length <= 14) return did;
  return `${did.slice(0, 8)}…${did.slice(-4)}`;
}

/** Best-effort elapsed-or-total minute count for the row. */
function elapsedMinutes(row: MySessionRow): number {
  const startMs = row.started_at ? Date.parse(row.started_at) : Date.parse(row.created_at);
  const endMs = row.ended_at ? Date.parse(row.ended_at) : Date.now();
  return Math.max(0, Math.round((endMs - startMs) / 60_000));
}

interface StatusBadgeProps {
  status: MySessionRow['status'];
}

function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  const isActive = ACTIVE_STATUSES.has(status);
  const label = isActive
    ? status === 'paused' ? 'Paused' : 'Live'
    : status === 'closed' ? 'Ended' : status === 'settled' ? 'Settled' : 'Closing';
  const tone = isActive
    ? 'border-hub-live/30 bg-hub-live/10 text-hub-live'
    : 'border-hub-mute/30 bg-hub-mute/10 text-hub-mute';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tone}`}
    >
      {isActive ? (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-hub-live animate-pulse" aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
}

export interface SessionInboxCardProps {
  row: MySessionRow;
  /**
   * When true, render the "Share outcome" button (used by MyOutcomesPage).
   * Sessions inbox doesn't show this even for ended rows — they get the
   * "Open" CTA which lands on the outcome page anyway.
   */
  showShare?: boolean;
  /**
   * When true, render the "Pin to profile" toggle (no-op for now).
   * Pinning will land in a follow-up; we surface the affordance early so
   * users see the future shape.
   */
  showPin?: boolean;
}

/**
 * One row of the inbox. Self-contained — no parent state needed beyond the row.
 */
export default function SessionInboxCard({
  row,
  showShare = false,
  showPin = false,
}: SessionInboxCardProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);

  const isActive = ACTIVE_STATUSES.has(row.status);
  const openHref = isActive
    ? `#/s/${encodeURIComponent(row.id)}`
    : row.share_token
      ? `#/o/${encodeURIComponent(row.share_token)}`
      : `#/s/${encodeURIComponent(row.id)}`;

  const minutes = elapsedMinutes(row);
  const totalLabel = isActive
    ? `${minutes} min elapsed · ${row.duration_min} min booked`
    : `${minutes} min`;

  const handleCopyShare = useCallback(async (): Promise<void> => {
    if (!row.share_token) return;
    try {
      // Public outcome URL — derive from current origin so the copy works
      // both on the prod hub and on local dev.
      const url = `${window.location.origin}/hub/#/o/${encodeURIComponent(row.share_token)}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      // Clipboard may be unavailable — silently degrade.
    }
  }, [row.share_token]);

  const handleTogglePin = useCallback(() => {
    // TODO(E3 follow-up): persist pin state via PATCH /api/sessions/:id once
    // the backend exposes a pinned flag. For now, this is a local-only
    // affordance to validate the UX before backing it.
    setPinned(p => !p);
  }, []);

  return (
    <article
      className="group rounded-card border border-hub-border bg-hub-surface-0 p-5 transition hover:border-hub-border-emphasis hover:bg-hub-surface-1"
      aria-label={`Session ${row.id} with ${row.agent_id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Left: avatars + identity */}
        <div className="flex items-start gap-3">
          <div className="flex -space-x-2">
            <span className="rounded-full ring-2 ring-hub-surface-0">
              <Avatar size={36} name={row.renter_did} variant="beam" colors={RENTER_PALETTE} />
            </span>
            <span className="rounded-full ring-2 ring-hub-surface-0">
              <Avatar size={36} name={row.owner_did} variant="beam" colors={OWNER_PALETTE} />
            </span>
          </div>
          <div className="min-w-0">
            <Link
              to={`/agents/${encodeURIComponent(row.owner_did)}`}
              className="text-sm font-semibold text-hub-text-primary hover:text-hub-accent transition"
            >
              {row.agent_id}
            </Link>
            <p className="mt-0.5 text-xs font-mono text-hub-text-muted truncate max-w-[28ch]">
              {shortDid(row.renter_did)} <span className="text-hub-text-tertiary">→</span>{' '}
              {shortDid(row.owner_did)}
            </p>
          </div>
        </div>

        {/* Right: status + duration */}
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={row.status} />
          <p className="text-[11px] text-hub-text-tertiary">{totalLabel}</p>
        </div>
      </div>

      {/* Summary line for ended sessions */}
      {row.summary ? (
        <p className="mt-3 text-xs text-hub-text-secondary">{row.summary}</p>
      ) : null}

      {/* Footer actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={openHref}
          className="inline-flex items-center gap-1.5 rounded-md bg-hub-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 transition"
        >
          {isActive ? 'Open session' : 'View outcome'}
          <ArrowRight size={12} aria-hidden="true" />
        </a>

        {showShare && row.share_token ? (
          <button
            type="button"
            onClick={() => { void handleCopyShare(); }}
            className="inline-flex items-center gap-1.5 rounded-md border border-hub-border-default px-3 py-1.5 text-xs font-medium text-hub-text-secondary hover:border-hub-border-emphasis hover:text-hub-text-primary transition"
            aria-label="Copy share URL"
          >
            {copied ? (
              <>
                <Check size={12} aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy size={12} aria-hidden="true" />
                Share
              </>
            )}
          </button>
        ) : null}

        {showPin ? (
          <button
            type="button"
            onClick={handleTogglePin}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              pinned
                ? 'border-hub-pinned/40 bg-hub-pinned/10 text-hub-pinned'
                : 'border-hub-border-default text-hub-text-secondary hover:border-hub-border-emphasis hover:text-hub-text-primary'
            }`}
            aria-pressed={pinned}
            title="Pinning will land in a follow-up — UI preview only."
          >
            <Pin size={12} aria-hidden="true" />
            {pinned ? 'Pinned' : 'Pin to profile'}
          </button>
        ) : null}

        {row.has_outcome && row.share_token ? (
          <a
            href={`#/o/${encodeURIComponent(row.share_token)}`}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-hub-text-muted hover:text-hub-text-primary transition"
          >
            Outcome page
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </article>
  );
}
