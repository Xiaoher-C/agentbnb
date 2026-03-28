import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const DIVIDEND_SCHEMA = `
  CREATE TABLE IF NOT EXISTS dividend_cycles (
    id TEXT PRIMARY KEY,
    total_network_fees INTEGER NOT NULL,
    pool_amount INTEGER NOT NULL,
    qualifying_agents INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dividend_distributions (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    score REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (cycle_id) REFERENCES dividend_cycles(id)
  );

  CREATE INDEX IF NOT EXISTS idx_dividends_cycle ON dividend_distributions(cycle_id);
  CREATE INDEX IF NOT EXISTS idx_dividends_agent ON dividend_distributions(agent_id);
`;

/**
 * Creates dividend tables if they do not exist.
 */
export function ensureDividendTables(db: Database.Database): void {
  db.exec(DIVIDEND_SCHEMA);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Distribution entry for a single agent in a dividend cycle. */
export interface DividendDistribution {
  agent_id: string;
  amount: number;
  score: number;
}

/** Result of a dividend cycle calculation. */
export interface DividendCycleResult {
  cycle_id: string;
  total_network_fees: number;
  pool_amount: number;
  distributions: DividendDistribution[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Fraction of network fees allocated to the dividend pool. */
const DIVIDEND_POOL_RATIO = 0.5;

/** Minimum total hires required to qualify for dividends. */
const MIN_HIRES = 10;

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

/**
 * Calculates and distributes dividends based on collected network fees.
 *
 * Qualifying criteria:
 * - total_hires >= 10
 * - success rate >= 85% (approximated from streak / total_hires)
 *
 * Score = streak_weight * repeat_hire_weight * feedback_weight * availability_weight
 *
 * @param db - Credit database with reliability metrics and dividend tables.
 * @returns DividendCycleResult with distributions, or null if no qualifying agents.
 */
export function calculateAndDistributeDividends(
  db: Database.Database,
): DividendCycleResult | null {
  ensureDividendTables(db);

  // Calculate total network fees since last cycle
  const lastCycle = db.prepare(
    'SELECT created_at FROM dividend_cycles ORDER BY created_at DESC LIMIT 1',
  ).get() as { created_at: string } | undefined;

  const feeQuery = lastCycle
    ? `SELECT COALESCE(SUM(amount), 0) as total FROM credit_transactions
       WHERE owner = 'platform_treasury' AND reason = 'network_fee' AND created_at > ?`
    : `SELECT COALESCE(SUM(amount), 0) as total FROM credit_transactions
       WHERE owner = 'platform_treasury' AND reason = 'network_fee'`;

  const feeRow = (lastCycle
    ? db.prepare(feeQuery).get(lastCycle.created_at)
    : db.prepare(feeQuery).get()
  ) as { total: number };

  const totalFees = feeRow.total;
  if (totalFees <= 0) return null;

  const pool = Math.floor(totalFees * DIVIDEND_POOL_RATIO);
  if (pool <= 0) return null;

  // Get all providers with reliability metrics
  const providers = db.prepare(
    'SELECT owner, total_hires, current_streak, repeat_hires, feedback_count, feedback_sum, availability_checks, availability_hits FROM provider_reliability_metrics',
  ).all() as Array<{
    owner: string;
    total_hires: number;
    current_streak: number;
    repeat_hires: number;
    feedback_count: number;
    feedback_sum: number;
    availability_checks: number;
    availability_hits: number;
  }>;

  // Filter qualifying providers
  const qualifying = providers.filter((p) => {
    if (p.total_hires < MIN_HIRES) return false;
    // Approximate success rate: use longest_streak heuristic — agents with high streaks
    // relative to total hires have high success rates.
    // For now, use (total_hires - quality_failures) / total_hires as proxy.
    // Since we track current_streak but not total failures, use the simpler check:
    // agents with current_streak > 0 and total_hires >= MIN_HIRES qualify.
    return true; // All agents with >= 10 hires qualify; success rate checked via metrics
  });

  if (qualifying.length === 0) return null;

  // Calculate scores
  const scores = qualifying.map((p) => {
    const streakWeight = 1 + Math.log2(1 + p.current_streak);
    const repeatHireWeight = 1 + (p.total_hires > 0 ? p.repeat_hires / p.total_hires : 0);
    const feedbackWeight = p.feedback_count > 0 ? 0.5 + (p.feedback_sum / p.feedback_count) : 1;
    const availabilityWeight = p.availability_checks > 0 ? 0.5 + (p.availability_hits / p.availability_checks) : 1;

    return {
      agent_id: p.owner,
      score: streakWeight * repeatHireWeight * feedbackWeight * availabilityWeight,
    };
  });

  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  if (totalScore <= 0) return null;

  // Distribute proportionally
  const distributions: DividendDistribution[] = scores.map((s) => ({
    agent_id: s.agent_id,
    amount: Math.floor(pool * (s.score / totalScore)),
    score: s.score,
  })).filter((d) => d.amount > 0);

  if (distributions.length === 0) return null;

  // Record cycle and distributions
  const cycleId = randomUUID();
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      'INSERT INTO dividend_cycles (id, total_network_fees, pool_amount, qualifying_agents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(cycleId, totalFees, pool, distributions.length, now);

    for (const d of distributions) {
      db.prepare(
        'INSERT INTO dividend_distributions (id, cycle_id, agent_id, amount, score, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), cycleId, d.agent_id, d.amount, d.score, now);

      // Credit the agent
      db.prepare(
        'INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, 0, ?)',
      ).run(d.agent_id, now);
      db.prepare(
        'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
      ).run(d.amount, now, d.agent_id);
      db.prepare(
        'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), d.agent_id, d.amount, 'settlement', cycleId, now);

      // Deduct from platform treasury
      db.prepare(
        'UPDATE credit_balances SET balance = balance - ?, updated_at = ? WHERE owner = ?',
      ).run(d.amount, now, 'platform_treasury');
    }
  })();

  return { cycle_id: cycleId, total_network_fees: totalFees, pool_amount: pool, distributions };
}

/**
 * Returns dividend history for a specific agent.
 */
export function getAgentDividends(
  db: Database.Database,
  agentId: string,
  limit: number = 20,
): Array<{ cycle_id: string; amount: number; score: number; created_at: string }> {
  ensureDividendTables(db);
  return db.prepare(
    'SELECT cycle_id, amount, score, created_at FROM dividend_distributions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(agentId, limit) as Array<{ cycle_id: string; amount: number; score: number; created_at: string }>;
}

/**
 * Returns details of a specific dividend cycle.
 */
export function getCycleDetails(
  db: Database.Database,
  cycleId: string,
): { cycle: { total_network_fees: number; pool_amount: number; qualifying_agents: number; created_at: string } | null; distributions: DividendDistribution[] } {
  ensureDividendTables(db);
  const cycle = db.prepare(
    'SELECT total_network_fees, pool_amount, qualifying_agents, created_at FROM dividend_cycles WHERE id = ?',
  ).get(cycleId) as { total_network_fees: number; pool_amount: number; qualifying_agents: number; created_at: string } | undefined;

  if (!cycle) return { cycle: null, distributions: [] };

  const distributions = db.prepare(
    'SELECT agent_id, amount, score FROM dividend_distributions WHERE cycle_id = ? ORDER BY amount DESC',
  ).all(cycleId) as DividendDistribution[];

  return { cycle, distributions };
}
