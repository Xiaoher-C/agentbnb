import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { listCards } from './store.js';

/** Options for providerRoutesPlugin. */
export interface ProviderRoutesOptions {
  registryDb: Database.Database;
  creditDb?: Database.Database;
}

/**
 * Fastify plugin that registers provider reliability and fleet endpoints.
 *
 *   GET /api/providers/:owner/reliability — Provider reliability metrics
 *   GET /api/fleet/:owner               — Agent fleet overview
 */
export async function providerRoutesPlugin(
  fastify: FastifyInstance,
  options: ProviderRoutesOptions,
): Promise<void> {
  const { registryDb: db, creditDb } = options;

  /**
   * GET /api/providers/:owner/reliability — Provider reliability metrics.
   */
  fastify.get('/api/providers/:owner/reliability', {
    schema: {
      tags: ['agents'],
      summary: 'Get provider reliability metrics',
      params: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] },
      response: {
        200: {
          type: 'object',
          properties: {
            current_streak: { type: 'integer' },
            longest_streak: { type: 'integer' },
            total_hires: { type: 'integer' },
            repeat_hires: { type: 'integer' },
            repeat_hire_rate: { type: 'number' },
            avg_feedback_score: { type: 'number' },
            availability_rate: { type: 'number' },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { owner } = request.params as { owner: string };
    if (!creditDb) {
      return reply.code(404).send({ error: 'Credit system not enabled' });
    }
    const { getReliabilityMetrics } = await import('../credit/reliability-metrics.js');
    const metrics = getReliabilityMetrics(creditDb, owner);
    if (!metrics) {
      return reply.code(404).send({ error: 'No reliability data for this provider' });
    }
    return reply.send(metrics);
  });

  /**
   * GET /api/fleet/:owner — Agent fleet overview for the given owner.
   * Returns all cards owned by the account with per-agent metrics.
   */
  fastify.get('/api/fleet/:owner', {
    schema: {
      tags: ['agents'],
      summary: 'Agent fleet overview for an owner',
      params: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] },
      response: {
        200: { type: 'object', properties: { agents: { type: 'array' } } },
      },
    },
  }, async (request, reply) => {
    const { owner } = request.params as { owner: string };
    const cards = listCards(db, owner);

    // Batch request stats per card (N+1 fix) — single query for all cards
    const cardIds = cards.map((c) => c.id);
    const cardIdPlaceholders = cardIds.map(() => '?').join(',');

    // Batch success/failure counts
    const statsMap = new Map<string, { successes: number; failures: number }>();
    if (cardIds.length > 0) {
      const statsRows = db.prepare(`
        SELECT card_id,
               SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
               SUM(CASE WHEN status IN ('failure', 'timeout', 'refunded') THEN 1 ELSE 0 END) as failures
        FROM request_log
        WHERE card_id IN (${cardIdPlaceholders}) AND (action_type IS NULL OR action_type = 'auto_share')
        GROUP BY card_id
      `).all(...cardIds) as Array<{ card_id: string; successes: number; failures: number }>;
      for (const row of statsRows) {
        statsMap.set(row.card_id, { successes: row.successes, failures: row.failures });
      }
    }

    // Batch failure breakdown
    const failureMap = new Map<string, Record<string, number>>();
    if (cardIds.length > 0) {
      try {
        const failureRows = db.prepare(`
          SELECT card_id, failure_reason, COUNT(*) as cnt
          FROM request_log
          WHERE card_id IN (${cardIdPlaceholders}) AND status IN ('failure', 'timeout', 'refunded') AND failure_reason IS NOT NULL
          GROUP BY card_id, failure_reason
        `).all(...cardIds) as Array<{ card_id: string; failure_reason: string; cnt: number }>;
        for (const fr of failureRows) {
          const existing = failureMap.get(fr.card_id) ?? {};
          existing[fr.failure_reason] = fr.cnt;
          failureMap.set(fr.card_id, existing);
        }
      } catch {
        // failure_reason column may not exist in older schemas
      }
    }

    // Hoist reliability metrics import outside the loop
    const reliabilityModule = creditDb
      ? await import('../credit/reliability-metrics.js')
      : null;

    const agents = [];
    for (const card of cards) {
      try {
        const rawCard = card as Record<string, unknown>;
        const providerIdentity =
          typeof card.agent_id === 'string' && card.agent_id.length > 0
            ? card.agent_id
            : card.owner;

        // Per-agent earnings/spend from credit transactions
        let earnings = 0;
        let spend = 0;
        if (creditDb) {
          const earningRow = creditDb.prepare(
            "SELECT COALESCE(SUM(amount), 0) as total FROM credit_transactions WHERE owner = ? AND reason = 'settlement' AND amount > 0",
          ).get(providerIdentity) as { total: number };
          earnings = earningRow.total;
          const spendRow = creditDb.prepare(
            "SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM credit_transactions WHERE owner = ? AND reason = 'escrow_hold'",
          ).get(providerIdentity) as { total: number };
          spend = spendRow.total;
        }

        // Use batched stats instead of per-card queries
        const stats = statsMap.get(card.id) ?? { successes: 0, failures: 0 };
        const successCount = stats.successes;
        const failureCount = stats.failures;
        const totalExec = successCount + failureCount;
        const successRate = totalExec > 0 ? successCount / totalExec : 0;

        const failureBreakdown = failureMap.get(card.id) ?? {};

        // Reliability metrics (import hoisted outside loop)
        let reliability = null;
        if (reliabilityModule) {
          reliability = reliabilityModule.getReliabilityMetrics(creditDb!, providerIdentity);
        }

        agents.push({
          id: card.id,
          name:
            (typeof rawCard['name'] === 'string' ? rawCard['name'] : undefined) ??
            (typeof rawCard['agent_name'] === 'string' ? rawCard['agent_name'] : undefined) ??
            card.owner,
          online: card.availability?.online ?? false,
          current_load: 0, // Will be populated from relay heartbeat data in future
          success_rate: successRate,
          total_executions: totalExec,
          earnings,
          spend,
          failure_breakdown: failureBreakdown,
          reliability,
        });
      } catch {
        // Skip malformed cards
      }
    }

    return reply.send({ agents });
  });
}
