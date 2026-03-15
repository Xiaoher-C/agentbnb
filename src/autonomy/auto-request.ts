import type Database from 'better-sqlite3';
import { searchCards } from '../registry/matcher.js';
import { BudgetManager } from '../credit/budget.js';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
import { requestCapability } from '../gateway/client.js';
import {
  getAutonomyTier,
  insertAuditEvent,
  type AutonomyConfig,
  type AutonomyTier,
} from '../autonomy/tiers.js';
import { createPendingRequest } from '../autonomy/pending-requests.js';
import { findPeer } from '../cli/peers.js';
import type { CapabilityCard } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Describes a capability gap that the agent needs filled autonomously.
 */
export interface CapabilityNeed {
  /** Natural-language search query to find a matching capability. */
  query: string;
  /** Maximum credit cost the requestor is willing to pay per call. */
  maxCostCredits: number;
  /** Optional input parameters to pass to the capability. */
  params?: Record<string, unknown>;
}

/**
 * Configuration for the AutoRequestor.
 */
export interface AutoRequestOptions {
  /** Agent owner identifier — used for self-exclusion and escrow. */
  owner: string;
  /** SQLite database for the capability registry (cards + request_log). */
  registryDb: Database.Database;
  /** SQLite database for credits (escrow, balances). */
  creditDb: Database.Database;
  /** Autonomy tier configuration controlling execution gating. */
  autonomyConfig: AutonomyConfig;
  /** Budget manager for reserve enforcement before escrow. */
  budgetManager: BudgetManager;
  /** Maximum number of candidates to retrieve from search. Default 10. */
  maxSearchResults?: number;
}

/**
 * Result of an autonomous capability request.
 */
export interface AutoRequestResult {
  /** Final status of the auto-request attempt. */
  status: 'success' | 'budget_blocked' | 'tier_blocked' | 'no_peer' | 'failed';
  /** The capability result (only present on success). */
  result?: unknown;
  /** The escrow ID used (only present on success). */
  escrowId?: string;
  /** The peer agent owner who fulfilled the request. */
  peer?: string;
  /** Credits spent (only present on success). */
  creditsSpent?: number;
  /** Human-readable reason for non-success outcomes. */
  reason?: string;
}

/**
 * A capability candidate for peer scoring — extracted from either a v1.0 card
 * or a v2.0 skill within a card.
 */
export interface Candidate {
  /** The parent capability card. */
  card: CapabilityCard;
  /** Credit cost for this candidate. */
  cost: number;
  /** Skill ID for v2.0 multi-skill cards. Undefined for v1.0 cards. */
  skillId: string | undefined;
}

/**
 * A scored candidate after peer scoring.
 */
export interface ScoredPeer extends Candidate {
  /** Final composite score (higher = better). */
  rawScore: number;
}

// ---------------------------------------------------------------------------
// Exported helpers (for testing)
// ---------------------------------------------------------------------------

/**
 * Applies min-max normalization to an array of numbers.
 *
 * Guards:
 * - Single value → returns [1]
 * - All equal values → returns all 1s
 *
 * @param values - Array of numeric values to normalize.
 * @returns Normalized values in [0, 1] range.
 */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [1];

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === min) {
    return values.map(() => 1);
  }

  return values.map((v) => (v - min) / (max - min));
}

/**
 * Scores and sorts peer candidates using min-max normalized composite scoring.
 *
 * Scoring dimensions:
 * - success_rate: from card.metadata.success_rate (default 0.5)
 * - cost_efficiency: 1/credits_per_call (zero-cost cards get max efficiency of 1)
 * - idle_rate: from card._internal.idle_rate (missing = 1.0, maximally idle)
 *
 * Self-exclusion: candidates where card.owner === selfOwner are filtered out.
 * Results are sorted by rawScore descending (best first).
 *
 * @param candidates - All candidate peers to score.
 * @param selfOwner - The requesting agent's owner ID (excluded from results).
 * @returns Sorted array of ScoredPeer objects, best match first.
 */
