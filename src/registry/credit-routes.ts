import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { holdEscrow, settleEscrow, releaseEscrow, getEscrowStatus } from '../credit/escrow.js';
import { bootstrapAgent, getBalance, getTransactions, migrateOwner } from '../credit/ledger.js';
import { AgentBnBError } from '../types/index.js';
import { identityAuthPlugin } from './identity-auth.js';
import { initFreeTierTable } from './free-tier.js';

/** Options for creditRoutesPlugin — requires a credit database instance. */
export interface CreditRoutesOptions {
  creditDb: Database.Database;
}

/**
 * Fastify plugin that registers credit API endpoints.
 *
 * PUBLIC routes (no auth required — safe read-only queries for agent startup):
 *   GET  /api/credits/balance        — Get balance by ?owner= query param
 *   GET  /api/credits/transactions   — Get transaction history by ?owner= query param
 *
 * AUTHENTICATED routes (require valid X-Agent-Id/PublicKey/Signature/Timestamp headers):
 *   POST /api/credits/hold       — Hold credits in escrow during capability execution
 *   POST /api/credits/settle     — Transfer held credits to provider on success
 *   POST /api/credits/release    — Refund held credits to requester on failure
 *   POST /api/credits/grant      — Bootstrap grant of 50 credits (once per Ed25519 public key)
 *   GET  /api/credits/:owner     — Get current credit balance (path-param style, auth required)
 *   GET  /api/credits/:owner/history — Get paginated transaction history (auth required)
 *
 * Grant deduplication is enforced via a `credit_grants` table keyed by Ed25519 public key.
 * This ensures each identity can only claim the initial grant once, regardless of agent name.
 *
 * POST /api/credits/grant requires ADMIN_TOKEN env var for admin override grants.
 * Set ADMIN_TOKEN in fly.toml or fly secrets to enable manual credit grants.
 * If ADMIN_TOKEN is not set, only Ed25519-authenticated self-grants are accepted.
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

  // Warn on startup if ADMIN_TOKEN is not configured
  // POST /api/credits/grant requires ADMIN_TOKEN env var for admin override grants
  if (!process.env.ADMIN_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn('[agentbnb] ADMIN_TOKEN not set — POST /api/credits/grant will return 401 for admin override grants');
  }

  // -------------------------------------------------------------------------
  // PUBLIC routes — registered BEFORE the auth scope so they are unauthenticated.
  // These are read-only balance/history queries safe to expose without auth.
  // Agents query their own balance/history during startup before Ed25519 keys load.
  // -------------------------------------------------------------------------

  /**
   * GET /api/credits/balance?owner=<owner>
   * Returns: { owner: string, balance: number }
   *
   * Public alias for balance lookup — no Ed25519 auth required.
   * Use this during agent startup or from scripts where auth is not yet initialized.
   */
  fastify.get('/api/credits/balance', {
    schema: {
      tags: ['credits'],
      summary: 'Get credit balance by owner query param (public, no auth required)',
      querystring: {
        type: 'object',
        properties: { owner: { type: 'string', description: 'Agent owner name' } },
        required: ['owner'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            balance: { type: 'number' },
          },
        },
        400: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const owner = typeof query.owner === 'string' ? query.owner.trim() : '';
    if (!owner) {
      return reply.code(400).send({ error: 'owner query param required' });
    }
    const balance = getBalance(creditDb, owner);
    return reply.send({ owner, balance });
  });

  /**
   * GET /api/credits/transactions?owner=<owner>&since=<iso>&limit=<n>
   * Returns: { owner: string, transactions: CreditTransaction[], limit: number }
   *
   * Public alias for transaction history — no Ed25519 auth required.
   * Useful for agent sync on startup or from scripts without full auth ceremony.
   * Query params:
   *   owner  — required; agent owner name
   *   since  — optional ISO 8601 timestamp; only return transactions after this time
   *   limit  — optional integer (default 50, max 100)
   */
  fastify.get('/api/credits/transactions', {
    schema: {
      tags: ['credits'],
      summary: 'Get transaction history by query params (public, no auth required)',
      querystring: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Agent owner name' },
          since: { type: 'string', description: 'ISO 8601 timestamp — only return transactions after this time' },
          limit: { type: 'integer', description: 'Max entries (default 50, max 100)' },
        },
        required: ['owner'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            transactions: { type: 'array' },
            limit: { type: 'integer' },
          },
        },
        400: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const owner = typeof query.owner === 'string' ? query.owner.trim() : '';
    if (!owner) {
      return reply.code(400).send({ error: 'owner query param required' });
    }
    const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 50;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 50 : rawLimit, 100);
    const since = typeof query.since === 'string' && query.since.trim() ? query.since.trim() : undefined;

    const transactions = getTransactions(creditDb, owner, { limit, after: since });
    return reply.send({ owner, transactions, limit });
  });

  /**
   * GET /api/credits/escrow/:id
   * Returns: { id, owner, amount, card_id, status, created_at, settled_at }
   *
   * Public escrow status lookup. Used by the managed-agents adapter's
   * agentbnb_get_result tool to poll async execution results.
   */
  fastify.get('/api/credits/escrow/:id', {
    schema: {
      tags: ['credits'],
      summary: 'Get escrow status by ID (public, no auth required)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            owner: { type: 'string' },
            amount: { type: 'number' },
            card_id: { type: 'string' },
            status: { type: 'string' },
            created_at: { type: 'string' },
            settled_at: { type: ['string', 'null'] },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const escrow = getEscrowStatus(creditDb, id);
    if (!escrow) {
      return reply.code(404).send({ error: 'Escrow record not found' });
    }
    return reply.send(escrow);
  });

  // -------------------------------------------------------------------------
  // AUTHENTICATED routes — scoped block with Ed25519 identity auth applied.
  // -------------------------------------------------------------------------

  // Register all auth-gated credit routes in a scoped block with identity auth
  await fastify.register(async (scope) => {
    // Apply Ed25519 identity auth hook to this scope
    identityAuthPlugin(scope, { agentDb: creditDb });

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
