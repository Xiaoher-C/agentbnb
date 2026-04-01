import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SkillExecutor } from '../skills/executor.js';
import { executeCapabilityRequest } from './execute.js';
import type { EscrowReceipt } from '../types/index.js';
// FailureReason is used as a string literal 'overload' in the overload log entry
import { verifyEscrowReceipt } from '../credit/signing.js';
import { decodeUCAN, verifyUCAN } from '../auth/ucan.js';
import { insertRequestLog } from '../registry/request-log.js';

/**
 * Options for creating a gateway server.
 */
export interface GatewayOptions {
  /** Port to listen on. Default 7700. */
  port?: number;
  /** Open registry database instance. */
  registryDb: Database.Database;
  /** Open credit database instance. */
  creditDb: Database.Database;
  /** Valid bearer tokens for auth. */
  tokens: string[];
  /** URL of the local capability handler. */
  handlerUrl: string;
  /** Request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Disable logging (useful for tests). */
  silent?: boolean;
  /**
   * Optional SkillExecutor instance.
   * When provided, skill execution is dispatched through SkillExecutor.execute()
   * instead of forwarding via fetch(handlerUrl).
   * When absent, the original handlerUrl fetch path is used (backward compat).
   */
  skillExecutor?: SkillExecutor;
}

const VERSION = '0.0.1';

/**
 * Creates a Fastify gateway server for agent-to-agent communication.
 * Registers /health (unauthenticated) and /rpc (token-authenticated) endpoints.
 * Returns a configured Fastify instance (call .ready() before using inject,
 * or .listen() to start accepting connections).
 *
 * @param opts - Gateway configuration options.
 * @returns Configured Fastify instance (not yet listening).
 */
