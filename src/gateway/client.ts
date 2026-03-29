import { randomUUID } from 'node:crypto';
import { Agent } from 'undici';
import { AgentBnBError } from '../types/index.js';
import type { EscrowReceipt } from '../types/index.js';
import { signEscrowReceipt } from '../credit/signing.js';

export const REQUEST_TIMEOUT_FALLBACK_MS = 300_000;
export const REQUEST_TIMEOUT_GRACE_MS = 30_000;
export const REQUEST_TIMEOUT_EXPECTED_MULTIPLIER = 1.5;

/**
 * Shared HTTP connection pool for gateway requests.
 * Reuses TCP connections across requests to the same host, eliminating
 * repeated TLS/TCP handshake overhead for Conductor multi-hop scenarios.
 */
const gatewayAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 10,
  pipelining: 1,
});

/**
 * Identity credentials for Ed25519-based authentication.
 * Used for cross-machine requests where static tokens aren't available.
 */
export interface IdentityAuth {
  /** Agent ID (sha256-derived from public key). */
  agentId: string;
  /** Hex-encoded Ed25519 public key. */
  publicKey: string;
  /** DER-encoded Ed25519 private key (for signing). */
  privateKey: Buffer;
}

/**
 * Timeout hints published by a provider card/skill.
 */
export interface RequestTimeoutHint {
  /** Typical expected duration from provider metadata. */
  expected_duration_ms?: number;
  /** Provider-declared hard timeout from provider metadata. */
  hard_timeout_ms?: number;
}

/**
 * Derives requester timeout from provider-published metadata.
 *
 * Priority:
 * 1. expected_duration_ms * 1.5 + grace buffer
 * 2. hard_timeout_ms + grace buffer
 * 3. fallback default
 */
export function deriveRequestTimeoutMs(hint?: RequestTimeoutHint): number {
  const expectedDurationMs = hint?.expected_duration_ms;
  if (typeof expectedDurationMs === 'number' && expectedDurationMs > 0) {
    return Math.ceil(expectedDurationMs * REQUEST_TIMEOUT_EXPECTED_MULTIPLIER) + REQUEST_TIMEOUT_GRACE_MS;
  }

  const hardTimeoutMs = hint?.hard_timeout_ms;
  if (typeof hardTimeoutMs === 'number' && hardTimeoutMs > 0) {
    return Math.ceil(hardTimeoutMs) + REQUEST_TIMEOUT_GRACE_MS;
  }

  return REQUEST_TIMEOUT_FALLBACK_MS;
}

/**
 * Options for requesting a capability from a remote gateway.
 */
export interface RequestOptions {
  /** Base URL of the remote gateway (e.g. http://localhost:7700). */
  gatewayUrl: string;
  /** Bearer token for authentication fallback. */
  token: string;
  /** Capability Card ID to execute. */
  cardId: string;
  /** Input parameters for the capability. */
  params?: Record<string, unknown>;
  /** Timeout in milliseconds. Explicit override when provided. */
  timeoutMs?: number;
  /** Provider timeout metadata used to derive default timeout when timeoutMs is omitted. */
  timeoutHint?: RequestTimeoutHint;
  /** Signed escrow receipt for cross-machine credit verification. */
  escrowReceipt?: EscrowReceipt;
  /** Identity credentials for Ed25519-based auth. */
  identity?: IdentityAuth;
}

/**
 * Builds gateway auth headers.
 *
 * When identity credentials are provided, signed Ed25519 headers are attached.
 * If a bearer token is also provided, it is sent alongside signature headers
 * for backward compatibility with token-based gateways.
 */
function buildGatewayAuthHeaders(
  payload: unknown,
  token: string,
  identity?: IdentityAuth,
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (identity) {
    const signature = signEscrowReceipt(payload as Record<string, unknown>, identity.privateKey);
    headers['X-Agent-Id'] = identity.agentId;
    headers['X-Agent-Public-Key'] = identity.publicKey;
    headers['X-Agent-Signature'] = signature;
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Sends a capability.execute JSON-RPC request to a remote gateway.
 *
 * Authentication: signs with Ed25519 identity credentials when available.
 * Bearer token is sent as backward-compatible fallback when provided.
 *
 * @param opts - Request options.
 * @returns The result from the capability execution.
 * @throws {AgentBnBError} on JSON-RPC error, network failure, or timeout.
 */
export async function requestCapability(opts: RequestOptions): Promise<unknown> {
  const {
    gatewayUrl,
    token,
    cardId,
    params = {},
    timeoutMs: timeoutOverrideMs,
    timeoutHint,
    escrowReceipt,
    identity,
  } = opts;
  const timeoutMs = timeoutOverrideMs ?? deriveRequestTimeoutMs(timeoutHint);

  const id = randomUUID();
  const payload = {
    jsonrpc: '2.0',
    id,
    method: 'capability.execute',
    params: {
      card_id: cardId,
      ...params,
      ...(escrowReceipt ? { escrow_receipt: escrowReceipt } : {}),
    },
  };

  const headers = buildGatewayAuthHeaders(payload, token, identity);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      // undici dispatcher for connection pooling (Node.js 20+)
      dispatcher: gatewayAgent,
    } as RequestInit);
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    throw new AgentBnBError(
      isTimeout ? 'Request timed out' : `Network error: ${String(err)}`,
      isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json()) as {
    jsonrpc: string;
    id: unknown;
    result?: unknown;
    error?: { code: number; message: string };
  };

  if (body.error) {
    throw new AgentBnBError(body.error.message, `RPC_ERROR_${body.error.code}`);
  }

  return body.result;
}

