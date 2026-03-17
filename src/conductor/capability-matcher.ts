/**
 * CapabilityMatcher — finds the best agent for each sub-task using registry search + peer scoring.
 *
 * Wraps the existing searchCards() for card discovery and scorePeers() for ranked selection
 * with self-exclusion. Returns alternatives for failover when the primary agent fails.
 */

import type Database from 'better-sqlite3';
import { searchCards } from '../registry/matcher.js';
import { scorePeers, type Candidate } from '../autonomy/auto-request.js';
import type { SubTask, MatchResult } from './types.js';
import type { CapabilityCard } from '../types/index.js';

/** Maximum number of alternative agents to return per sub-task. */
const MAX_ALTERNATIVES = 2;

/**
 * Options for matchSubTasks.
 */
export interface MatchOptions {
  /** Open SQLite database with registry tables. */
  db: Database.Database;
  /** Sub-tasks to find agents for. */
  subtasks: SubTask[];
  /** Owner ID of the conductor agent — excluded from matches (self-exclusion). */
  conductorOwner: string;
}

/**
 * Finds the best agent for each sub-task using registry FTS search and peer scoring.
 *
 * For each sub-task:
 * 1. Searches cards via FTS5 with `{ online: true }` filter
 * 2. Builds Candidate[] from both v1.0 (card-level pricing) and v2.0 (skill-level pricing) cards
 * 3. Scores and ranks candidates via scorePeers() with self-exclusion
 * 4. Selects the top scorer as the primary agent and up to 2 alternatives
 *
 * Sub-tasks with no matching cards return a MatchResult with empty selected_agent and score 0.
 *
 * @param opts - Match configuration including database, subtasks, and conductor owner ID.
 * @returns MatchResult[] in the same order as the input subtasks.
 */
export function matchSubTasks(opts: MatchOptions): MatchResult[] {
  const { db, subtasks, conductorOwner } = opts;

  return subtasks.map((subtask) => {
    // Step 1: Search for matching cards (online only)
    const cards = searchCards(db, subtask.required_capability, { online: true });

    // Step 2: Build candidates from both v1.0 and v2.0 cards
    const candidates: Candidate[] = [];

    for (const card of cards) {
      const cardAsV2 = card as CapabilityCard & {
        skills?: Array<{ id: string; pricing: { credits_per_call: number } }>;
      };

      if (Array.isArray(cardAsV2.skills)) {
        // v2.0 multi-skill card — each skill is a separate candidate
        for (const skill of cardAsV2.skills) {
          candidates.push({
            card,
            cost: skill.pricing.credits_per_call,
            skillId: skill.id,
          });
        }
      } else {
        // v1.0 card — card-level pricing
        candidates.push({
          card,
          cost: card.pricing.credits_per_call,
          skillId: undefined,
        });
      }
    }

    // Step 3: Score with self-exclusion
    const scored = scorePeers(candidates, conductorOwner);

    // Step 4: No candidates — return empty match
    if (scored.length === 0) {
      return {
        subtask_id: subtask.id,
        selected_agent: '',
        selected_skill: '',
        score: 0,
        credits: 0,
        alternatives: [],
      };
    }

    // Step 5: Top scorer is primary, next scorers are alternatives
    const top = scored[0]!;
    const alternatives = scored.slice(1, 1 + MAX_ALTERNATIVES).map((s) => ({
      agent: s.card.owner,
      skill: s.skillId ?? '',
      score: s.rawScore,
      credits: s.cost,
    }));

    return {
      subtask_id: subtask.id,
      selected_agent: top.card.owner,
      selected_skill: top.skillId ?? '',
      score: top.rawScore,
      credits: top.cost,
      alternatives,
    };
  });
}
