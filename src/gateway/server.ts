import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { SkillExecutor } from '../skills/executor.js';
import { executeCapabilityRequest } from './execute.js';
import type { EscrowReceipt } from '../types/index.js';
import { verifyEscrowReceipt } from '../credit/signing.js';

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

    // Neither method succeeded
    await reply.status(401).send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Unauthorized: provide Bearer token or X-Agent-Id/Signature headers' },
    });
  });

  // GET /health — returns server status
  fastify.get('/health', async () => {
    return { status: 'ok', version: VERSION, uptime: process.uptime() };
  });

  // POST /rpc — JSON-RPC 2.0 capability execution endpoint
  fastify.post('/rpc', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

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

    const result = await executeCapabilityRequest({
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

    if (result.success) {
      return reply.send({ jsonrpc: '2.0', id, result: result.result });
    } else {
      return reply.send({ jsonrpc: '2.0', id, error: result.error });
    }
  });

  return fastify;
}
