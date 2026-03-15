import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Autonomy tier level: 1 = auto-execute, 2 = execute + notify, 3 = ask-before (blocked). */
export type AutonomyTier = 1 | 2 | 3;

/**
 * Owner-configured thresholds that control autonomous behavior.
 * Both thresholds default to 0, meaning ALL actions are Tier 3 (blocked)
 * until the owner explicitly configures them via `agentbnb config set tier1 <N>`.
 */
export interface AutonomyConfig {
  /**
   * Maximum credit amount for fully autonomous execution (Tier 1).
   * Actions costing strictly less than this value execute without notification.
   * Default: 0 (Tier 1 disabled — owner must opt in).
   */
  tier1_max_credits: number;
  /**
   * Maximum credit amount for supervised execution with notification (Tier 2).
   * Actions with cost in [tier1_max_credits, tier2_max_credits) execute and notify the owner.
   * Default: 0 (Tier 2 disabled — owner must opt in).
   */
  tier2_max_credits: number;
}

/**
 * Discriminated union of all autonomy audit event types.
 * Each variant records which tier was invoked and payload-specific details.
 */
export type AutonomyEvent =
  | { type: 'auto_share'; skill_id: string; tier_invoked: 1; idle_rate: number }
  | { type: 'auto_share_notify'; skill_id: string; tier_invoked: 2; idle_rate: number }
  | { type: 'auto_share_pending'; skill_id: string; tier_invoked: 3; idle_rate: number }
  | { type: 'auto_request'; card_id: string; skill_id: string; tier_invoked: 1; credits: number; peer: string }
  | { type: 'auto_request_notify'; card_id: string; skill_id: string; tier_invoked: 2; credits: number; peer: string }
  | { type: 'auto_request_pending'; card_id: string; skill_id: string; tier_invoked: 3; credits: number; peer: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default autonomy configuration per OWASP Least-Agency principle.
 * Both thresholds are 0, so ALL credit amounts satisfy `amount >= 0 >= tier2_max_credits`,
 * which means getAutonomyTier() always returns Tier 3.
 * Owners must explicitly run `agentbnb config set tier1 <N>` to enable autonomy.
 */
export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
  tier1_max_credits: 0,
  tier2_max_credits: 0,
};

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Classifies a credit amount into an autonomy tier based on owner-configured thresholds.
 *
 * Tier classification:
 * - Tier 1: creditAmount < tier1_max_credits → fully autonomous (auto-execute)
 * - Tier 2: tier1_max_credits <= creditAmount < tier2_max_credits → execute + notify owner
 * - Tier 3: creditAmount >= tier2_max_credits → blocked, ask owner before proceeding
 *
 * When DEFAULT_AUTONOMY_CONFIG is used (both thresholds = 0), every amount >= 0 >= 0
 * satisfies the Tier 3 condition, so all actions are blocked until the owner configures thresholds.
 *
 * @param creditAmount - The cost in credits of the proposed autonomous action.
 * @param config - The owner's autonomy configuration with tier thresholds.
 * @returns The autonomy tier (1, 2, or 3) for this credit amount.
 */
export function getAutonomyTier(creditAmount: number, config: AutonomyConfig): AutonomyTier {
  if (creditAmount < config.tier1_max_credits) return 1;
  if (creditAmount < config.tier2_max_credits) return 2;
  return 3;
}

/**
 * Inserts an autonomy audit event into the request_log table.
 *
 * This records every autonomous or semi-autonomous action taken by the agent,
 * including the tier that was invoked and event-specific metadata.
 * Share events use card_id='system' since they don't reference a specific capability card.
 * Request events use the actual card_id from the event payload.
 *
 * @param db - Open database instance (must have request_log table with action_type + tier_invoked columns).
 * @param event - The autonomy event to record.
 */
export function insertAuditEvent(db: Database.Database, event: AutonomyEvent): void {
  // Determine card_id and credits_charged based on event type
  const isShareEvent =
    event.type === 'auto_share' ||
    event.type === 'auto_share_notify' ||
    event.type === 'auto_share_pending';

  const cardId = isShareEvent ? 'system' : (event as { card_id: string }).card_id;
  const creditsCharged = isShareEvent ? 0 : (event as { credits: number }).credits;

  const stmt = db.prepare(`
    INSERT INTO request_log (
      id, card_id, card_name, requester, status, latency_ms, credits_charged,
      created_at, skill_id, action_type, tier_invoked
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    randomUUID(),
    cardId,
    'autonomy-audit',
    'self',
    'success',
    0,
    creditsCharged,
    new Date().toISOString(),
    event.skill_id,
    event.type,
    event.tier_invoked
  );
}