/**
 * A single request within a batch.
 */
export interface BatchRequestItem {
  /** JSON-RPC request ID (for correlating responses). */
  id: string;
  /** Capability Card ID to execute. */
  cardId: string;
  /** Input parameters for the capability. */
  params?: Record<string, unknown>;
  /** Signed escrow receipt for cross-machine credit verification. */
  escrowReceipt?: EscrowReceipt;
}

/**
 * Sends a batch of capability.execute JSON-RPC requests to a single gateway.
 *
 * Uses JSON-RPC 2.0 batch format (array of requests) to reduce network
 * round-trips when multiple sub-tasks target the same agent in a Conductor wave.
 *
 * @param gatewayUrl - Base URL of the remote gateway.
 * @param token - Bearer token for authentication.
 * @param items - Array of batch request items.
 * @param opts - Optional timeout and identity.
 * @returns Map of request ID to result (or Error for failures).
 */
export async function requestCapabilityBatch(
  gatewayUrl: string,
  token: string,
  items: BatchRequestItem[],
  opts: { timeoutMs?: number; timeoutHint?: RequestTimeoutHint; identity?: IdentityAuth } = {},
): Promise<Map<string, unknown>> {
  if (items.length === 0) return new Map();
  if (items.length === 1) {
    // Single item — use regular path to avoid batch overhead
    const item = items[0]!;
    const result = await requestCapability({
      gatewayUrl,
      token,
      cardId: item.cardId,
      params: item.params,
      escrowReceipt: item.escrowReceipt,
      timeoutMs: opts.timeoutMs,
      timeoutHint: opts.timeoutHint,
      identity: opts.identity,
    });
    return new Map([[item.id, result]]);
  }

  const { timeoutMs: timeoutOverrideMs, timeoutHint, identity } = opts;
  const timeoutMs = timeoutOverrideMs ?? deriveRequestTimeoutMs(timeoutHint);

  const batchPayload = items.map((item) => ({
    jsonrpc: '2.0',
    id: item.id,
    method: 'capability.execute',
    params: {
      card_id: item.cardId,
      ...item.params,
      ...(item.escrowReceipt ? { escrow_receipt: item.escrowReceipt } : {}),
    },
  }));

  const headers = buildGatewayAuthHeaders(batchPayload, token, identity);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify(batchPayload),
      signal: controller.signal,
      dispatcher: gatewayAgent,
    } as RequestInit);
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    throw new AgentBnBError(
      isTimeout ? 'Batch request timed out' : `Network error: ${String(err)}`,
      isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json()) as Array<{
    jsonrpc: string;
    id: string;
    result?: unknown;
    error?: { code: number; message: string };
  }>;

  const results = new Map<string, unknown>();
  for (const resp of body) {
    if (resp.error) {
      results.set(resp.id, new AgentBnBError(resp.error.message, `RPC_ERROR_${resp.error.code}`));
    } else {
      results.set(resp.id, resp.result);
    }
  }
  return results;
}

/**
 * Options for requesting a capability via WebSocket relay.
 */
export interface RelayRequestOptions {
  /** Target agent owner to relay the request to. */
  targetOwner: string;
  /** Capability Card ID to execute. */
  cardId: string;
  /** Optional skill ID within the card. */
  skillId?: string;
  /** Input parameters for the capability. */
  params?: Record<string, unknown>;
  /** Signed escrow receipt for cross-machine credit verification. */
  escrowReceipt?: EscrowReceipt;
  /** Timeout in milliseconds. Explicit override when provided. */
  timeoutMs?: number;
  /** Provider timeout metadata used to derive default timeout when timeoutMs is omitted. */
  timeoutHint?: RequestTimeoutHint;
  /** Actual requester owner for credit tracking (defaults to relay client's owner). */
  requester?: string;
}

/**
 * Sends a capability request to another agent via the WebSocket relay.
 *
 * @param relay - Connected RelayClient instance.
 * @param opts - Relay request options.
 * @returns The result from the capability execution.
 * @throws {AgentBnBError} on relay error, timeout, or target agent offline.
 */
export async function requestViaRelay(
  relay: import('../relay/websocket-client.js').RelayClient,
  opts: RelayRequestOptions,
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? deriveRequestTimeoutMs(opts.timeoutHint);
  try {
    return await relay.request({
      targetOwner: opts.targetOwner,
      cardId: opts.cardId,
      skillId: opts.skillId,
      params: opts.params ?? {},
      requester: opts.requester,
      escrowReceipt: opts.escrowReceipt as Record<string, unknown> | undefined,
      timeoutMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('timeout')) {
      throw new AgentBnBError(message, 'TIMEOUT');
    }
    if (message.includes('offline')) {
      throw new AgentBnBError(message, 'AGENT_OFFLINE');
    }
    throw new AgentBnBError(message, 'RELAY_ERROR');
  }
}
