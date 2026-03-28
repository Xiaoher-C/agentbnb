import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { insertRequestLog } from '../registry/request-log.js';
import {
  RelayMessageSchema,
  type RegisterMessage,
  type RelayRequestMessage,
  type RelayResponseMessage,
  type RelayProgressMessage,
  type HeartbeatMessage,
  type EscrowHoldMessage,
  type EscrowSettleMessage,
  type BalanceSyncMessage,
  type PendingRelayRequest,
  type RateLimitEntry,
  type RelayState,
  type AgentCapacityData,
} from './types.js';
import { lookupCardPrice, holdForRelay, settleForRelay, releaseForRelay, calculateConductorFee } from './relay-credit.js';
import { processEscrowHold, processEscrowSettle, settleWithNetworkFee } from './relay-escrow.js';
import { getBalance } from '../credit/ledger.js';
import { handleJobRelayResponse } from '../hub-agent/relay-bridge.js';
import { AgentBnBError, AnyCardSchema } from '../types/index.js';

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
  /** V8: Reverse lookup — agent_id → owner for dual-key routing */
  const agentIdToOwner = new Map<string, string>();
  /** Pending relay requests keyed by request ID */
  const pendingRequests = new Map<string, PendingRelayRequest>();
  /** Rate limit state per owner */
  const rateLimits = new Map<string, RateLimitEntry>();
  /** Agent capacity data from heartbeats */
  const agentCapacities = new Map<string, AgentCapacityData>();
  /** Optional callback invoked when an agent registers (comes online) */
  let onAgentOnlineCallback: ((owner: string) => void) | undefined;

  /**
   * V8: Resolve a target identifier (agent_id or owner) to a connection key.
   */
  function resolveConnectionKey(target: string): string | undefined {
    const ownerFromAgentId = agentIdToOwner.get(target);
    if (ownerFromAgentId && connections.has(ownerFromAgentId)) return ownerFromAgentId;
    if (connections.has(target)) return target;
    return undefined;
  }

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
   * Uses AnyCardSchema to accept both v1.0 and v2.0 cards, and raw SQL
   * to bypass store.ts functions which are locked to v1.0 schema only.
   */
  function upsertCard(cardData: Record<string, unknown>, owner: string): string {
    const parsed = AnyCardSchema.safeParse(cardData);
    if (!parsed.success) {
      throw new AgentBnBError(
        `Card validation failed: ${parsed.error.message}`,
        'VALIDATION_ERROR',
      );
    }

    const card = { ...parsed.data, availability: { ...parsed.data.availability, online: true } };
    const cardId = card.id;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM capability_cards WHERE id = ?').get(cardId) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        'UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?',
      ).run(JSON.stringify(card), now, cardId);
    } else {
      db.prepare(
        'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(cardId, owner, JSON.stringify(card), now, now);
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
   * Upserts the primary card, then any additional cards from the `cards` array.
   * Only logs agent_joined once (for the primary card).
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

    // V8: Register agent_id → owner mapping for dual-key routing
    if (msg.agent_id) {
      agentIdToOwner.set(msg.agent_id, owner);
    }

    // V8 Phase 3: Multi-agent registration — register additional agents from this server
    if (msg.agents && msg.agents.length > 0) {
      for (const agentEntry of msg.agents) {
        // Map each agent_id to this connection's owner key
        agentIdToOwner.set(agentEntry.agent_id, owner);

        // Upsert each agent's cards
        for (const agentCard of agentEntry.cards) {
          try {
            upsertCard(agentCard, owner);
          } catch { /* non-fatal: skip invalid cards */ }
        }
      }
    }

    // Ephemeral requester connections (owner contains ':req:') are used solely for
    // making outbound relay requests. They do not need a card in the registry — skip
    // persistence and activity logging to avoid polluting the card list.
    const isEphemeral = owner.includes(':req:');
    if (isEphemeral) {
      const cardId = (card.id as string) ?? owner;
      sendMessage(ws, { type: 'registered', agent_id: cardId });
      return;
    }

    // Upsert primary card into registry (non-fatal — agent stays connected even if card is invalid)
    let cardId: string;
    try {
      cardId = upsertCard(card, owner);
    } catch (err) {
      console.error(`[relay] card validation failed for ${owner}:`, err instanceof Error ? err.message : err);
      cardId = (card.id as string) ?? owner;
    }

    // Get card name for activity log
    const cardName = (card.name as string) ?? (card.agent_name as string) ?? owner;

    // Log agent joined (only once, for the primary card)
    logAgentJoined(owner, cardName, cardId);

    // Upsert additional cards (e.g., conductor card)
    if (msg.cards && msg.cards.length > 0) {
      for (const extraCard of msg.cards) {
        try {
          upsertCard(extraCard, owner);
        } catch { /* non-fatal: skip invalid additional cards */ }
      }
    }

    // Mark all owner's cards online
    markOwnerOnline(owner);

    // Invoke onAgentOnline callback (e.g., relay bridge dispatches queued jobs)
    if (onAgentOnlineCallback) {
      try { onAgentOnlineCallback(owner); } catch (e) {
        console.error('[relay] onAgentOnline callback error:', e);
      }
    }

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

    // Look up target agent's connection (V8: resolve agent_id or owner)
    const targetKey = resolveConnectionKey(msg.target_agent_id ?? msg.target_owner);
    const targetWs = targetKey ? connections.get(targetKey) : undefined;
    if (!targetWs || targetWs.readyState !== 1) {
      sendMessage(ws, {
        type: 'response',
        id: msg.id,
        error: { code: -32603, message: `Agent offline: ${msg.target_agent_id ?? msg.target_owner}` },
      });
      return;
    }

    // Credit hold — if creditDb is provided, hold credits before forwarding.
    // Use msg.requester (the actual agent owner) for credit operations rather
    // than fromOwner (the connection key), so that temp requester connections
    // with synthetic IDs still charge the correct account.
    const creditOwner = msg.requester ?? fromOwner;
    let escrowId: string | undefined;
    if (creditDb) {
      try {
        const price = lookupCardPrice(db, msg.card_id, msg.skill_id);
        if (price !== null && price > 0) {
          escrowId = holdForRelay(creditDb, creditOwner, price, msg.card_id);
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

    // Track pending request with escrowId and targetOwner.
    // originOwner is the connection key for routing; creditOwner is used for
    // conductor fee settlement and is stored as originOwner when they differ.
    pendingRequests.set(msg.id, { originOwner: fromOwner, creditOwner, timeout, escrowId, targetOwner: msg.target_owner });

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

    // If this is a job-dispatched request, delegate to job relay response handler
    if (pending.jobId && creditDb) {
      try {
        handleJobRelayResponse({
          registryDb: db,
          creditDb,
          jobId: pending.jobId,
          escrowId: pending.escrowId,
          relayOwner: pending.targetOwner ?? '',
          result: msg.error === undefined ? msg.result : undefined,
          error: msg.error,
        });
      } catch (e) {
        console.error('[relay] job relay response handling failed:', e);
      }
      // Still forward response to origin if connected
      const originWs = connections.get(pending.originOwner);
      if (originWs && originWs.readyState === 1) {
        sendMessage(originWs, { type: 'response', id: msg.id, result: msg.result, error: msg.error });
      }
      return;
    }

    // Settle or release escrow based on response outcome
    if (pending.escrowId && creditDb) {
      try {
        if (msg.error === undefined) {
          // Provider succeeded — settle credits to provider (V8: with network fee)
          settleWithNetworkFee(creditDb, pending.escrowId, pending.targetOwner!);
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
          const feeEscrowId = holdForRelay(creditDb, pending.creditOwner ?? pending.originOwner, conductorFee, msg.id);
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
    agentCapacities.delete(owner);
    // V8: Clean up agent_id → owner mapping
    for (const [agentId, o] of agentIdToOwner) {
      if (o === owner) { agentIdToOwner.delete(agentId); break; }
    }
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

  /**
   * Handle a heartbeat message from an agent.
   * Stores capacity data for routing and Hub display.
   */
  function handleHeartbeat(msg: HeartbeatMessage): void {
    agentCapacities.set(msg.owner, msg.capacity);
  }

  // ---------------------------------------------------------------------------
  // V8 Phase 2: Explicit escrow message handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle an explicit escrow hold request (P2P with relay verification flow).
   */
  function handleEscrowHold(ws: WebSocket, msg: EscrowHoldMessage): void {
    if (!creditDb) {
      sendMessage(ws, { type: 'error', code: 'no_credit_db', message: 'Credit system not available' });
      return;
    }

    try {
      const result = processEscrowHold(
        creditDb,
        msg.consumer_agent_id,
        msg.provider_agent_id,
        msg.skill_id,
        msg.amount,
        msg.request_id,
        msg.signature,
        msg.public_key,
      );

      sendMessage(ws, {
        type: 'escrow_hold_confirmed',
        request_id: msg.request_id,
        escrow_id: result.escrow_id,
        hold_amount: result.hold_amount,
        consumer_remaining: result.consumer_remaining,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Escrow hold failed';
      const code = errMsg.includes('INSUFFICIENT_CREDITS') ? 'insufficient_credits' : 'escrow_hold_failed';
      sendMessage(ws, { type: 'error', code, message: errMsg, request_id: msg.request_id });
    }
  }

  /**
   * Handle an explicit escrow settlement request.
   */
  function handleEscrowSettle(ws: WebSocket, msg: EscrowSettleMessage): void {
    if (!creditDb) {
      sendMessage(ws, { type: 'error', code: 'no_credit_db', message: 'Credit system not available' });
      return;
    }

    try {
      // Look up the escrow to find the provider
      const escrow = creditDb
        .prepare('SELECT card_id FROM credit_escrow WHERE id = ? AND status = ?')
        .get(msg.escrow_id, 'held') as { card_id: string } | undefined;

      if (!escrow) {
        sendMessage(ws, { type: 'error', code: 'escrow_not_found', message: `Escrow not found: ${msg.escrow_id}`, request_id: msg.request_id });
        return;
      }

      // card_id format from processEscrowHold: "provider_agent_id:skill_id"
      const providerAgentId = escrow.card_id.split(':')[0];

      const result = processEscrowSettle(
        creditDb,
        msg.escrow_id,
        msg.success,
        providerAgentId,
        msg.signature,
        msg.public_key,
        msg.consumer_agent_id,
      );

      // Send settlement confirmation to consumer
      sendMessage(ws, {
        type: 'escrow_settled',
        escrow_id: result.escrow_id,
        request_id: msg.request_id,
        provider_earned: result.provider_earned,
        network_fee: result.network_fee,
        consumer_remaining: result.consumer_remaining,
        provider_balance: result.provider_balance,
      });

      // Send settlement notification to provider if connected
      const providerKey = resolveConnectionKey(providerAgentId);
      if (providerKey) {
        const providerWs = connections.get(providerKey);
        if (providerWs && providerWs.readyState === 1) {
          sendMessage(providerWs, {
            type: 'escrow_settled',
            escrow_id: result.escrow_id,
            request_id: msg.request_id,
            provider_earned: result.provider_earned,
            network_fee: result.network_fee,
            consumer_remaining: result.consumer_remaining,
            provider_balance: result.provider_balance,
          });
        }
      }
    } catch (err) {
      sendMessage(ws, { type: 'error', code: 'escrow_settle_failed', message: err instanceof Error ? err.message : 'Settlement failed', request_id: msg.request_id });
    }
  }

  /**
   * Handle a balance sync request — returns authoritative balance from relay.
   */
  function handleBalanceSync(ws: WebSocket, msg: BalanceSyncMessage): void {
    if (!creditDb) {
      sendMessage(ws, { type: 'error', code: 'no_credit_db', message: 'Credit system not available' });
      return;
    }

    const balance = getBalance(creditDb, msg.agent_id);
    sendMessage(ws, {
      type: 'balance_sync_response',
      agent_id: msg.agent_id,
      balance,
    });
  }

  // Register WebSocket route — must be inside register() for @fastify/websocket to work correctly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void server.register(async (app: any) => {
  app.get('/ws', { websocket: true } as any, (rawSocket: any, _request: any) => {
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

          case 'heartbeat':
            handleHeartbeat(msg);
            break;

          // V8 Phase 2: Explicit escrow messages
          case 'escrow_hold':
            handleEscrowHold(socket, msg);
            break;

          case 'escrow_settle':
            handleEscrowSettle(socket, msg);
            break;

          case 'balance_sync':
            handleBalanceSync(socket, msg);
            break;

          default:
            // Ignore other message types from agents
            break;
        }
      })();
    });

    // Ping/pong keepalive — detect zombie connections early
    const pingInterval = setInterval(() => {
      if (socket.readyState === 1) socket.ping();
    }, 30_000);

    socket.on('close', () => {
      clearInterval(pingInterval);
      handleDisconnect(registeredOwner);
    });

    socket.on('error', () => {
      clearInterval(pingInterval);
      handleDisconnect(registeredOwner);
    });
  });
  }); // end server.register()

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
      agentCapacities.clear();
    },
    setOnAgentOnline: (cb: (owner: string) => void) => {
      onAgentOnlineCallback = cb;
    },
    getConnections: () => connections as Map<string, unknown>,
    getPendingRequests: () => pendingRequests,
    sendMessage: (ws: unknown, msg: Record<string, unknown>) => {
      sendMessage(ws as WebSocket, msg);
    },
    getAgentCapacity: (owner: string) => agentCapacities.get(owner),
    getAllCapacities: () => new Map(agentCapacities),
  };
}
