import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getCard, updateCard } from './store.js';
import { searchCards, filterCards } from './matcher.js';
import { getRequestLog } from './request-log.js';
import type { SincePeriod } from './request-log.js';
import { getBalance } from '../credit/ledger.js';
import { detectApiKeys, buildDraftCard, KNOWN_API_KEYS } from '../cli/onboarding.js';
import { AgentBnBError } from '../types/index.js';
import type { CapabilityCard } from '../types/index.js';

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
 * Paginated response envelope for card listing.
 */
interface PaginatedCards {
  total: number;
  limit: number;
  offset: number;
  items: CapabilityCard[];
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
export function createRegistryServer(opts: RegistryServerOptions): FastifyInstance {
  const { registryDb: db, silent = false } = opts;

  const server = Fastify({ logger: !silent });

  // Register CORS — allow all origins for public marketplace discovery, including preflight
  void server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

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
      decorateReply: false,
    });

    // Redirect /hub (no trailing slash) to /hub/ so assets resolve correctly
    server.get('/hub', async (_request, reply) => {
      return reply.redirect('/hub/');
    });
  }

  /**
   * GET /health — Liveness probe for the registry server.
   */
  server.get('/health', async (_request, reply) => {
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
  server.get('/cards', async (request, reply) => {
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

    // Sorting
    if (sort === 'success_rate') {
      // Sort descending — cards without a rating go last (treat as -1)
      cards = [...cards].sort((a, b) => {
        const aRate = a.metadata?.success_rate ?? -1;
        const bRate = b.metadata?.success_rate ?? -1;
        return bRate - aRate;
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

    const result: PaginatedCards = { total, limit, offset, items: items as CapabilityCard[] };
    return reply.send(result);
  });

  /**
   * GET /cards/:id — Retrieve a single capability card by UUID.
   *
   * Returns the card if found, or 404 with { error: 'Not found' }.
   */
  server.get('/cards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const card = getCard(db, id);

    if (!card) {
      return reply.code(404).send({ error: 'Not found' });
    }

    return reply.send(stripInternal(card));
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
       */
      ownerRoutes.get('/me', async (_request, reply) => {
        const balance = opts.creditDb
          ? getBalance(opts.creditDb, ownerName)
          : 0;
        return reply.send({ owner: ownerName, balance });
      });

      /**
       * GET /requests — Returns paginated request log entries.
       *
       * Query params:
       *   limit  — Max entries (default 10, max 100)
       *   since  — Time window: '24h', '7d', or '30d'
       */
      ownerRoutes.get('/requests', async (request, reply) => {
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
      ownerRoutes.get('/draft', async (_request, reply) => {
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
      ownerRoutes.post('/cards/:id/toggle-online', async (request, reply) => {
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
      ownerRoutes.patch('/cards/:id', async (request, reply) => {
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
    });
  }

  return server;
}
