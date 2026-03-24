/**
 * Shared types for the Conductor module — task decomposition, matching, budgeting, and orchestration.
 */

/**
 * A single sub-task produced by the TaskDecomposer.
 * Represents one step in a multi-step orchestration plan.
 */
export interface SubTask {
  /** Unique identifier for this sub-task (UUID). */
  id: string;
  /** Human-readable description of what this step does. */
  description: string;
  /** The capability category required to execute this step (e.g. 'tts', 'text_gen'). */
  required_capability: string;
  /** Parameters to pass to the executing agent's skill. */
  params: Record<string, unknown>;
  /** IDs of sub-tasks that must complete before this one can start. */
  depends_on: string[];
  /** Estimated credit cost for this step. */
  estimated_credits: number;
}

/**
 * Result of matching a SubTask to an available agent/skill.
 */
export interface MatchResult {
  /** ID of the sub-task this match is for. */
  subtask_id: string;
  /** Owner/agent ID of the selected peer. */
  selected_agent: string;
  /** Skill ID on the selected agent's card. */
  selected_skill: string;
  /** Capability card ID of the selected agent. Used for relay execution of remote agents. */
  selected_card_id?: string;
  /** Match quality score (0-1). */
  score: number;
  /** Negotiated credit cost. */
  credits: number;
  /** Alternative matches considered. */
  alternatives: Array<{
    agent: string;
    skill: string;
    score: number;
    credits: number;
  }>;
}

/**
 * Budget constraints for an orchestration run.
 */
export interface ExecutionBudget {
  /** Sum of all sub-task estimated_credits. */
  estimated_total: number;
  /** Hard ceiling — abort if exceeded. */
  max_budget: number;
  /** Credits retained by the Conductor for coordination. */
  orchestration_fee: number;
  /** Per-task actual spending tracker. */
  per_task_spending: Map<string, number>;
  /** Whether human/agent approval is needed before execution. */
  requires_approval: boolean;
}

/**
 * Depth context passed through nested Conductor calls to enforce recursion limits.
 * Included in params when Conductor requests another agent's task_decomposition skill.
 */
export interface ConductorRequestContext {
  /** Number of nested decomposition calls. 0 = top-level; >= 1 = already decomposed. */
  decomposition_depth: number;
  /** Number of nested orchestration calls. 0 = top-level; >= 2 = error. */
  orchestration_depth: number;
}

/**
 * Final result of a completed orchestration.
 */
export interface OrchestrationResult {
  /** Whether all sub-tasks completed successfully. */
  success: boolean;
  /** Per-subtask output data, keyed by sub-task ID. */
  results: Map<string, unknown>;
  /** Total credits spent across all sub-tasks + orchestration fee. */
  total_credits: number;
  /** Wall-clock time from start to finish. */
  latency_ms: number;
  /** Error messages for failed sub-tasks. */
  errors?: string[];
  /**
   * Per-task team traceability context. Keys are subtask IDs.
   * Present only when the orchestration ran with a team.
   */
  trace?: Map<string, { team_id: string | null; capability_type: string | null }>;
}
