import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { tryVerifyIdentity } from './identity-auth.js';
import { convertToGptActions } from './openapi-gpt-actions.js';
import { executeCapabilityBatch } from '../gateway/execute.js';

/** Options for batchRoutesPlugin. */
export interface BatchRoutesOptions {
  registryDb: Database.Database;
  creditDb?: Database.Database;
  ownerApiKey?: string;
  ownerName?: string;
  /** The parent Fastify instance that owns the Swagger spec (needed for GPT actions). */
  parentServer: FastifyInstance;
}

/**
 * Fastify plugin that registers GPT actions and batch request endpoints.
 *
 *   GET  /api/openapi/gpt-actions — GPT Actions-compatible OpenAPI schema
 *   POST /api/request/batch       — Execute multiple capability requests in one batch call
 */
export async function batchRoutesPlugin(
  fastify: FastifyInstance,
  options: BatchRoutesOptions,
): Promise<void> {
  const { registryDb: db, creditDb, ownerApiKey, ownerName, parentServer } = options;

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
   * GET /api/openapi/gpt-actions — Returns a GPT Builder-importable OpenAPI spec.
   *
   * Filters the auto-generated spec to only public GET/POST endpoints,
   * sets absolute server URL, and adds operationIds.
   */
  fastify.get('/api/openapi/gpt-actions', {
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
    const openapiSpec = parentServer.swagger();
    const gptActions = convertToGptActions(openapiSpec as Record<string, unknown>, serverUrl);
    return reply.send(gptActions);
  });

  // ---------------------------------------------------------------------------
  // Batch request endpoint — POST /api/request/batch
  // ---------------------------------------------------------------------------

  /**
   * POST /api/request/batch — Execute multiple capability requests in a single call.
   *
   * Strategies:
   *   - `parallel`    — all requests run concurrently; any failure makes overall success false
   *   - `sequential`  — requests run one at a time; stops on first failure
   *   - `best_effort` — all run concurrently; partial success is acceptable
   *
   * Auth: Ed25519 identity headers (preferred) or admin Bearer token (ownerApiKey).
   * Budget: sum(max_credits) must be <= total_budget or the call is rejected immediately.
   *
   * Body: { requests: [{ skill_id, params, max_credits }], strategy, total_budget }
   * Response: BatchExecuteResult
   */
  fastify.post('/api/request/batch', {
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
    if (!creditDb) {
      return reply.code(503).send({ error: 'Credit database not configured' });
    }

    // Authenticate caller: prefer Ed25519 identity, fall back to admin Bearer token.
    let owner: string | null = null;

    const didResult = await tryVerifyIdentity(request, {});
    if (didResult.valid) {
      owner = didResult.agentId;
    } else {
      // Fall back to Bearer token — only accept the server's ownerApiKey (admin path).
      const auth = request.headers.authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (token && ownerApiKey && token === ownerApiKey && ownerName) {
        owner = ownerName;
      }
    }

    if (!owner) {
      return reply.code(401).send({ error: 'Valid identity headers or admin Bearer token required' });
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
        creditDb,
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
}
