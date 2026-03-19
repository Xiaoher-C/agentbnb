import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getCard, insertCard, updateCard, listCards } from './store.js';
import { listPendingRequests, resolvePendingRequest } from '../autonomy/pending-requests.js';
import { searchCards, filterCards } from './matcher.js';
import { getPricingStats } from './pricing.js';
import { getRequestLog, getActivityFeed } from './request-log.js';
import type { SincePeriod } from './request-log.js';
import { createLedger } from '../credit/create-ledger.js';
import { detectApiKeys, buildDraftCard, KNOWN_API_KEYS } from '../cli/onboarding.js';
import { AgentBnBError, AnyCardSchema } from '../types/index.js';
import type { CapabilityCard, CapabilityCardV2 } from '../types/index.js';
import { registerWebSocketRelay } from '../relay/websocket-relay.js';
import type { RelayState } from '../relay/types.js';
import {
  registerGuarantor,
  linkAgentToGuarantor,
  getAgentGuarantor,
  initiateGithubAuth,
} from '../identity/guarantor.js';
import { creditRoutesPlugin } from './credit-routes.js';

/**
 * Options for creating the public registry server.
 */
export interface RegistryServerOptions {
  /** Open SQLite database instance for the capability card registry. */
  registryDb: Database.Database;
  /** When true, disables Fastify request logging. Useful for tests. */
  silent?: boolean;
  /** The owner identity for /me responses. Required to enable owner endpoints. */
  ownerName?: string;
  /** The API key for Bearer token auth on owner endpoints. Required to enable owner endpoints. */
  ownerApiKey?: string;
  /** Credit database for balance lookups in GET /me. */
  creditDb?: Database.Database;
}

/**
 * Strips the `_internal` field from a card before sending it over the network.
 * `_internal` is private per-card metadata — it must never be transmitted to clients.
 *
 * @param card - Full capability card (possibly containing _internal)
 * @returns Card without the _internal field
 */
function stripInternal(card: CapabilityCard): Omit<CapabilityCard, '_internal'> {
  const { _internal: _, ...publicCard } = card;
  return publicCard;
}

/**
 * Creates a public, read-only Fastify HTTP server exposing capability cards.
 *
 * Endpoints:
 *   GET /health         — Returns { status: 'ok' }
 *   GET /cards          — Paginated list with optional search/filter/sort
 *   GET /cards/:id      — Single card by UUID, or 404
 *
 * All origins are allowed (CORS). No auth required. No write endpoints.
 *
 * @param opts - Server options including the database and optional silent flag.
 * @returns A Fastify instance (not yet listening — caller calls .listen() or uses .inject() in tests).
 */
/** Return type from createRegistryServer — includes relay state for lifecycle management. */
export interface RegistryServerResult {
  server: FastifyInstance;
  relayState: RelayState | null;
}

