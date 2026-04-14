import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { listCards } from './store.js';
import { getActivityFeed } from './request-log.js';
import type { CapabilityCardV2 } from '../types/index.js';
import type { RelayState } from '../relay/types.js';

/** Options for activityRoutesPlugin. */
export interface ActivityRoutesOptions {
  registryDb: Database.Database;
  relayState: RelayState | null;
}

/**
 * Fastify plugin that registers activity and stats endpoints.
 *
 *   GET /api/activity — Paginated public activity feed
 *   GET /api/stats    — Aggregate network statistics
 */
export async function activityRoutesPlugin(
  fastify: FastifyInstance,
  options: ActivityRoutesOptions,
): Promise<void> {
  const { registryDb: db, relayState } = options;

  /**
   * GET /api/activity — Returns a paginated public activity feed of exchange events.
   *
   * Joins request_log with capability_cards to include the provider (card owner) field.
   * Autonomy audit rows (action_type = 'auto_request') are excluded.
   * Auto-share events (action_type = 'auto_share') and regular exchanges are included.
   *
   * Query parameters:
   *   limit  — Max items to return (default 20, max 100)
   *   since  — ISO 8601 timestamp; only entries newer than this are returned (for polling)
   */
  fastify.get('/api/activity', {
    schema: {
      tags: ['system'],
      summary: 'Paginated public activity feed of exchange events',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20, description: 'Max items (max 100)' },
          since: { type: 'string', description: 'ISO 8601 timestamp for polling' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            items: { type: 'array' },
            total: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
    const since = query.since?.trim() || undefined;
    const items = getActivityFeed(db, limit, since);
    return reply.send({ items, total: items.length, limit });
  });

  /**
   * GET /api/stats — Returns aggregate network statistics for the Hub.
   *
   * - agents_online: count of connected agents via WebSocket relay + cards with online=true
   * - total_capabilities: total number of registered capability cards
   * - total_exchanges: count of successful exchanges (excluding autonomy audits)
   * - executions_7d: successful executions in the last 7 days (Hub v2 Narrative Strip)
   * - verified_providers_count: providers with at least one verification_badge (always 0 in phase 1)
   */
  fastify.get('/api/stats', {
    schema: {
      tags: ['system'],
      summary: 'Aggregate network statistics',
      response: {
        200: {
          type: 'object',
          properties: {
            agents_online: { type: 'integer' },
            total_capabilities: { type: 'integer' },
            total_exchanges: { type: 'integer' },
            executions_7d: { type: 'integer' },
            verified_providers_count: { type: 'integer' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const allCards = listCards(db);

    // Online agents: relay connections + cards marked online (deduplicated by owner)
    const onlineOwners = new Set<string>();
    if (relayState) {
      for (const owner of relayState.getOnlineOwners()) {
        onlineOwners.add(owner);
      }
    }
    for (const card of allCards) {
      if (card.availability.online) {
        onlineOwners.add(card.owner);
      }
    }

    // Total exchanges: successful requests excluding autonomy audits
    const exchangeStmt = db.prepare(
      "SELECT COUNT(*) as count FROM request_log WHERE status = 'success' AND (action_type IS NULL OR action_type = 'auto_share')"
    );
    const exchangeRow = exchangeStmt.get() as { count: number };

    // Executions in last 7 days (all statuses, excluding autonomy audits)
    const exec7dStmt = db.prepare(
      "SELECT COUNT(*) as count FROM request_log WHERE action_type IS NULL AND created_at >= DATE('now', '-7 days')"
    );
    const exec7dRow = exec7dStmt.get() as { count: number };

    return reply.send({
      agents_online: onlineOwners.size,
      total_capabilities: allCards.reduce((sum, card) => {
        const v2 = card as unknown as CapabilityCardV2;
        return sum + (v2.skills?.length ?? 1);
      }, 0),
      total_exchanges: exchangeRow.count,
      executions_7d: exec7dRow.count,
      verified_providers_count: 0, // Phase 1: no verification mechanism yet
    });
  });
}
