import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getCard, updateReputation } from '../registry/store.js';
import { getBalance } from '../credit/ledger.js';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
import { insertRequestLog } from '../registry/request-log.js';
import { AgentBnBError } from '../types/index.js';
import type { CapabilityCardV2 } from '../types/index.js';

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
    timeoutMs = 30_000,
    silent = false,
  } = opts;

  const fastify = Fastify({ logger: !silent });
  const tokenSet = new Set(tokens);

  // Auth hook — applied to all routes on this instance.
  // GET /health is explicitly skipped.
  fastify.addHook('onRequest', async (request, reply) => {
    // Allow health check without auth
    if (request.method === 'GET' && request.url === '/health') return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      await reply.status(401).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Unauthorized: missing token' },
      });
      return;
    }

    const token = auth.slice('Bearer '.length).trim();
    if (!tokenSet.has(token)) {
      await reply.status(401).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Unauthorized: invalid token' },
      });
    }
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

    // Look up card in registry
    const card = getCard(registryDb, cardId);
    if (!card) {
      return reply.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Card not found: ${cardId}` },
      });
    }

    // Requester identity comes from params (agents identify themselves)
    const requester = (params.requester as string | undefined) ?? 'unknown';

    // Resolve skill and pricing.
    // If the stored card is v2.0 (has a skills[] array), look up the requested skill.
    // Without skill_id, fall back to the first skill (v1.0 backward compat).
    // v1.0 cards use card-level pricing directly.
    let creditsNeeded: number;
    let cardName: string;
    let resolvedSkillId: string | undefined;

    const rawCard = card as unknown as Record<string, unknown>;
    if (Array.isArray(rawCard['skills'])) {
      const v2card = card as unknown as CapabilityCardV2;
      const skill = skillId
        ? v2card.skills.find((s) => s.id === skillId)
        : v2card.skills[0]; // fallback to first skill

      if (!skill) {
        return reply.send({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Skill not found: ${skillId}` },
        });
      }

      creditsNeeded = skill.pricing.credits_per_call;
      cardName = skill.name;
      resolvedSkillId = skill.id;
    } else {
      // v1.0 card — use card-level pricing
      creditsNeeded = card.pricing.credits_per_call;
      cardName = card.name;
    }

    // Check balance and hold escrow
    let escrowId: string;
    try {
      const balance = getBalance(creditDb, requester);
      if (balance < creditsNeeded) {
        return reply.send({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: 'Insufficient credits' },
        });
      }
      escrowId = holdEscrow(creditDb, requester, creditsNeeded, cardId);
    } catch (err) {
      const msg = err instanceof AgentBnBError ? err.message : 'Failed to hold escrow';
      return reply.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: msg },
      });
    }

    // Execute at handler URL with configurable timeout via AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startMs = Date.now();

    try {
      const response = await fetch(handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId, skill_id: resolvedSkillId, params }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        releaseEscrow(creditDb, escrowId);
        updateReputation(registryDb, cardId, false, Date.now() - startMs);
        // Log failed execution — logging failures are silently ignored
        try {
          insertRequestLog(registryDb, {
            id: randomUUID(),
            card_id: cardId,
            card_name: cardName,
            skill_id: resolvedSkillId,
            requester,
            status: 'failure',
            latency_ms: Date.now() - startMs,
            credits_charged: 0,
            created_at: new Date().toISOString(),
          });
        } catch { /* silent no-op */ }
        return reply.send({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: `Handler returned ${response.status}` },
        });
      }

      const result = (await response.json()) as unknown;
      settleEscrow(creditDb, escrowId, card.owner);
      updateReputation(registryDb, cardId, true, Date.now() - startMs);
      // Log successful execution — logging failures are silently ignored
      try {
        insertRequestLog(registryDb, {
          id: randomUUID(),
          card_id: cardId,
          card_name: cardName,
          skill_id: resolvedSkillId,
          requester,
          status: 'success',
          latency_ms: Date.now() - startMs,
          credits_charged: creditsNeeded,
          created_at: new Date().toISOString(),
        });
      } catch { /* silent no-op */ }

      return reply.send({ jsonrpc: '2.0', id, result });
    } catch (err) {
      clearTimeout(timer);
      releaseEscrow(creditDb, escrowId);
      updateReputation(registryDb, cardId, false, Date.now() - startMs);

      const isTimeout = err instanceof Error && err.name === 'AbortError';
      // Log timeout or handler error — logging failures are silently ignored
      try {
        insertRequestLog(registryDb, {
          id: randomUUID(),
          card_id: cardId,
          card_name: cardName,
          skill_id: resolvedSkillId,
          requester,
          status: isTimeout ? 'timeout' : 'failure',
          latency_ms: Date.now() - startMs,
          credits_charged: 0,
          created_at: new Date().toISOString(),
        });
      } catch { /* silent no-op */ }

      return reply.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: isTimeout ? 'Execution timeout' : 'Handler error' },
      });
    }
  });

  return fastify;
}
