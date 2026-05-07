/**
 * RentSessionModal — v10 rental confirmation modal.
 *
 * Renders a duration picker (30 / 60 / 120 min), shows the live cost
 * breakdown (rate × duration + 10% buffer), enforces a real client-side
 * escrow balance gate, and on confirm POSTs to `/api/sessions` with
 * `session_mode: true` (privacy contract — ADR-024) and navigates to
 * `/s/:id`.
 *
 * Balance gate (E4):
 * - Pulls the spendable balance via `useEscrowBalance()` (calls `/me`).
 * - Loading → cost row shows a skeleton, Confirm disabled.
 * - Sufficient → green confirmation with the escrow-hold amount.
 * - Insufficient → red warning + Topup CTA, Confirm visibly disabled.
 * - 0 balance → empty-pocket state pointing at provider docs.
 * - Defensive: even with a passing client-side gate the backend may still
 *   reject with HTTP 402 if balance changed mid-flight; we surface that as
 *   an inline error.
 *
 * Dialog UX:
 * - Backdrop click + ESC close the modal
 * - Submit button shows loading state while the request is in flight
 *
 * The `RentableAgent` shape comes from `useRentableAgents`. The `renterDid`
 * is read from the active Hub session — when no session exists, the modal
 * shows a "請先登入" prompt instead of the duration picker.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { X, Shield, Loader2, AlertTriangle, CheckCircle2, Wallet } from 'lucide-react';
import { authedFetch, loadSession } from '../lib/authHeaders.js';
import {
  BALANCE_CHANGED_EVENT,
  useEscrowBalance,
  type EscrowCurrency,
} from '../hooks/useEscrowBalance.js';
import type { RentableAgent } from '../hooks/useRentableAgents.js';

interface RentSessionModalProps {
  agent: RentableAgent | null;
  onClose: () => void;
}

const DURATION_CHOICES: ReadonlyArray<{ minutes: 30 | 60 | 120; label: string }> = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '60 min' },
  { minutes: 120, label: '120 min' },
];

/** Default fallback rate when an agent has not declared a per-minute price. */
const FALLBACK_RATE_PER_MINUTE = 1;

/**
 * Safety buffer applied on top of the literal duration × rate cost. The
 * backend may settle slightly more than the nominal estimate (rounding,
 * rate drift inside a session). Holding 10% extra in escrow keeps the
 * session from dying mid-conversation.
 */
export const ESCROW_BUFFER_RATIO = 0.1;

/** Where the user goes to read about earning / topping up credits. */
const TOPUP_PATH = '/credit-policy';

interface CreateSessionResponse {
  session_id: string;
  share_token: string;
  relay_url: string;
  status: string;
}

interface CostBreakdown {
  ratePerMinute: number;
  duration: 30 | 60 | 120;
  baseCost: number;
  buffer: number;
  total: number;
}

function computeCost(ratePerMinute: number, duration: 30 | 60 | 120): CostBreakdown {
  const baseCost = ratePerMinute * duration;
  // Round buffer up so we never under-hold by a fractional credit.
  const buffer = Math.ceil(baseCost * ESCROW_BUFFER_RATIO);
  return {
    ratePerMinute,
    duration,
    baseCost,
    buffer,
    total: baseCost + buffer,
  };
}

/**
 * Renders the rental confirmation dialog. Caller manages the open/close
 * lifecycle by passing `agent === null` to hide the modal.
 */
