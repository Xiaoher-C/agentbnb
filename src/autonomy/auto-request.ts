import type Database from 'better-sqlite3';
import { searchCards } from '../registry/matcher.js';
import { BudgetManager } from '../credit/budget.js';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
import { requestCapability } from '../gateway/client.js';
import { requestViaTemporaryRelay } from '../gateway/relay-dispatch.js';
import {
  getAutonomyTier,
  insertAuditEvent,
  type AutonomyConfig,
  type AutonomyTier,
} from '../autonomy/tiers.js';
import { createPendingRequest } from '../autonomy/pending-requests.js';
import { findPeer } from '../cli/peers.js';
import type { CapabilityCard } from '../types/index.js';
import { fetchRemoteCards } from '../cli/remote-registry.js';
import { resolveTargetCapability } from '../gateway/resolve-target-capability.js';
import { resolveCanonicalIdentity } from '../identity/agent-identity.js';
import { mintSelfDelegatedSkillToken } from '../auth/ucan.js';

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
 * Local signing identity used by AutoRequestor to mint self-delegated UCAN
 * tokens for outbound relay calls. The private key MUST be loaded from the
 * local keystore — never from caller-supplied params (audit CRITICAL-2).
 */
export interface AutoRequestorIdentity {
  /** Issuer/audience DID (e.g. `did:agentbnb:<agent_id>`). */
  readonly did: string;
  /** DER-encoded Ed25519 private key matching the DID. */
  readonly privateKey: Buffer;
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
  /** Optional remote registry URL for fallback when local search returns no results. */
  registryUrl?: string;
  /**
   * Local signing identity for minting self-delegated UCAN tokens used to
   * authenticate relay calls. When omitted, relay attempts are skipped and
   * the auto-request returns `no_peer`.
   */
  identity?: AutoRequestorIdentity;
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
  /**
   * Per-skill metadata for v2.0 multi-skill candidates.
   * When set, scorePeers() prefers these over card-level metadata fields,
   * enabling accurate scoring when different skills on the same card have
   * different success rates.
   */
  skillMetadata?: { success_rate?: number };
  /**
   * Per-skill _internal for v2.0 multi-skill candidates.
   * Carries skill-level idle_rate, which is tracked independently per skill
   * by IdleMonitor. When set, scorePeers() prefers this over card-level _internal.
   */
  skillInternal?: Record<string, unknown>;
  /**
   * Load factor from heartbeat capacity data.
   * Computed as 1.0 - (current_load / max_concurrent).
   * Range: 0.0 (fully loaded) to 1.0 (idle). Undefined = assume 1.0.
   */
  loadFactor?: number;
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
 * - success_rate: from skill-level metadata.success_rate if available (v2.0 multi-skill),
 *   otherwise falls back to card.metadata.success_rate (default 0.5)
 * - cost_efficiency: 1/credits_per_call (zero-cost cards get max efficiency of 1)
 * - idle_rate: from skill-level _internal.idle_rate if available (v2.0 multi-skill),
 *   otherwise falls back to card._internal.idle_rate (missing = 1.0, maximally idle)
 * - load_factor: from heartbeat capacity data (1.0 - current_load/max_concurrent).
 *   Missing = 1.0 (assume fully available).
 *
 * Composite: success_rate × cost_efficiency × idle_rate × load_factor
 *
 * Self-exclusion:
 * - Always excludes candidates where card.owner === selfOwner.
 * - When registryDb is provided, also excludes candidates whose canonical
 *   agent_id matches selfOwner's canonical agent_id.
 * Results are sorted by rawScore descending (best first).
 *
 * @param candidates - All candidate peers to score.
 * @param selfOwner - The requesting agent's owner ID (excluded from results).
 * @param registryDb - Optional registry DB for owner->agent_id canonicalization.
 * @returns Sorted array of ScoredPeer objects, best match first.
 */
export function scorePeers(
  candidates: Candidate[],
  selfOwner: string,
  registryDb?: Database.Database,
): ScoredPeer[] {
  const selfIdentity = registryDb ? resolveCanonicalIdentity(registryDb, selfOwner) : null;

  // Self-exclusion
  const eligible = candidates.filter((c) => {
    if (c.card.owner === selfOwner) return false;

    if (!registryDb || !selfIdentity?.resolved) return true;

    if (typeof c.card.agent_id === 'string' && c.card.agent_id.length > 0) {
      return c.card.agent_id !== selfIdentity.agent_id;
    }

    const peerIdentity = resolveCanonicalIdentity(registryDb, c.card.owner);
    return !peerIdentity.resolved || peerIdentity.agent_id !== selfIdentity.agent_id;
  });

  if (eligible.length === 0) return [];

  // Extract raw dimension values.
  // For v2.0 multi-skill candidates, prefer skill-level metadata/internal over card-level.
  // This ensures accurate scoring when skills on the same card have different performance profiles.
  const successRates = eligible.map((c) => {
    // Prefer skill-level success_rate (v2.0 multi-skill)
    if (c.skillMetadata?.success_rate !== undefined) {
      return c.skillMetadata.success_rate;
    }
    // Fall back to card-level
    return c.card.metadata?.success_rate ?? 0.5;
  });

  const costEfficiencies = eligible.map((c) => (c.cost === 0 ? 1 : 1 / c.cost));

  const idleRates = eligible.map((c) => {
    // Prefer skill-level _internal.idle_rate (v2.0 multi-skill, tracked by IdleMonitor per skill)
    if (c.skillInternal !== undefined) {
      const skillIdleRate = c.skillInternal['idle_rate'];
      if (typeof skillIdleRate === 'number') return skillIdleRate;
    }
    // Fall back to card-level _internal.idle_rate
    const internal = c.card._internal as Record<string, unknown> | undefined;
    const idleRate = internal?.['idle_rate'];
    return typeof idleRate === 'number' ? idleRate : 1.0;
  });

  // Load factor: 1.0 - (current_load / max_concurrent), default 1.0 (fully available)
  const loadFactors = eligible.map((c) => c.loadFactor ?? 1.0);

  // Normalize each dimension
  const normSuccess = minMaxNormalize(successRates);
  const normCost = minMaxNormalize(costEfficiencies);
  const normIdle = minMaxNormalize(idleRates);
  const normLoad = minMaxNormalize(loadFactors);

  // Combine dimensions multiplicatively
  const scored: ScoredPeer[] = eligible.map((c, i) => ({
    ...c,
    rawScore: (normSuccess[i] ?? 0) * (normCost[i] ?? 0) * (normIdle[i] ?? 0) * (normLoad[i] ?? 0),
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
  private readonly registryUrl?: string;
  private readonly identity?: AutoRequestorIdentity;

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
    this.registryUrl = opts.registryUrl;
    this.identity = opts.identity;
  }

  /**
   * Mints a short-lived self-delegated UCAN authorising the auto-request to
   * invoke `agentbnb://skill/<skillId>` via a relay.
   *
   * Returns null on any failure (missing identity, signer error). Callers
   * MUST treat null as "skip this auto-request" — never fall back to a
   * placeholder token (audit finding CRITICAL-2).
   */
  private mintRelayToken(skillId: string | undefined): string | null {
    if (!this.identity) {
      return null;
    }
    try {
      return mintSelfDelegatedSkillToken({
        did: this.identity.did,
        signerKey: this.identity.privateKey,
        skillId,
        ttlSeconds: 300,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Never log secret material — message only.
      console.error(`[auto-request] failed to mint UCAN, skipping: ${message}`);
      return null;
    }
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
    const selfIdentity = resolveCanonicalIdentity(this.registryDb, this.owner);
    const isSelfTarget = (targetOwner: string, targetAgentId?: string): boolean => {
      if (targetOwner === this.owner) return true;

      if (!selfIdentity.resolved) return false;

      if (targetAgentId && targetAgentId === selfIdentity.agent_id) return true;

      const targetOwnerIdentity = resolveCanonicalIdentity(this.registryDb, targetOwner);
      return targetOwnerIdentity.resolved && targetOwnerIdentity.agent_id === selfIdentity.agent_id;
    };

    // Step 1: Search for matching cards (local first, remote fallback)
    let cards = searchCards(this.registryDb, need.query, { online: true });

    // Remote fallback: when local returns zero and registryUrl is configured
    if (cards.length === 0 && this.registryUrl) {
      try {
        cards = await fetchRemoteCards(this.registryUrl, { q: need.query, online: true });
      } catch {
        // Graceful degradation — network errors result in empty cards
        insertAuditEvent(this.registryDb, {
          type: 'auto_request_failed',
          card_id: 'none',
          skill_id: 'none',
          tier_invoked: 3,
          credits: 0,
          peer: 'none',
          reason: `Remote registry fallback failed for query "${need.query}"`,
        });
        cards = [];
      }
    }

    // Step 2: Build candidates from both v1.0 and v2.0 cards.
    // For v2.0 multi-skill cards, each skill becomes its own Candidate carrying
    // skill-level metadata and _internal so scorePeers() can use per-skill metrics.
    const candidates: Candidate[] = [];

    for (const card of cards) {
      const cardAsV2 = card as CapabilityCard & {
        skills?: Array<{
          id: string;
          pricing: { credits_per_call: number };
          metadata?: { success_rate?: number; avg_latency_ms?: number };
          _internal?: Record<string, unknown>;
        }>;
      };

      if (Array.isArray(cardAsV2.skills)) {
        // v2.0 multi-skill card — flatten skills, carrying per-skill metadata
        for (const skill of cardAsV2.skills) {
          const cost = skill.pricing.credits_per_call;
          if (cost <= need.maxCostCredits) {
            candidates.push({
              card,
              cost,
              skillId: skill.id,
              // Carry skill-level metadata so scorePeers() can prefer it over card-level
              skillMetadata: skill.metadata,
              skillInternal: skill._internal,
            });
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
    const scored = scorePeers(candidates, this.owner, this.registryDb);

    const resolverOptions = {
      registryDb: this.registryDb,
      registryUrl: this.registryUrl,
      onlineOnly: true,
    } as const;

    let resolvedTarget = null as Awaited<ReturnType<typeof resolveTargetCapability>> | null;

    // Unified routing: even when scoring returns no candidates, try the shared
    // resolver path (local -> remote -> relay) so --query can find relay peers.
    if (scored.length === 0) {
      resolvedTarget = await resolveTargetCapability(need.query, resolverOptions);
      if (
        !resolvedTarget ||
        isSelfTarget(resolvedTarget.owner, resolvedTarget.agent_id) ||
        resolvedTarget.credits_per_call > need.maxCostCredits
      ) {
        this.logFailure('auto_request_failed', 'system', 'none', 3, 0, 'none', 'No eligible peer found');
        return { status: 'no_peer', reason: 'No eligible peer found' };
      }
    } else {
      // scored.length > 0 is guaranteed here.
      const top: ScoredPeer = scored[0] as ScoredPeer;
      const targetKey = top.skillId ?? top.card.id;
      resolvedTarget =
        await resolveTargetCapability(targetKey, resolverOptions) ??
        await resolveTargetCapability(need.query, resolverOptions);
      if (!resolvedTarget || isSelfTarget(resolvedTarget.owner, resolvedTarget.agent_id)) {
        this.logFailure('auto_request_failed', top.card.id, top.skillId ?? 'none', 3, top.cost, top.card.owner, 'No eligible peer found');
        return { status: 'no_peer', reason: 'No eligible peer found' };
      }
    }

    if (!resolvedTarget) {
      this.logFailure('auto_request_failed', 'system', 'none', 3, 0, 'none', 'No eligible peer found');
      return { status: 'no_peer', reason: 'No eligible peer found' };
    }

    const selectedCardId = resolvedTarget.cardId;
    const selectedSkillId = resolvedTarget.skillId;
    const selectedPeer = resolvedTarget.owner;
    const selectedCost = resolvedTarget.credits_per_call;
    const selectedViaRelay = resolvedTarget.via_relay;

    // Step 5: Check autonomy tier
    const tier = getAutonomyTier(selectedCost, this.autonomyConfig);

    if (tier === 3) {
      // Queue to pending_requests — do not execute
      createPendingRequest(this.registryDb, {
        skill_query: need.query,
        max_cost_credits: need.maxCostCredits,
        credits: selectedCost,
        selected_peer: selectedPeer,
        selected_card_id: selectedCardId,
        selected_skill_id: selectedSkillId,
        params: need.params,
      });

      insertAuditEvent(this.registryDb, {
        type: 'auto_request_pending',
        card_id: selectedCardId,
        skill_id: selectedSkillId ?? selectedCardId,
        tier_invoked: 3,
        credits: selectedCost,
        peer: selectedPeer,
      });

      return {
        status: 'tier_blocked',
        reason: 'Tier 3: owner approval required',
        peer: selectedPeer,
      };
    }

    // Step 6: Budget check
    if (!this.budgetManager.canSpend(selectedCost)) {
      this.logFailure(
        'auto_request_failed',
        selectedCardId,
        selectedSkillId ?? 'none',
        tier,
        selectedCost,
        selectedPeer,
        'Budget reserve would be breached'
      );
      return { status: 'budget_blocked', reason: 'Insufficient credits — reserve floor would be breached' };
    }

    const requestParams = selectedSkillId
      ? { skill_id: selectedSkillId, ...need.params, requester: this.owner }
      : { ...need.params, requester: this.owner };

    // Paid relay path: skip local escrow — relay holds escrow server-side.
    // This fixes the double-escrow bug where local holdEscrow + relay escrow
    // both reserved credits for the same request.
    if (selectedViaRelay && selectedCost > 0) {
      if (!this.registryUrl) {
        this.logFailure(
          'auto_request_failed',
          selectedCardId,
          selectedSkillId ?? 'none',
          tier,
          selectedCost,
          selectedPeer,
          'Relay target found but registryUrl is not configured'
        );
        return { status: 'no_peer', reason: 'Relay target found but registryUrl is not configured' };
      }

      const relayToken = this.mintRelayToken(selectedSkillId);
      if (!relayToken) {
        this.logFailure(
          'auto_request_failed',
          selectedCardId,
          selectedSkillId ?? 'none',
          tier,
          selectedCost,
          selectedPeer,
          'No signing identity available to mint UCAN for relay'
        );
        return {
          status: 'no_peer',
          reason: 'No signing identity available to mint UCAN for relay',
          peer: selectedPeer,
        };
      }

      try {
        const execResult = await requestViaTemporaryRelay({
          registryUrl: this.registryUrl,
          owner: this.owner,
          token: relayToken,
          targetOwner: selectedPeer,
          cardId: selectedCardId,
          skillId: selectedSkillId,
          params: requestParams,
        });

        // Tier 2 notification audit event
        if (tier === 2) {
          insertAuditEvent(this.registryDb, {
            type: 'auto_request_notify',
            card_id: selectedCardId,
            skill_id: selectedSkillId ?? selectedCardId,
            tier_invoked: 2,
            credits: selectedCost,
            peer: selectedPeer,
          });
        } else {
          insertAuditEvent(this.registryDb, {
            type: 'auto_request',
            card_id: selectedCardId,
            skill_id: selectedSkillId ?? selectedCardId,
            tier_invoked: 1,
            credits: selectedCost,
            peer: selectedPeer,
          });
        }

        return {
          status: 'success',
          result: execResult,
          peer: selectedPeer,
          creditsSpent: selectedCost,
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logFailure(
          'auto_request_failed',
          selectedCardId,
          selectedSkillId ?? 'none',
          tier,
          selectedCost,
          selectedPeer,
          `Execution failed: ${reason}`
        );
        return {
          status: 'failed',
          reason: `Execution failed: ${reason}`,
          peer: selectedPeer,
        };
      }
    }

    // Free/local path: use local escrow + direct HTTP
    // Step 7: Hold escrow
    const escrowId = holdEscrow(this.creditDb, this.owner, selectedCost, selectedCardId);

    // Step 8: Execute via peer gateway
    try {
      let execResult: unknown;
      if (selectedViaRelay) {
        // Free relay request (selectedCost === 0)
        if (!this.registryUrl) {
          this.logFailure(
            'auto_request_failed',
            selectedCardId,
            selectedSkillId ?? 'none',
            tier,
            selectedCost,
            selectedPeer,
            'Relay target found but registryUrl is not configured'
          );
          releaseEscrow(this.creditDb, escrowId);
          return { status: 'no_peer', reason: 'Relay target found but registryUrl is not configured' };
        }

        const freeRelayToken = this.mintRelayToken(selectedSkillId);
        if (!freeRelayToken) {
          this.logFailure(
            'auto_request_failed',
            selectedCardId,
            selectedSkillId ?? 'none',
            tier,
            selectedCost,
            selectedPeer,
            'No signing identity available to mint UCAN for relay'
          );
          releaseEscrow(this.creditDb, escrowId);
          return {
            status: 'no_peer',
            reason: 'No signing identity available to mint UCAN for relay',
            peer: selectedPeer,
          };
        }

        execResult = await requestViaTemporaryRelay({
          registryUrl: this.registryUrl,
          owner: this.owner,
          token: freeRelayToken,
          targetOwner: selectedPeer,
          cardId: selectedCardId,
          skillId: selectedSkillId,
          params: requestParams,
        });
      } else {
        const peerConfig = findPeer(selectedPeer);
        if (!peerConfig) {
          this.logFailure(
            'auto_request_failed',
            selectedCardId,
            selectedSkillId ?? 'none',
            tier,
            selectedCost,
            selectedPeer,
            'No gateway config for peer'
          );
          releaseEscrow(this.creditDb, escrowId);
          return { status: 'no_peer', reason: 'No gateway config for peer' };
        }

        execResult = await requestCapability({
          gatewayUrl: peerConfig.url,
          token: peerConfig.token,
          cardId: selectedCardId,
          params: requestParams,
        });
      }

      // Step 9a: Settle escrow on success
      settleEscrow(this.creditDb, escrowId, selectedPeer);

      // Step 10: Tier 2 notification audit event
      if (tier === 2) {
        insertAuditEvent(this.registryDb, {
          type: 'auto_request_notify',
          card_id: selectedCardId,
          skill_id: selectedSkillId ?? selectedCardId,
          tier_invoked: 2,
          credits: selectedCost,
          peer: selectedPeer,
        });
      } else {
        // Tier 1: log successful auto_request event
        insertAuditEvent(this.registryDb, {
          type: 'auto_request',
          card_id: selectedCardId,
          skill_id: selectedSkillId ?? selectedCardId,
          tier_invoked: 1,
          credits: selectedCost,
          peer: selectedPeer,
        });
      }

      return {
        status: 'success',
        result: execResult,
        escrowId,
        peer: selectedPeer,
        creditsSpent: selectedCost,
      };
    } catch (err) {
      // Step 9b: Release escrow on failure
      releaseEscrow(this.creditDb, escrowId);

      const reason = err instanceof Error ? err.message : String(err);
      this.logFailure(
        'auto_request_failed',
        selectedCardId,
        selectedSkillId ?? 'none',
        tier,
        selectedCost,
        selectedPeer,
        `Execution failed: ${reason}`
      );

      return {
        status: 'failed',
        reason: `Execution failed: ${reason}`,
        peer: selectedPeer,
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
