import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
import { bootstrapAgent, getBalance, getTransactions, migrateOwner } from '../credit/ledger.js';
import { AgentBnBError } from '../types/index.js';
import { identityAuthPlugin } from './identity-auth.js';
import { initFreeTierTable } from './free-tier.js';

/** Options for creditRoutesPlugin — requires a credit database instance. */
export interface CreditRoutesOptions {
  creditDb: Database.Database;
}

/**
 * Fastify plugin that registers all 6 credit API endpoints behind Ed25519 identity auth.
 *
 * Routes (all require valid X-Agent-PublicKey/Signature/Timestamp headers):
 *   POST /api/credits/hold       — Hold credits in escrow during capability execution
 *   POST /api/credits/settle     — Transfer held credits to provider on success
 *   POST /api/credits/release    — Refund held credits to requester on failure
 *   POST /api/credits/grant      — Bootstrap grant of 50 credits (once per Ed25519 public key)
 *   GET  /api/credits/:owner     — Get current credit balance
 *   GET  /api/credits/:owner/history — Get paginated transaction history
 *
 * Grant deduplication is enforced via a `credit_grants` table keyed by Ed25519 public key.
 * This ensures each identity can only claim the initial grant once, regardless of agent name.
 *
 * @param fastify - The Fastify instance (parent scope from server.ts)
 * @param options - Must include a `creditDb` Database instance
 */
