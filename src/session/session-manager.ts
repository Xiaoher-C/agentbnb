import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  type Session,
  type SessionMessage,
  type SessionConfig,
  type SessionOpenMessage,
  type SessionMessageMessage,
  type SessionEndMessage,
  type SessionEndReason,
  loadSessionConfig,
} from './session-types.js';
import { SessionEscrow } from './session-escrow.js';

/**
 * Options for constructing a SessionManager.
 */
export interface SessionManagerOptions {
  creditDb: Database.Database;
  /** Send a JSON message to an agent identified by connection key. */
  sendToAgent: (agentKey: string, msg: unknown) => void;
  /** Check if an agent is currently connected. */
  isAgentOnline?: (agentKey: string) => boolean;
  /** Override session config (for testing). */
  config?: SessionConfig;
}

/**
 * Manages the lifecycle of agent-to-agent interactive sessions.
 *
 * Runs on the relay side. Handles:
 * - Session open with escrow hold
 * - Message routing between requester and provider
 * - Credit metering (per_message / per_minute / per_session)
 * - Idle and max-duration timeouts
 * - Budget enforcement
 * - Session end and credit settlement
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private durationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private escrow: SessionEscrow;
  private config: SessionConfig;
  private sendToAgent: (agentKey: string, msg: unknown) => void;

  /** Maps agent connection key → set of session IDs they participate in. */
  private agentSessions = new Map<string, Set<string>>();

  constructor(opts: SessionManagerOptions) {
    this.escrow = new SessionEscrow(opts.creditDb);
    this.config = opts.config ?? loadSessionConfig();
    this.sendToAgent = opts.sendToAgent;
    // opts.isAgentOnline reserved for future online-check guard before message dispatch
  }

  /**
   * Open a new session between requester and provider.
   */
  openSession(msg: SessionOpenMessage, requesterKey: string): Session {
    // Check concurrent session limit
    const requesterSessions = this.agentSessions.get(requesterKey);
    if (requesterSessions && requesterSessions.size >= this.config.abuse.max_concurrent_sessions_per_agent) {
      this.sendToAgent(requesterKey, {
        type: 'session_error',
        session_id: msg.session_id,
        code: 'MAX_CONCURRENT_SESSIONS',
        message: `Maximum concurrent sessions (${this.config.abuse.max_concurrent_sessions_per_agent}) reached`,
      });
      throw new Error('Max concurrent sessions reached');
    }

    // Hold escrow for full budget
    const escrowId = this.escrow.holdBudget(msg.requester_id, msg.budget, msg.card_id);

    const now = new Date().toISOString();
    const session: Session = {
      id: msg.session_id,
      requester_id: msg.requester_id,
      provider_id: msg.provider_id,
      skill_id: msg.skill_id,
      card_id: msg.card_id,
      status: 'open',
      escrow_id: escrowId,
      budget: msg.budget,
      spent: 0,
      pricing_model: msg.pricing_model,
      messages: [],
      created_at: now,
      updated_at: now,
    };

    this.sessions.set(session.id, session);
    this.trackAgentSession(requesterKey, session.id);
    this.trackAgentSession(msg.provider_id, session.id);

    // Send ack to requester
    this.sendToAgent(requesterKey, {
      type: 'session_ack',
      session_id: session.id,
      escrow_id: escrowId,
      status: 'open',
    });

    // Forward initial message to provider
    const initialMsg = this.createMessage(session.id, 'requester', msg.initial_message);
    session.messages.push(initialMsg);
    session.status = 'active';
    session.updated_at = new Date().toISOString();

    this.sendToAgent(msg.provider_id, {
      type: 'session_message',
      session_id: session.id,
      sender: 'requester',
      content: msg.initial_message,
    });

    // For per_session pricing, charge the flat rate immediately
    if (session.pricing_model === 'per_session') {
      const cost = this.config.pricing.per_session_flat_rate;
      this.escrow.deductMessage(escrowId, cost);
      session.spent = cost;
    }

    // Start timers
    this.resetIdleTimer(session.id);
    this.startDurationTimer(session.id);

    return session;
  }

  /**
   * Route a message within an active session.
   */
  routeMessage(msg: SessionMessageMessage, senderKey: string): void {
    const session = this.sessions.get(msg.session_id);
    if (!session) {
      this.sendToAgent(senderKey, {
        type: 'session_error',
        session_id: msg.session_id,
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      });
      return;
    }

    if (session.status !== 'active') {
      this.sendToAgent(senderKey, {
        type: 'session_error',
        session_id: msg.session_id,
        code: 'SESSION_NOT_ACTIVE',
        message: `Session is ${session.status}, not active`,
      });
      return;
    }

    // Check message limit
    if (session.messages.length >= this.config.pricing.max_messages_per_session) {
      this.endSessionInternal(session, 'budget_exhausted');
      return;
    }

    // Per-message cost (charged on provider reply)
    if (session.pricing_model === 'per_message' && msg.sender === 'provider') {
      const rate = this.config.pricing.per_message_base_rate;
      const { remaining } = this.escrow.deductMessage(session.escrow_id, rate);
      session.spent += rate;

      if (remaining <= 0) {
        // Record the message first, then end
        const record = this.createMessage(session.id, msg.sender, msg.content, msg.metadata);
        session.messages.push(record);
        session.updated_at = new Date().toISOString();

        // Forward the last message before ending
        const targetKey = this.getCounterpartyKey(session, msg.sender);
        this.sendToAgent(targetKey, {
          type: 'session_message',
          session_id: session.id,
          sender: msg.sender,
          content: msg.content,
          metadata: msg.metadata,
        });

        this.endSessionInternal(session, 'budget_exhausted');
        return;
      }
    }

    // Record message
    const record = this.createMessage(session.id, msg.sender, msg.content, msg.metadata);
    session.messages.push(record);
    session.updated_at = new Date().toISOString();

    // Forward to counterparty
    const targetKey = this.getCounterpartyKey(session, msg.sender);
    this.sendToAgent(targetKey, {
      type: 'session_message',
      session_id: session.id,
      sender: msg.sender,
      content: msg.content,
      metadata: msg.metadata,
    });

    // Reset idle timer
    this.resetIdleTimer(session.id);
  }

  /**
   * End a session at the request of either party.
   */
  endSession(msg: SessionEndMessage, _senderKey: string): void {
    const session = this.sessions.get(msg.session_id);
    if (!session) return;
    if (session.status === 'settled' || session.status === 'closed') return;

    this.endSessionInternal(session, msg.reason as SessionEndReason);
  }

  /**
   * Handle agent disconnection — end all their active sessions.
   */
  handleDisconnect(agentKey: string): void {
    const sessionIds = this.agentSessions.get(agentKey);
    if (!sessionIds) return;

    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session && session.status !== 'settled' && session.status !== 'closed') {
        this.endSessionInternal(session, 'error');
      }
    }
  }

  /** Get a session by ID. */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** List sessions, optionally filtered by agent. */
  listSessions(agentId?: string): Session[] {
    if (!agentId) return Array.from(this.sessions.values());
    return Array.from(this.sessions.values()).filter(
      (s) => s.requester_id === agentId || s.provider_id === agentId,
    );
  }

  /** Clean up all timers (for graceful shutdown). */
  shutdown(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    for (const timer of this.durationTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    this.durationTimers.clear();
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private endSessionInternal(session: Session, reason: SessionEndReason): void {
    session.status = 'closing';
    session.end_reason = reason;
    session.ended_at = new Date().toISOString();

    // Clear timers
    this.clearTimers(session.id);

    // Settle credits
    if (session.spent > 0) {
      this.escrow.settle(session.escrow_id, session.provider_id);
    } else {
      this.escrow.refund(session.escrow_id);
    }

    const durationMs = Date.now() - new Date(session.created_at).getTime();
    const settledMsg = {
      type: 'session_settled' as const,
      session_id: session.id,
      total_cost: session.spent,
      messages_count: session.messages.length,
      duration_seconds: Math.round(durationMs / 1000),
      refunded: session.budget - session.spent,
    };

    session.status = 'settled';
    session.updated_at = new Date().toISOString();

    // Notify both parties
    this.sendToAgent(session.requester_id, settledMsg);
    this.sendToAgent(session.provider_id, settledMsg);

    // Mark closed and clean up
    session.status = 'closed';
    this.untrackAgentSession(session.requester_id, session.id);
    this.untrackAgentSession(session.provider_id, session.id);
  }

  private resetIdleTimer(sessionId: string): void {
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session && session.status === 'active') {
        this.endSessionInternal(session, 'timeout');
      }
    }, this.config.timeouts.idle_timeout_ms);

    this.idleTimers.set(sessionId, timer);
  }

  private startDurationTimer(sessionId: string): void {
    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session && session.status !== 'settled' && session.status !== 'closed') {
        this.endSessionInternal(session, 'timeout');
      }
    }, this.config.timeouts.max_session_duration_ms);

    this.durationTimers.set(sessionId, timer);
  }

  private clearTimers(sessionId: string): void {
    const idle = this.idleTimers.get(sessionId);
    if (idle) { clearTimeout(idle); this.idleTimers.delete(sessionId); }
    const dur = this.durationTimers.get(sessionId);
    if (dur) { clearTimeout(dur); this.durationTimers.delete(sessionId); }
  }

  private createMessage(
    sessionId: string,
    sender: 'requester' | 'provider',
    content: string,
    metadata?: SessionMessage['metadata'],
  ): SessionMessage {
    return {
      id: randomUUID(),
      session_id: sessionId,
      sender,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };
  }

  private getCounterpartyKey(session: Session, sender: 'requester' | 'provider'): string {
    return sender === 'requester' ? session.provider_id : session.requester_id;
  }

  private trackAgentSession(agentKey: string, sessionId: string): void {
    let set = this.agentSessions.get(agentKey);
    if (!set) { set = new Set(); this.agentSessions.set(agentKey, set); }
    set.add(sessionId);
  }

  private untrackAgentSession(agentKey: string, sessionId: string): void {
    const set = this.agentSessions.get(agentKey);
    if (set) { set.delete(sessionId); if (set.size === 0) this.agentSessions.delete(agentKey); }
  }
}
