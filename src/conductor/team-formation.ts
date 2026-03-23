/**
 * Team formation — assembles a Team from SubTask[] using role-aware agent selection.
 *
 * Reuses CapabilityMatcher (matchSubTasks) for agent discovery.
 * Strategy controls candidate ranking within each role group.
 *
 * Roles are ROUTING HINTS ONLY — not permissions, not hierarchy.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SubTask, MatchResult } from './types.js';
import type { Team, TeamMember, FormationStrategy } from './role-schema.js';
import { matchSubTasks } from './capability-matcher.js';

/**
 * Options for formTeam().
 */
export interface FormTeamOptions {
  /** Sub-tasks to form a team from (may or may not have role hints). */
  subtasks: SubTask[];
  /** Agent selection strategy. */
  strategy: FormationStrategy;
  /** Open SQLite registry database. */
  db: Database.Database;
  /** Owner of the conductor agent — excluded from matching (self-exclusion). */
  conductorOwner: string;
  /** Optional remote registry URL fallback. */
  registryUrl?: string;
}

/**
 * Selects the best MatchResult from a list using the given strategy.
 * 'balanced' returns the first result (already ranked by scorePeers composite score).
 * 'quality_optimized' returns the highest score.
 * 'cost_optimized' returns the lowest credits (ties broken by highest score).
 */
function selectByStrategy(matches: MatchResult[], strategy: FormationStrategy): MatchResult | undefined {
  if (matches.length === 0) return undefined;

  if (strategy === 'balanced') {
    // Default scorePeers ranking — first result is best composite
    return matches[0];
  }

  if (strategy === 'quality_optimized') {
    return matches.reduce((best, m) => (m.score > best.score ? m : best), matches[0]!);
  }

  // cost_optimized: lowest credits, tie-break by highest score
  return matches.reduce((best, m) => {
    if (m.credits < best.credits) return m;
    if (m.credits === best.credits && m.score > best.score) return m;
    return best;
  }, matches[0]!);
}

/**
 * Forms a Team from SubTask[] using role-aware agent selection.
 *
 * Algorithm:
 * 1. Separate subtasks into role-hinted and role-less
 * 2. Run matchSubTasks() on all role-hinted subtasks
 * 3. Apply strategy-specific selection within the match results
 * 4. Return Team with matched members and unrouted subtasks
 *
 * SubTasks without a role hint go directly to unrouted[].
 * SubTasks with a role hint but no available agent also go to unrouted[].
 *
 * @param opts - Formation options.
 * @returns Team with matched members and unrouted subtasks.
 */
export async function formTeam(opts: FormTeamOptions): Promise<Team> {
  const { subtasks, strategy, db, conductorOwner, registryUrl } = opts;

  const team_id = randomUUID();
  const roledSubtasks = subtasks.filter((s) => s.role !== undefined);
  const rolelessSubtasks = subtasks.filter((s) => s.role === undefined);

  if (roledSubtasks.length === 0) {
    return { team_id, strategy, matched: [], unrouted: rolelessSubtasks };
  }

  // matchSubTasks returns results in the same order as input subtasks
  const matchResults = await matchSubTasks({
    db,
    subtasks: roledSubtasks,
    conductorOwner,
    registryUrl,
  });

  // Build a map from subtask_id to MatchResult for O(1) lookup
  const matchMap = new Map<string, MatchResult>(matchResults.map((m) => [m.subtask_id, m]));

  const matched: TeamMember[] = [];
  const unrouted: SubTask[] = [...rolelessSubtasks];

  for (const subtask of roledSubtasks) {
    const m = matchMap.get(subtask.id);

    // No match found or empty selected_agent — add to unrouted
    if (!m || m.selected_agent === '') {
      unrouted.push(subtask);
      continue;
    }

    // For cost_optimized and quality_optimized, consider alternatives alongside primary
    // Build a candidate list: primary + alternatives in MatchResult format for selectByStrategy
    const allCandidates: MatchResult[] = [
      m,
      ...m.alternatives.map((alt) => ({
        subtask_id: m.subtask_id,
        selected_agent: alt.agent,
        selected_skill: alt.skill,
        score: alt.score,
        credits: alt.credits,
        alternatives: [],
      })),
    ];

    const selected = selectByStrategy(allCandidates, strategy)!;

    matched.push({
      subtask,
      role: subtask.role!,
      agent: selected.selected_agent,
      skill: selected.selected_skill,
      card_id: selected === m ? m.selected_card_id : undefined,
      credits: selected.credits,
      score: selected.score,
    });
  }

  return { team_id, strategy, matched, unrouted };
}
