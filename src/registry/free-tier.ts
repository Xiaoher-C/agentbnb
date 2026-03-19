import type Database from 'better-sqlite3';

/**
 * Initializes the free-tier usage tracking table.
 * Idempotent — safe to call multiple times on startup.
 *
 * Table: credit_free_tier_usage
 *   Primary key: (agent_public_key, skill_id) — one row per agent per skill.
 *   usage_count — incremented on every capability use within the free tier.
 *   last_used_at — ISO 8601 timestamp of the most recent use.
 *
 * @param db - The credit database instance (creditDb).
 */
export function initFreeTierTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_free_tier_usage (
      agent_public_key TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT NOT NULL,
      PRIMARY KEY (agent_public_key, skill_id)
    )
  `);
}

/**
 * Records one use of a free-tier skill by the given agent.
 * Upserts the usage count — inserts on first use, increments on subsequent uses.
 *
 * @param db - The credit database instance (creditDb).
 * @param agentPublicKey - Hex-encoded Ed25519 public key of the requesting agent.
 * @param skillId - The skill ID being exercised (from the Capability Card's skills array).
 */
export function recordFreeTierUse(
  db: Database.Database,
  agentPublicKey: string,
  skillId: string,
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO credit_free_tier_usage (agent_public_key, skill_id, usage_count, last_used_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(agent_public_key, skill_id)
    DO UPDATE SET usage_count = usage_count + 1, last_used_at = ?
  `).run(agentPublicKey, skillId, now, now);
}

/**
 * Returns the current free-tier usage count for a given agent+skill pair.
 * Returns 0 if the agent has never used this skill.
 *
 * @param db - The credit database instance (creditDb).
 * @param agentPublicKey - Hex-encoded Ed25519 public key of the requesting agent.
 * @param skillId - The skill ID to look up.
 * @returns Number of times the agent has used the skill (0 if unknown).
 */
export function getFreeTierUsage(
  db: Database.Database,
  agentPublicKey: string,
  skillId: string,
): number {
  const row = db
    .prepare(
      'SELECT usage_count FROM credit_free_tier_usage WHERE agent_public_key = ? AND skill_id = ?',
    )
    .get(agentPublicKey, skillId) as { usage_count: number } | undefined;
  return row?.usage_count ?? 0;
}
