import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getCard } from './store.js';
import { searchCards, filterCards } from './matcher.js';
import type { CapabilityCard } from '../types/index.js';

/**
 * Options for creating the public registry server.
 */
export interface RegistryServerOptions {
  /** Open SQLite database instance for the capability card registry. */
  registryDb: Database.Database;
  /** When true, disables Fastify request logging. Useful for tests. */
  silent?: boolean;
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

  // Register CORS — allow all origins for public marketplace discovery
  void server.register(cors, { origin: true });

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
    const items = cards.slice(offset, offset + limit);

    const result: PaginatedCards = { total, limit, offset, items };
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

    return reply.send(card);
  });

  return server;
}
