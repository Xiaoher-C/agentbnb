/**
 * RentSessionModal — v10 rental confirmation modal.
 *
 * Renders a duration picker (30 / 60 / 120 min), shows the live cost estimate,
 * checks renter escrow balance, and on confirm POSTs to `/api/sessions` with
 * `session_mode: true` (privacy contract — ADR-024) and navigates to /s/:id.
 *
 * Dialog UX:
 * - Backdrop click + ESC close the modal
 * - Submit button shows loading state while the request is in flight
 * - Errors surface inline below the action row
 *
 * The `RentableAgent` shape comes from `useRentableAgents`. The `renterDid` is
 * read from the active Hub session — when no session exists, the modal shows
 * a "請先登入" prompt instead of the duration picker.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { X, Shield, Loader2 } from 'lucide-react';
import { authedFetch, loadSession } from '../lib/authHeaders.js';
import type { RentableAgent } from '../hooks/useRentableAgents.js';

interface RentSessionModalProps {
  agent: RentableAgent | null;
  /** Renter's available credit balance, fetched from /me. null = unknown. */
  renterBalance?: number | null;
  onClose: () => void;
}

const DURATION_CHOICES: ReadonlyArray<{ minutes: 30 | 60 | 120; label: string }> = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '60 min' },
  { minutes: 120, label: '120 min' },
];

/** Default fallback rate when an agent has not declared a per-minute price. */
const FALLBACK_RATE_PER_MINUTE = 1;

interface CreateSessionResponse {
  session_id: string;
  share_token: string;
  relay_url: string;
  status: string;
}

/**
 * Renders the rental confirmation dialog. Caller manages the open/close
 * lifecycle by passing `agent === null` to hide the modal.
 */
export default function RentSessionModal({
  agent,
  renterBalance = null,
  onClose,
}: RentSessionModalProps): JSX.Element | null {
  const navigate = useNavigate();
  const [duration, setDuration] = useState<30 | 60 | 120>(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC closes
  useEffect(() => {
    if (!agent) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!agent) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [agent]);

  const ratePerMinute = useMemo(() => {
    if (!agent) return FALLBACK_RATE_PER_MINUTE;
    return agent.pricing.per_minute ?? FALLBACK_RATE_PER_MINUTE;
  }, [agent]);

  const estimatedCost = ratePerMinute * duration;
  const hasInsufficientBalance =
    renterBalance !== null && renterBalance >= 0 && estimatedCost > renterBalance;

  const session = loadSession();
  const renterDid = session?.agentId ?? null;

  if (!agent) return null;

  const handleConfirm = async (): Promise<void> => {
    if (!renterDid) {
      setError('請先登入再租用 agent。');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await authedFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renter_did: renterDid,
          owner_did: agent.owner_did,
          agent_id: agent.agent_id,
          duration_min: duration,
          budget_credits: estimatedCost,
          // Privacy contract — ADR-024
          session_mode: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server returned ${res.status}`);
      }

      const data = (await res.json()) as CreateSessionResponse;
      onClose();
      void navigate(`/s/${data.session_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`無法建立 session：${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rent-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
      />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-hub-surface border border-hub-border rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden">
        <header className="flex items-start justify-between gap-3 p-5 border-b border-hub-border">
          <div className="min-w-0">
            <h2
              id="rent-modal-title"
              className="text-base font-semibold text-hub-text-primary truncate"
            >
              租用 {agent.name}
            </h2>
            <p className="text-xs text-hub-text-secondary mt-0.5 truncate">
              @{agent.owner_did}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-hub-text-muted hover:text-hub-text-primary hover:bg-white/[0.06] transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* Duration picker */}
          <fieldset>
            <legend className="text-xs uppercase tracking-wider text-hub-text-muted mb-2">
              Session length
            </legend>
            <div
              role="radiogroup"
              aria-label="Session duration"
              className="grid grid-cols-3 gap-2"
            >
              {DURATION_CHOICES.map(({ minutes, label }) => {
                const selected = duration === minutes;
                return (
                  <button
                    key={minutes}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setDuration(minutes)}
                    className={`text-sm py-2.5 rounded-lg border transition-colors ${
                      selected
                        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                        : 'bg-white/[0.02] border-hub-border text-hub-text-secondary hover:border-hub-border-hover hover:text-hub-text-primary'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Cost summary */}
          <dl className="rounded-lg border border-hub-border bg-white/[0.02] p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-hub-text-secondary">Rate</dt>
              <dd className="font-mono text-hub-text-primary">
                cr {ratePerMinute} / min
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-hub-text-secondary">Estimated cost</dt>
              <dd className="font-mono text-hub-accent text-base">
                cr {estimatedCost}
              </dd>
            </div>
            {renterBalance !== null && (
              <div className="flex items-center justify-between">
                <dt className="text-hub-text-secondary">Your balance</dt>
                <dd
                  className={`font-mono ${
                    hasInsufficientBalance ? 'text-amber-400' : 'text-hub-text-primary'
                  }`}
                >
                  cr {renterBalance}
                </dd>
              </div>
            )}
          </dl>

          {/* Privacy contract reminder */}
          <p className="flex items-start gap-2 text-[11px] text-hub-text-muted leading-relaxed">
            <Shield size={12} className="flex-shrink-0 mt-0.5 text-emerald-400/80" />
            <span>
              工具在出租者本機執行，你只看到結果。對話與檔案僅在這個 session 內可見，不會匯入對方 agent 的長期記憶。
            </span>
          </p>

          {hasInsufficientBalance && (
            <p
              role="alert"
              className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2"
            >
              餘額不足以涵蓋這次租用。請先儲值或選擇較短的時段。
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 break-words"
            >
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hub-border bg-white/[0.02]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 text-sm text-hub-text-secondary hover:text-hub-text-primary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting || hasInsufficientBalance}
            className="inline-flex items-center gap-2 px-4 py-2 bg-hub-accent text-white text-sm font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Creating session…' : `Confirm · cr ${estimatedCost}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
