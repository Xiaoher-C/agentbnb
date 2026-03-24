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
import { getCardsBySkillCapability } from '../registry/store.js';
import type { AnyCard, CapabilityCardV2 } from '../types/index.js';

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
 * Forms a Team from SubTask[] using capability-first agent selection.
 *
 * Algorithm:
 * For each subtask:
 * 1. Run matchSubTasks() using the subtask's required_capability
 * 2. Apply strategy-specific selection on candidates
 * 3. Create TeamMember with capability_type = subtask.required_capability
 * 4. If no agent found, add subtask to unrouted[]
 *
 * Every subtask participates in matching — no role-hint filtering.
 *
 * @param opts - Formation options.
 * @returns Team with matched members and unrouted subtasks.
 */
export async function formTeam(opts: FormTeamOptions): Promise<Team> {
  const { subtasks, strategy, db, conductorOwner, registryUrl } = opts;

  const team_id = randomUUID();

  if (subtasks.length === 0) {
    return { team_id, strategy, matched: [], unrouted: [] };
  }

  const matched: TeamMember[] = [];
  const unrouted: SubTask[] = [];

  for (const subtask of subtasks) {
    // Step 1: skill-level exact capability match (capability_type or capability_types[])
    const skillCards = getCardsBySkillCapability(db, subtask.required_capability)
      .filter((c) => (c as AnyCard & { owner?: string }).owner !== conductorOwner);

    if (skillCards.length > 0) {
      const candidates = skillCards.map((card) => {
        const skills = (card as CapabilityCardV2).skills ?? [];
        const matchingSkill = skills.find(
          (s) =>
            s.capability_type === subtask.required_capability ||
            (s.capability_types ?? []).includes(subtask.required_capability),
        );
        return {
          subtask_id: subtask.id,
          selected_agent: (card as AnyCard & { owner: string }).owner,
          selected_skill: matchingSkill?.id ?? '',
          selected_card_id: card.id,
          score: 1.0,
          credits: matchingSkill?.pricing.credits_per_call ?? 0,
          alternatives: [] as Array<{ agent: string; skill: string; score: number; credits: number }>,
        };
      });

      const selected = selectByStrategy(candidates, strategy)!;
      matched.push({
        subtask,
        capability_type: subtask.required_capability,
        agent: selected.selected_agent,
        skill: selected.selected_skill,
        card_id: selected.selected_card_id,
        credits: selected.credits,
        score: selected.score,
      });
      continue;
    }

    // Step 2: FTS5 fallback via matchSubTasks
    const matchResults = await matchSubTasks({
      db,
      subtasks: [subtask],
      conductorOwner,
      registryUrl,
    });

    const m = matchResults[0];

    // No match found or empty selected_agent — add to unrouted
    if (!m || m.selected_agent === '') {
      unrouted.push(subtask);
      continue;
    }

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
      capability_type: subtask.required_capability,
      agent: selected.selected_agent,
      skill: selected.selected_skill,
      card_id: selected === m ? m.selected_card_id : undefined,
      credits: selected.credits,
      score: selected.score,
    });
  }

  return { team_id, strategy, matched, unrouted };
}
