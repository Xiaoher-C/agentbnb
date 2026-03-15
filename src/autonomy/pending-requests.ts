import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AgentBnBError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A pending Tier 3 auto-request awaiting owner approval or rejection.
 * Persisted in the pending_requests SQLite table.
 */
export interface PendingRequest {
  /** UUID primary key. */
  id: string;
  /** The natural-language skill query that triggered the pending request. */
  skill_query: string;
  /** Maximum credit cost the requestor is willing to pay. */
  max_cost_credits: number;
  /** The selected peer agent's identifier (if a match was found). */
  selected_peer: string | null;
  /** The selected capability card ID (if a match was found). */
  selected_card_id: string | null;
  /** The selected skill ID within the card (if a match was found). */
  selected_skill_id: string | null;
  /** The credit amount quoted for this request. */
  credits: number;
  /** Current status: 'pending' | 'approved' | 'rejected'. */
  status: string;
  /** JSON-serialized original params blob for re-execution after approval. */
  params: string | null;
  /** ISO timestamp when the request was created. */
  created_at: string;
  /** ISO timestamp when the request was resolved (approved or rejected). */
  resolved_at: string | null;
}

// ---------------------------------------------------------------------------
// Input options
// ---------------------------------------------------------------------------

/**
 * Options for creating a new pending request.
 */
export interface CreatePendingRequestOpts {
  /** The natural-language skill query. */
  skill_query: string;
  /** Maximum credit cost the requestor accepts. */
  max_cost_credits: number;
  /** Credit amount quoted by the selected peer. */
  credits: number;
  /** Peer agent identifier (optional — not always known at queue time). */
  selected_peer?: string;
  /** Selected capability card ID (optional). */
  selected_card_id?: string;
  /** Selected skill ID (optional). */
  selected_skill_id?: string;
  /** Original call params for re-execution after approval (optional). */
  params?: unknown;
}

// ---------------------------------------------------------------------------
// CRUD functions
// ---------------------------------------------------------------------------

/**
 * Inserts a new pending request with status='pending' into the pending_requests table.
 *
 * @param db - Open database instance (must have pending_requests table).
 * @param opts - Options for the new pending request.
 * @returns The UUID id of the newly created pending request.
 */
export function createPendingRequest(
  db: Database.Database,
  opts: CreatePendingRequestOpts
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const paramsJson = opts.params !== undefined ? JSON.stringify(opts.params) : null;

  db.prepare(`
    INSERT INTO pending_requests (
      id, skill_query, max_cost_credits, selected_peer, selected_card_id,
      selected_skill_id, credits, status, params, created_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
  `).run(
    id,
    opts.skill_query,
    opts.max_cost_credits,
    opts.selected_peer ?? null,
    opts.selected_card_id ?? null,
    opts.selected_skill_id ?? null,
    opts.credits,
    paramsJson,
    now
  );

  return id;
}

/**
 * Returns all pending requests with status='pending', sorted by created_at DESC (newest first).
 *
 * @param db - Open database instance.
 * @returns Array of PendingRequest objects currently awaiting owner action.
 */
export function listPendingRequests(db: Database.Database): PendingRequest[] {
  const rows = db
    .prepare(`SELECT * FROM pending_requests WHERE status = 'pending' ORDER BY created_at DESC`)
    .all() as PendingRequest[];
  return rows;
}

/**
 * Resolves a pending request by setting its status to 'approved' or 'rejected'
 * and recording the resolution timestamp.
 *
 * @param db - Open database instance.
 * @param id - UUID of the pending request to resolve.
 * @param resolution - Either 'approved' or 'rejected'.
 * @throws {AgentBnBError} with code NOT_FOUND if no request with the given id exists.
 */
export function resolvePendingRequest(
  db: Database.Database,
  id: string,
  resolution: 'approved' | 'rejected'
): void {
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE pending_requests SET status = ?, resolved_at = ? WHERE id = ?`
    )
    .run(resolution, now, id);

  if (result.changes === 0) {
    throw new AgentBnBError(
      `Pending request not found: ${id}`,
      'NOT_FOUND'
    );
  }
}
