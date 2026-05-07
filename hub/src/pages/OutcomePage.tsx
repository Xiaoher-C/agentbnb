/**
 * OutcomePage — Public outcome render at `/o/:share_token`.
 *
 * Backend route: `GET /o/:share_token` (no auth) returns an `OutcomePage`
 * snapshot. Renderer surfaces:
 *   1. Hero — agent + renter avatars, duration, completion status
 *   2. Summary — messages / tasks_done / files / credit_used / credit_refunded
 *   3. Threads — title + status + completion timestamps
 *   4. Rating — stars + comment (renter can submit if missing)
 *   5. Share button — copies the canonical /o/:share_token URL
 *
 * The page is intentionally sharable: no auth required to read, and no PII
 * beyond DIDs is rendered. Anyone with the share token can view.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import {
  Check,
  CheckCircle2,
  Circle,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Star,
  Wallet,
} from 'lucide-react';
import Avatar, { OWNER_AVATAR_PALETTE, RENTER_AVATAR_PALETTE } from '../components/Avatar.js';
import { authedFetch, loadSession } from '../lib/authHeaders.js';

interface OutcomeThread {
  id: string;
  session_id: string;
  title: string;
  description: string;
  status: 'in_progress' | 'completed';
  created_at: string;
  completed_at: string | null;
}

interface OutcomeRating {
  session_id: string;
  rater_did: string;
  rated_agent_id: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment: string;
  created_at: string;
}

interface OutcomePayload {
  generated_at: string;
  summary: {
    messages: number;
    tasks_done: number;
    files: number;
    credit_used: number;
    credit_refunded: number;
    duration_seconds: number;
  };
  threads: OutcomeThread[];
  participants: { did: string; role: string }[];
  rating: OutcomeRating | null;
  share_token: string;
}

function formatDuration(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function shortDid(did: string): string {
  if (did.length <= 14) return did;
  return `${did.slice(0, 8)}…${did.slice(-4)}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/** Render a 1-5 star row, optionally interactive. */
function StarRow({
  stars,
  size = 18,
  interactive = false,
  onChange,
}: {
  stars: number;
  size?: number;
  interactive?: boolean;
  onChange?: (next: 1 | 2 | 3 | 4 | 5) => void;
}): JSX.Element {
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= stars;
        const Cls = filled ? 'text-amber-400 fill-amber-400' : 'text-hub-text-tertiary';
        const inner = <Star size={size} className={Cls} aria-hidden="true" />;
        if (!interactive) {
          return <span key={n}>{inner}</span>;
        }
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange?.(n as 1 | 2 | 3 | 4 | 5)}
            className="rounded p-0.5 hover:bg-white/[0.04]"
            aria-label={`Rate ${n} stars`}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

interface RatingFormProps {
  sessionId: string;
  raterDid: string;
  onSubmitted: () => void;
}

