/**
 * useSessionWebSocket — Hub-side WebSocket hook for v10 rental session rooms.
 *
 * Connects to the AgentBnB relay (`/ws`) and exchanges session messages over
 * the Zod schemas defined in `src/relay/types.ts`. Mirrors the bootstrap
 * sequence used by `src/cli/session-action.ts` (register → session_open →
 * session_message stream → session_end).
 *
 * Privacy contract (ADR-024 — three-layer enforcement):
 *   `session_mode: true` is set on the registration payload so the relay-side
 *   `request_log` skip path is taken (verified by `src/session/privacy.test.ts`).
 *   The hook itself NEVER persists message content — messages live only in
 *   React state, are dropped on unmount, and the renter's browser is the
 *   only client-side memory of the conversation.
 *
 * Reconnect strategy: exponential backoff capped at 10s, max 8 attempts.
 *
 * NOTE: this is a thin client. Authoritative session lifecycle (escrow, mode,
 * thread state) lives on the relay. The hook mirrors what the server sends.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Lightweight participant view returned by the hook (DID + role). */
export interface SessionParticipantView {
  did: string;
  role: 'renter_human' | 'renter_agent' | 'rented_agent' | 'human_observer';
}

/** Lightweight message view rendered in the SessionRoom. */
export interface SessionMessageView {
  id: string;
  sender: 'requester' | 'provider';
  sender_did?: string;
  sender_role?: SessionParticipantView['role'];
  content: string;
  timestamp: string;
  thread_id?: string | null;
  is_human_intervention?: boolean;
}

/** Connection state surfaced to the UI. */
export type SessionWebSocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

/** Settled payload (returned in session_settled). */
export interface SessionSettlement {
  total_cost: number;
  messages_count: number;
  duration_seconds: number;
  refunded: number;
}

/** Hook configuration. */
export interface UseSessionWebSocketOptions {
  /** Relay URL (e.g. `ws://localhost:7777/ws`). If omitted, derives from window.location. */
  relayUrl?: string;
  /** Renter DID — used as the relay register `owner` and surfaced as session opener. */
  renterDid: string;
  /** Owner / rented-agent DID — used as `provider_id` on session_open. */
  ownerDid: string;
  /** Capability card id (or `rental:<agent_id>` synthetic id when not card-bound). */
  cardId: string;
  /** Skill / agent id. v10 uses agent_id here, since rentals are agent-scoped. */
  skillId: string;
  /** Budget in credits — passed as session_open.budget. */
  budget: number;
  /** Initial mode — UI labels: 「透過我的 agent」 (proxy) or 「直接和出租 agent 對話」 (direct). */
  mode: 'direct' | 'proxy';
  /** Optional initial message used to bootstrap the session. */
  initialMessage?: string;
}

/** Hook return value. */
export interface UseSessionWebSocketResult {
  status: SessionWebSocketStatus;
  messages: SessionMessageView[];
  participants: SessionParticipantView[];
  ended: boolean;
  settled: SessionSettlement | null;
  error: string | null;
  /** Send a message in the current session. No-op if socket isn't open. */
  sendMessage: (
    content: string,
    opts?: { threadId?: string | null; isHumanIntervention?: boolean; attachments?: string[] },
  ) => void;
  /** Switch interaction mode mid-session. */
  changeMode: (mode: 'direct' | 'proxy') => void;
  /** End the session locally + remotely. */
  endSession: (reason?: 'completed' | 'cancelled') => void;
}

/** Reconnect schedule (ms). Cap at 10s, max 8 attempts. */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 10_000, 10_000, 10_000];

/** Build a relay URL from the current page origin. */
function defaultRelayUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:7777/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/** Generate a stable id for messages we receive (server messages may lack ids). */
function genMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * React hook that owns the relay WebSocket lifecycle for a single session.
 *
 * The session id is the source of truth — it identifies both the relay
 * subscription and the REST resource (`GET /api/sessions/:id`). Pass it as
 * the first arg.
 */
