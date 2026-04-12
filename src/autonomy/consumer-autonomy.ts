/**
 * Consumer-side autonomy guard.
 *
 * Mirrors the provider-side autonomy model (tiers.ts) for the consumer:
 * tracks cumulative spend across MCP tool calls in a session and enforces
 * budget caps to prevent uncontrolled multi-skill spending.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Consumer autonomy configuration.
 * Controls how aggressively the consumer agent can spend credits autonomously.
 */
export interface ConsumerAutonomyConfig {
  /**
   * Maximum total credits the agent may spend in a single MCP session.
   * When cumulative spend reaches this cap, further paid requests are blocked.
   * Default: 50.
   */
  session_budget: number;

  /**
   * Maximum credits for a single request.
   * Requests estimated to cost more than this are blocked before execution.
   * Default: 20.
   */
  single_request_max: number;

  /**
   * Policy when a second (or subsequent) paid skill is requested in the same session:
   * - `auto`   — allow silently (current behavior, no guard)
   * - `notify` — allow but include a spend warning in the response
   * - `block`  — reject with an error asking the consumer to confirm intent
   * Default: 'notify'.
   */
  multi_skill_policy: 'auto' | 'notify' | 'block';
}

/**
 * Mutable session state tracked across MCP tool calls.
 * Lives on McpServerContext for the lifetime of the MCP connection.
 */
export interface ConsumerSessionState {
  /** Total credits spent so far in this session. */
  totalSpent: number;
  /** Number of paid skill calls made so far. */
  paidCallCount: number;
}

/**
 * Result of a consumer budget check.
 */
export interface BudgetCheckResult {
  /** Whether the request is allowed to proceed. */
  allowed: boolean;
  /** Warning message to include in the response (when allowed but noteworthy). */
  warning?: string;
  /** Error message when blocked. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default consumer autonomy config — safe but not overly restrictive.
 * - session_budget: 50 credits per session
 * - single_request_max: 20 credits per request
 * - multi_skill_policy: 'notify' (warn on second paid skill)
 */
export const DEFAULT_CONSUMER_AUTONOMY: ConsumerAutonomyConfig = {
  session_budget: 50,
  single_request_max: 20,
  multi_skill_policy: 'notify',
};

/**
 * Creates a fresh session state (used at MCP server startup).
 */
export function createSessionState(): ConsumerSessionState {
  return { totalSpent: 0, paidCallCount: 0 };
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Checks whether a consumer request should be allowed given the current
 * session state and autonomy configuration.
 *
 * @param config - Consumer autonomy configuration.
 * @param session - Current session spend state.
 * @param estimatedCost - Estimated credit cost for this request (0 for free skills).
 * @returns Check result with allowed/warning/error.
 */
export function checkConsumerBudget(
  config: ConsumerAutonomyConfig,
  session: ConsumerSessionState,
  estimatedCost: number,
): BudgetCheckResult {
  // Free requests are always allowed
  if (estimatedCost <= 0) {
    return { allowed: true };
  }

  // Single request cap
  if (estimatedCost > config.single_request_max) {
    return {
      allowed: false,
      error: `Request cost (${estimatedCost} credits) exceeds single_request_max (${config.single_request_max}). ` +
        `Adjust consumer_autonomy.single_request_max in config to allow higher-cost requests.`,
    };
  }

  // Session budget cap
  if (session.totalSpent + estimatedCost > config.session_budget) {
    return {
      allowed: false,
      error: `Session budget exceeded: spent ${session.totalSpent} + requested ${estimatedCost} = ${session.totalSpent + estimatedCost} credits, ` +
        `but session_budget is ${config.session_budget}. ` +
        `This session has already made ${session.paidCallCount} paid call(s).`,
    };
  }

  // Multi-skill policy: check if this is a subsequent paid call
  if (session.paidCallCount > 0) {
    if (config.multi_skill_policy === 'block') {
      return {
        allowed: false,
        error: `Multi-skill block: this would be paid call #${session.paidCallCount + 1} in this session ` +
          `(total spent: ${session.totalSpent}, this request: ${estimatedCost} credits). ` +
          `consumer_autonomy.multi_skill_policy is "block". ` +
          `Only one paid skill call is allowed per session unless policy is changed.`,
      };
    }

    if (config.multi_skill_policy === 'notify') {
      return {
        allowed: true,
        warning: `This is paid call #${session.paidCallCount + 1} in this session. ` +
          `Cumulative spend: ${session.totalSpent} + ${estimatedCost} = ${session.totalSpent + estimatedCost} credits ` +
          `(session budget: ${config.session_budget}).`,
      };
    }
  }

  // auto policy or first paid call — allow silently
  return { allowed: true };
}

/**
 * Records a successful paid request in the session state.
 *
 * @param session - Mutable session state to update.
 * @param creditsSpent - Credits actually charged for the completed request.
 */
export function recordConsumerSpend(session: ConsumerSessionState, creditsSpent: number): void {
  if (creditsSpent > 0) {
    session.totalSpent += creditsSpent;
    session.paidCallCount += 1;
  }
}
