import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { RelayClient } from '../relay/websocket-client.js';
import { requestViaRelay } from './client.js';
import { AgentBnBError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type RelayErrorKind =
  | 'CONNECT_FAILED'
  | 'HANDSHAKE_REJECTED'
  | 'PROVIDER_OFFLINE'
  | 'PROVIDER_TIMEOUT'
  | 'EXECUTION_ERROR';

export class RelayDispatchError extends AgentBnBError {
  constructor(message: string, public readonly kind: RelayErrorKind) {
    super(message, 'RELAY_DISPATCH_ERROR');
    this.name = 'RelayDispatchError';
  }
}

/**
 * Maps a raw error to a structured {@link RelayErrorKind}.
 *
 * The heuristic inspects the error message for well-known substrings emitted
 * by the relay, WebSocket layer, and Node networking stack.
 */
export function classifyRelayError(err: unknown): RelayErrorKind {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('connect')) {
    return 'CONNECT_FAILED';
  }
  if (msg.includes('not registered') || msg.includes('offline') || msg.includes('no provider')) {
    return 'PROVIDER_OFFLINE';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'PROVIDER_TIMEOUT';
  }
  if (msg.includes('rejected') || msg.includes('handshake')) {
    return 'HANDSHAKE_REJECTED';
  }
  return 'EXECUTION_ERROR';
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
const RETRYABLE_KINDS: ReadonlySet<RelayErrorKind> = new Set<RelayErrorKind>([
  'CONNECT_FAILED',
  'PROVIDER_OFFLINE',
]);

/** Base delays in ms for attempt 1 and 2 (attempt 0 is the first try). */
const BASE_DELAYS_MS = [1_000, 2_000] as const;

/** Returns the base delay with 0-30% additive jitter. */
function backoffWithJitter(attemptIndex: number): number {
  const base = BASE_DELAYS_MS[Math.min(attemptIndex, BASE_DELAYS_MS.length - 1)] ?? 2_000;
  const jitter = Math.random() * 0.3 * base;
  return base + jitter;
}

/**
 * Options for requesting a capability via a temporary relay connection.
 */
export interface TemporaryRelayRequestOptions {
  /** Registry URL (HTTP/HTTPS — will be upgraded to WS). */
  registryUrl: string;
  /**
   * Requester canonical identity. Prefer agent_id (cryptographic, stable across
   * renames) over owner (legacy human-chosen string). Used for relay credit tracking.
   * Provide at least one of agent_id or owner.
   */
  agent_id?: string;
  /** @deprecated Use agent_id. Kept for backward compat during v7->v8 transition. */
  owner?: string;
  /** Authentication token for the registry. */
  token: string;
  /** Target agent owner identifier. */
  targetOwner: string;
  /** Canonical target agent identity. Preferred over targetOwner when available. */
  targetAgentId?: string;
  /** Capability Card ID to execute. */
  cardId: string;
  /** Optional skill ID within the card. */
  skillId?: string;
  /** Input parameters for the capability. */
  params: Record<string, unknown>;
  /** Timeout in milliseconds. Default 300_000 (5 min). */
  timeoutMs?: number;
}

/**
 * Sends a capability request via a temporary WebSocket relay connection.
 *
 * Creates an ephemeral relay connection using `owner:req:<uuid>` so the relay
 * skips card upsert for `:req:` owners. Sets `requester` to the actual owner
 * so the relay charges the correct agent's registry balance. No `escrowReceipt`
 * is sent — the relay holds its own escrow server-side.
 *
 * Retries up to {@link MAX_ATTEMPTS} times for transient errors (CONNECT_FAILED,
 * PROVIDER_OFFLINE) with exponential backoff and jitter.
 *
 * Always disconnects in `finally` to avoid leaked connections.
 *
 * @param opts - Request options.
 * @returns The result from the capability execution.
 * @throws {RelayDispatchError} with a classified {@link RelayErrorKind}.
 */
export async function requestViaTemporaryRelay(opts: TemporaryRelayRequestOptions): Promise<unknown> {
  const {
    registryUrl,
    agent_id,
    owner,
    token,
    targetOwner,
    targetAgentId,
    cardId,
    skillId,
    params,
    timeoutMs = 300_000,
  } = opts;

  // Prefer agent_id (cryptographic, stable) over owner (legacy string).
  const requesterIdentity = agent_id ?? owner ?? '';

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const requesterId = `${requesterIdentity}:req:${randomUUID()}`;

    const relay = new RelayClient({
      registryUrl,
      owner: requesterId,
      token,
      card: {
        spec_version: '1.0',
        id: randomUUID(),
        owner: requesterId,
        name: requesterId,
        description: 'Temporary relay requester',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 0 },
        availability: { online: false },
      },
      onRequest: async () => ({
        error: { code: -32601, message: 'Temporary relay requester does not serve capabilities' },
      }),
      silent: true,
    });

    try {
      await relay.connect();
    } catch (err) {
      relay.disconnect();
      lastError = err;
      const kind = classifyRelayError(err);

      if (RETRYABLE_KINDS.has(kind) && attempt < MAX_ATTEMPTS - 1) {
        await delay(backoffWithJitter(attempt));
        continue;
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new RelayDispatchError(`Relay connection failed: ${message}`, kind);
    }

    try {
      return await requestViaRelay(relay, {
        targetOwner,
        targetAgentId,
        cardId,
        skillId,
        params,
        requester: requesterIdentity, // canonical identity for relay credit tracking
        timeoutMs,
      });
    } catch (err) {
      // The finally block handles disconnect. Classify and decide whether to retry.
      lastError = err;
      const kind = classifyRelayError(err);

      if (RETRYABLE_KINDS.has(kind) && attempt < MAX_ATTEMPTS - 1) {
        // finally runs before continue, ensuring disconnect before retry.
        await delay(backoffWithJitter(attempt));
        continue;
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new RelayDispatchError(message, kind);
    } finally {
      relay.disconnect();
    }
  }

  // Should never reach here, but satisfy the compiler.
  const kind = classifyRelayError(lastError);
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new RelayDispatchError(`Relay dispatch failed after ${MAX_ATTEMPTS} attempts: ${message}`, kind);
}
