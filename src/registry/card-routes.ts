import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { getCard, insertCard, getCardsBySkillCapability, attachCanonicalAgentId } from './store.js';
import { searchCards, filterCards, buildReputationMap } from './matcher.js';
import { getPricingStats } from './pricing.js';
import { AgentBnBError, AnyCardSchema } from '../types/index.js';
import type { CapabilityCard } from '../types/index.js';
import { tryVerifyIdentity } from './identity-auth.js';
import { canonicalizeAgentId } from '../identity/identity.js';

// Tier threshold constants — used for trust/reputation tier computation
const TIER_1_MIN_EXEC = 10;
const TIER_2_MIN_EXEC = 50;
const TIER_2_MIN_SUCCESS_RATE = 0.85;

/**
 * Strips the `_internal` field from a card before sending it over the network.
 * `_internal` is private per-card metadata — it must never be transmitted to clients.
 */
function stripInternal(card: CapabilityCard): Omit<CapabilityCard, '_internal'> {
  const { _internal: _, ...publicCard } = card;
  return publicCard;
}

/** Options for cardRoutesPlugin. */
export interface CardRoutesOptions {
  registryDb: Database.Database;
  creditDb?: Database.Database;
  ownerApiKey?: string;
  ownerName?: string;
}

/**
 * Fastify plugin that registers capability card CRUD and search endpoints.
 *
 *   GET    /cards              — List and search capability cards
 *   GET    /api/cards/trending — Top 10 trending skills by recent usage
 *   GET    /api/pricing        — Aggregate pricing statistics
 *   GET    /cards/:id          — Get a capability card by ID
 *   POST   /cards              — Publish a capability card
 *   DELETE /cards/:id          — Delete a capability card (requires Bearer auth)
 */