export function createRegistryServer(opts: RegistryServerOptions): RegistryServerResult {
  const { registryDb: db, silent = false } = opts;

  const server = Fastify({ logger: !silent });

  // Register OpenAPI / Swagger — MUST be registered before any routes
  void server.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'AgentBnB Registry API',
        description: 'P2P Agent Capability Sharing Protocol — discover, publish, and exchange agent capabilities',
        version: '3.1.6',
      },
      servers: [{ url: '/', description: 'Registry server' }],
      tags: [
        { name: 'cards', description: 'Capability card CRUD' },
        { name: 'credits', description: 'Credit hold/settle/release (Ed25519 auth required)' },
        { name: 'agents', description: 'Agent profiles and reputation' },
        { name: 'identity', description: 'Agent identity and guarantor registration' },
        { name: 'owner', description: 'Owner-only endpoints (Bearer auth required)' },
        { name: 'system', description: 'Health and stats' },
        { name: 'pricing', description: 'Market pricing statistics' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          ed25519Auth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Agent-PublicKey',
            description: 'Ed25519 public key (hex). Also requires X-Agent-Signature and X-Agent-Timestamp headers.',
          },
        },
      },
    },
  });

  void server.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  // Register CORS — allow all origins for public marketplace discovery, including preflight
  void server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-PublicKey', 'X-Agent-Signature', 'X-Agent-Timestamp'],
  });

  // Register WebSocket support for relay
  void server.register(fastifyWebsocket);

  // Register WebSocket relay — agents connect via /ws for zero-config networking
  // Pass creditDb so relay enforces credit hold/settle/release on every request
  let relayState: RelayState | null = null;
  if (opts.creditDb) {
    relayState = registerWebSocketRelay(server, db, opts.creditDb);
  }

  // Register credit endpoints when creditDb is provided — agents can hold/settle/release/grant credits
  if (opts.creditDb) {
    void server.register(creditRoutesPlugin, { creditDb: opts.creditDb });
  }

  // Register static file serving for the hub SPA (optional — skipped if hub not built)
  // Resolve hub/dist/ relative to this file's compiled location in dist/registry/server.js
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const hubDistCandidates = [
    join(__dirname, '../../hub/dist'),   // When running from dist/registry/server.js
    join(__dirname, '../../../hub/dist'), // Fallback for alternative layouts
  ];
  const hubDistDir = hubDistCandidates.find((p) => existsSync(p));

  if (hubDistDir) {
    void server.register(fastifyStatic, {
      root: hubDistDir,
      prefix: '/hub/',
    });

    // Redirect root to /hub/ — Hub IS the landing page for MVP
    server.get('/', async (_request, reply) => {
      return reply.redirect('/hub/');
    });

    // Redirect /hub (no trailing slash) to /hub/ so assets resolve correctly
    server.get('/hub', async (_request, reply) => {
      return reply.redirect('/hub/');
    });

    // SPA catch-all: serve index.html when fastifyStatic calls callNotFound()
    // for /hub/* paths that don't match real static files (deep links, hash routes).
    // fastifyStatic's wildcard handler already owns GET+HEAD /hub/* — we must NOT
    // register a competing route. Instead, use setNotFoundHandler to intercept the
    // callNotFound() signal and serve index.html for hub sub-paths.
    server.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/hub/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  /**
   * GET /health — Liveness probe for the registry server.
   */
  server.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'Liveness probe',
      response: { 200: { type: 'object', properties: { status: { type: 'string' } } } },
    },
  }, async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  /**
   * GET /cards — List and search capability cards with filtering, sorting, and pagination.
   *
   * Query parameters:
   *   q                  — Full-text search query (uses FTS5)
   *   level              — Filter by capability level: 1, 2, or 3
   *   online             — Filter by availability.online: true or false
   *   tag                — Filter cards that have this tag in metadata.tags
   *   min_success_rate   — Filter cards with success_rate >= value (0-1)
   *   max_latency_ms     — Filter cards with avg_latency_ms <= value
   *   sort               — Sort order: 'success_rate' (desc) or 'latency' (asc)
   *   limit              — Max items per page (default 20, max 100)
   *   offset             — Pagination offset (default 0)
   */
  server.get('/cards', {
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
          sort: { type: 'string', enum: ['popular', 'rated', 'success_rate', 'cheapest', 'newest', 'latency'], description: 'Sort order' },
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
    const minSuccessRate =
      query.min_success_rate !== undefined ? parseFloat(query.min_success_rate) : undefined;
    const maxLatencyMs =
      query.max_latency_ms !== undefined ? parseFloat(query.max_latency_ms) : undefined;
    const sort = query.sort;

    // Limit/offset with defaults and cap
    const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
    const rawOffset = query.offset !== undefined ? parseInt(query.offset, 10) : 0;
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    // Fetch cards — use searchCards (FTS5) if query string provided, else filterCards
    let cards: CapabilityCard[];
    if (q.length > 0) {
      cards = searchCards(db, q, { level, online });
    } else {
      cards = filterCards(db, { level, online });
    }

    // Post-filter by tag
    if (tag !== undefined && tag.length > 0) {
      cards = cards.filter((c) => c.metadata?.tags?.includes(tag));
    }

    // Post-filter by min_success_rate (cards without success_rate are excluded)
    if (minSuccessRate !== undefined && !isNaN(minSuccessRate)) {
      cards = cards.filter(
        (c) => (c.metadata?.success_rate ?? -1) >= minSuccessRate
      );
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

    // Sorting
    if (sort === 'popular') {
      // Sort by uses this week descending
      cards = [...cards].sort((a, b) => {
        const aUses = usesMap.get(a.id) ?? 0;
        const bUses = usesMap.get(b.id) ?? 0;
        return bUses - aUses;
      });
    } else if (sort === 'rated' || sort === 'success_rate') {
      // Sort descending — cards without a rating go last (treat as -1)
      cards = [...cards].sort((a, b) => {
        const aRate = a.metadata?.success_rate ?? -1;
        const bRate = b.metadata?.success_rate ?? -1;
        return bRate - aRate;
      });
    } else if (sort === 'cheapest') {
      // Sort by credits_per_call ascending
      cards = [...cards].sort((a, b) => {
        return a.pricing.credits_per_call - b.pricing.credits_per_call;
      });
    } else if (sort === 'newest') {
      // Sort by created_at descending — use SQL table row, not JSON
      const createdStmt = db.prepare('SELECT id, created_at FROM capability_cards');
      const createdRows = createdStmt.all() as Array<{ id: string; created_at: string }>;
      const createdMap = new Map(createdRows.map((r) => [r.id, r.created_at]));
      cards = [...cards].sort((a, b) => {
        const aDate = createdMap.get(a.id) ?? '';
        const bDate = createdMap.get(b.id) ?? '';
        return bDate.localeCompare(aDate);
      });
    } else if (sort === 'latency') {
      // Sort ascending — cards without latency data go last (treat as Infinity)
      cards = [...cards].sort((a, b) => {
        const aLatency = a.metadata?.avg_latency_ms ?? Infinity;
        const bLatency = b.metadata?.avg_latency_ms ?? Infinity;
        return aLatency - bLatency;
      });
    }

    const total = cards.length;
    const items = cards.slice(offset, offset + limit).map(stripInternal);

    // Build uses_this_week lookup for returned items
    const usesThisWeek: Record<string, number> = {};
    for (const [key, count] of usesMap) {
      if (count > 0) usesThisWeek[key] = count;
    }

    const result = { total, limit, offset, items: items as CapabilityCard[], uses_this_week: usesThisWeek };
    return reply.send(result);
  });

  /**
   * GET /api/cards/trending — Returns top 10 skills by successful request count in the last 7 days.
   *
   * Each item includes the full card data plus `uses_this_week` count.
   * Only cards with at least 1 successful request in the window are included.
   */
  server.get('/api/cards/trending', {
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
   *
   * Query parameters:
   *   q — Search query string (required)
   *
   * Returns { query, min, max, median, mean, count } or 400 if q is missing.
   */
  server.get('/api/pricing', {
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
   *
   * Returns the card if found, or 404 with { error: 'Not found' }.
   */
  server.get('/cards/:id', {
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
   *
   * Accepts both v1.0 and v2.0 card JSON. Validates via AnyCardSchema (Zod).
   * For v2.0 cards, uses INSERT OR REPLACE (raw SQL) since insertCard() only handles v1.0.
   * Returns 201 on success, 400 on validation failure.
   */
  server.post('/cards', {
    schema: {
      tags: ['cards'],
      summary: 'Publish a capability card',
      body: { type: 'object', additionalProperties: true, description: 'Capability card JSON (v1.0 or v2.0)' },
      response: {
        201: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } },
        400: { type: 'object', properties: { error: { type: 'string' }, issues: { type: 'array' } } },
      },
    },
  }, async (request, reply) => {
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
    const now = new Date().toISOString();

    if (card.spec_version === '2.0') {
      // v2.0 card — raw SQL INSERT OR REPLACE (insertCard only supports v1.0)
      const cardWithTimestamps = {
        ...card,
        created_at: card.created_at ?? now,
        updated_at: now,
      };
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
        insertCard(db, card);
      } catch (err) {
        if (err instanceof AgentBnBError && err.code === 'VALIDATION_ERROR') {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    }

    return reply.code(201).send({ ok: true, id: card.id });
  });

  /**
   * DELETE /cards/:id — Remove a capability card from the registry.
   *
   * Returns 200 on success, 404 if card not found.
   */
  server.delete('/cards/:id', {
    schema: {
      tags: ['cards'],
      summary: 'Delete a capability card',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        200: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const card = getCard(db, id);
    if (!card) {
      return reply.code(404).send({ error: 'Not found' });
    }
    db.prepare('DELETE FROM capability_cards WHERE id = ?').run(id);
    return reply.send({ ok: true, id });
  });

  /**
   * GET /api/agents — Returns a reputation-sorted list of all agent profiles.
   *
   * Each agent profile is aggregated from their capability cards and request log.
   * Sorted by success_rate DESC (nulls last), then total_earned DESC.
   * credits_earned is computed via GROUP BY aggregate SQL, never stored as a column.
   */
  server.get('/api/agents', {
    schema: {
      tags: ['agents'],
      summary: 'List all agent profiles sorted by reputation',
      response: {
        200: {
          type: 'object',
          properties: { items: { type: 'array' }, total: { type: 'integer' } },
        },
      },
    },
  }, async (_request, reply) => {
    const allCards = listCards(db);

    // Group cards by owner
    const ownerMap = new Map<string, CapabilityCard[]>();
    for (const card of allCards) {
      const existing = ownerMap.get(card.owner) ?? [];
      existing.push(card);
      ownerMap.set(card.owner, existing);
    }

    // Compute credits_earned per owner via single aggregate SQL (NOT per-owner loop)
    const creditsStmt = db.prepare(`
      SELECT cc.owner,
             SUM(CASE WHEN rl.status = 'success' THEN rl.credits_charged ELSE 0 END) as credits_earned
      FROM capability_cards cc
      LEFT JOIN request_log rl ON rl.card_id = cc.id
      GROUP BY cc.owner
    `);
    const creditsRows = creditsStmt.all() as Array<{ owner: string; credits_earned: number }>;
    const creditsMap = new Map(creditsRows.map((r) => [r.owner, r.credits_earned ?? 0]));

    // Build agent profiles
    const agents = Array.from(ownerMap.entries()).map(([owner, cards]) => {
      const skillCount = cards.reduce((sum, card) => sum + ((card as unknown as CapabilityCardV2).skills?.length ?? 1), 0);
      const successRates = cards
        .map((c) => c.metadata?.success_rate)
        .filter((r): r is number => r != null);
      const avgSuccessRate =
        successRates.length > 0
          ? successRates.reduce((a, b) => a + b, 0) / successRates.length
          : null;

      // member_since: use MIN of created_at from the SQL table (not from parsed JSON)
      const memberStmt = db.prepare(
        'SELECT MIN(created_at) as earliest FROM capability_cards WHERE owner = ?'
      );
      const memberRow = memberStmt.get(owner) as { earliest: string } | undefined;

      return {
        owner,
        skill_count: skillCount,
        success_rate: avgSuccessRate,
        total_earned: creditsMap.get(owner) ?? 0,
        member_since: memberRow?.earliest ?? new Date().toISOString(),
      };
    });

    // Sort by reputation: success_rate DESC (nulls last), then total_earned DESC
    agents.sort((a, b) => {
      const aRate = a.success_rate ?? -1;
      const bRate = b.success_rate ?? -1;
      if (bRate !== aRate) return bRate - aRate;
      return b.total_earned - a.total_earned;
    });

    return reply.send({ items: agents, total: agents.length });
  });

  /**
   * GET /api/agents/:owner — Returns profile, skills, and recent activity for a specific agent.
   *
   * Returns 404 if the owner has no capability cards registered.
   * recent_activity contains up to 10 most recent request log entries for this owner's cards.
   */
  server.get('/api/agents/:owner', {
    schema: {
      tags: ['agents'],
      summary: 'Get agent profile, skills, and recent activity',
      params: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] },
      response: {
        200: {
          type: 'object',
          properties: {
            profile: { type: 'object', additionalProperties: true },
            skills: { type: 'array' },
            recent_activity: { type: 'array' },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { owner } = request.params as { owner: string };
    const ownerCards = listCards(db, owner);

    if (ownerCards.length === 0) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const skillCount = ownerCards.reduce((sum, card) => sum + ((card as unknown as CapabilityCardV2).skills?.length ?? 1), 0);
    const successRates = ownerCards
      .map((c) => c.metadata?.success_rate)
      .filter((r): r is number => r != null);
    const avgSuccessRate =
      successRates.length > 0
        ? successRates.reduce((a, b) => a + b, 0) / successRates.length
        : null;

    // Credits earned via aggregate SQL
    const creditsStmt = db.prepare(`
      SELECT SUM(CASE WHEN rl.status = 'success' THEN rl.credits_charged ELSE 0 END) as credits_earned
      FROM capability_cards cc
      LEFT JOIN request_log rl ON rl.card_id = cc.id
      WHERE cc.owner = ?
    `);
    const creditsRow = creditsStmt.get(owner) as { credits_earned: number } | undefined;

    // member_since from earliest created_at
    const memberStmt = db.prepare(
      'SELECT MIN(created_at) as earliest FROM capability_cards WHERE owner = ?'
    );
    const memberRow = memberStmt.get(owner) as { earliest: string } | undefined;

    // Recent activity (last 10 requests involving this owner's cards)
    const activityStmt = db.prepare(`
      SELECT rl.id, rl.card_name, rl.requester, rl.status, rl.credits_charged, rl.created_at
      FROM request_log rl
      INNER JOIN capability_cards cc ON rl.card_id = cc.id
      WHERE cc.owner = ?
      ORDER BY rl.created_at DESC
      LIMIT 10
    `);
    const recentActivity = activityStmt.all(owner) as Array<{
      id: string;
      card_name: string;
      requester: string;
      status: string;
      credits_charged: number;
      created_at: string;
    }>;

    const profile = {
      owner,
      skill_count: skillCount,
      success_rate: avgSuccessRate,
      total_earned: creditsRow?.credits_earned ?? 0,
      member_since: memberRow?.earliest ?? new Date().toISOString(),
    };

    return reply.send({
      profile,
      skills: ownerCards,
      recent_activity: recentActivity,
    });
  });

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
  server.get('/api/activity', {
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
   */
  server.get('/api/stats', {
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

    return reply.send({
      agents_online: onlineOwners.size,
      total_capabilities: allCards.reduce((sum, card) => {
        const v2 = card as unknown as CapabilityCardV2;
        return sum + (v2.skills?.length ?? 1);
      }, 0),
      total_exchanges: exchangeRow.count,
    });
  });

  // ---------------------------------------------------------------------------
  // Identity endpoints — public agent identity and guarantor registration
  // ---------------------------------------------------------------------------

  /**
   * POST /api/identity/register — Register a human guarantor via GitHub login.
   *
   * Body: { github_login: string }
   * Returns the created GuarantorRecord. GitHub OAuth verification is stubbed.
   */
  server.post('/api/identity/register', {
    schema: {
      tags: ['identity'],
      summary: 'Register a human guarantor via GitHub login',
      body: {
        type: 'object',
        properties: { github_login: { type: 'string' } },
        required: ['github_login'],
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        409: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    if (!opts.creditDb) {
      return reply.code(503).send({ error: 'Credit database not configured' });
    }
    const body = request.body as Record<string, unknown>;
    const githubLogin = typeof body.github_login === 'string' ? body.github_login.trim() : '';
    if (!githubLogin) {
      return reply.code(400).send({ error: 'github_login is required' });
    }
    try {
      const record = registerGuarantor(opts.creditDb, githubLogin);
      const auth = initiateGithubAuth();
      return reply.code(201).send({ guarantor: record, oauth: auth });
    } catch (err) {
      if (err instanceof AgentBnBError && err.code === 'GUARANTOR_EXISTS') {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * POST /api/identity/link — Link an agent to a human guarantor.
   *
   * Body: { agent_id: string, github_login: string }
   * Enforces max 10 agents per guarantor.
   */
  server.post('/api/identity/link', {
    schema: {
      tags: ['identity'],
      summary: 'Link an agent to a human guarantor',
      body: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          github_login: { type: 'string' },
        },
        required: ['agent_id', 'github_login'],
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        409: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    if (!opts.creditDb) {
      return reply.code(503).send({ error: 'Credit database not configured' });
    }
    const body = request.body as Record<string, unknown>;
    const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
    const githubLogin = typeof body.github_login === 'string' ? body.github_login.trim() : '';
    if (!agentId || !githubLogin) {
      return reply.code(400).send({ error: 'agent_id and github_login are required' });
    }
    try {
      const record = linkAgentToGuarantor(opts.creditDb, agentId, githubLogin);
      return reply.send({ guarantor: record });
    } catch (err) {
      if (err instanceof AgentBnBError) {
        const statusMap: Record<string, number> = {
          GUARANTOR_NOT_FOUND: 404,
          MAX_AGENTS_EXCEEDED: 409,
          AGENT_ALREADY_LINKED: 409,
        };
        const status = statusMap[err.code] ?? 400;
        return reply.code(status).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * GET /api/identity/:agent_id — Returns the guarantor info for an agent.
   *
   * Returns { guarantor: GuarantorRecord } or { guarantor: null } if not linked.
   */
  server.get('/api/identity/:agent_id', {
    schema: {
      tags: ['identity'],
      summary: 'Get guarantor info for an agent',
      params: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] },
      response: {
        200: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            guarantor: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!opts.creditDb) {
      return reply.code(503).send({ error: 'Credit database not configured' });
    }
    const { agent_id } = request.params as { agent_id: string };
    const guarantor = getAgentGuarantor(opts.creditDb, agent_id);
    return reply.send({ agent_id, guarantor });
  });

  // Register owner routes as a scoped plugin (NOT fastify-plugin) so the auth hook
  // only applies to these routes and does NOT affect public /cards and /health endpoints.
  if (opts.ownerApiKey && opts.ownerName) {
    const ownerApiKey = opts.ownerApiKey;
    const ownerName = opts.ownerName;

    void server.register(async (ownerRoutes) => {
      /**
       * Auth hook: validates Bearer token against ownerApiKey.
       * Responds with 401 Unauthorized if missing or incorrect.
       */
      ownerRoutes.addHook('onRequest', async (request, reply) => {
        const auth = request.headers.authorization;
        const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
        if (!token || token !== ownerApiKey) {
          return reply.status(401).send({ error: 'Unauthorized' });
        }
      });

      /**
       * GET /me — Returns owner identity and current credit balance.
       * Uses CreditLedger (direct DB mode) when creditDb is available.
       */
      ownerRoutes.get('/me', {
        schema: {
          tags: ['owner'],
          summary: 'Get owner identity and credit balance',
          security: [{ bearerAuth: [] }],
          response: {
            200: { type: 'object', properties: { owner: { type: 'string' }, balance: { type: 'number' } } },
          },
        },
      }, async (_request, reply) => {
        let balance = 0;
        if (opts.creditDb) {
          const ledger = createLedger({ db: opts.creditDb });
          balance = await ledger.getBalance(ownerName);
        }
        return reply.send({ owner: ownerName, balance });
      });

      /**
       * GET /requests — Returns paginated request log entries.
       *
       * Query params:
       *   limit  — Max entries (default 10, max 100)
       *   since  — Time window: '24h', '7d', or '30d'
       */
      ownerRoutes.get('/requests', {
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
      ownerRoutes.get('/draft', {
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
      ownerRoutes.post('/cards/:id/toggle-online', {
        schema: {
          tags: ['owner'],
          summary: 'Toggle card online/offline status',
          security: [{ bearerAuth: [] }],
          params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          response: {
            200: { type: 'object', properties: { ok: { type: 'boolean' }, online: { type: 'boolean' } } },
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
      ownerRoutes.patch('/cards/:id', {
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
       *
       * Returns an array of PendingRequest objects with status='pending', newest first.
       */
      ownerRoutes.get('/me/pending-requests', {
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
       *
       * Returns 200 with { status: 'approved', id } on success.
       * Returns 404 if the request id does not exist.
       */
      ownerRoutes.post('/me/pending-requests/:id/approve', {
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
       *
       * Returns 200 with { status: 'rejected', id } on success.
       * Returns 404 if the request id does not exist.
       */
      ownerRoutes.post('/me/pending-requests/:id/reject', {
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
       *
       * Query params:
       *   limit — Max entries (default 20, max 100)
       *
       * Returns { items: CreditTransaction[], limit: number }
       * Returns { items: [], limit: 20 } when no creditDb is configured.
       */
      ownerRoutes.get('/me/transactions', {
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
        if (!opts.creditDb) {
          return reply.send({ items: [], limit });
        }
        const ledger = createLedger({ db: opts.creditDb });
        const items = await ledger.getHistory(ownerName, limit);
        return reply.send({ items, limit });
      });
    });
  }

  return { server, relayState };
}