export function scorePeers(candidates: Candidate[], selfOwner: string): ScoredPeer[] {
  // Self-exclusion
  const eligible = candidates.filter((c) => c.card.owner !== selfOwner);

  if (eligible.length === 0) return [];

  // Extract raw dimension values
  const successRates = eligible.map((c) => c.card.metadata?.success_rate ?? 0.5);
  const costEfficiencies = eligible.map((c) => (c.cost === 0 ? 1 : 1 / c.cost));
  const idleRates = eligible.map((c) => {
    const internal = c.card._internal as Record<string, unknown> | undefined;
    const idleRate = internal?.idle_rate;
    return typeof idleRate === 'number' ? idleRate : 1.0;
  });

  // Normalize each dimension
  const normSuccess = minMaxNormalize(successRates);
  const normCost = minMaxNormalize(costEfficiencies);
  const normIdle = minMaxNormalize(idleRates);

  // Combine dimensions multiplicatively
  const scored: ScoredPeer[] = eligible.map((c, i) => ({
    ...c,
    rawScore: (normSuccess[i] ?? 0) * (normCost[i] ?? 0) * (normIdle[i] ?? 0),
  }));

  // Sort descending by score
  scored.sort((a, b) => b.rawScore - a.rawScore);

  return scored;
}

// ---------------------------------------------------------------------------
// AutoRequestor class
// ---------------------------------------------------------------------------

/**
 * Orchestrates the complete auto-request flow for filling capability gaps.
 *
 * Flow: search → filter (self-exclusion + cost cap) → score → tier gate →
 *       budget check → escrow → execute → settle/release → audit log
 *
 * All failure paths log an audit event to request_log (REQ-06 compliance).
 */
export class AutoRequestor {
  private readonly owner: string;
  private readonly registryDb: Database.Database;
  private readonly creditDb: Database.Database;
  private readonly autonomyConfig: AutonomyConfig;
  private readonly budgetManager: BudgetManager;

  /**
   * Creates a new AutoRequestor.
   *
   * @param opts - Configuration for this AutoRequestor instance.
   */
  constructor(opts: AutoRequestOptions) {
    this.owner = opts.owner;
    this.registryDb = opts.registryDb;
    this.creditDb = opts.creditDb;
    this.autonomyConfig = opts.autonomyConfig;
    this.budgetManager = opts.budgetManager;
  }