export default function RentSessionModal({
  agent,
  onClose,
}: RentSessionModalProps): JSX.Element | null {
  const navigate = useNavigate();
  const [duration, setDuration] = useState<30 | 60 | 120>(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { balance, loading: balanceLoading, error: balanceError } = useEscrowBalance();
  const currency: EscrowCurrency = 'credits';

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

  const cost = useMemo(() => computeCost(ratePerMinute, duration), [ratePerMinute, duration]);

  const session = loadSession();
  const renterDid = session?.agentId ?? null;

  // Three-state classification — keep `null` as "unknown / loading", treat
  // 0 as a special empty-pocket case for clearer copy.
  const balanceUnknown = balance === null;
  const isEmptyPocket = balance === 0;
  const isInsufficient = balance !== null && cost.total > balance;
  const shortfall = isInsufficient && balance !== null ? cost.total - balance : 0;
  const canConfirm = !submitting && !balanceLoading && !balanceUnknown && !isInsufficient;

  if (!agent) return null;

  const handleConfirm = async (): Promise<void> => {
    if (!renterDid) {
      setError('請先登入再租用 agent。');
      return;
    }
    if (isInsufficient) {
      // Defensive — the button should already be disabled.
      setError(`餘額不足 ${shortfall} credits。`);
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
          budget_credits: cost.total,
          // Privacy contract — ADR-024
          session_mode: true,
        }),
      });

      // Race condition: backend may know the renter is broke before we did.
      if (res.status === 402) {
        setError('餘額不足以覆蓋這次租用。請先儲值再試。');
        // Trigger a refresh so the balance row updates.
        window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server returned ${res.status}`);
      }

      const data = (await res.json()) as CreateSessionResponse;
      // Refresh balance for any other surface watching the credit total.
      window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
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

          {/* Cost breakdown */}
          <dl
            data-testid="rent-cost-breakdown"
            className="rounded-lg border border-hub-border bg-white/[0.02] p-4 space-y-2 text-sm"
          >
            <div className="flex items-center justify-between">
              <dt className="text-hub-text-secondary">Rate</dt>
              <dd className="font-mono text-hub-text-primary">
                {currency} {cost.ratePerMinute} / min
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-hub-text-secondary">{cost.duration} min × rate</dt>
              <dd className="font-mono text-hub-text-primary">
                {currency} {cost.baseCost}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt
                className="text-hub-text-secondary"
                title="10% safety buffer held in escrow"
              >
                Buffer (10%)
              </dt>
              <dd className="font-mono text-hub-text-primary">
                {currency} {cost.buffer}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-hub-border/60 pt-2 mt-1">
              <dt className="text-hub-text-secondary">Escrow hold</dt>
              <dd className="font-mono text-hub-accent text-base">
                {currency} {cost.total}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-hub-text-secondary">Your balance</dt>
              <dd className="font-mono text-hub-text-primary">
                {balanceLoading ? (
                  <span
                    aria-label="Loading balance"
                    data-testid="balance-skeleton"
                    className="inline-block h-3 w-16 rounded bg-white/10 animate-pulse"
                  />
                ) : balanceUnknown ? (
                  <span className="text-hub-text-muted">—</span>
                ) : (
                  <span className={isInsufficient ? 'text-amber-400' : 'text-hub-text-primary'}>
                    {currency} {balance}
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {/* Privacy contract reminder */}
          <p className="flex items-start gap-2 text-[11px] text-hub-text-muted leading-relaxed">
            <Shield size={12} className="flex-shrink-0 mt-0.5 text-emerald-400/80" />
            <span>
              工具在出租者本機執行，你只看到結果。對話與檔案僅在這個 session 內可見，不會匯入對方 agent 的長期記憶。
            </span>
          </p>

          {/* Balance state banner */}
          {!balanceLoading && balanceError && (
            <p
              role="alert"
              className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2"
            >
              {balanceError}
            </p>
          )}

          {!balanceLoading && !balanceUnknown && isEmptyPocket && (
            <div
              role="status"
              data-testid="empty-pocket"
              className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5"
            >
              <Wallet size={14} className="flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">你的 credit 餘額是 0。</p>
                <p className="text-amber-200/80 leading-relaxed">
                  Credits are earned by completing agent work — read the provider guide to start.
                </p>
                <a
                  href={`#${TOPUP_PATH}`}
                  className="inline-flex items-center gap-1 text-amber-200 hover:text-amber-100 underline underline-offset-2"
                >
                  Earn credits →
                </a>
              </div>
            </div>
          )}

          {!balanceLoading && !balanceUnknown && !isEmptyPocket && isInsufficient && (
            <div
              role="alert"
              data-testid="insufficient-balance"
              className="flex items-start gap-2 text-xs text-red-200 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2.5"
            >
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-red-300" />
              <div className="space-y-1">
                <p className="font-medium">
                  You need {shortfall} more {currency} to start this session.
                </p>
                <a
                  href={`#${TOPUP_PATH}`}
                  className="inline-flex items-center gap-1 text-red-200 hover:text-red-100 underline underline-offset-2"
                >
                  How to top up →
                </a>
              </div>
            </div>
          )}

          {!balanceLoading && !balanceUnknown && !isInsufficient && (
            <p
              data-testid="sufficient-balance"
              className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2"
            >
              <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                Will hold {cost.total} {currency} in escrow. Unused credits are refunded when the
                session ends.
              </span>
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
            disabled={!canConfirm}
            data-testid="rent-confirm-button"
            aria-disabled={!canConfirm}
            className="inline-flex items-center gap-2 px-4 py-2 bg-hub-accent text-white text-sm font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Creating session…' : `Confirm · ${currency} ${cost.total}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
