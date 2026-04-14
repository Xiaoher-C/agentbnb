import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { registerWebSocketRelay } from '../relay/websocket-relay.js';
import type { RelayState } from '../relay/types.js';
import { creditRoutesPlugin } from './credit-routes.js';
import { activityRoutesPlugin } from './activity-routes.js';
import { providerRoutesPlugin } from './provider-routes.js';
import { agentRoutesPlugin } from './agent-routes.js';
import { batchRoutesPlugin } from './batch-routes.js';
import { identityRoutesPlugin } from './identity-routes.js';
import { cardRoutesPlugin } from './card-routes.js';
import { ownerRoutesPlugin } from './owner-routes.js';
import feedbackPlugin from '../feedback/api.js';
import evolutionPlugin from '../evolution/api.js';

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

  // Register CORS — origin: true is intentional for a public registry read API.
  // Write endpoints (POST /cards, batch, identity) are protected by Ed25519 signed headers
  // which cannot be forged cross-origin, providing equivalent CSRF protection.
  void server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Id', 'X-Agent-PublicKey', 'X-Agent-Signature', 'X-Agent-Timestamp'],
  });

  // Global rate limit — 100 requests per minute per IP to prevent abuse
  void server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
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

  // Hub Agent routes DISABLED — violates P2P principles (ADR-002, ADR-003, ADR-010).
  // Hub Agent centralizes execution on the Registry server, bypasses agentbnb init identity,
  // and uses a hardcoded ownerPublicKey. See decisions/2026-04-14-hub-agent-violates-p2p-principles.
  // if (opts.creditDb) {
  //   void server.register(hubAgentRoutesPlugin, { registryDb: db, creditDb: opts.creditDb });
  //   if (relayState?.setOnAgentOnline && relayState.getConnections && relayState.getPendingRequests && relayState.sendMessage) {
  //     const bridge = createRelayBridge({
  //       registryDb: db,
  //       creditDb: opts.creditDb,
  //       sendMessage: relayState.sendMessage,
  //       pendingRequests: relayState.getPendingRequests(),
  //       connections: relayState.getConnections(),
  //     });
  //     relayState.setOnAgentOnline(bridge.onAgentOnline);
  //   }
  // }

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

  // Card CRUD and search routes (extracted to card-routes.ts)
  void api.register(cardRoutesPlugin, {
    registryDb: db,
    creditDb: opts.creditDb,
    ownerApiKey: opts.ownerApiKey,
    ownerName: opts.ownerName,
  });

  // Agent profile routes (extracted to agent-routes.ts)
  void api.register(agentRoutesPlugin, { registryDb: db, creditDb: opts.creditDb });

  // Activity and stats routes (extracted to activity-routes.ts)
  void api.register(activityRoutesPlugin, { registryDb: db, relayState });

  // Identity and auth routes (extracted to identity-routes.ts)
  void api.register(identityRoutesPlugin, { registryDb: db, creditDb: opts.creditDb });

  // GPT actions and batch request routes (extracted to batch-routes.ts)
  void api.register(batchRoutesPlugin, {
    registryDb: db,
    creditDb: opts.creditDb,
    ownerApiKey: opts.ownerApiKey,
    ownerName: opts.ownerName,
    parentServer: server,
  });

  // Owner routes (extracted to owner-routes.ts) — registered as scoped plugin so auth
  // hook only applies to these routes and does NOT affect public endpoints.
  if (opts.ownerApiKey && opts.ownerName) {
    void api.register(ownerRoutesPlugin, {
      registryDb: db,
      creditDb: opts.creditDb,
      ownerApiKey: opts.ownerApiKey,
      ownerName: opts.ownerName,
    });
  }

  // Provider reliability and fleet routes (extracted to provider-routes.ts)
  void api.register(providerRoutesPlugin, { registryDb: db, creditDb: opts.creditDb });

  }); // end of API routes plugin

  return { server, relayState };
}
