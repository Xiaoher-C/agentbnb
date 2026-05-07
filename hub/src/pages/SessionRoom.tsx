/**
 * SessionRoom — Live rental session UI at `/s/:id`.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Status bar: timer · participants · escrow · End session │
 *   ├──────────────────────────────────┬──────────────────────┤
 *   │ Conversation (scrollable)         │ Participants panel   │
 *   │                                   │ Threads panel        │
 *   ├──────────────────────────────────┴──────────────────────┤
 *   │ Mode toggle (透過我的 agent ↔ 直接和出租 agent 對話)        │
 *   │ MessageComposer                                         │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Privacy contract (ADR-024): the WebSocket open payload includes
 * `session_mode: true`. This is enforced inside `useSessionWebSocket` so
 * `request_log` skips persistence on the relay side. See
 * `src/session/privacy.test.ts`.
 *
 * Mode toggle copy is intentionally Chinese — `direct` / `proxy` strings are
 * NEVER surfaced to the user.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Loader2, LogOut, Users, Wallet } from 'lucide-react';
import { authedFetch } from '../lib/authHeaders.js';
import { useSessionWebSocket } from '../hooks/useSessionWebSocket.js';
import SessionMessage from '../components/SessionMessage.js';
import MessageComposer from '../components/MessageComposer.js';
import SessionTimer from '../components/SessionTimer.js';
import ParticipantsPanel from '../components/ParticipantsPanel.js';
import ThreadList from '../components/ThreadList.js';

/** Session metadata shape returned by `GET /api/sessions/:id`. */
interface SessionDTO {
  id: string;
  renter_did: string;
  owner_did: string;
  agent_id: string;
  status: 'open' | 'active' | 'paused' | 'closing' | 'settled' | 'closed';
  duration_min: number;
  budget_credits: number;
  spent_credits: number;
  current_mode: 'direct' | 'proxy';
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  share_token: string | null;
  participants: { did: string; role: 'renter_human' | 'renter_agent' | 'rented_agent' | 'human_observer' }[];
  threads: {
    id: string;
    session_id: string;
    title: string;
    description: string;
    status: 'in_progress' | 'completed';
    created_at: string;
    completed_at: string | null;
  }[];
}

interface EndSessionResponse {
  session_id: string;
  outcome: { share_token: string };
}

/**
 * Read the session metadata once on mount.
 *
 * If the session id isn't found in the URL or the API call fails, the page
 * surfaces an error state. We don't try to reconstruct a session from query
 * params — the resource must already exist.
 */
function useSessionMetadata(sessionId: string | undefined): {
  data: SessionDTO | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<SessionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('Session not found.');
        throw new Error(`Failed to load session (${res.status})`);
      }
      const json = await res.json() as SessionDTO;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce]);

  return { data, loading, error, refetch: fetchOnce };
}

/**
 * SessionRoom — main page for a live rental session.
 */
