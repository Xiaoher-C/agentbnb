import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { getCard, insertCard, updateCard, listCards, getCardsBySkillCapability, attachCanonicalAgentId } from './store.js';
import { listPendingRequests, resolvePendingRequest } from '../autonomy/pending-requests.js';
import { searchCards, filterCards, buildReputationMap } from './matcher.js';
import { getPricingStats } from './pricing.js';
import { getRequestLog, getActivityFeed } from './request-log.js';
import type { SincePeriod } from './request-log.js';
import { createLedger } from '../credit/create-ledger.js';
import { detectApiKeys, buildDraftCard, KNOWN_API_KEYS } from '../cli/onboarding.js';
import { AgentBnBError, AnyCardSchema } from '../types/index.js';
import type { CapabilityCard, CapabilityCardV2, AgentProfileV2 } from '../types/index.js';
import { registerWebSocketRelay } from '../relay/websocket-relay.js';
import type { RelayState } from '../relay/types.js';
import {
  registerGuarantor,
  linkAgentToGuarantor,
  getAgentGuarantor,
  initiateGithubAuth,
} from '../identity/guarantor.js';
import { creditRoutesPlugin } from './credit-routes.js';
import { hubAgentRoutesPlugin } from '../hub-agent/routes.js';
import { createRelayBridge } from '../hub-agent/relay-bridge.js';
import { convertToGptActions } from './openapi-gpt-actions.js';
import feedbackPlugin from '../feedback/api.js';
import evolutionPlugin from '../evolution/api.js';
import { executeCapabilityBatch } from '../gateway/execute.js';

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

function buildSqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
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
        description: 'Where AI agents hire AI agents — discover, publish, and coordinate agent capabilities',
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
            description: 'Ed25519 public key (hex). Also requires X-Agent-Id, X-Agent-Signature, and X-Agent-Timestamp headers.',
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
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Id', 'X-Agent-PublicKey', 'X-Agent-Signature', 'X-Agent-Timestamp'],
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

  // Register Hub Agent CRUD endpoints -- requires HUB_MASTER_KEY env var for secret encryption
  if (opts.creditDb) {
    void server.register(hubAgentRoutesPlugin, { registryDb: db, creditDb: opts.creditDb });

    // Wire relay bridge: auto-dispatch queued jobs when agents reconnect
    if (relayState?.setOnAgentOnline && relayState.getConnections && relayState.getPendingRequests && relayState.sendMessage) {
      const bridge = createRelayBridge({
        registryDb: db,
        creditDb: opts.creditDb,
        sendMessage: relayState.sendMessage,
        pendingRequests: relayState.getPendingRequests(),
        connections: relayState.getConnections(),
      });
      relayState.setOnAgentOnline(bridge.onAgentOnline);
    }
  }

  // Register static file serving for the hub SPA (optional — skipped if hub not built)
  // Resolve hub/dist/ relative to this file's compiled location in dist/registry/server.js
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const hubDistCandidates = [
    join(__dirname, '../hub/dist'),       // When in dist/ (tsup chunk, e.g. dist/server-XYZ.js)
    join(__dirname, '../../hub/dist'),    // When in dist/registry/ or dist/cli/
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

  // Register feedback plugin — POST /api/feedback, GET /api/feedback/:skill_id, GET /api/reputation/:agent_id
  void server.register(feedbackPlugin, { db });

  // Register evolution plugin — POST /api/evolution/publish, GET /api/evolution/latest, GET /api/evolution/history
  void server.register(evolutionPlugin, { db });

  // ---- All API routes registered inside a plugin so @fastify/swagger captures them ----
  // Routes registered directly on the server (outside a plugin) are invisible to swagger
  // because swagger's onRoute hook is not yet active during synchronous registration.
  void server.register(async (api) => {

  /**
   * GET /health — Liveness probe for the registry server.
   */
  api.get('/health', {
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
   *   min_reputation     — Filter cards with peer feedback reputation >= value (0-1)
   *   capability_type    — Filter cards whose skills declare this capability_type
   *   sort               — Sort order: 'popular'|'rated'|'success_rate'|'cheapest'|'newest'|'latency'|'reputation_desc'|'reputation_asc'
   *   limit              — Max items per page (default 20, max 100)
   *   offset             — Pagination offset (default 0)
   */
  api.get('/cards', {
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
    // getCardsBySkillCapability checks skill.capability_type (string) and
    // skill.capability_types (string[]) so both single and multi-type skill declarations match.
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
    // NOTE: Phase 1 design — trust is per-owner. All cards from the same owner
    // share the same performance_tier and success_rate. Per-skill trust is Phase 2.
    // success_rate denominator = terminal_exec (success+failure+timeout+refunded only),
    // excluding audit/autonomy action_type rows.
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
        if (row.total_exec > 10) tier = 1;
        if (row.total_exec > 50 && successRate >= 0.85) tier = 2;
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
    // Cards from owners with zero terminal executions are excluded when filter is active.
    if (minSuccessRate !== undefined && !isNaN(minSuccessRate)) {
      cards = cards.filter((c) => {
        const trust = ownerTrustMap.get(c.owner);
        if (!trust || trust.terminal_exec === 0) return false;
        return trust.success_rate >= minSuccessRate;
      });
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
      // Sort by credits_per_call ascending — fall back to first skill price for v2 cards
      cards = [...cards].sort((a, b) => {
        type MaybeV2 = { pricing?: { credits_per_call: number }; skills?: Array<{ pricing: { credits_per_call: number } }> };
        const aCard = a as unknown as MaybeV2;
        const bCard = b as unknown as MaybeV2;
        const aPrice = aCard.pricing?.credits_per_call ?? aCard.skills?.[0]?.pricing?.credits_per_call ?? Infinity;
        const bPrice = bCard.pricing?.credits_per_call ?? bCard.skills?.[0]?.pricing?.credits_per_call ?? Infinity;
        return aPrice - bPrice;
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
    } else if (sort === 'reputation_desc' || sort === 'reputation_asc') {
      // Sort by peer feedback reputation score.
      // Build reputation map in one batch pass (deduplicates owner lookups).
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
    // Only compute for paged items to avoid scanning feedback for the entire result set.
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
        // Enrich metadata with live execution-based success_rate if available
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
   *
   * Each item includes the full card data plus `uses_this_week` count.
   * Only cards with at least 1 successful request in the window are included.
   */
  api.get('/api/cards/trending', {
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
  api.get('/api/pricing', {
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
  api.get('/cards/:id', {
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
  api.post('/cards', {
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
      const cardWithTimestamps = attachCanonicalAgentId(db, {
        ...card,
        created_at: card.created_at ?? now,
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
   * Requires Authorization: Bearer <token> header.
   * Returns 204 on success, 403 if card belongs to different owner, 404 if not found, 401 if unauthenticated.
   */
  api.delete('/cards/:id', {
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
    if (!token || !opts.ownerApiKey || token !== opts.ownerApiKey) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const card = getCard(db, id);
    if (!card) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (opts.ownerName && card.owner !== opts.ownerName) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    db.prepare('DELETE FROM capability_cards WHERE id = ?').run(id);
    return reply.code(204).send();
  });

  /**
   * GET /api/agents — Returns a reputation-sorted list of all agent profiles.
   *
   * Each agent profile is aggregated from their capability cards and request log.
   * Sorted by success_rate DESC (nulls last), then total_earned DESC.
   * credits_earned is computed via GROUP BY aggregate SQL, never stored as a column.
   */
  api.get('/api/agents', {
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
   * GET /api/agents/:owner — Returns AgentProfileV2 for Hub v2.
   *
   * Returns 404 if the owner has no capability cards registered.
   * Computes trust_metrics, execution_proofs, and performance_tier from
   * request_log at query time (no snapshots in phase 1).
   * Also includes backwards-compatible `profile` and `recent_activity` fields.
   */
  api.get('/api/agents/:owner', {
    schema: {
      tags: ['agents'],
      summary: 'Get agent profile, skills, and recent activity (AgentProfileV2)',
      params: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] },
      response: {
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { owner } = request.params as { owner: string };
    const ownerCards = listCards(db, owner);

    if (ownerCards.length === 0) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const resolvedOwner = ownerCards[0]?.owner ?? owner;
    const ownerCardIds = ownerCards.map((card) => card.id);
    const cardIdPlaceholders = buildSqlPlaceholders(ownerCardIds.length);
    const joinedAt =
      ownerCards
        .map((card) => card.created_at)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort((left, right) => left.localeCompare(right))[0] ??
      new Date().toISOString();
    const latestCardUpdate =
      ownerCards
        .map((card) => card.updated_at ?? card.created_at)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort((left, right) => right.localeCompare(left))[0] ?? joinedAt;

    const lastActiveStmt = db.prepare(
      `SELECT MAX(created_at) as last_req FROM request_log WHERE card_id IN (${cardIdPlaceholders})`,
    );
    const lastActiveRow = lastActiveStmt.get(...ownerCardIds) as { last_req: string | null } | undefined;
    const lastActive = lastActiveRow?.last_req ?? latestCardUpdate ?? joinedAt;

    // --- Trust Metrics (from request_log, all-time) ---
    const metricsStmt = db.prepare(`
      SELECT
        SUM(CASE WHEN rl.failure_reason IS NULL OR rl.failure_reason IN ('bad_execution','auth_error')
            THEN 1 ELSE 0 END) as total,
        SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as successes,
        AVG(CASE WHEN rl.status = 'success' THEN rl.latency_ms END) as avg_latency,
        COUNT(DISTINCT rl.requester) as unique_requesters,
        COUNT(DISTINCT CASE WHEN rl.status = 'success' THEN rl.requester END) as repeat_success_requesters
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders}) AND rl.action_type IS NULL
    `);
    const metricsRow = metricsStmt.get(...ownerCardIds) as {
      total: number;
      successes: number;
      avg_latency: number | null;
      unique_requesters: number;
      repeat_success_requesters: number;
    } | undefined;

    const totalExec = metricsRow?.total ?? 0;
    const successExec = metricsRow?.successes ?? 0;
    const successRate = totalExec > 0 ? successExec / totalExec : 0;
    const avgLatency = metricsRow?.avg_latency ?? 0;

    // refund_rate: proportion of requests that resulted in no credits charged (failure/timeout)
    const refundRate = totalExec > 0 ? (totalExec - successExec) / totalExec : 0;

    // repeat_use_rate: unique requesters who had at least one success / total unique requesters
    const uniqueReq = metricsRow?.unique_requesters ?? 0;
    const repeatRate = uniqueReq > 0 ? (metricsRow?.repeat_success_requesters ?? 0) / uniqueReq : 0;

    // 7-day trend: daily execution counts
    const trendStmt = db.prepare(`
      SELECT
        DATE(rl.created_at) as day,
        COUNT(*) as count,
        SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as success
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders}) AND rl.action_type IS NULL
        AND rl.created_at >= DATE('now', '-7 days')
      GROUP BY DATE(rl.created_at)
      ORDER BY day ASC
    `);
    const trend_7d = (trendStmt.all(...ownerCardIds) as Array<{ day: string; count: number; success: number }>)
      .map((r) => ({ date: r.day, count: r.count, success: r.success }));

    // --- Performance Tier (metrics-only, no verification implication) ---
    let performanceTier: 0 | 1 | 2 = 0;
    if (totalExec > 10) performanceTier = 1;
    if (totalExec > 50 && successRate >= 0.85) performanceTier = 2;

    // --- Execution Proofs (last 10, proof_source='request_log' in phase 1) ---
    const proofsStmt = db.prepare(`
      SELECT rl.card_name, rl.status, rl.latency_ms, rl.id, rl.created_at
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders}) AND rl.action_type IS NULL
      ORDER BY rl.created_at DESC
      LIMIT 10
    `);
    const proofRows = proofsStmt.all(...ownerCardIds) as Array<{
      card_name: string;
      status: 'success' | 'failure' | 'timeout';
      latency_ms: number;
      id: string;
      created_at: string;
    }>;

    const statusToOutcomeClass = (s: string): 'completed' | 'partial' | 'failed' | 'cancelled' => {
      if (s === 'success') return 'completed';
      if (s === 'timeout') return 'cancelled';
      return 'failed';
    };

    const executionProofs: AgentProfileV2['execution_proofs'] = proofRows.map((r) => ({
      action: r.card_name,
      status: r.status === 'timeout' ? 'timeout' : r.status,
      outcome_class: statusToOutcomeClass(r.status),
      latency_ms: r.latency_ms,
      receipt_id: r.id,
      proof_source: 'request_log' as const,
      timestamp: r.created_at,
    }));

    // --- Suitability from most recent v2.0 card ---
    const v2Card = ownerCards.find((c) => (c as unknown as CapabilityCardV2).spec_version === '2.0') as CapabilityCardV2 | undefined;
    const suitability = v2Card?.suitability;

    // --- Learning from most recent v2.0 card ---
    const learning: AgentProfileV2['learning'] = {
      known_limitations: v2Card?.learning?.known_limitations ?? [],
      common_failure_patterns: v2Card?.learning?.common_failure_patterns ?? [],
      recent_improvements: v2Card?.learning?.recent_improvements ?? [],
      critiques: v2Card?.learning?.critiques ?? [],
    };

    // --- Recent activity (backwards compat) ---
    const activityStmt = db.prepare(`
      SELECT rl.id, rl.card_name, rl.requester, rl.status, rl.credits_charged, rl.created_at
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders})
      ORDER BY rl.created_at DESC
      LIMIT 10
    `);
    const recentActivity = activityStmt.all(...ownerCardIds) as AgentProfileV2['recent_activity'];

    // --- Backwards-compat profile aggregate ---
    const skillCount = ownerCards.reduce((sum, card) => sum + ((card as unknown as CapabilityCardV2).skills?.length ?? 1), 0);
    const creditsStmt = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN rl.status = 'success' THEN rl.credits_charged ELSE 0 END), 0) as credits_earned
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders})
    `);
    const creditsRow = creditsStmt.get(...ownerCardIds) as { credits_earned: number } | undefined;

    const response: AgentProfileV2 = {
      owner: resolvedOwner,
      agent_name: v2Card?.agent_name,
      short_description: v2Card?.short_description,
      joined_at: joinedAt,
      last_active: lastActive,
      performance_tier: performanceTier,
      verification_badges: [], // Phase 1: no verification mechanism yet
      authority: {
        authority_source: 'self',
        verification_status: 'none',
      },
      suitability,
      trust_metrics: {
        total_executions: totalExec,
        successful_executions: successExec,
        success_rate: successRate,
        avg_latency_ms: Math.round(avgLatency),
        refund_rate: refundRate,
        repeat_use_rate: repeatRate,
        trend_7d,
        snapshot_at: null,
        aggregation_window: 'all',
      },
      execution_proofs: executionProofs,
      learning,
      skills: ownerCards,
      recent_activity: recentActivity,
    };

    // Backwards-compat: also include `profile` shape for Hub v1 consumers
    return reply.send({
      ...response,
      profile: {
        owner: resolvedOwner,
        skill_count: skillCount,
        success_rate: successRate > 0 ? successRate : null,
        total_earned: creditsRow?.credits_earned ?? 0,
        member_since: joinedAt,
      },
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
  api.get('/api/activity', {
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
  api.get('/api/stats', {
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

  // ---------------------------------------------------------------------------
  // Identity endpoints — public agent identity and guarantor registration
  // ---------------------------------------------------------------------------

  /**
   * POST /api/identity/register — Register a human guarantor via GitHub login.
   *
   * Body: { github_login: string }
   * Returns the created GuarantorRecord. GitHub OAuth verification is stubbed.
   */
  api.post('/api/identity/register', {
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
        503: { type: 'object', properties: { error: { type: 'string' } } },
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
  api.post('/api/identity/link', {
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
        503: { type: 'object', properties: { error: { type: 'string' } } },
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
        const statusMap: Record<string, 400 | 404 | 409> = {
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
  api.get('/api/identity/:agent_id', {
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
        503: { type: 'object', properties: { error: { type: 'string' } } },
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

  /**
   * GET /api/did/:agent_id — Returns a W3C DID Document for an agent.
   */
  api.get('/api/did/:agent_id', {
    schema: {
      tags: ['identity'],
      summary: 'Resolve agent DID Document',
      params: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] },
      response: {
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };
    const allCards = listCards(opts.registryDb);
    const agentCard = allCards.find((c) => {
      const parsed = AnyCardSchema.safeParse(c);
      return parsed.success && parsed.data.agent_id === agent_id;
    });
    if (!agentCard) {
      return reply.code(404).send({ error: `Agent ${agent_id} not found` });
    }
    const parsed = AnyCardSchema.parse(agentCard);
    const didId = `did:agentbnb:${agent_id}`;
    const didDocument: Record<string, unknown> = {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2020/v1'],
      id: didId,
      verificationMethod: [{ id: `${didId}#key-1`, type: 'Ed25519VerificationKey2020', controller: didId }],
      authentication: [`${didId}#key-1`],
      assertionMethod: [`${didId}#key-1`],
    };
    if (parsed.gateway_url) {
      didDocument['service'] = [{ id: `${didId}#agentbnb-gateway`, type: 'AgentGateway', serviceEndpoint: parsed.gateway_url }];
    }
    return reply.send(didDocument);
  });

  /**
   * GET /api/credentials/:agent_id — Returns Verifiable Credentials for an agent.
   */
  api.get('/api/credentials/:agent_id', {
    schema: {
      tags: ['identity'],
      summary: 'Get Verifiable Credentials for an agent',
      params: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };
    return reply.send({ agent_id, did: `did:agentbnb:${agent_id}`, credentials: [] });
  });

  /**
   * GET /api/openapi/gpt-actions — Returns a GPT Builder-importable OpenAPI spec.
   *
   * Filters the auto-generated spec to only public GET/POST endpoints,
   * sets absolute server URL, and adds operationIds.
   */
  api.get('/api/openapi/gpt-actions', {
    schema: {
      tags: ['system'],
      summary: 'GPT Actions-compatible OpenAPI schema',
      description: 'Returns a GPT Builder-importable OpenAPI spec with only public GET/POST endpoints',
      querystring: {
        type: 'object',
        properties: {
          server_url: { type: 'string', description: 'Base URL for the server (required for absolute URLs in GPT Actions)' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const serverUrl = query.server_url?.trim() || `${request.protocol}://${request.hostname}`;
    const openapiSpec = server.swagger();
    const gptActions = convertToGptActions(openapiSpec as Record<string, unknown>, serverUrl);
    return reply.send(gptActions);
  });

  // ---------------------------------------------------------------------------
  // Batch request endpoint — POST /api/request/batch
  // ---------------------------------------------------------------------------

  /** Zod schema for validating POST /api/request/batch request body. */
  const BatchRequestBodySchema = z.object({
    requests: z.array(
      z.object({
        skill_id: z.string().min(1),
        params: z.record(z.unknown()).default({}),
        max_credits: z.number().positive(),
      }),
    ).min(1),
    strategy: z.enum(['parallel', 'sequential', 'best_effort']),
    total_budget: z.number().positive(),
  });

  /**
   * POST /api/request/batch — Execute multiple capability requests in a single call.
   *
   * Strategies:
   *   - `parallel`    — all requests run concurrently; any failure makes overall success false
   *   - `sequential`  — requests run one at a time; stops on first failure
   *   - `best_effort` — all run concurrently; partial success is acceptable
   *
   * Auth: reads `owner` from `Authorization: Bearer <owner>` header.
   * Budget: sum(max_credits) must be <= total_budget or the call is rejected immediately.
   *
   * Body: { requests: [{ skill_id, params, max_credits }], strategy, total_budget }
   * Response: BatchExecuteResult
   */
  api.post('/api/request/batch', {
    schema: {
      tags: ['cards'],
      summary: 'Execute multiple capability requests in one batch call',
      body: { type: 'object', additionalProperties: true },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        401: { type: 'object', properties: { error: { type: 'string' } } },
        503: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    // Require creditDb to be present for credit operations
    if (!opts.creditDb) {
      return reply.code(503).send({ error: 'Credit database not configured' });
    }

    // Extract owner from Bearer token header
    const auth = request.headers.authorization;
    const owner = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!owner) {
      return reply.code(401).send({ error: 'Authorization header with Bearer <owner> is required' });
    }

    // Validate request body with Zod
    const parseResult = BatchRequestBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Request body validation failed',
        issues: parseResult.error.issues,
      });
    }

    const { requests, strategy, total_budget } = parseResult.data;
    const host = request.headers.host ?? request.hostname;
    const relayRegistryUrl = `${request.protocol}://${host}`;
    const relayRequesterOwner = `${owner}:batch:${Date.now()}`;

    let relayClient: import('../relay/websocket-client.js').RelayClient | undefined;

    try {
      const batchResult = await executeCapabilityBatch({
        requests,
        strategy,
        total_budget,
        registryDb: db,
        creditDb: opts.creditDb,
        owner,
        registryUrl: relayRegistryUrl,
        dispatchRequest: async ({ target, params, requester }) => {
          // For direct targets we keep compatibility with legacy batch behavior.
          // Relay execution is used when the target has no gateway_url.
          if (!target.via_relay) {
            return { card_id: target.cardId, skill_id: target.skillId };
          }

          if (!relayClient) {
            const { RelayClient } = await import('../relay/websocket-client.js');
            relayClient = new RelayClient({
              registryUrl: relayRegistryUrl,
              owner: relayRequesterOwner,
              token: 'batch-token',
              card: {
                spec_version: '1.0',
                id: randomUUID(),
                owner: relayRequesterOwner,
                name: relayRequesterOwner,
                description: 'Batch requester',
                level: 1,
                inputs: [],
                outputs: [],
                pricing: { credits_per_call: 1 },
                availability: { online: false },
              },
              onRequest: async () => ({ error: { code: -32601, message: 'Batch requester does not serve capabilities' } }),
              silent: true,
            });
            await relayClient.connect();
          }

          const { requestViaRelay } = await import('../gateway/client.js');
          return requestViaRelay(relayClient, {
            targetOwner: target.owner,
            cardId: target.cardId,
            skillId: target.skillId,
            params: { ...params, requester },
            requester,
          });
        },
      });

      return reply.send(batchResult);
    } finally {
      relayClient?.disconnect();
    }
  });

  // Register owner routes as a scoped plugin (NOT fastify-plugin) so the auth hook
  // only applies to these routes and does NOT affect public /cards and /health endpoints.
  if (opts.ownerApiKey && opts.ownerName) {
    const ownerApiKey = opts.ownerApiKey;
    const ownerName = opts.ownerName;

    void api.register(async (ownerRoutes) => {
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

  /**
   * GET /api/providers/:owner/reliability — Provider reliability metrics.
   */
  api.get('/api/providers/:owner/reliability', {
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
    if (!opts.creditDb) {
      return reply.code(404).send({ error: 'Credit system not enabled' });
    }
    const { getReliabilityMetrics } = await import('../credit/reliability-metrics.js');
    const metrics = getReliabilityMetrics(opts.creditDb, owner);
    if (!metrics) {
      return reply.code(404).send({ error: 'No reliability data for this provider' });
    }
    return reply.send(metrics);
  });

  /**
   * GET /api/fleet/:owner — Agent fleet overview for the given owner.
   * Returns all cards owned by the account with per-agent metrics.
   */
  api.get('/api/fleet/:owner', {
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
        if (opts.creditDb) {
          const earningRow = opts.creditDb.prepare(
            "SELECT COALESCE(SUM(amount), 0) as total FROM credit_transactions WHERE owner = ? AND reason = 'settlement' AND amount > 0",
          ).get(providerIdentity) as { total: number };
          earnings = earningRow.total;
          const spendRow = opts.creditDb.prepare(
            "SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM credit_transactions WHERE owner = ? AND reason = 'escrow_hold'",
          ).get(providerIdentity) as { total: number };
          spend = spendRow.total;
        }

        // Per-agent request stats from request_log
        const successCount = (db.prepare(
          "SELECT COUNT(*) as cnt FROM request_log WHERE card_id = ? AND status = 'success' AND (action_type IS NULL OR action_type = 'auto_share')",
        ).get(card.id) as { cnt: number }).cnt;

        const failureCount = (db.prepare(
          "SELECT COUNT(*) as cnt FROM request_log WHERE card_id = ? AND status IN ('failure', 'timeout', 'refunded') AND (action_type IS NULL OR action_type = 'auto_share')",
        ).get(card.id) as { cnt: number }).cnt;

        const totalExec = successCount + failureCount;
        const successRate = totalExec > 0 ? successCount / totalExec : 0;

        // Failure breakdown by failure_reason
        let failureBreakdown: Record<string, number> = {};
        try {
          const failureRows = db.prepare(
            "SELECT failure_reason, COUNT(*) as cnt FROM request_log WHERE card_id = ? AND status IN ('failure', 'timeout', 'refunded') AND failure_reason IS NOT NULL GROUP BY failure_reason",
          ).all(card.id) as Array<{ failure_reason: string; cnt: number }>;
          for (const fr of failureRows) {
            failureBreakdown[fr.failure_reason] = fr.cnt;
          }
        } catch {
          // failure_reason column may not exist in older schemas
        }

        // Reliability metrics
        let reliability = null;
        if (opts.creditDb) {
          const { getReliabilityMetrics } = await import('../credit/reliability-metrics.js');
          reliability = getReliabilityMetrics(opts.creditDb, providerIdentity);
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

  }); // end of API routes plugin

  return { server, relayState };
}
