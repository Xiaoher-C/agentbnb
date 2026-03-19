import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { insertCard, getCard, updateCard } from '../registry/store.js';
import { insertRequestLog } from '../registry/request-log.js';
import {
  RelayMessageSchema,
  type RegisterMessage,
  type RelayRequestMessage,
  type RelayResponseMessage,
  type RelayProgressMessage,
  type PendingRelayRequest,
  type RateLimitEntry,
  type RelayState,
} from './types.js';
import { lookupCardPrice, holdForRelay, settleForRelay, releaseForRelay, calculateConductorFee } from './relay-credit.js';
import { AgentBnBError } from '../types/index.js';

/** Maximum relay requests per agent per minute */
const RATE_LIMIT_MAX = 60;
/** Rate limit window in milliseconds (1 minute) */
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Relay request timeout in milliseconds (5 minutes for long-running skills) */
const RELAY_TIMEOUT_MS = 300_000;

/**
 * Registers WebSocket relay on an existing Fastify instance.
 * Adds a `/ws` route that upgrades HTTP to WebSocket for agent relay.
 *
 * @param server - Fastify instance with @fastify/websocket already registered.
 * @param db - Registry database instance (for card lookups and online status).
 * @param creditDb - Optional credit database. When provided, credits are held
 *   before forwarding requests, settled on success, and released on failure/timeout/disconnect.
 *   When undefined, all credit operations are skipped (backward compat for tests).
 * @returns RelayState for monitoring and graceful shutdown.
 */
