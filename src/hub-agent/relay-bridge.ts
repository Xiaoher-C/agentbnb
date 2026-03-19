import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getJobsByRelayOwner, updateJobStatus, getJob } from './job-queue.js';
import { getHubAgent } from './store.js';
import { settleForRelay, releaseForRelay } from '../relay/relay-credit.js';
import type { PendingRelayRequest } from '../relay/types.js';

/** Timeout for dispatched jobs (5 minutes, same as RELAY_TIMEOUT_MS) */
const JOB_DISPATCH_TIMEOUT_MS = 300_000;

/** Options for creating a relay bridge */
export interface RelayBridgeOptions {
  registryDb: Database.Database;
  creditDb: Database.Database;
  /** Function to send a JSON message over a WebSocket */
  sendMessage: (ws: unknown, msg: Record<string, unknown>) => void;
  /** Map of pending relay requests (shared with relay server) */
  pendingRequests: Map<string, PendingRelayRequest>;
  /** Map of active WebSocket connections keyed by owner */
  connections: Map<string, unknown>;
}

/** Relay bridge instance */
export interface RelayBridge {
  /** Called when an agent comes online via relay. Dispatches queued jobs. */
  onAgentOnline(owner: string): void;
}

/**
 * Creates a relay bridge that auto-dispatches queued jobs when agents reconnect.
 *
 * The bridge monitors agent online events and forwards pending jobs
 * through the relay's WebSocket connections. It reuses the relay's
 * pendingRequests map for response tracking.
 *
 * @param opts - Bridge configuration with DB instances and relay accessors.
 * @returns A RelayBridge with an onAgentOnline callback.
 */
export function createRelayBridge(opts: RelayBridgeOptions): RelayBridge {
  const { registryDb, creditDb, sendMessage, pendingRequests, connections } = opts;

  function onAgentOnline(owner: string): void {
    // Find all queued jobs targeting this relay owner
    const jobs = getJobsByRelayOwner(registryDb, owner);
    if (jobs.length === 0) return;

    // Get target WebSocket
    const targetWs = connections.get(owner);
    if (!targetWs) return;

    for (const job of jobs) {
      // Update status to dispatched
      updateJobStatus(registryDb, job.id, 'dispatched');

      // Look up the Hub Agent to get its card ID
      const agent = getHubAgent(registryDb, job.hub_agent_id);
      const cardId = agent
        ? agent.agent_id.padEnd(32, '0')
            .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5')
        : job.hub_agent_id;

      // Generate relay request ID
      const requestId = randomUUID();

      // Parse params
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(job.params) as Record<string, unknown>;
      } catch { /* use empty params */ }

      // Track as pending request with jobId for response routing
      const timeout = setTimeout(() => {
        const pending = pendingRequests.get(requestId);
        if (pending) {
          pendingRequests.delete(requestId);
          // Timeout: mark job failed, release escrow
          updateJobStatus(registryDb, job.id, 'failed', JSON.stringify({ error: 'dispatch timeout' }));
          if (job.escrow_id) {
            try { releaseForRelay(creditDb, job.escrow_id); } catch (e) {
              console.error('[relay-bridge] escrow release on timeout failed:', e);
            }
          }
        }
      }, JOB_DISPATCH_TIMEOUT_MS);

      pendingRequests.set(requestId, {
        originOwner: job.requester_owner,
        timeout,
        escrowId: job.escrow_id ?? undefined,
        targetOwner: owner,
        jobId: job.id,
      });

      // Forward to target agent
      sendMessage(targetWs, {
        type: 'incoming_request',
        id: requestId,
        from_owner: job.requester_owner,
        card_id: cardId,
        skill_id: job.skill_id,
        params,
      });
    }
  }

  return { onAgentOnline };
}

/**
 * Handles a relay response for a job-dispatched request.
 * Called by the relay server when it detects a jobId on a PendingRelayRequest.
 *
 * @param opts.registryDb - Registry database for job status updates.
 * @param opts.creditDb - Credit database for escrow operations.
 * @param opts.jobId - The job ID being responded to.
 * @param opts.escrowId - The escrow ID associated with the job.
 * @param opts.relayOwner - The relay owner (provider) for escrow settlement.
 * @param opts.result - Success result (if no error).
 * @param opts.error - Error object (if failed).
 */
export function handleJobRelayResponse(opts: {
  registryDb: Database.Database;
  creditDb: Database.Database;
  jobId: string;
  escrowId?: string;
  relayOwner: string;
  result?: unknown;
  error?: unknown;
}): void {
  const { registryDb, creditDb, jobId, escrowId, relayOwner, result, error } = opts;

  if (error) {
    // Failed
    updateJobStatus(registryDb, jobId, 'failed', JSON.stringify(error));
    if (escrowId) {
      try { releaseForRelay(creditDb, escrowId); } catch (e) {
        console.error('[relay-bridge] escrow release on error failed:', e);
      }
    }
  } else {
    // Success
    updateJobStatus(registryDb, jobId, 'completed', JSON.stringify(result));
    if (escrowId) {
      try { settleForRelay(creditDb, escrowId, relayOwner); } catch (e) {
        console.error('[relay-bridge] escrow settle failed:', e);
      }
    }
  }
}
