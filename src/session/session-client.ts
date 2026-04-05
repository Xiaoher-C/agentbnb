import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import type {
  Session,
  SessionMessage,
  SessionAckMessage,
  SessionSettledMessage,
  SessionPricingModel,
} from './session-types.js';

/**
 * Options for opening a session.
 */
export interface SessionOpenOptions {
  providerId: string;
  cardId: string;
  skillId: string;
  budget: number;
  initialMessage: string;
  pricingModel?: SessionPricingModel;
}

/**
 * Requester-side session client.
 *
 * Provides a high-level API over the WebSocket relay for opening, messaging,
 * and ending interactive sessions with provider agents.
 */
export class SessionClient {
  /** Active message listeners keyed by session_id. */
  private messageListeners = new Map<string, Array<(msg: SessionMessage) => void>>();
  /** One-time response waiters keyed by session_id. */
  private responseWaiters = new Map<string, Array<(msg: unknown) => void>>();
  /** Cleanup handler for the WS listener. */
  private wsListener: ((data: WebSocket.Data) => void) | null = null;

  constructor(
    private ws: WebSocket,
    private agentId: string,
  ) {
    this.setupWsListener();
  }

  /**
   * Open a new session with a provider.
   * Returns after receiving session_ack from the relay.
   */
  async open(opts: SessionOpenOptions): Promise<{ sessionId: string; escrowId: string }> {
    const sessionId = randomUUID();

    this.ws.send(JSON.stringify({
      type: 'session_open',
      session_id: sessionId,
      requester_id: this.agentId,
      provider_id: opts.providerId,
      card_id: opts.cardId,
      skill_id: opts.skillId,
      budget: opts.budget,
      pricing_model: opts.pricingModel ?? 'per_message',
      initial_message: opts.initialMessage,
    }));

    // Wait for session_ack
    const ack = await this.waitForMessage<SessionAckMessage>(
      sessionId,
      'session_ack',
      30_000,
    );

    return { sessionId: ack.session_id, escrowId: ack.escrow_id };
  }

  /**
   * Send a message within an active session.
   * Does not wait for provider reply — use onMessage() to listen.
   */
  send(sessionId: string, content: string): void {
    this.ws.send(JSON.stringify({
      type: 'session_message',
      session_id: sessionId,
      sender: 'requester',
      content,
    }));
  }

  /**
   * Send a message and wait for the provider's reply.
   */
  async sendAndWait(sessionId: string, content: string, timeoutMs = 90_000): Promise<string> {
    this.send(sessionId, content);
    const reply = await this.waitForMessage<{ content: string }>(
      sessionId,
      'session_message',
      timeoutMs,
    );
    return reply.content;
  }

  /**
   * End a session.
   * Returns the settlement details after the relay confirms.
   */
  async end(sessionId: string, reason: string = 'completed'): Promise<SessionSettledMessage> {
    this.ws.send(JSON.stringify({
      type: 'session_end',
      session_id: sessionId,
      reason,
    }));

    return this.waitForMessage<SessionSettledMessage>(
      sessionId,
      'session_settled',
      30_000,
    );
  }

  /**
   * Register a listener for incoming session messages.
   */
  onMessage(sessionId: string, callback: (msg: SessionMessage) => void): void {
    let listeners = this.messageListeners.get(sessionId);
    if (!listeners) {
      listeners = [];
      this.messageListeners.set(sessionId, listeners);
    }
    listeners.push(callback);
  }

  /**
   * Remove all listeners for a session.
   */
  removeListeners(sessionId: string): void {
    this.messageListeners.delete(sessionId);
    this.responseWaiters.delete(sessionId);
  }

  /**
   * Clean up the WebSocket listener.
   */
  destroy(): void {
    if (this.wsListener) {
      this.ws.removeListener('message', this.wsListener);
      this.wsListener = null;
    }
    this.messageListeners.clear();
    this.responseWaiters.clear();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private setupWsListener(): void {
    this.wsListener = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.session_id) return;

        // Dispatch to one-time response waiters
        const waiters = this.responseWaiters.get(`${msg.session_id}:${msg.type}`);
        if (waiters && waiters.length > 0) {
          const waiter = waiters.shift()!;
          waiter(msg);
          if (waiters.length === 0) {
            this.responseWaiters.delete(`${msg.session_id}:${msg.type}`);
          }
        }

        // Dispatch to message listeners (for session_message type)
        if (msg.type === 'session_message' && msg.sender === 'provider') {
          const listeners = this.messageListeners.get(msg.session_id);
          if (listeners) {
            for (const cb of listeners) cb(msg as SessionMessage);
          }
        }

        // Also dispatch session_settled to message listeners
        if (msg.type === 'session_settled') {
          const listeners = this.messageListeners.get(msg.session_id);
          if (listeners) {
            for (const cb of listeners) cb(msg as unknown as SessionMessage);
          }
        }
      } catch {
        // Ignore non-JSON or non-session messages
      }
    };
    this.ws.on('message', this.wsListener);
  }

  private waitForMessage<T>(sessionId: string, type: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const key = `${sessionId}:${type}`;
      let waiters = this.responseWaiters.get(key);
      if (!waiters) {
        waiters = [];
        this.responseWaiters.set(key, waiters);
      }

      const timer = setTimeout(() => {
        // Remove this waiter on timeout
        const arr = this.responseWaiters.get(key);
        if (arr) {
          const idx = arr.indexOf(waiter);
          if (idx >= 0) arr.splice(idx, 1);
        }
        reject(new Error(`Timeout waiting for ${type} on session ${sessionId}`));
      }, timeoutMs);

      const waiter = (msg: unknown) => {
        clearTimeout(timer);
        resolve(msg as T);
      };

      waiters.push(waiter);
    });
  }
}