export function registerWebSocketRelay(
  server: FastifyInstance,
  db: Database.Database,
  creditDb?: Database.Database,
): RelayState {
  /** Active agent connections keyed by owner */
  const connections = new Map<string, WebSocket>();
  /** Pending relay requests keyed by request ID */
  const pendingRequests = new Map<string, PendingRelayRequest>();
  /** Rate limit state per owner */
  const rateLimits = new Map<string, RateLimitEntry>();

  /**
   * Check and increment rate limit for an owner.
   * @returns true if request is allowed, false if rate limited.
   */
  function checkRateLimit(owner: string): boolean {
    const now = Date.now();
    const entry = rateLimits.get(owner);

    if (!entry || now >= entry.resetTime) {
      rateLimits.set(owner, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }

    if (entry.count >= RATE_LIMIT_MAX) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Mark all cards belonging to an owner as offline.
   */
  function markOwnerOffline(owner: string): void {
    try {
      // Find all cards by this owner and mark offline
      const stmt = db.prepare('SELECT id, data FROM capability_cards WHERE owner = ?');
      const rows = stmt.all(owner) as Array<{ id: string; data: string }>;
      for (const row of rows) {
        try {
          const card = JSON.parse(row.data);
          if (card.availability?.online) {
            card.availability.online = false;
            card.updated_at = new Date().toISOString();
            const updateStmt = db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?');
            updateStmt.run(JSON.stringify(card), card.updated_at, row.id);
          }
        } catch { /* skip malformed cards */ }
      }
    } catch { /* database errors are non-fatal */ }
  }

  /**
   * Mark all cards belonging to an owner as online.
   */
  function markOwnerOnline(owner: string): void {
    try {
      const stmt = db.prepare('SELECT id, data FROM capability_cards WHERE owner = ?');
      const rows = stmt.all(owner) as Array<{ id: string; data: string }>;
      for (const row of rows) {
        try {
          const card = JSON.parse(row.data);
          card.availability = { ...card.availability, online: true };
          card.updated_at = new Date().toISOString();
          const updateStmt = db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?');
          updateStmt.run(JSON.stringify(card), card.updated_at, row.id);
        } catch { /* skip malformed cards */ }
      }
    } catch { /* database errors are non-fatal */ }
  }

  /**
   * Upsert a card into the registry from a relay register message.
   */
  function upsertCard(cardData: Record<string, unknown>, owner: string): string {
    const cardId = cardData.id as string;
    const existing = getCard(db, cardId);

    if (existing) {
      // Update existing card — mark online
      const updates = { ...cardData, availability: { ...((cardData.availability as Record<string, unknown>) ?? {}), online: true } };
      updateCard(db, cardId, owner, updates);
    } else {
      // Insert new card — mark online
      const card = { ...cardData, availability: { ...((cardData.availability as Record<string, unknown>) ?? {}), online: true } };
      insertCard(db, card as Parameters<typeof insertCard>[1]);
    }

    return cardId;
  }

  /**
   * Log an agent_joined activity event.
   */
  function logAgentJoined(owner: string, cardName: string, cardId: string): void {
    try {
      insertRequestLog(db, {
        id: randomUUID(),
        card_id: cardId,
        card_name: cardName,
        requester: owner,
        status: 'success',
        latency_ms: 0,
        credits_charged: 0,
        created_at: new Date().toISOString(),
        action_type: 'agent_joined',
      });
    } catch { /* non-fatal */ }
  }

  /**
   * Send a JSON message over WebSocket.
   */
  function sendMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Handle an agent registration message.
   */
  function handleRegister(ws: WebSocket, msg: RegisterMessage): void {
    const { owner, card } = msg;

    // Close existing connection for this owner (reconnect case)
    const existing = connections.get(owner);
    if (existing && existing !== ws) {
      try { existing.close(1000, 'Replaced by new connection'); } catch { /* ignore */ }
    }

    // Store connection
    connections.set(owner, ws);

    // Upsert card into registry
    const cardId = upsertCard(card, owner);

    // Get card name for activity log
    const cardName = (card.name as string) ?? (card.agent_name as string) ?? owner;

    // Log agent joined
    logAgentJoined(owner, cardName, cardId);

    // Mark all owner's cards online
    markOwnerOnline(owner);

    // Send acknowledgment
    sendMessage(ws, { type: 'registered', agent_id: cardId });
  }

  /**
   * Handle a relay request from Agent A to Agent B.
   */
  async function handleRelayRequest(ws: WebSocket, msg: RelayRequestMessage, fromOwner: string): Promise<void> {
    // Rate limit check
    if (!checkRateLimit(fromOwner)) {
      sendMessage(ws, {
        type: 'error',
        code: 'rate_limited',
        message: `Rate limit exceeded: max ${RATE_LIMIT_MAX} requests per minute`,
        request_id: msg.id,
      });
      return;
    }

    // Look up target agent's connection
    const targetWs = connections.get(msg.target_owner);
    if (!targetWs || targetWs.readyState !== 1) {
      sendMessage(ws, {
        type: 'response',
        id: msg.id,
        error: { code: -32603, message: `Agent offline: ${msg.target_owner}` },
      });
      return;
    }

    // Credit hold — if creditDb is provided, hold credits before forwarding
    let escrowId: string | undefined;
    if (creditDb) {
      try {
        const price = lookupCardPrice(db, msg.card_id, msg.skill_id);
        if (price !== null && price > 0) {
          escrowId = holdForRelay(creditDb, fromOwner, price, msg.card_id);
        }
      } catch (err) {
        if (err instanceof AgentBnBError && err.code === 'INSUFFICIENT_CREDITS') {
          // Hard reject — do not forward to provider
          sendMessage(ws, {
            type: 'response',
            id: msg.id,
            error: { code: -32603, message: 'Insufficient credits' },
          });
          return;
        }
        // Other credit DB errors are non-fatal — log and continue without escrow
        console.error('[relay] credit hold error (non-fatal):', err);
      }
    }

    // Set up timeout — release escrow on timeout
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      if (pending?.escrowId && creditDb) {
        try { releaseForRelay(creditDb, pending.escrowId); } catch (e) { console.error('[relay] escrow release on timeout failed:', e); }
      }
      sendMessage(ws, {
        type: 'response',
        id: msg.id,
        error: { code: -32603, message: 'Relay request timeout' },
      });
    }, RELAY_TIMEOUT_MS);

    // Track pending request with escrowId and targetOwner
    pendingRequests.set(msg.id, { originOwner: fromOwner, timeout, escrowId, targetOwner: msg.target_owner });

    // Forward to target agent
    sendMessage(targetWs, {
      type: 'incoming_request',
      id: msg.id,
      from_owner: fromOwner,
      card_id: msg.card_id,
      skill_id: msg.skill_id,
      params: msg.params,
      requester: msg.requester ?? fromOwner,
      escrow_receipt: msg.escrow_receipt,
    });
  }

  /**
   * Handle a relay progress message from Agent B.
   * Resets the pending request timeout and forwards the progress to the origin requester.
   */
  function handleRelayProgress(msg: RelayProgressMessage): void {
    const pending = pendingRequests.get(msg.id);
    if (!pending) return; // Unknown request ID — ignore

    // Reset the relay timeout so a slow but alive provider doesn't get cut off
    clearTimeout(pending.timeout);
    const newTimeout = setTimeout(() => {
      const p = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      if (p?.escrowId && creditDb) {
        try { releaseForRelay(creditDb, p.escrowId); } catch (e) { console.error('[relay] escrow release on progress timeout failed:', e); }
      }
      const originWs = connections.get(pending.originOwner);
      if (originWs && originWs.readyState === 1) {
        sendMessage(originWs, {
          type: 'response',
          id: msg.id,
          error: { code: -32603, message: 'Relay request timeout' },
        });
      }
    }, RELAY_TIMEOUT_MS);
    pending.timeout = newTimeout;

    // Forward progress to the origin requester
    const originWs = connections.get(pending.originOwner);
    if (originWs && originWs.readyState === 1) {
      sendMessage(originWs, {
        type: 'relay_progress',
        id: msg.id,
        progress: msg.progress,
        message: msg.message,
      });
    }
  }

  /**
   * Handle a relay response from Agent B back to Agent A.
   */
  function handleRelayResponse(msg: RelayResponseMessage): void {
    const pending = pendingRequests.get(msg.id);
    if (!pending) return; // Already timed out or duplicate

    // Clear timeout
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.id);

    // Settle or release escrow based on response outcome
    if (pending.escrowId && creditDb) {
      try {
        if (msg.error === undefined) {
          // Provider succeeded — settle credits to provider
          settleForRelay(creditDb, pending.escrowId, pending.targetOwner!);
        } else {
          // Provider returned an error — refund requester
          releaseForRelay(creditDb, pending.escrowId);
        }
      } catch (e) {
        console.error('[relay] escrow settle/release on response failed:', e);
      }
    }

    // Conductor fee settlement — detect Conductor orchestration responses
    // A Conductor result contains a `total_credits` field indicating the sub-task cost sum.
    let conductorFee = 0;
    if (
      creditDb &&
      msg.error === undefined &&
      typeof msg.result === 'object' &&
      msg.result !== null &&
      'total_credits' in msg.result &&
      typeof (msg.result as Record<string, unknown>).total_credits === 'number'
    ) {
      const totalCredits = (msg.result as Record<string, unknown>).total_credits as number;
      conductorFee = calculateConductorFee(totalCredits);

      if (conductorFee > 0) {
        try {
          // Hold the fee from the original requester, then immediately settle to conductor
          const feeEscrowId = holdForRelay(creditDb, pending.originOwner, conductorFee, msg.id);
          settleForRelay(creditDb, feeEscrowId, pending.targetOwner!);
        } catch (e) {
          // Fee settlement is best-effort: the main capability was already settled successfully.
          // The requester may have spent their remaining credits on sub-tasks.
          console.error('[relay] conductor fee settlement failed (non-fatal):', e);
          conductorFee = 0; // Reset so we don't report a fee that wasn't charged
        }
      }
    }

    // Forward response to origin agent, including conductor_fee if charged
    const originWs = connections.get(pending.originOwner);
    if (originWs && originWs.readyState === 1) {
      sendMessage(originWs, {
        type: 'response',
        id: msg.id,
        result: msg.result,
        error: msg.error,
        ...(conductorFee > 0 ? { conductor_fee: conductorFee } : {}),
      });
    }
  }

  /**
   * Handle WebSocket disconnection.
   */
  function handleDisconnect(owner: string | undefined): void {
    if (!owner) return;

    connections.delete(owner);
    rateLimits.delete(owner);
    markOwnerOffline(owner);

    // Fail any pending requests targeting this now-disconnected provider
    // Also clean up requests that originated FROM this agent
    for (const [reqId, pending] of pendingRequests) {
      if (pending.targetOwner === owner) {
        // This request was forwarded to the disconnected provider — release escrow and notify requester
        clearTimeout(pending.timeout);
        pendingRequests.delete(reqId);

        if (pending.escrowId && creditDb) {
          try { releaseForRelay(creditDb, pending.escrowId); } catch (e) { console.error('[relay] escrow release on disconnect failed:', e); }
        }

        const originWs = connections.get(pending.originOwner);
        if (originWs && originWs.readyState === 1) {
          sendMessage(originWs, {
            type: 'response',
            id: reqId,
            error: { code: -32603, message: 'Provider disconnected' },
          });
        }
      } else if (pending.originOwner === owner) {
        // Request originated from this agent — clean up without notifying (requester is gone)
        clearTimeout(pending.timeout);
        pendingRequests.delete(reqId);
        // Release escrow so provider doesn't wait for a settlement that won't come
        if (pending.escrowId && creditDb) {
          try { releaseForRelay(creditDb, pending.escrowId); } catch (e) { console.error('[relay] escrow release on requester disconnect failed:', e); }
        }
      }
    }
  }

  // Register WebSocket route
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.get('/ws', { websocket: true } as any, (rawSocket: any, _request: any) => {
    const socket = rawSocket as import('ws').WebSocket;
    let registeredOwner: string | undefined;

    socket.on('message', (raw: Buffer | string) => {
      void (async () => {
        let data: unknown;
        try {
          data = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
        } catch {
          sendMessage(socket, { type: 'error', code: 'invalid_json', message: 'Invalid JSON' });
          return;
        }

        const parsed = RelayMessageSchema.safeParse(data);
        if (!parsed.success) {
          sendMessage(socket, {
            type: 'error',
            code: 'invalid_message',
            message: `Invalid message: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
          });
          return;
        }

        const msg = parsed.data;

        switch (msg.type) {
          case 'register':
            registeredOwner = msg.owner;
            handleRegister(socket, msg);
            break;

          case 'relay_request':
            if (!registeredOwner) {
              sendMessage(socket, {
                type: 'error',
                code: 'not_registered',
                message: 'Must send register message before relay requests',
              });
              return;
            }
            await handleRelayRequest(socket, msg, registeredOwner);
            break;

          case 'relay_response':
            handleRelayResponse(msg);
            break;

          case 'relay_progress':
            handleRelayProgress(msg);
            break;

          default:
            // Ignore other message types from agents
            break;
        }
      })();
    });

    socket.on('close', () => {
      handleDisconnect(registeredOwner);
    });

    socket.on('error', () => {
      handleDisconnect(registeredOwner);
    });
  });

  return {
    getOnlineCount: () => connections.size,
    getOnlineOwners: () => Array.from(connections.keys()),
    shutdown: () => {
      for (const [, ws] of connections) {
        try { ws.close(1001, 'Server shutting down'); } catch { /* ignore */ }
      }
      connections.clear();
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timeout);
      }
      pendingRequests.clear();
      rateLimits.clear();
    },
  };
}