export function useSessionWebSocket(
  sessionId: string,
  options: UseSessionWebSocketOptions,
): UseSessionWebSocketResult {
  const {
    relayUrl,
    renterDid,
    ownerDid,
    cardId,
    skillId,
    budget,
    mode,
    initialMessage,
  } = options;

  const [status, setStatus] = useState<SessionWebSocketStatus>('idle');
  const [messages, setMessages] = useState<SessionMessageView[]>([]);
  const [participants, setParticipants] = useState<SessionParticipantView[]>([
    { did: renterDid, role: 'renter_human' },
    { did: ownerDid, role: 'rented_agent' },
  ]);
  const [ended, setEnded] = useState(false);
  const [settled, setSettled] = useState<SessionSettlement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);
  const sessionOpenSentRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Forward-declared connect ref so reconnect schedule can reach the latest `connect`. */
  const connectRef = useRef<() => void>(() => {});
  /** Mirrors `ended` so the close handler reads the latest value without stale closure. */
  const endedRef = useRef(false);
  useEffect(() => { endedRef.current = ended; }, [ended]);

  const url = useMemo(() => relayUrl ?? defaultRelayUrl(), [relayUrl]);

  /** Append an incoming message to local state. */
  const pushIncoming = useCallback((raw: Record<string, unknown>): void => {
    const sender = raw.sender === 'provider' ? 'provider' : 'requester';
    const content = typeof raw.content === 'string' ? raw.content : '';
    if (!content) return;
    const next: SessionMessageView = {
      id: typeof raw.id === 'string' ? raw.id : genMessageId(),
      sender,
      sender_did: typeof raw.sender_did === 'string' ? raw.sender_did : undefined,
      sender_role: typeof raw.sender_role === 'string'
        ? raw.sender_role as SessionParticipantView['role']
        : (sender === 'provider' ? 'rented_agent' : 'renter_human'),
      content,
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString(),
      thread_id: typeof raw.thread_id === 'string' ? raw.thread_id : null,
      is_human_intervention: raw.is_human_intervention === true,
    };
    setMessages(prev => [...prev, next]);
  }, []);

  /** Wire socket message handling. */
  const wireSocket = useCallback((ws: WebSocket): void => {
    ws.onmessage = (event: MessageEvent): void => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(typeof event.data === 'string' ? event.data : '{}') as Record<string, unknown>;
      } catch {
        return;
      }

      // Defensive: relay already filters by session subscription.
      if (parsed.session_id && parsed.session_id !== sessionId) return;

      const t = parsed.type;
      switch (t) {
        case 'registered': {
          if (!sessionOpenSentRef.current) {
            sessionOpenSentRef.current = true;
            ws.send(JSON.stringify({
              type: 'session_open',
              session_id: sessionId,
              requester_id: renterDid,
              provider_id: ownerDid,
              card_id: cardId,
              skill_id: skillId,
              budget,
              pricing_model: 'per_message',
              initial_message: initialMessage ?? '(rental session opened)',
              session_mode: true, // ADR-024 privacy contract
            }));
          }
          break;
        }
        case 'session_ack':
          setStatus('open');
          break;
        case 'session_message':
          pushIncoming(parsed);
          break;
        case 'session_settled':
          setSettled({
            total_cost: typeof parsed.total_cost === 'number' ? parsed.total_cost : 0,
            messages_count: typeof parsed.messages_count === 'number' ? parsed.messages_count : 0,
            duration_seconds: typeof parsed.duration_seconds === 'number' ? parsed.duration_seconds : 0,
            refunded: typeof parsed.refunded === 'number' ? parsed.refunded : 0,
          });
          setEnded(true);
          break;
        case 'session_error':
          setError(typeof parsed.message === 'string' ? parsed.message : 'Session error');
          break;
        case 'session_thread_open':
        case 'session_thread_complete':
        case 'session_mode_change':
          // Reflected via REST refetch in the page, not in-hook.
          break;
        default:
          break;
      }
    };

    ws.onerror = (): void => {
      setStatus('error');
    };

    ws.onclose = (): void => {
      wsRef.current = null;
      sessionOpenSentRef.current = false;
      if (cancelledRef.current || endedRef.current) {
        setStatus('closed');
        return;
      }
      const idx = Math.min(attemptRef.current, RECONNECT_DELAYS_MS.length - 1);
      const delay = RECONNECT_DELAYS_MS[idx];
      attemptRef.current += 1;
      if (attemptRef.current > RECONNECT_DELAYS_MS.length) {
        setStatus('closed');
        setError('Connection lost — please refresh.');
        return;
      }
      setStatus('reconnecting');
      reconnectTimerRef.current = setTimeout(() => {
        connectRef.current();
      }, delay);
    };
  }, [sessionId, renterDid, ownerDid, cardId, skillId, budget, initialMessage, pushIncoming]);

  /** Open a fresh socket and trigger the register → session_open handshake. */
  const connect = useCallback((): void => {
    if (cancelledRef.current) return;
    setStatus('connecting');
    setError(null);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'WebSocket failed to construct');
      return;
    }
    wsRef.current = ws;

    ws.onopen = (): void => {
      attemptRef.current = 0;
      // Stub card keeps the relay's register schema happy; the session is
      // identified by session_id, not by this card.
      ws.send(JSON.stringify({
        type: 'register',
        owner: renterDid,
        agent_id: renterDid,
        token: 'hub-session-client',
        card: {
          id: `hub-session-${sessionId}`,
          owner: renterDid,
          name: 'hub-session-client',
        },
      }));
    };

    wireSocket(ws);
  }, [url, renterDid, sessionId, wireSocket]);

  // Keep connectRef pointing at the latest connect closure for the reconnect schedule.
  useEffect(() => { connectRef.current = connect; }, [connect]);

  // -------------------------------------------------------------------------
  // Lifecycle: open on mount once DIDs are known; close on unmount.
  // -------------------------------------------------------------------------
  const canConnect = !!sessionId && !!renterDid && !!ownerDid;
  useEffect(() => {
    cancelledRef.current = false;
    if (!canConnect) return;
    connect();
    return () => {
      cancelledRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
    // connect is captured via connectRef; re-run only when canConnect flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, canConnect]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  const sendMessage = useCallback((
    content: string,
    opts?: { threadId?: string | null; isHumanIntervention?: boolean; attachments?: string[] },
  ): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Allow attachment-only messages (no text body).
    const hasContent = content.trim().length > 0;
    const hasAttachments = (opts?.attachments?.length ?? 0) > 0;
    if (!hasContent && !hasAttachments) return;
    const payload: Record<string, unknown> = {
      type: 'session_message',
      session_id: sessionId,
      sender: 'requester',
      content,
    };
    if (opts?.threadId) payload.thread_id = opts.threadId;
    if (opts?.isHumanIntervention) payload.is_human_intervention = true;
    if (hasAttachments) payload.attachments = opts!.attachments;
    ws.send(JSON.stringify(payload));

    // Optimistically reflect outbound message in local state
    setMessages(prev => [
      ...prev,
      {
        id: genMessageId(),
        sender: 'requester',
        sender_did: renterDid,
        sender_role: opts?.isHumanIntervention ? 'renter_human' : 'renter_agent',
        content,
        timestamp: new Date().toISOString(),
        thread_id: opts?.threadId ?? null,
        is_human_intervention: opts?.isHumanIntervention === true,
      },
    ]);
  }, [sessionId, renterDid]);

  const changeMode = useCallback((nextMode: 'direct' | 'proxy'): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'session_mode_change',
      session_id: sessionId,
      mode: nextMode,
    }));
  }, [sessionId]);

  const endSession = useCallback((reason: 'completed' | 'cancelled' = 'completed'): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'session_end',
        session_id: sessionId,
        reason,
      }));
    }
    setEnded(true);
  }, [sessionId]);

  // Keep participants list in sync when the renter/owner DIDs change.
  useEffect(() => {
    setParticipants([
      { did: renterDid, role: 'renter_human' },
      { did: ownerDid, role: 'rented_agent' },
    ]);
  }, [renterDid, ownerDid]);

  // Broadcast mode toggles to the relay, but only after the session is open
  // and only when `mode` actually changes (avoid duplicate frames on every
  // status flip / reconnect).
  const lastBroadcastModeRef = useRef<'direct' | 'proxy' | null>(null);
  useEffect(() => {
    if (status !== 'open') return;
    if (lastBroadcastModeRef.current === mode) return;
    lastBroadcastModeRef.current = mode;
    changeMode(mode);
  }, [mode, status, changeMode]);

  return {
    status,
    messages,
    participants,
    ended,
    settled,
    error,
    sendMessage,
    changeMode,
    endSession,
  };
}