export default function SessionRoom(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sessionId = id ?? '';
  const { data: session, loading, error, refetch } = useSessionMetadata(sessionId);

  const [mode, setMode] = useState<'direct' | 'proxy'>('proxy');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  // Mirror the server's current_mode into local state once it arrives
  useEffect(() => {
    if (session?.current_mode) {
      setMode(session.current_mode);
    }
  }, [session?.current_mode]);

  // Open the WebSocket once we have session metadata
  const ws = useSessionWebSocket(sessionId, {
    renterDid: session?.renter_did ?? '',
    ownerDid: session?.owner_did ?? '',
    cardId: `rental:${session?.agent_id ?? sessionId}`,
    skillId: session?.agent_id ?? '',
    budget: session?.budget_credits ?? 0,
    mode,
    initialMessage: 'Session started.',
  });

  // -------------------------------------------------------------------------
  // Auto-scroll the conversation to the latest message
  // -------------------------------------------------------------------------
  const conversationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = conversationRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [ws.messages.length]);

  // -------------------------------------------------------------------------
  // Thread + end-session handlers
  // -------------------------------------------------------------------------
  const createThread = useCallback(async (input: { title: string; description: string }): Promise<void> => {
    const res = await authedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Failed to open thread (${res.status})`);
    }
    await refetch();
  }, [sessionId, refetch]);

  const completeThread = useCallback(async (threadId: string): Promise<void> => {
    const res = await authedFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/threads/${encodeURIComponent(threadId)}/complete`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Failed to complete thread (${res.status})`);
    }
    await refetch();
  }, [sessionId, refetch]);

  const endSessionAndNavigate = useCallback(async (): Promise<void> => {
    setEndingSession(true);
    setEndError(null);
    try {
      // Relay first (live escrow settle), then REST (outcome persist + share token).
      ws.endSession('completed');
      const res = await authedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ end_reason: 'completed' }),
      });
      if (!res.ok && res.status !== 409) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Failed to end session (${res.status})`);
      }
      let shareToken = session?.share_token ?? '';
      if (res.ok) {
        const data = await res.json() as EndSessionResponse;
        shareToken = data.outcome?.share_token ?? shareToken;
      }
      if (shareToken) {
        navigate(`/o/${encodeURIComponent(shareToken)}`);
      } else {
        await refetch();
      }
    } catch (err) {
      setEndError(err instanceof Error ? err.message : 'Failed to end session');
    } finally {
      setEndingSession(false);
      setConfirmEnd(false);
    }
  }, [sessionId, ws, session?.share_token, navigate, refetch]);

  // Mode toggle copy is intentionally Chinese — `direct` / `proxy` strings are
  // never surfaced to the user (ADR-024 / spec).
  const modeToggle = (
    <div className="inline-flex items-center rounded-full border border-hub-border-default bg-hub-surface-0 p-1 text-xs">
      <button
        type="button"
        onClick={() => { setMode('proxy'); }}
        className={`rounded-full px-3 py-1 transition ${
          mode === 'proxy'
            ? 'bg-hub-accent/20 text-hub-accent'
            : 'text-hub-text-secondary hover:text-hub-text-primary'
        }`}
      >
        透過我的 agent
      </button>
      <button
        type="button"
        onClick={() => { setMode('direct'); }}
        className={`rounded-full px-3 py-1 transition ${
          mode === 'direct'
            ? 'bg-amber-500/20 text-amber-300'
            : 'text-hub-text-secondary hover:text-hub-text-primary'
        }`}
      >
        直接和出租 agent 對話
      </button>
    </div>
  );

  if (!sessionId) {
    return (
      <div className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] p-6 text-sm text-rose-300">
        Missing session id.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-hub-text-secondary">
        <Loader2 size={20} className="mr-2 animate-spin" aria-hidden="true" />
        Loading session…
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] p-6 text-sm text-rose-300">
        {error ?? 'Session not found.'}
      </div>
    );
  }

  const isClosed = session.status === 'closed' || session.status === 'settled' || ws.ended;
  const onlineDids = ws.status === 'open' ? [session.renter_did] : [];

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <header className="flex flex-wrap items-center gap-3 rounded-card border border-hub-border-default bg-hub-surface-0 px-4 py-3">
        <SessionTimer
          startedAt={session.started_at ?? session.created_at}
          durationMin={session.duration_min}
        />
        <div className="inline-flex items-center gap-1.5 rounded-full border border-hub-border-default bg-white/[0.04] px-3 py-1.5 text-xs text-hub-text-secondary">
          <Users size={12} aria-hidden="true" />
          {ws.participants.length} participants
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-hub-border-default bg-white/[0.04] px-3 py-1.5 text-xs text-hub-text-secondary">
          <Wallet size={12} aria-hidden="true" />
          <span className="font-mono">{session.spent_credits}</span>
          <span className="text-hub-text-muted">/ {session.budget_credits} cr</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {ws.status === 'reconnecting' ? (
            <span className="text-xs text-amber-400">Reconnecting…</span>
          ) : null}
          {!isClosed ? (
            <button
              type="button"
              onClick={() => { setConfirmEnd(true); }}
              disabled={endingSession}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition disabled:opacity-50"
            >
              <LogOut size={12} aria-hidden="true" />
              End session
            </button>
          ) : (
            <span className="text-xs text-hub-text-muted">Session ended</span>
          )}
        </div>
      </header>

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Conversation */}
        <section className="flex min-h-[480px] flex-col rounded-card border border-hub-border-default bg-hub-surface-0">
          <div
            ref={conversationRef}
            className="flex-1 overflow-y-auto p-4 space-y-3"
          >
            {ws.messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-hub-text-muted">
                Waiting for the rented agent…
              </div>
            ) : (
              ws.messages.map((m) => (
                <SessionMessage key={m.id} message={m} />
              ))
            )}
          </div>

          {/* Mode toggle + composer */}
          <div className="border-t border-hub-border-default p-3 space-y-2">
            <div className="flex items-center justify-between">
              {modeToggle}
              <p className="text-[11px] text-hub-text-muted">
                {mode === 'proxy'
                  ? '你的 agent 會代你和出租 agent 溝通'
                  : '你會直接和出租 agent 對話（會被標記為 human intervention）'}
              </p>
            </div>
            <MessageComposer
              sessionId={sessionId}
              callerDid={session.renter_did}
              disabled={isClosed || ws.status !== 'open'}
              isHumanInterventionMode={mode === 'direct'}
              onSend={(content, attachments) => {
                ws.sendMessage(content, {
                  isHumanIntervention: mode === 'direct',
                  attachments: attachments.map(a => a.id),
                });
              }}
            />
          </div>
        </section>

        {/* Right rail */}
        <aside className="space-y-3">
          <ParticipantsPanel participants={ws.participants} onlineDids={onlineDids} />
          <ThreadList
            threads={session.threads}
            onCreate={createThread}
            onComplete={completeThread}
            readOnly={isClosed}
          />
        </aside>
      </div>

      {/* End session confirm modal */}
      {confirmEnd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-session-title"
        >
          <div className="w-full max-w-md rounded-modal border border-hub-border-emphasis bg-hub-surface-1 p-5">
            <h2 id="end-session-title" className="text-base font-semibold text-hub-text-primary">
              End this session?
            </h2>
            <p className="mt-2 text-sm text-hub-text-secondary">
              The session will be settled and an outcome page will be generated.
              Unspent credits ({Math.max(0, session.budget_credits - session.spent_credits)} cr) will be refunded.
            </p>
            {endError ? (
              <p className="mt-2 text-xs text-rose-400">{endError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setConfirmEnd(false); setEndError(null); }}
                disabled={endingSession}
                className="rounded-md border border-hub-border-default px-3 py-1.5 text-xs text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void endSessionAndNavigate(); }}
                disabled={endingSession}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 transition disabled:opacity-50"
              >
                {endingSession ? (
                  <>
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                    Ending…
                  </>
                ) : (
                  <>
                    <LogOut size={12} aria-hidden="true" />
                    End session
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
