import type Database from 'better-sqlite3';
import type { AgentBnBConfig } from '../cli/config.js';
import type { AutonomyConfig } from '../autonomy/tiers.js';
import { DEFAULT_AUTONOMY_CONFIG } from '../autonomy/tiers.js';
import { DEFAULT_BUDGET_CONFIG } from '../credit/budget.js';
import { getBalance } from '../credit/ledger.js';
import { listCards } from '../registry/store.js';

/**
 * Summary of an individual skill as shown in the openclaw status output.
 */
export interface SkillStatus {
  /** Stable skill identifier. */
  id: string;
  /** Human-readable skill name. */
  name: string;
  /** Last computed idle rate (0.0–1.0), or null if not yet computed. */
  idle_rate: number | null;
  /** Whether this skill is currently marked online. */
  online: boolean;
}

/**
 * Full status report for the OpenClaw integration.
 * Returned by getOpenClawStatus().
 */
export interface OpenClawStatus {
  /** Always true — indicates AgentBnB is installed and config is readable. */
  installed: boolean;
  /** Agent owner identifier from config. */
  owner: string;
  /** Gateway URL from config. */
  gateway_url: string;
  /** Active autonomy tier thresholds. */
  tier: AutonomyConfig;
  /** Current credit balance. */
  balance: number;
  /** Credit reserve floor from budget config. */
  reserve: number;
  /** Per-skill status for all skills on v2.0 cards owned by this agent. */
  skills: SkillStatus[];
}

/**
 * Reads config, registry, and credit DB to produce a full OpenClaw status summary.
 *
 * This function only performs read operations (SELECT) and is safe to call
 * concurrently with a running `agentbnb serve` process (WAL mode allows concurrent readers).
 *
 * @param config - Loaded AgentBnB configuration.
 * @param db - Open registry database instance.
 * @param creditDb - Open credit database instance.
 * @returns OpenClawStatus with tier config, balance, reserve, and per-skill idle rates.
 */
export function getOpenClawStatus(
  config: AgentBnBConfig,
  db: Database.Database,
  creditDb: Database.Database,
): OpenClawStatus {
  const autonomy = config.autonomy ?? DEFAULT_AUTONOMY_CONFIG;
  const budget = config.budget ?? DEFAULT_BUDGET_CONFIG;
  const balance = getBalance(creditDb, config.owner);

  // Get all cards for this owner, filter for v2.0 only
  const allCards = listCards(db, config.owner);
  const skills: SkillStatus[] = [];

  for (const card of allCards) {
    // Use unknown narrowing to check spec_version without modifying store.ts types
    const anyCard = card as unknown as { spec_version?: string; skills?: unknown[] };
    if (anyCard.spec_version !== '2.0' || !Array.isArray(anyCard.skills)) continue;

    for (const skill of anyCard.skills as Array<Record<string, unknown>>) {
      const internal = (skill['_internal'] as Record<string, unknown> | undefined) ?? {};
      const idleRate = typeof internal['idle_rate'] === 'number' ? internal['idle_rate'] : null;
      const availability = skill['availability'] as { online?: boolean } | undefined;
      const online = availability?.online ?? false;

      skills.push({
        id: String(skill['id'] ?? ''),
        name: String(skill['name'] ?? ''),
        idle_rate: idleRate,
        online,
      });
    }
  }

  return {
    installed: true,
    owner: config.owner,
    gateway_url: config.gateway_url,
    tier: autonomy,
    balance,
    reserve: budget.reserve_credits,
    skills,
  };
}