export async function cardRoutesPlugin(
  fastify: FastifyInstance,
  options: CardRoutesOptions,
): Promise<void> {
  const { registryDb: db, ownerApiKey, ownerName } = options;

  /**
   * GET /cards — List and search capability cards with filtering, sorting, and pagination.
   */
  fastify.get('/cards', {
    schema: {
      tags: ['cards'],
      summary: 'List and search capability cards',
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Full-text search query' },
          level: { type: 'integer', enum: [1, 2, 3], description: 'Capability level filter' },
          online: { type: 'string', enum: ['true', 'false'], description: 'Availability filter' },
          tag: { type: 'string', description: 'Filter by metadata tag' },
          min_success_rate: { type: 'number', description: 'Minimum success rate (0-1)' },
          max_latency_ms: { type: 'number', description: 'Maximum average latency in ms' },
          min_reputation: { type: 'number', description: 'Minimum reputation score (0-1) based on peer feedback' },
          capability_type: { type: 'string', description: 'Filter cards whose skills declare this capability_type (e.g. tts, code_gen)' },
          sort: { type: 'string', enum: ['popular', 'rated', 'success_rate', 'cheapest', 'newest', 'latency', 'reputation_desc', 'reputation_asc'], description: 'Sort order' },
          limit: { type: 'integer', default: 20, description: 'Max items per page (max 100)' },
          offset: { type: 'integer', default: 0, description: 'Pagination offset' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            items: { type: 'array' },
            uses_this_week: { type: 'object', additionalProperties: { type: 'number' } },
          },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    // Parse query params
    const q = query.q?.trim() ?? '';
    const levelRaw = query.level !== undefined ? parseInt(query.level, 10) : undefined;
    const level =
      levelRaw === 1 || levelRaw === 2 || levelRaw === 3 ? levelRaw : undefined;
    const onlineRaw = query.online;
    const online =
      onlineRaw === 'true' ? true : onlineRaw === 'false' ? false : undefined;
    const tag = query.tag?.trim();
    const capabilityType = query.capability_type?.trim() || undefined;
    const minSuccessRate =
      query.min_success_rate !== undefined ? parseFloat(query.min_success_rate) : undefined;
    const maxLatencyMs =
      query.max_latency_ms !== undefined ? parseFloat(query.max_latency_ms) : undefined;
    const minReputation =
      query.min_reputation !== undefined ? parseFloat(query.min_reputation) : undefined;
    const sort = query.sort;

    // Limit/offset with defaults and cap
    const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
    const rawOffset = query.offset !== undefined ? parseInt(query.offset, 10) : 0;
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    // Fetch cards — use searchCards (FTS5) if query string provided, else filterCards
    let cards: CapabilityCard[];
    if (q.length > 0) {
      cards = searchCards(db, q, { level, online, min_reputation: minReputation });
    } else {
      cards = filterCards(db, { level, online, min_reputation: minReputation });
    }

    // Filter out ephemeral requester stub cards (owner contains ':req:').
    // These are transient relay connections, not real capability providers.
    cards = cards.filter((c) => !c.owner.includes(':req:'));

    // Post-filter by capability_type — intersect with cards whose skills declare this type.
    if (capabilityType !== undefined) {
      const capTypeIds = new Set(
        getCardsBySkillCapability(db, capabilityType).map((c) => c.id)
      );
      cards = cards.filter((c) => capTypeIds.has(c.id));
    }

    // Post-filter by tag — check both card-root and skill-level metadata
    if (tag !== undefined && tag.length > 0) {
      cards = cards.filter((c) => {
        const rootTags = c.metadata?.tags ?? [];
        const skillTags = (c as unknown as { skills?: Array<{ metadata?: { tags?: string[] } }> })
          .skills?.flatMap((s) => s.metadata?.tags ?? []) ?? [];
        return [...rootTags, ...skillTags].includes(tag);
      });
    }

    // Post-filter by max_latency_ms (cards without avg_latency_ms are excluded)
    if (maxLatencyMs !== undefined && !isNaN(maxLatencyMs)) {
      cards = cards.filter(
        (c) => (c.metadata?.avg_latency_ms ?? Infinity) <= maxLatencyMs
      );
    }

    // Compute uses_this_week for all cards (single SQL query)
    const usesStmt = db.prepare(`
      SELECT card_id, skill_id, COUNT(*) as cnt
      FROM request_log
      WHERE status = 'success'
        AND created_at > datetime('now', '-7 days')
        AND (action_type IS NULL OR action_type = 'auto_share')
      GROUP BY card_id, skill_id
    `);
    const usesRows = usesStmt.all() as Array<{ card_id: string; skill_id: string | null; cnt: number }>;
    const usesMap = new Map<string, number>();
    for (const row of usesRows) {
      // Accumulate by card_id
      usesMap.set(row.card_id, (usesMap.get(row.card_id) ?? 0) + row.cnt);
      // Also store by skill_id if available
      if (row.skill_id) {
        usesMap.set(row.skill_id, (usesMap.get(row.skill_id) ?? 0) + row.cnt);
      }
    }

    // Compute owner trust summary (batch SQL — owner-level, not card-level)
    interface OwnerTrust {
      performance_tier: 0 | 1 | 2;
      authority_source: 'self' | 'platform' | 'org';
      success_rate: number;
      avg_latency_ms: number;
      terminal_exec: number;
    }
    const ownerTrustMap = new Map<string, OwnerTrust>();
    const uniqueOwners = [...new Set(cards.map((c) => c.owner))];
    if (uniqueOwners.length > 0) {
      const placeholders = uniqueOwners.map(() => '?').join(',');
      const trustStmt = db.prepare(`
        SELECT cc.owner,
          COUNT(rl.id) as total_exec,
          SUM(CASE WHEN rl.status IN ('success','failure','timeout','refunded')
              AND (rl.failure_reason IS NULL OR rl.failure_reason IN ('bad_execution','auth_error'))
              THEN 1 ELSE 0 END) as terminal_exec,
          SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as success_exec,
          AVG(CASE WHEN rl.status = 'success' THEN rl.latency_ms END) as avg_latency
        FROM capability_cards cc
        LEFT JOIN request_log rl ON rl.card_id = cc.id AND rl.action_type IS NULL
        WHERE cc.owner IN (${placeholders})
        GROUP BY cc.owner
      `);
      const trustRows = trustStmt.all(...uniqueOwners) as Array<{
        owner: string;
        total_exec: number;
        terminal_exec: number;
        success_exec: number;
        avg_latency: number | null;
      }>;
      for (const row of trustRows) {
        const terminalExec = row.terminal_exec ?? 0;
        const successExec = row.success_exec ?? 0;
        const successRate = terminalExec > 0 ? successExec / terminalExec : 0;
        let tier: 0 | 1 | 2 = 0;
        if (row.total_exec > TIER_1_MIN_EXEC) tier = 1;
        if (row.total_exec > TIER_2_MIN_EXEC && successRate >= TIER_2_MIN_SUCCESS_RATE) tier = 2;
        ownerTrustMap.set(row.owner, {
          performance_tier: tier,
          authority_source: 'self', // Phase 1: all self-declared
          success_rate: successRate,
          avg_latency_ms: Math.round(row.avg_latency ?? 0),
          terminal_exec: terminalExec,
        });
      }
    }

    // Post-filter by min_success_rate using owner trust (execution-based).
    if (minSuccessRate !== undefined && !isNaN(minSuccessRate)) {
      cards = cards.filter((c) => {
        const trust = ownerTrustMap.get(c.owner);
        if (!trust || trust.terminal_exec === 0) return false;
        return trust.success_rate >= minSuccessRate;
      });
    }

    // Sorting
    if (sort === 'popular') {
      cards = [...cards].sort((a, b) => {
        const aUses = usesMap.get(a.id) ?? 0;
        const bUses = usesMap.get(b.id) ?? 0;
        return bUses - aUses;
      });
    } else if (sort === 'rated' || sort === 'success_rate') {
      cards = [...cards].sort((a, b) => {
        const aRate = a.metadata?.success_rate ?? -1;
        const bRate = b.metadata?.success_rate ?? -1;
        return bRate - aRate;
      });
    } else if (sort === 'cheapest') {
      cards = [...cards].sort((a, b) => {
        type MaybeV2 = { pricing?: { credits_per_call: number }; skills?: Array<{ pricing: { credits_per_call: number } }> };
        const aCard = a as unknown as MaybeV2;
        const bCard = b as unknown as MaybeV2;
        const aPrice = aCard.pricing?.credits_per_call ?? aCard.skills?.[0]?.pricing?.credits_per_call ?? Infinity;
        const bPrice = bCard.pricing?.credits_per_call ?? bCard.skills?.[0]?.pricing?.credits_per_call ?? Infinity;
        return aPrice - bPrice;
      });
    } else if (sort === 'newest') {
      const createdStmt = db.prepare('SELECT id, created_at FROM capability_cards');
      const createdRows = createdStmt.all() as Array<{ id: string; created_at: string }>;
      const createdMap = new Map(createdRows.map((r) => [r.id, r.created_at]));
      cards = [...cards].sort((a, b) => {
        const aDate = createdMap.get(a.id) ?? '';
        const bDate = createdMap.get(b.id) ?? '';
        return bDate.localeCompare(aDate);
      });
    } else if (sort === 'latency') {
      cards = [...cards].sort((a, b) => {
        const aLatency = a.metadata?.avg_latency_ms ?? Infinity;
        const bLatency = b.metadata?.avg_latency_ms ?? Infinity;
        return aLatency - bLatency;
      });
    } else if (sort === 'reputation_desc' || sort === 'reputation_asc') {
      const repMap = buildReputationMap(db, cards.map((c) => c.owner));
      const dir = sort === 'reputation_desc' ? -1 : 1;
      cards = [...cards].sort((a, b) => {
        const aScore = repMap.get(a.owner) ?? 0.5;
        const bScore = repMap.get(b.owner) ?? 0.5;
        return dir * (bScore - aScore);
      });
    }

    const total = cards.length;
    const pagedCards = cards.slice(offset, offset + limit);

    // Build reputation map for paged cards (batch, deduplicates owner lookups).
    const pageRepMap = buildReputationMap(db, pagedCards.map((c) => c.owner));

    // Augment each card with owner trust summary fields
    const items = pagedCards.map((card) => {
      const trust = ownerTrustMap.get(card.owner);
      const stripped = stripInternal(card);
      return {
        ...stripped,
        performance_tier: trust?.performance_tier ?? 0,
        authority_source: trust?.authority_source ?? 'self',
        reputation_score: pageRepMap.get(card.owner) ?? 0.5,
        metadata: trust && trust.terminal_exec > 0
          ? {
              ...stripped.metadata,
              success_rate: trust.success_rate,
              avg_latency_ms: trust.avg_latency_ms || stripped.metadata?.avg_latency_ms,
            }
          : stripped.metadata,
      };
    });

    // Build uses_this_week lookup for returned items
    const usesThisWeek: Record<string, number> = {};
    for (const [key, count] of usesMap) {
      if (count > 0) usesThisWeek[key] = count;
    }

    const result = { total, limit, offset, items, uses_this_week: usesThisWeek };
    return reply.send(result);
  });

  /**
   * GET /api/cards/trending — Returns top 10 skills by successful request count in the last 7 days.
   */
  fastify.get('/api/cards/trending', {
    schema: {
      tags: ['cards'],
      summary: 'Top 10 trending skills by recent usage',
      response: { 200: { type: 'object', properties: { items: { type: 'array' } } } },
    },
  }, async (_request, reply) => {
    const trendingStmt = db.prepare(`
      SELECT rl.card_id, COUNT(*) as recent_requests
      FROM request_log rl
      WHERE rl.status = 'success'
        AND rl.created_at > datetime('now', '-7 days')
        AND (rl.action_type IS NULL OR rl.action_type = 'auto_share')
      GROUP BY rl.card_id
      ORDER BY recent_requests DESC
      LIMIT 10
    `);
    const trendingRows = trendingStmt.all() as Array<{ card_id: string; recent_requests: number }>;

    const items = trendingRows
      .map((row) => {
        const card = getCard(db, row.card_id);
        if (!card) return null;
        return { ...stripInternal(card), uses_this_week: row.recent_requests };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return reply.send({ items });
  });

  /**
   * GET /api/pricing — Returns aggregate pricing statistics for skills matching a query.
   */
  fastify.get('/api/pricing', {
    schema: {
      tags: ['pricing'],
      summary: 'Aggregate pricing statistics for skills matching a query',
      querystring: {
        type: 'object',
        properties: { q: { type: 'string', description: 'Search query (required)' } },
        required: ['q'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            min: { type: 'number' },
            max: { type: 'number' },
            median: { type: 'number' },
            mean: { type: 'number' },
            count: { type: 'integer' },
          },
        },
        400: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const q = query.q?.trim();
    if (!q) {
      return reply.code(400).send({ error: 'q parameter is required' });
    }
    const stats = getPricingStats(db, q);
    return reply.send({ query: q, ...stats });
  });

  /**
   * GET /cards/:id — Retrieve a single capability card by UUID.
   */
  fastify.get('/cards/:id', {
    schema: {
      tags: ['cards'],
      summary: 'Get a capability card by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const card = getCard(db, id);

    if (!card) {
      return reply.code(404).send({ error: 'Not found' });
    }

    return reply.send(stripInternal(card));
  });

  /**
   * POST /cards — Publish a capability card to the registry.
   */
  fastify.post('/cards', {
    schema: {
      tags: ['cards'],
      summary: 'Publish a capability card',
      body: { type: 'object', additionalProperties: true, description: 'Capability card JSON (v1.0 or v2.0)' },
      response: {
        201: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } },
        400: { type: 'object', properties: { error: { type: 'string' }, issues: { type: 'array' } } },
        401: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Accept DID identity headers (Hub flow) or admin Bearer token (legacy CLI
    // flow). Mirrors /api/request/batch in batch-routes.ts.
    let authedIdentity: string | null = null;
    let authMode: 'did' | 'bearer' | null = null;

    const didResult = await tryVerifyIdentity(request, { agentDb: db });
    if (didResult.valid) {
      authedIdentity = didResult.agentId;
      authMode = 'did';
      request.agentId = didResult.agentId;
      request.agentPublicKey = didResult.publicKey;
    } else {
      const auth = request.headers.authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (token && ownerApiKey && token === ownerApiKey && ownerName) {
        authedIdentity = ownerName;
        authMode = 'bearer';
      }
    }

    if (!authedIdentity || !authMode) {
      return reply.code(401).send({ error: 'Valid DID identity headers or admin Bearer token required' });
    }

    const body = request.body as Record<string, unknown>;
    // Default spec_version to '1.0' if missing (AnyCardSchema requires discriminator)
    if (!body.spec_version) {
      body.spec_version = '1.0';
    }
    const result = AnyCardSchema.safeParse(body);

    if (!result.success) {
      return reply.code(400).send({
        error: 'Card validation failed',
        issues: result.error.issues,
      });
    }

    const card = result.data;

    // Canonicalize both sides so `agent-<hex>` and bare `<hex>` collapse to the
    // same key. In Bearer mode also accept the legacy display-name owner.
    const canonicalAuthedId = canonicalizeAgentId(authedIdentity);
    const canonicalCardOwner = canonicalizeAgentId(card.owner);
    const ownerMatchesIdentity = canonicalCardOwner === canonicalAuthedId;
    const ownerMatchesDisplay = authMode === 'bearer' && card.owner === ownerName;
    if (!ownerMatchesIdentity && !ownerMatchesDisplay) {
      return reply.code(403).send({ error: 'Card owner does not match authenticated identity' });
    }

    // Persist `owner` as the canonical authenticated id so owner-scoped queries
    // resolve consistently. Bearer mode keeps the display name (legacy alias).
    const ownedCard = { ...card, owner: authMode === 'did' ? canonicalAuthedId : authedIdentity };
    const now = new Date().toISOString();

    // Card quality gate — prevent garbage cards on the registry
    if (ownedCard.spec_version === '2.0') {
      if (!ownedCard.skills || ownedCard.skills.length === 0) {
        return reply.code(400).send({ error: 'Card must have at least 1 skill' });
      }
      const badSkill = ownedCard.skills.find((s) => !s.description || s.description.length < 20);
      if (badSkill) {
        return reply.code(400).send({ error: `Skill "${badSkill.id}" must have a description (20+ chars)` });
      }
      if (ownedCard.agent_name === ownedCard.owner || /^[0-9a-f]{16}$/.test(ownedCard.agent_name)) {
        return reply.code(400).send({ error: 'agent_name must be a readable name, not an ID' });
      }
    } else {
      if (!ownedCard.description || ownedCard.description.length < 20) {
        return reply.code(400).send({ error: 'Card must have a description (20+ chars)' });
      }
    }

    if (ownedCard.spec_version === '2.0') {
      // v2.0 card — raw SQL INSERT OR REPLACE (insertCard only supports v1.0)
      const cardWithTimestamps = attachCanonicalAgentId(db, {
        ...ownedCard,
        created_at: ownedCard.created_at ?? now,
        updated_at: now,
      });
      db.prepare(
        `INSERT OR REPLACE INTO capability_cards (id, owner, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        cardWithTimestamps.id,
        cardWithTimestamps.owner,
        JSON.stringify(cardWithTimestamps),
        cardWithTimestamps.created_at,
        cardWithTimestamps.updated_at,
      );
    } else {
      // v1.0 card — use existing insertCard with Zod validation
      try {
        insertCard(db, ownedCard);
      } catch (err) {
        if (err instanceof AgentBnBError && err.code === 'VALIDATION_ERROR') {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    }

    return reply.code(201).send({ ok: true, id: ownedCard.id });
  });

  /**
   * DELETE /cards/:id — Remove a capability card from the registry.
   */
  fastify.delete('/cards/:id', {
    schema: {
      tags: ['cards'],
      summary: 'Delete a capability card (requires Bearer auth)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        204: { type: 'null', description: 'Card deleted successfully' },
        401: { type: 'object', properties: { error: { type: 'string' } } },
        403: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    // Authenticate via Bearer token — reuse ownerApiKey if configured
    const auth = request.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token || !ownerApiKey || token !== ownerApiKey) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const card = getCard(db, id);
    if (!card) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (ownerName && card.owner !== ownerName) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    db.prepare('DELETE FROM capability_cards WHERE id = ?').run(id);
    return reply.code(204).send();
  });
}
