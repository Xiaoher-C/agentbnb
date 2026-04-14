import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { getCard, updateCard } from './store.js';
import { listPendingRequests, resolvePendingRequest } from '../autonomy/pending-requests.js';
import { getRequestLog } from './request-log.js';
import type { SincePeriod } from './request-log.js';
import { createLedger } from '../credit/create-ledger.js';
import { detectApiKeys, buildDraftCard, KNOWN_API_KEYS } from '../cli/onboarding.js';
import { AgentBnBError } from '../types/index.js';
import type { CapabilityCard } from '../types/index.js';
import { tryVerifyIdentity } from './identity-auth.js';
import { getHubIdentityByAgentId } from './hub-identities.js';

/** Options for ownerRoutesPlugin. */
export interface OwnerRoutesOptions {
  registryDb: Database.Database;
  creditDb?: Database.Database;
  ownerApiKey: string;
  ownerName: string;
}

/**
 * Fastify plugin that registers authenticated owner endpoints.
 *
 *   GET  /me                              — Owner identity and credit balance
 *   GET  /requests                        — Paginated request log entries
 *   GET  /draft                           — Draft capability cards from auto-detected API keys
 *   POST /cards/:id/toggle-online         — Toggle card online/offline status
 *   PATCH /cards/:id                      — Update card description or pricing
 *   GET  /me/pending-requests             — List pending Tier 3 approval queue entries
 *   POST /me/pending-requests/:id/approve — Approve a pending Tier 3 request
 *   POST /me/pending-requests/:id/reject  — Reject a pending Tier 3 request
 *   GET  /me/transactions                 — Paginated credit transaction history
 *   GET  /me/events                       — Provider event stream
 *   GET  /me/stats                        — Aggregated provider stats
 */
