/**
 * Role-based team data model for Conductor team formation.
 *
 * Roles are ROUTING HINTS ONLY — not authorization boundaries, not hierarchy levels.
 */

import type { Role } from '../types/index.js';
import type { SubTask, MatchResult } from './types.js';

export type { Role };

/**
 * A single team member: a SubTask matched to an agent.
 */
export interface TeamMember {
  /** The sub-task this member handles. */
  subtask: SubTask;
  /** Routing hint role for this member's position. */
  role: Role;
  /** Owner ID of the matched agent. */
  agent: string;
  /** Skill ID on the agent's card for this task. */
  skill: string;
  /** Card ID for relay-based execution. */
  card_id?: string;
  /** Negotiated credit cost. */
  credits: number;
  /** Match quality score (0-1). */
  score: number;
}

/**
 * A fully-formed team: matched members + unrouted subtasks.
 * Unrouted subtasks either had no role hint or no available matching agent.
 */
export interface Team {
  /** Unique team identifier (UUID). */
  team_id: string;
  /** Formation strategy used to select agents. */
  strategy: FormationStrategy;
  /** Successfully matched team members. */
  matched: TeamMember[];
  /**
   * Sub-tasks that could not be matched — either missing a role hint
   * or no available agent found in the registry.
   * Callers should decide whether to fail-fast or proceed with partial teams.
   */
  unrouted: SubTask[];
}

/**
 * Agent selection strategy for team formation.
 *
 * cost_optimized     — select the lowest-cost agent per sub-task
 * quality_optimized  — select the highest-scored agent per sub-task (success_rate × cost_efficiency × idle_rate)
 * balanced           — use the default scorePeers() composite ranking (same as standard matchSubTasks)
 */
export type FormationStrategy = 'cost_optimized' | 'quality_optimized' | 'balanced';

// Re-export MatchResult for convenience (used in team-formation.ts)
export type { MatchResult };