  /**
   * Executes an autonomous capability request.
   *
   * Performs the full flow:
   * 1. Search for matching capability cards
   * 2. Filter self-owned and over-budget candidates
   * 3. Score candidates using min-max normalized composite scoring
   * 4. Resolve peer gateway config
   * 5. Check autonomy tier (Tier 3 queues to pending_requests)
   * 6. Check budget reserve
   * 7. Hold escrow
   * 8. Execute via peer gateway
   * 9. Settle or release escrow based on outcome
   * 10. Log audit event (for Tier 2 notifications and all failures)
   *
   * @param need - The capability need to fulfill.
   * @returns The result of the auto-request attempt.
   */
  async requestWithAutonomy(need: CapabilityNeed): Promise<AutoRequestResult> {
    // Step 1: Search for matching cards
    const cards = searchCards(this.registryDb, need.query, { online: true });

    // Step 2: Build candidates from both v1.0 and v2.0 cards
    const candidates: Candidate[] = [];

    for (const card of cards) {
      const cardAsV2 = card as CapabilityCard & { skills?: Array<{ id: string; pricing: { credits_per_call: number } }> };

      if (Array.isArray(cardAsV2.skills)) {
        // v2.0 multi-skill card — flatten skills
        for (const skill of cardAsV2.skills) {
          const cost = skill.pricing.credits_per_call;
          if (cost <= need.maxCostCredits) {
            candidates.push({ card, cost, skillId: skill.id });
          }
        }
      } else {
        // v1.0 card — use card-level pricing
        const cost = card.pricing.credits_per_call;
        if (cost <= need.maxCostCredits) {
          candidates.push({ card, cost, skillId: undefined });
        }
      }
    }

    // Step 3: Score with self-exclusion
    const scored = scorePeers(candidates, this.owner);

    if (scored.length === 0) {
      this.logFailure('auto_request_failed', 'system', 'none', 3, 0, 'none', 'No eligible peer found');
      return { status: 'no_peer', reason: 'No eligible peer found' };
    }

    // Step 4: Pick top scorer and resolve peer gateway
    // scored.length > 0 is guaranteed by the guard above, but TypeScript doesn't know scored[0] is defined
    const top: ScoredPeer = scored[0] as ScoredPeer;
    const peerConfig = findPeer(top.card.owner);

    if (!peerConfig) {
      this.logFailure('auto_request_failed', top.card.id, top.skillId ?? 'none', 3, top.cost, top.card.owner, 'No gateway config for peer');
      return { status: 'no_peer', reason: 'No gateway config for peer' };
    }

    // Step 5: Check autonomy tier
    const tier = getAutonomyTier(top.cost, this.autonomyConfig);

    if (tier === 3) {
      // Queue to pending_requests — do not execute
      createPendingRequest(this.registryDb, {
        skill_query: need.query,
        max_cost_credits: need.maxCostCredits,
        credits: top.cost,
        selected_peer: top.card.owner,
        selected_card_id: top.card.id,
        selected_skill_id: top.skillId,
        params: need.params,
      });

      insertAuditEvent(this.registryDb, {
        type: 'auto_request_pending',
        card_id: top.card.id,
        skill_id: top.skillId ?? top.card.id,
        tier_invoked: 3,
        credits: top.cost,
        peer: top.card.owner,
      });

      return {
        status: 'tier_blocked',
        reason: 'Tier 3: owner approval required',
        peer: top.card.owner,
      };
    }

    // Step 6: Budget check
    if (!this.budgetManager.canSpend(top.cost)) {
      this.logFailure('auto_request_failed', top.card.id, top.skillId ?? 'none', tier, top.cost, top.card.owner, 'Budget reserve would be breached');
      return { status: 'budget_blocked', reason: 'Insufficient credits — reserve floor would be breached' };
    }

    // Step 7: Hold escrow
    const escrowId = holdEscrow(this.creditDb, this.owner, top.cost, top.card.id);

    // Step 8: Execute via peer gateway
    try {
      const execResult = await requestCapability({
        gatewayUrl: peerConfig.url,
        token: peerConfig.token,
        cardId: top.card.id,
        params: top.skillId
          ? { skill_id: top.skillId, ...need.params }
          : need.params,
      });

      // Step 9a: Settle escrow on success
      settleEscrow(this.creditDb, escrowId, top.card.owner);

      // Step 10: Tier 2 notification audit event
      if (tier === 2) {
        insertAuditEvent(this.registryDb, {
          type: 'auto_request_notify',
          card_id: top.card.id,
          skill_id: top.skillId ?? top.card.id,
          tier_invoked: 2,
          credits: top.cost,
          peer: top.card.owner,
        });
      } else {
        // Tier 1: log successful auto_request event
        insertAuditEvent(this.registryDb, {
          type: 'auto_request',
          card_id: top.card.id,
          skill_id: top.skillId ?? top.card.id,
          tier_invoked: 1,
          credits: top.cost,
          peer: top.card.owner,
        });
      }

      return {
        status: 'success',
        result: execResult,
        escrowId,
        peer: top.card.owner,
        creditsSpent: top.cost,
      };
    } catch (err) {
      // Step 9b: Release escrow on failure
      releaseEscrow(this.creditDb, escrowId);

      const reason = err instanceof Error ? err.message : String(err);
      this.logFailure('auto_request_failed', top.card.id, top.skillId ?? 'none', tier, top.cost, top.card.owner, `Execution failed: ${reason}`);

      return {
        status: 'failed',
        reason: `Execution failed: ${reason}`,
        peer: top.card.owner,
      };
    }
  }

  /**
   * Logs a failure audit event to request_log.
   * Used for all non-success paths to satisfy REQ-06.
   */
  private logFailure(
    type: 'auto_request_failed',
    cardId: string,
    skillId: string,
    tier: AutonomyTier,
    credits: number,
    peer: string,
    reason: string
  ): void {
    insertAuditEvent(this.registryDb, {
      type,
      card_id: cardId,
      skill_id: skillId,
      tier_invoked: tier,
      credits,
      peer,
      reason,
    });
  }
}