export async function ownerRoutesPlugin(
  fastify: FastifyInstance,
  options: OwnerRoutesOptions,
): Promise<void> {
  const { registryDb: db, creditDb, ownerApiKey, ownerName } = options;

  /**
   * Auth hook: accepts either Bearer token (legacy CLI flow) OR DID auth
   * headers (new Hub flow via registered hub_identities).
   *
   * Bearer mode: Authorization: Bearer <ownerApiKey>
   * DID mode: X-Agent-Id + X-Agent-PublicKey + X-Agent-Signature + X-Agent-Timestamp
   *          — must match a registered Hub identity in hub_identities.
   *
   * On success, sets request.agentId (Bearer mode uses ownerName as pseudo-agent_id).
   */
  fastify.addHook('preHandler', async (request, reply) => {
    // Try Bearer auth first (legacy path)
    const auth = request.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (token === ownerApiKey) {
      // Valid bearer — use ownerName as the effective identity
      request.agentId = ownerName;
      return;
    }

    // Fall through to DID auth
    const didResult = await tryVerifyIdentity(request, {});
    if (didResult.valid) {
      // Cross-check: must be a registered Hub identity
      const hubIdentity = getHubIdentityByAgentId(db, didResult.agentId);
      if (!hubIdentity) {
        return reply.status(401).send({ error: 'Agent not registered on this Hub' });
      }
      request.agentId = didResult.agentId;
      request.agentPublicKey = didResult.publicKey;
      return;
    }

    // Neither worked
    return reply.status(401).send({ error: 'Unauthorized' });
  });

  /**
   * GET /me — Returns owner identity and current credit balance.
   * Uses CreditLedger (direct DB mode) when creditDb is available.
   */
  fastify.get('/me', {
    schema: {
      tags: ['owner'],
      summary: 'Get owner identity and credit balance',
      security: [{ bearerAuth: [] }],
      response: {
        200: { type: 'object', properties: { owner: { type: 'string' }, balance: { type: 'number' } } },
      },
    },
  }, async (request, reply) => {
    // Use request.agentId set by auth hook (either ownerName for Bearer or agent_id for DID)
    const identity = request.agentId ?? ownerName;
    let balance = 0;
    if (creditDb) {
      const ledger = createLedger({ db: creditDb });
      balance = await ledger.getBalance(identity);
    }
    return reply.send({ owner: identity, balance });
  });

  /**
   * GET /requests — Returns paginated request log entries.
   *
   * Query params:
   *   limit  — Max entries (default 10, max 100)
   *   since  — Time window: '24h', '7d', or '30d'
   */
  fastify.get('/requests', {
    schema: {
      tags: ['owner'],
      summary: 'Paginated request log entries',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max entries (default 10, max 100)' },
          since: { type: 'string', enum: ['24h', '7d', '30d'], description: 'Time window' },
        },
      },
      response: { 200: { type: 'object', properties: { items: { type: 'array' }, limit: { type: 'integer' } } } },
    },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 10;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 10 : rawLimit, 100);
    const sinceRaw = query.since;
    const validSince: SincePeriod[] = ['24h', '7d', '30d'];
    const since = sinceRaw && validSince.includes(sinceRaw as SincePeriod)
      ? (sinceRaw as SincePeriod)
      : undefined;
    const items = getRequestLog(db, limit, since);
    return reply.send({ items, limit });
  });

  /**
   * GET /draft — Returns draft Capability Cards built from auto-detected API keys.
   */
  fastify.get('/draft', {
    schema: {
      tags: ['owner'],
      summary: 'Draft capability cards from auto-detected API keys',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'object', properties: { cards: { type: 'array' } } } },
    },
  }, async (_request, reply) => {
    const detectedKeys = detectApiKeys(KNOWN_API_KEYS);
    const cards = detectedKeys
      .map((key) => buildDraftCard(key, ownerName))
      .filter((card): card is CapabilityCard => card !== null);
    return reply.send({ cards });
  });

  /**
   * POST /cards/:id/toggle-online — Toggles availability.online for an owned card.
   *
   * Returns 404 if card not found, 403 if card belongs to different owner.
   */
  fastify.post('/cards/:id/toggle-online', {
    schema: {
      tags: ['owner'],
      summary: 'Toggle card online/offline status',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        200: { type: 'object', properties: { ok: { type: 'boolean' }, online: { type: 'boolean' } } },
        403: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const card = getCard(db, id);
    if (!card) {
      return reply.code(404).send({ error: 'Not found' });
    }
    try {
      const newOnline = !card.availability.online;
      updateCard(db, id, ownerName, {
        availability: { ...card.availability, online: newOnline },
      });
      return reply.send({ ok: true, online: newOnline });
    } catch (err) {
      if (err instanceof AgentBnBError && err.code === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      throw err;
    }
  });

  /**
   * PATCH /cards/:id — Updates description and/or pricing for an owned card.
   *
   * Returns 403 if card belongs to different owner, 404 if not found.
   */
  fastify.patch('/cards/:id', {
    schema: {
      tags: ['owner'],
      summary: 'Update card description or pricing',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          pricing: { type: 'object', additionalProperties: true },
        },
        additionalProperties: true,
      },
      response: {
        200: { type: 'object', properties: { ok: { type: 'boolean' } } },
        403: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<Pick<CapabilityCard, 'description' | 'pricing'>>;
    const updates: Partial<CapabilityCard> = {};
    if (body.description !== undefined) updates.description = body.description;
    if (body.pricing !== undefined) updates.pricing = body.pricing;
    try {
      updateCard(db, id, ownerName, updates);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof AgentBnBError) {
        if (err.code === 'FORBIDDEN') {
          return reply.code(403).send({ error: 'Forbidden' });
        }
        if (err.code === 'NOT_FOUND') {
          return reply.code(404).send({ error: 'Not found' });
        }
      }
      throw err;
    }
  });

  /**
   * GET /me/pending-requests — Lists all pending Tier 3 approval queue entries.
   */
  fastify.get('/me/pending-requests', {
    schema: {
      tags: ['owner'],
      summary: 'List pending Tier 3 approval queue entries',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array' } },
    },
  }, async (_request, reply) => {
    const rows = listPendingRequests(db);
    return reply.send(rows);
  });

  /**
   * POST /me/pending-requests/:id/approve — Approves a pending Tier 3 request.
   */
  fastify.post('/me/pending-requests/:id/approve', {
    schema: {
      tags: ['owner'],
      summary: 'Approve a pending Tier 3 request',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        200: { type: 'object', properties: { status: { type: 'string' }, id: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      resolvePendingRequest(db, id, 'approved');
      return reply.send({ status: 'approved', id });
    } catch (err) {
      if (err instanceof AgentBnBError) return reply.status(404).send({ error: err.message });
      throw err;
    }
  });

  /**
   * POST /me/pending-requests/:id/reject — Rejects a pending Tier 3 request.
   */
  fastify.post('/me/pending-requests/:id/reject', {
    schema: {
      tags: ['owner'],
      summary: 'Reject a pending Tier 3 request',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        200: { type: 'object', properties: { status: { type: 'string' }, id: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      resolvePendingRequest(db, id, 'rejected');
      return reply.send({ status: 'rejected', id });
    } catch (err) {
      if (err instanceof AgentBnBError) return reply.status(404).send({ error: err.message });
      throw err;
    }
  });

  /**
   * GET /me/transactions — Returns paginated credit transaction history.
   */
  fastify.get('/me/transactions', {
    schema: {
      tags: ['owner'],
      summary: 'Paginated credit transaction history',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', description: 'Max entries (default 20, max 100)' } },
      },
      response: {
        200: { type: 'object', properties: { items: { type: 'array' }, limit: { type: 'integer' } } },
      },
    },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
    if (!creditDb) {
      return reply.send({ items: [], limit });
    }
    const ledger = createLedger({ db: creditDb });
    const items = await ledger.getHistory(ownerName, limit);
    return reply.send({ items, limit });
  });

  /**
   * GET /me/events — Provider event stream.
   */
  fastify.get('/me/events', {
    schema: {
      tags: ['owner'],
      summary: 'Provider event stream',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max entries (default 50)' },
          since: { type: 'string', description: 'ISO timestamp for cursor-based polling' },
          event_type: { type: 'string', description: 'Filter by event type' },
        },
      },
    },
  }, async (request, reply) => {
    const { getProviderEvents: getEvents } = await import('./provider-events.js');
    const query = request.query as Record<string, string | undefined>;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const events = getEvents(db, {
      limit,
      since: query.since,
      event_type: query.event_type as import('./provider-events.js').ProviderEventType | undefined,
    });
    return reply.send({ events });
  });

  /**
   * GET /me/stats — Aggregated provider stats.
   */
  fastify.get('/me/stats', {
    schema: {
      tags: ['owner'],
      summary: 'Aggregated provider stats',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { period: { type: 'string', enum: ['24h', '7d', '30d'] } },
      },
    },
  }, async (request, reply) => {
    const { getProviderStats: getStats } = await import('./provider-events.js');
    const query = request.query as Record<string, string | undefined>;
    const period = (query.period as '24h' | '7d' | '30d') ?? '7d';
    const stats = getStats(db, period);

    // Compute spending from credit_transactions (outflows: escrow_hold, voucher_hold, network_fee)
    if (creditDb) {
      const periodMs = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 }[period];
      const cutoff = new Date(Date.now() - periodMs).toISOString();
      try {
        const row = creditDb.prepare(`
          SELECT COALESCE(SUM(CASE WHEN amount < 0 AND reason IN ('escrow_hold', 'voucher_hold', 'network_fee') THEN -amount ELSE 0 END), 0) as spent
          FROM credit_transactions
          WHERE owner = ? AND created_at >= ?
        `).get(ownerName, cutoff) as { spent: number } | undefined;
        stats.total_spending = row?.spent ?? 0;
        stats.net_pnl = stats.total_earnings - stats.total_spending;
      } catch { /* silent — keep zeros */ }
    }

    return reply.send(stats);
  });
}