function RatingForm({ sessionId, raterDid, onSubmitted }: RatingFormProps): JSX.Element {
  const [stars, setStars] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rater_did: raterDid, stars, comment: comment.trim() }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Failed to submit rating (${res.status})`);
      }
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit rating');
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, raterDid, stars, comment, onSubmitted]);

  return (
    <form onSubmit={(e) => { void submit(e); }} className="space-y-3">
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wider text-hub-text-muted">Your rating</p>
        <StarRow stars={stars} size={22} interactive onChange={setStars} />
      </div>
      <div>
        <textarea
          value={comment}
          onChange={(e) => { setComment(e.target.value); }}
          placeholder="Share what worked (or didn't). Visible on the public outcome page."
          rows={3}
          className="w-full resize-none rounded-md border border-hub-border-default bg-hub-bg px-3 py-2 text-sm text-hub-text-primary placeholder:text-hub-text-muted focus:border-hub-accent focus:outline-none"
        />
      </div>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-1.5 rounded-md bg-hub-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 transition disabled:opacity-50"
      >
        {submitting ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
        Submit rating
      </button>
    </form>
  );
}

/**
 * Public outcome page — read by share token, optional rating submission.
 */
export default function OutcomePage(): JSX.Element {
  const { share_token: shareToken } = useParams<{ share_token: string }>();
  const [data, setData] = useState<OutcomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Identify the viewer for rating gate. The form only renders when:
  //   - the outcome lacks a rating
  //   - the viewer is signed in
  //   - the viewer's DID matches one of the participants in `renter_*` roles
  const viewerSession = useMemo(() => loadSession(), []);

  const fetchOutcome = useCallback(async (): Promise<void> => {
    if (!shareToken) {
      setError('Missing share token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/o/${encodeURIComponent(shareToken)}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('Outcome not found.');
        throw new Error(`Failed to load outcome (${res.status})`);
      }
      const json = await res.json() as OutcomePayload;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load outcome');
    } finally {
      setLoading(false);
    }
  }, [shareToken]);

  useEffect(() => {
    void fetchOutcome();
  }, [fetchOutcome]);

  const handleCopyShareUrl = useCallback(async (): Promise<void> => {
    try {
      const url = window.location.href;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      // Clipboard may be unavailable in private browsing — silently degrade.
    }
  }, []);

  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-hub-text-secondary">
        <Loader2 size={20} className="mr-2 animate-spin" aria-hidden="true" />
        Loading outcome…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] p-6 text-sm text-rose-300">
        {error ?? 'Outcome not found.'}
      </div>
    );
  }

  const renter = data.participants.find((p) => p.role === 'renter_human');
  const owner = data.participants.find((p) => p.role === 'rented_agent');
  const sessionId = data.threads[0]?.session_id ?? '';
  const viewerIsRenter = !!viewerSession && !!renter && viewerSession.agentId === renter.did;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="rounded-card border border-hub-border-emphasis bg-gradient-to-br from-hub-surface-1 to-hub-surface-0 p-6">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            {renter ? (
              <div className="flex flex-col items-center text-center">
                <Avatar agentId={renter.did} size={56} name="Renter" colors={RENTER_AVATAR_PALETTE} />
                <p className="mt-2 text-[11px] uppercase tracking-wider text-hub-text-muted">租用人</p>
                <p className="font-mono text-[11px] text-hub-text-secondary">{shortDid(renter.did)}</p>
              </div>
            ) : null}
            <div className="text-2xl text-hub-text-tertiary" aria-hidden="true">×</div>
            {owner ? (
              <div className="flex flex-col items-center text-center">
                <Avatar agentId={owner.did} size={56} name="Rented agent" colors={OWNER_AVATAR_PALETTE} />
                <p className="mt-2 text-[11px] uppercase tracking-wider text-hub-text-muted">出租 agent</p>
                <p className="font-mono text-[11px] text-hub-text-secondary">{shortDid(owner.did)}</p>
              </div>
            ) : null}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-hub-text-muted">Rental session outcome</p>
            <h1 className="mt-1 text-2xl font-semibold text-hub-text-primary">
              {formatDuration(data.summary.duration_seconds)} · {data.summary.tasks_done} task{data.summary.tasks_done === 1 ? '' : 's'} done
            </h1>
            <p className="mt-1 text-sm text-hub-text-secondary">
              Completed {fmtDateTime(data.generated_at)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => { void handleCopyShareUrl(); }}
            className="inline-flex items-center gap-1.5 rounded-md border border-hub-border-default bg-white/[0.04] px-3 py-2 text-sm text-hub-text-secondary hover:text-hub-text-primary hover:bg-white/[0.08] transition"
          >
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>
      </section>

      {/* Summary cards */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard icon={<MessageSquare size={14} />} label="Messages" value={data.summary.messages.toString()} />
        <SummaryCard icon={<Sparkles size={14} />} label="Tasks done" value={data.summary.tasks_done.toString()} />
        <SummaryCard icon={<FileText size={14} />} label="Files" value={data.summary.files.toString()} />
        <SummaryCard
          icon={<Wallet size={14} />}
          label="Credits used"
          value={data.summary.credit_used.toString()}
          tone="accent"
        />
        <SummaryCard
          icon={<RefreshCw size={14} />}
          label="Refunded"
          value={data.summary.credit_refunded.toString()}
        />
      </section>

      {/* Threads */}
      <section className="rounded-card border border-hub-border-default bg-hub-surface-0 p-4">
        <h2 className="mb-3 text-sm font-semibold text-hub-text-primary">Threads</h2>
        {data.threads.length === 0 ? (
          <p className="text-sm text-hub-text-muted">No deliverable threads were opened in this session.</p>
        ) : (
          <ul className="space-y-3">
            {data.threads.map((t) => {
              const done = t.status === 'completed';
              return (
                <li
                  key={t.id}
                  className="flex items-start gap-3 rounded-md border border-hub-border-default bg-white/[0.02] p-3"
                >
                  <div className="pt-0.5">
                    {done ? (
                      <CheckCircle2 size={16} className="text-hub-accent" aria-hidden="true" />
                    ) : (
                      <Circle size={16} className="text-hub-text-muted" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${done ? 'text-hub-text-secondary' : 'text-hub-text-primary'}`}>
                      {t.title}
                    </p>
                    {t.description ? (
                      <p className="mt-1 text-xs text-hub-text-muted">{t.description}</p>
                    ) : null}
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-hub-text-muted">
                      <span>Opened {fmtDateTime(t.created_at)}</span>
                      {done && t.completed_at ? <span>· Completed {fmtDateTime(t.completed_at)}</span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Rating */}
      <section className="rounded-card border border-hub-border-default bg-hub-surface-0 p-4">
        <h2 className="mb-3 text-sm font-semibold text-hub-text-primary">Renter rating</h2>
        {data.rating ? (
          <div className="space-y-2">
            <StarRow stars={data.rating.stars} />
            {data.rating.comment ? (
              <p className="text-sm text-hub-text-primary">{data.rating.comment}</p>
            ) : (
              <p className="text-sm text-hub-text-muted">No comment.</p>
            )}
            <p className="text-[11px] text-hub-text-muted">
              By <span className="font-mono">{shortDid(data.rating.rater_did)}</span>
              {' · '}
              {fmtDateTime(data.rating.created_at)}
            </p>
          </div>
        ) : viewerIsRenter && sessionId ? (
          <RatingForm
            sessionId={sessionId}
            raterDid={viewerSession?.agentId ?? ''}
            onSubmitted={() => { void fetchOutcome(); }}
          />
        ) : (
          <p className="text-sm text-hub-text-muted">No rating yet.</p>
        )}
      </section>
    </div>
  );
}

interface SummaryCardProps {
  icon: JSX.Element;
  label: string;
  value: string;
  tone?: 'default' | 'accent';
}

function SummaryCard({ icon, label, value, tone = 'default' }: SummaryCardProps): JSX.Element {
  const toneCls = tone === 'accent'
    ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
    : 'border-hub-border-default bg-hub-surface-0';
  return (
    <div className={`rounded-card border ${toneCls} px-4 py-3`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-hub-text-muted">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold text-hub-text-primary tabular-nums">{value}</p>
    </div>
  );
}
