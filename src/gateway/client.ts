import { randomUUID } from 'node:crypto';
import { AgentBnBError } from '../types/index.js';
import type { EscrowReceipt } from '../types/index.js';
import { signEscrowReceipt } from '../credit/signing.js';

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
 * Options for requesting a capability from a remote gateway.
 */
export interface RequestOptions {
  /** Base URL of the remote gateway (e.g. http://localhost:7700). */
  gatewayUrl: string;
  /** Bearer token for authentication (used for local requests). */
  token: string;
  /** Capability Card ID to execute. */
  cardId: string;
  /** Input parameters for the capability. */
  params?: Record<string, unknown>;
  /** Timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Signed escrow receipt for cross-machine credit verification. */
  escrowReceipt?: EscrowReceipt;
  /** Identity credentials for Ed25519-based auth (replaces token for remote). */
  identity?: IdentityAuth;
}

/**
 * Sends a capability.execute JSON-RPC request to a remote gateway.
 *
 * Authentication: uses Bearer token if provided, otherwise signs
 * the request payload with Ed25519 identity credentials.
 *
 * @param opts - Request options.
 * @returns The result from the capability execution.
 * @throws {AgentBnBError} on JSON-RPC error, network failure, or timeout.
 */
export async function requestCapability(opts: RequestOptions): Promise<unknown> {
  const { gatewayUrl, token, cardId, params = {}, timeoutMs = 300_000, escrowReceipt, identity } = opts;

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

  // Build auth headers
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (identity) {
    // Ed25519 identity auth: sign the payload, include agent_id + public_key + signature
    const signature = signEscrowReceipt(payload as unknown as Record<string, unknown>, identity.privateKey);
    headers['X-Agent-Id'] = identity.agentId;
    headers['X-Agent-Public-Key'] = identity.publicKey;
    headers['X-Agent-Signature'] = signature;
  } else if (token) {
    // Legacy Bearer token auth
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
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
  /** Timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
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
  try {
    return await relay.request({
      targetOwner: opts.targetOwner,
      cardId: opts.cardId,
      skillId: opts.skillId,
      params: opts.params ?? {},
      escrowReceipt: opts.escrowReceipt as Record<string, unknown> | undefined,
      timeoutMs: opts.timeoutMs,
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