export async function creditRoutesPlugin(
  fastify: FastifyInstance,
  options: CreditRoutesOptions,
): Promise<void> {
  const { creditDb } = options;

  // Create grant deduplication table keyed by Ed25519 public key
  creditDb.exec(`
    CREATE TABLE IF NOT EXISTS credit_grants (
      public_key TEXT PRIMARY KEY,
      granted_at TEXT NOT NULL,
      owner TEXT
    )
  `);
  // Add owner column if missing (migration for existing tables)
  try {
    creditDb.exec('ALTER TABLE credit_grants ADD COLUMN owner TEXT');
  } catch { /* column already exists */ }

  // Initialize free-tier usage tracking table
  initFreeTierTable(creditDb);

  // Register all credit routes in a scoped block with identity auth
  await fastify.register(async (scope) => {
    // Apply Ed25519 identity auth hook to this scope
    identityAuthPlugin(scope);

    /**
     * POST /api/credits/hold
     * Body: { owner: string, amount: number, cardId: string }
     * Returns: { escrowId: string }
     */
    scope.post('/api/credits/hold', {
      schema: {
        tags: ['credits'],
        summary: 'Hold credits in escrow during capability execution',
        security: [{ ed25519Auth: [] }],
        body: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            amount: { type: 'number' },
            cardId: { type: 'string' },
          },
          required: ['owner', 'amount', 'cardId'],
        },
        response: {
          200: { type: 'object', properties: { escrowId: { type: 'string' } } },
          400: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' } } },
        },
      },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      const owner = typeof body.owner === 'string' ? body.owner.trim() : '';
      const amount = typeof body.amount === 'number' ? body.amount : NaN;
      const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : '';

      if (!owner || isNaN(amount) || amount <= 0 || !cardId) {
        return reply.code(400).send({ error: 'Missing or invalid required fields: owner, amount (>0), cardId' });
      }

      try {
        const escrowId = holdEscrow(creditDb, owner, amount, cardId);
        return reply.send({ escrowId });
      } catch (err) {
        if (err instanceof AgentBnBError && err.code === 'INSUFFICIENT_CREDITS') {
          return reply.code(400).send({ error: err.message, code: 'INSUFFICIENT_CREDITS' });
        }
        throw err;
      }
    });

    /**
     * POST /api/credits/settle
     * Body: { escrowId: string, recipientOwner: string }
     * Returns: { ok: true }
     */
    scope.post('/api/credits/settle', {
      schema: {
        tags: ['credits'],
        summary: 'Transfer held credits to provider on success',
        security: [{ ed25519Auth: [] }],
        body: {
          type: 'object',
          properties: {
            escrowId: { type: 'string' },
            recipientOwner: { type: 'string' },
          },
          required: ['escrowId', 'recipientOwner'],
        },
        response: {
          200: { type: 'object', properties: { ok: { type: 'boolean' } } },
          400: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' } } },
        },
      },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      const escrowId = typeof body.escrowId === 'string' ? body.escrowId.trim() : '';
      const recipientOwner = typeof body.recipientOwner === 'string' ? body.recipientOwner.trim() : '';

      if (!escrowId || !recipientOwner) {
        return reply.code(400).send({ error: 'escrowId and recipientOwner are required' });
      }

      try {
        settleEscrow(creditDb, escrowId, recipientOwner);
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof AgentBnBError) {
          return reply.code(400).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    /**
     * POST /api/credits/release
     * Body: { escrowId: string }
     * Returns: { ok: true }
     */
    scope.post('/api/credits/release', {
      schema: {
        tags: ['credits'],
        summary: 'Refund held credits to requester on failure',
        security: [{ ed25519Auth: [] }],
        body: {
          type: 'object',
          properties: { escrowId: { type: 'string' } },
          required: ['escrowId'],
        },
        response: {
          200: { type: 'object', properties: { ok: { type: 'boolean' } } },
          400: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' } } },
        },
      },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      const escrowId = typeof body.escrowId === 'string' ? body.escrowId.trim() : '';

      if (!escrowId) {
        return reply.code(400).send({ error: 'escrowId is required' });
      }

      try {
        releaseEscrow(creditDb, escrowId);
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof AgentBnBError) {
          return reply.code(400).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    /**
     * POST /api/credits/grant
     * Body: { owner: string, amount?: number }
     * Returns: { ok: true, granted: number } or { ok: true, granted: 0, reason: 'already_granted' }
     *
     * Deduplication is by Ed25519 public key (request.agentPublicKey set by identityAuthPlugin).
     */
    scope.post('/api/credits/grant', {
      schema: {
        tags: ['credits'],
        summary: 'Bootstrap grant of 50 credits (once per identity)',
        security: [{ ed25519Auth: [] }],
        body: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            amount: { type: 'number' },
          },
          required: ['owner'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              granted: { type: 'number' },
              reason: { type: 'string' },
            },
          },
          400: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      const owner = typeof body.owner === 'string' ? body.owner.trim() : '';
      const amount = typeof body.amount === 'number' ? body.amount : 50;
      const publicKey = request.agentPublicKey;

      if (!owner) {
        return reply.code(400).send({ error: 'owner is required' });
      }

      // Check for existing grant using public key as dedup key
      const existing = creditDb
        .prepare('SELECT public_key, owner FROM credit_grants WHERE public_key = ?')
        .get(publicKey) as { public_key: string; owner: string | null } | undefined;

      if (existing) {
        // Auto-rename: if owner changed since original grant, migrate credits
        if (existing.owner && existing.owner !== owner) {
          migrateOwner(creditDb, existing.owner, owner);
          creditDb.prepare('UPDATE credit_grants SET owner = ? WHERE public_key = ?').run(owner, publicKey);
          return reply.send({ ok: true, granted: 0, reason: 'renamed', from: existing.owner, to: owner });
        }
        return reply.send({ ok: true, granted: 0, reason: 'already_granted' });
      }

      // Grant credits and record in dedup table (with owner for future rename)
      const now = new Date().toISOString();
      bootstrapAgent(creditDb, owner, amount);
      creditDb
        .prepare('INSERT INTO credit_grants (public_key, granted_at, owner) VALUES (?, ?, ?)')
        .run(publicKey, now, owner);

      return reply.send({ ok: true, granted: amount });
    });

    /**
     * GET /api/credits/:owner
     * Returns: { balance: number }
     */
    scope.get('/api/credits/:owner', {
      schema: {
        tags: ['credits'],
        summary: 'Get current credit balance for an agent',
        security: [{ ed25519Auth: [] }],
        params: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] },
        response: { 200: { type: 'object', properties: { balance: { type: 'number' } } } },
      },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { owner } = request.params as { owner: string };
      const balance = getBalance(creditDb, owner);
      return reply.send({ balance });
    });

    /**
     * GET /api/credits/:owner/history
     * Query: limit (default 20, max 100)
     * Returns: { transactions: CreditTransaction[], limit: number }
     */
    scope.get('/api/credits/:owner/history', {
      schema: {
        tags: ['credits'],
        summary: 'Get paginated transaction history',
        security: [{ ed25519Auth: [] }],
        params: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', description: 'Max entries (default 20, max 100)' } },
        },
        response: {
          200: {
            type: 'object',
            properties: { transactions: { type: 'array' }, limit: { type: 'integer' } },
          },
        },
      },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { owner } = request.params as { owner: string };
      const query = request.query as Record<string, string | undefined>;
      const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
      const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);

      const transactions = getTransactions(creditDb, owner, limit);
      return reply.send({ transactions, limit });
    });

    /**
     * POST /api/credits/rename
     * Body: { oldOwner: string, newOwner: string }
     * Returns: { ok: true, migrated: true } or { ok: true, migrated: false }
     *
     * Migrates credit balance, transactions, and escrows from oldOwner to newOwner.
     * Auth: Ed25519 identity (caller must be the key owner).
     */
    scope.post('/api/credits/rename', {
      schema: {
        tags: ['credits'],
        summary: 'Rename owner — migrate credits from old owner to new owner',
        security: [{ ed25519Auth: [] }],
        body: {
          type: 'object',
          properties: {
            oldOwner: { type: 'string' },
            newOwner: { type: 'string' },
          },
          required: ['oldOwner', 'newOwner'],
        },
        response: {
          200: { type: 'object', properties: { ok: { type: 'boolean' }, migrated: { type: 'boolean' } } },
          400: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      const oldOwner = typeof body.oldOwner === 'string' ? body.oldOwner.trim() : '';
      const newOwner = typeof body.newOwner === 'string' ? body.newOwner.trim() : '';

      if (!oldOwner || !newOwner || oldOwner === newOwner) {
        return reply.code(400).send({ error: 'oldOwner and newOwner must be different non-empty strings' });
      }

      const oldBalance = getBalance(creditDb, oldOwner);
      if (oldBalance === 0) {
        return reply.send({ ok: true, migrated: false });
      }

      migrateOwner(creditDb, oldOwner, newOwner);
      return reply.send({ ok: true, migrated: true });
    });
  });
}
