import { randomUUID } from 'node:crypto';
import { AgentBnBError } from '../types/index.js';
import type { EscrowReceipt } from '../types/index.js';

/**
 * Options for requesting a capability from a remote gateway.
 */
export interface RequestOptions {
  /** Base URL of the remote gateway (e.g. http://localhost:7700). */
  gatewayUrl: string;
  /** Bearer token for authentication. */
  token: string;
  /** Capability Card ID to execute. */
  cardId: string;
  /** Input parameters for the capability. */
  params?: Record<string, unknown>;
  /** Timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Signed escrow receipt for cross-machine credit verification. */
  escrowReceipt?: EscrowReceipt;
}

/**
 * Sends a capability.execute JSON-RPC request to a remote gateway.
 *
 * @param opts - Request options.
 * @returns The result from the capability execution.
 * @throws {AgentBnBError} on JSON-RPC error, network failure, or timeout.
 */
export async function requestCapability(opts: RequestOptions): Promise<unknown> {
  const { gatewayUrl, token, cardId, params = {}, timeoutMs = 30_000, escrowReceipt } = opts;

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
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