export function createGatewayServer(opts: GatewayOptions): FastifyInstance {
  const {
    registryDb,
    creditDb,
    tokens,
    handlerUrl,
    timeoutMs = 300_000,
    silent = false,
    skillExecutor,
  } = opts;

  const fastify = Fastify({ logger: !silent });
  const tokenSet = new Set(tokens);

  // Per-skill in-flight execution counter. Used to enforce capacity.max_concurrent limits.
  // Scoped to this server instance so each createGatewayServer() call gets its own map.
  const inFlight = new Map<string, number>();
  // Hardcoded retry suggestion for overload responses — deterministic and simple.
  const OVERLOAD_RETRY_MS = 5000;

  // Auth: two methods, checked in sequence.
  //   1. Bearer token — checked in onRequest (before body parse)
  //   2. Ed25519 identity — checked in preHandler (after body parse, since
  //      signature verification needs the parsed JSON body)
  //
  // If Bearer token succeeds, we mark the request as authenticated and skip
  // the preHandler check. If neither succeeds, preHandler rejects with 401.

  // Phase 1: Bearer token check (onRequest — runs before body parsing)
  fastify.addHook('onRequest', async (request) => {
    // Allow health check without auth
    if (request.method === 'GET' && request.url === '/health') return;

    const auth = request.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      if (tokenSet.has(token)) {
        // Mark as authenticated so preHandler skips
        (request as unknown as Record<string, unknown>)._authenticated = true;
      }
    }
  });

  // Phase 2: Ed25519 identity check (preHandler — runs after body parsing)
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip if already authenticated via Bearer token
    if ((request as unknown as Record<string, unknown>)._authenticated) return;
    // Skip health check
    if (request.method === 'GET' && request.url === '/health') return;

    const agentId = request.headers['x-agent-id'] as string | undefined;
    const publicKeyHex = request.headers['x-agent-public-key'] as string | undefined;
    const signature = request.headers['x-agent-signature'] as string | undefined;

    if (agentId && publicKeyHex && signature) {
      try {
        const publicKeyBuf = Buffer.from(publicKeyHex, 'hex');
        const body = request.body as Record<string, unknown>;
        if (body && typeof body === 'object') {
          const valid = verifyEscrowReceipt(body, signature, publicKeyBuf);
          if (valid) return; // Authorized via identity
        }
      } catch {
        // Verification failed — fall through to unauthorized
      }
    }

    // Phase 3: UCAN token check — Authorization: Bearer ucan.<token>
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ucan.')) {
      const ucanToken = authHeader.slice('Bearer ucan.'.length);
      try {
        const decoded = decodeUCAN(ucanToken);
        // Resolve issuer's public key from x-agent-public-key header
        const ucanPubKeyHex = request.headers['x-agent-public-key'] as string | undefined;
        if (ucanPubKeyHex) {
          const pubKeyBuf = Buffer.from(ucanPubKeyHex, 'hex');
          const ucanResult = verifyUCAN(ucanToken, pubKeyBuf);
          if (ucanResult.valid) {
            (request as unknown as Record<string, unknown>)._authenticated = true;
            (request as unknown as Record<string, unknown>)._ucanPayload = decoded.payload;
            return;
          }
        }
      } catch {
        // UCAN verification failed — fall through to unauthorized
      }
    }

    // No auth method succeeded
    await reply.status(401).send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Unauthorized: provide Bearer token, X-Agent-Id/Signature headers, or UCAN token' },
    });
  });

  // GET /health — returns server status
  fastify.get('/health', async () => {
    return { status: 'ok', version: VERSION, uptime: process.uptime() };
  });

  // POST /rpc — JSON-RPC 2.0 capability execution endpoint (supports batch)
  fastify.post('/rpc', async (request, reply) => {
    const rawBody = request.body;

    // JSON-RPC 2.0 batch support: if body is an array, process each request
    if (Array.isArray(rawBody)) {
      const responses = await Promise.all(
        (rawBody as Array<Record<string, unknown>>).map(async (single) => {
          if (single.jsonrpc !== '2.0' || !single.method) {
            return { jsonrpc: '2.0', id: single.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
          }
          if (single.method !== 'capability.execute') {
            return { jsonrpc: '2.0', id: single.id ?? null, error: { code: -32601, message: 'Method not found' } };
          }
          const params = (single.params ?? {}) as Record<string, unknown>;
          const cardId = params.card_id as string | undefined;
          if (!cardId) {
            return { jsonrpc: '2.0', id: single.id ?? null, error: { code: -32602, message: 'Invalid params: card_id required' } };
          }
          const requester = (params.requester as string | undefined) ?? 'unknown';
          const receipt = params.escrow_receipt as EscrowReceipt | undefined;
          const batchSkillId = params.skill_id as string | undefined;

          const trackKey = batchSkillId ?? cardId;
          inFlight.set(trackKey, (inFlight.get(trackKey) ?? 0) + 1);
          try {
            const result = await executeCapabilityRequest({
              registryDb, creditDb, cardId, skillId: batchSkillId, params,
              requester, escrowReceipt: receipt, skillExecutor, handlerUrl, timeoutMs,
            });
            if (result.success) {
              return { jsonrpc: '2.0', id: single.id ?? null, result: result.result };
            } else {
              return { jsonrpc: '2.0', id: single.id ?? null, error: result.error };
            }
          } finally {
            const next = (inFlight.get(trackKey) ?? 1) - 1;
            if (next <= 0) inFlight.delete(trackKey);
            else inFlight.set(trackKey, next);
          }
        }),
      );
      return reply.send(responses);
    }

    const body = rawBody as Record<string, unknown>;

    // Validate JSON-RPC structure
    if (body.jsonrpc !== '2.0' || !body.method) {
      return reply.status(400).send({
        jsonrpc: '2.0',
        id: body.id ?? null,
        error: { code: -32600, message: 'Invalid Request' },
      });
    }

    const id = (body.id ?? null) as string | number | null;

    if (body.method !== 'capability.execute') {
      return reply.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' },
      });
    }

    const params = (body.params ?? {}) as Record<string, unknown>;
    const cardId = params.card_id as string | undefined;
    const skillId = params.skill_id as string | undefined;

    if (!cardId) {
      return reply.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Invalid params: card_id required' },
      });
    }

    const requester = (params.requester as string | undefined) ?? 'unknown';
    const receipt = params.escrow_receipt as EscrowReceipt | undefined;

    // Check per-skill concurrency limit before executing.
    // Uses getSkillConfig() on the SkillExecutor to read capacity.max_concurrent.
    // Overload rejection: log to request_log (failure_reason: 'overload') WITHOUT calling
    // updateReputation — overload events are infrastructure noise, not provider quality signals.
    if (skillExecutor && skillId && typeof skillExecutor.getSkillConfig === 'function') {
      const skillConfig = skillExecutor.getSkillConfig(skillId);
      const maxConcurrent = skillConfig?.capacity?.max_concurrent;
      if (maxConcurrent !== undefined) {
        const current = inFlight.get(skillId) ?? 0;
        if (current >= maxConcurrent) {
          // Log overload event without calling updateReputation
          // card_name uses sentinel '<overload>' to avoid an extra DB lookup for a rejected request
          try {
            insertRequestLog(registryDb, {
              id: randomUUID(),
              card_id: cardId,
              card_name: '<overload>',
              requester,
              status: 'failure',
              latency_ms: 0,
              credits_charged: 0,
              created_at: new Date().toISOString(),
              skill_id: skillId,
              failure_reason: 'overload',
            });
          } catch { /* silent — do not let log failure block the response */ }
          return reply.status(200).send({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: 'overload',
              data: { error: 'overload', retry_after_ms: OVERLOAD_RETRY_MS },
            },
          });
        }
      }
    }

    // Track in-flight executions. Increment before execute, decrement in finally
    // to guarantee no leaks on success, failure, or exception.
    const trackKey = skillId ?? cardId;
    inFlight.set(trackKey, (inFlight.get(trackKey) ?? 0) + 1);
    let result;
    try {
      result = await executeCapabilityRequest({
        registryDb,
        creditDb,
        cardId,
        skillId,
        params,
        requester,
        escrowReceipt: receipt,
        skillExecutor,
        handlerUrl,
        timeoutMs,
      });
    } finally {
      const next = (inFlight.get(trackKey) ?? 1) - 1;
      if (next <= 0) {
        inFlight.delete(trackKey);
      } else {
        inFlight.set(trackKey, next);
      }
    }

    if (result.success) {
      return reply.send({ jsonrpc: '2.0', id, result: result.result });
    } else {
      return reply.send({ jsonrpc: '2.0', id, error: result.error });
    }
  });

  return fastify;
}
