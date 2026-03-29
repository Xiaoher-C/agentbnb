import { randomUUID } from 'node:crypto';
import { RelayClient } from '../relay/websocket-client.js';
import { requestViaRelay } from './client.js';
import { AgentBnBError } from '../types/index.js';

/**
 * Options for requesting a capability via a temporary relay connection.
 */
export interface TemporaryRelayRequestOptions {
  /** Registry URL (HTTP/HTTPS — will be upgraded to WS). */
  registryUrl: string;
  /** Requester agent owner identifier. */
  owner: string;
  /** Authentication token for the registry. */
  token: string;
  /** Target agent owner identifier. */
  targetOwner: string;
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
 * Always disconnects in `finally` to avoid leaked connections.
 *
 * @param opts - Request options.
 * @returns The result from the capability execution.
 * @throws {AgentBnBError} with code 'RELAY_UNAVAILABLE' on connection failure.
 */
export async function requestViaTemporaryRelay(opts: TemporaryRelayRequestOptions): Promise<unknown> {
  const {
    registryUrl,
    owner,
    token,
    targetOwner,
    cardId,
    skillId,
    params,
    timeoutMs = 300_000,
  } = opts;

  const requesterId = `${owner}:req:${randomUUID()}`;

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
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentBnBError(`Relay connection failed: ${message}`, 'RELAY_UNAVAILABLE');
  }

  try {
    return await requestViaRelay(relay, {
      targetOwner,
      cardId,
      skillId,
      params,
      requester: owner, // actual owner for credit tracking on relay server
      timeoutMs,
    });
  } finally {
    relay.disconnect();
  }
}
