import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { AgentBnBError, AnyCardSchema } from '../types/index.js';
import {
  registerGuarantor,
  linkAgentToGuarantor,
  getAgentGuarantor,
  initiateGithubAuth,
} from '../identity/guarantor.js';
import {
  ensureHubIdentitiesTables,
  createChallenge,
  consumeChallenge,
  pruneChallenges,
  registerHubIdentity,
  getHubIdentityByEmail,
  getHubIdentityByAgentId,
  deriveAgentId as deriveHubAgentId,
} from './hub-identities.js';
import { tryVerifyIdentity } from './identity-auth.js';

/** Options for identityRoutesPlugin. */
export interface IdentityRoutesOptions {
  registryDb: Database.Database;
  creditDb?: Database.Database;
}

/**
 * Fastify plugin that registers identity and auth endpoints.
 *
 *   POST /api/identity/register    — Register a human guarantor via GitHub login
 *   GET  /api/agents/challenge     — Issue a one-time challenge for registration
 *   POST /api/agents/register      — Register a new Hub-managed agent identity
 *   POST /api/agents/login         — Fetch encrypted identity blob for login
 *   POST /api/identity/link        — Link an agent to a human guarantor
 *   GET  /api/identity/:agent_id   — Get guarantor info for an agent
 *   GET  /api/did/:agent_id        — Resolve agent DID Document
 *   GET  /api/credentials/:agent_id — Get Verifiable Credentials for an agent
 */
export async function identityRoutesPlugin(
  fastify: FastifyInstance,
  options: IdentityRoutesOptions,
): Promise<void> {
  const { registryDb: db, creditDb } = options;

  /**
   * POST /api/identity/register — Register a human guarantor via GitHub login.
   *
   * Body: { github_login: string }
   * Returns the created GuarantorRecord. GitHub OAuth verification is stubbed.
   */
  fastify.post('/api/identity/register', {
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
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
    if (!creditDb) {
      return reply.code(503).send({ error: 'Credit database not configured' });
    }
    const body = request.body as Record<string, unknown>;
    const githubLogin = typeof body.github_login === 'string' ? body.github_login.trim() : '';
    if (!githubLogin) {
      return reply.code(400).send({ error: 'github_login is required' });
    }
    try {
      const record = registerGuarantor(creditDb, githubLogin);
      const auth = initiateGithubAuth();
      return reply.code(201).send({ guarantor: record, oauth: auth });
    } catch (err) {
      if (err instanceof AgentBnBError && err.code === 'GUARANTOR_EXISTS') {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // ─── Hub-first agent registration ──────────────────────────────────────
  // These endpoints let users create agents from the Hub browser UI without
  // needing the CLI. Keys are generated in the browser (WebCrypto) and stored
  // server-side as passphrase-encrypted blobs.
  ensureHubIdentitiesTables(db);
  // Prune expired challenges on startup
  try { pruneChallenges(db); } catch { /* silent */ }

  /**
   * GET /api/agents/challenge — Issue a one-time challenge for registration.
   * Client signs the challenge with their private key to prove possession.
   */
  fastify.get('/api/agents/challenge', {
    schema: {
      tags: ['hub-auth'],
      summary: 'Get a registration challenge',
      response: {
        200: {
          type: 'object',
          properties: {
            challenge: { type: 'string' },
            expires_at: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const { challenge, expires_at } = createChallenge(db);
    return reply.send({ challenge, expires_at });
  });

  /**
   * POST /api/agents/register — Register a new Hub-managed agent identity.
   *
   * Body: { email, public_key (hex), encrypted_private_key (base64),
   *         kdf_salt (base64), display_name, challenge, signature (base64url) }
   *
   * Server verifies: challenge is valid + signature proves possession of private key.
   * Returns: { agent_id, did, created_at }
   */
  fastify.post('/api/agents/register', {
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['hub-auth'],
      summary: 'Register a new Hub-managed agent identity',
      body: {
        type: 'object',
        required: ['email', 'public_key', 'encrypted_private_key', 'kdf_salt', 'display_name', 'challenge', 'signature'],
        properties: {
          email: { type: 'string', format: 'email' },
          public_key: { type: 'string' },
          encrypted_private_key: { type: 'string' },
          kdf_salt: { type: 'string' },
          display_name: { type: 'string' },
          challenge: { type: 'string' },
          signature: { type: 'string' },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        409: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      email: string;
      public_key: string;
      encrypted_private_key: string;
      kdf_salt: string;
      display_name: string;
      challenge: string;
      signature: string;
    };

    // Validate challenge
    if (!consumeChallenge(db, body.challenge)) {
      return reply.code(400).send({ error: 'Invalid or expired challenge' });
    }

    // Validate key format
    if (!/^[0-9a-fA-F]+$/.test(body.public_key) || body.public_key.length % 2 !== 0) {
      return reply.code(400).send({ error: 'Invalid public_key format' });
    }

    // Verify signature of the challenge (proves possession of private key)
    try {
      const { verifyEscrowReceipt } = await import('../credit/signing.js');
      const publicKeyBuffer = Buffer.from(body.public_key, 'hex');
      // Sign the challenge as a string payload for simplicity
      const valid = verifyEscrowReceipt({ challenge: body.challenge }, body.signature, publicKeyBuffer);
      if (!valid) {
        return reply.code(400).send({ error: 'Invalid signature' });
      }
    } catch (err) {
      request.log.warn({ err }, 'Signature verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    // Check for duplicate email
    const existing = getHubIdentityByEmail(db, body.email.toLowerCase());
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // Check for duplicate agent_id (someone registered the same key)
    const agent_id = deriveHubAgentId(body.public_key);
    const existingByAgentId = getHubIdentityByAgentId(db, agent_id);
    if (existingByAgentId) {
      return reply.code(409).send({ error: 'Agent already registered' });
    }

    // Register
    const identity = registerHubIdentity(db, {
      email: body.email.toLowerCase(),
      public_key: body.public_key,
      encrypted_private_key: body.encrypted_private_key,
      kdf_salt: body.kdf_salt,
      display_name: body.display_name,
    });

    return reply.code(201).send({
      agent_id: identity.agent_id,
      did: `did:agentbnb:${identity.agent_id}`,
      created_at: identity.created_at,
    });
  });

  /**
   * POST /api/agents/login — Fetch encrypted identity blob for passphrase decryption.
   *
   * Body: { email }
   * Returns: { agent_id, public_key, encrypted_private_key, kdf_salt, display_name }
   *
   * Client decrypts the private key locally with the passphrase. Server never
   * sees plaintext private keys.
   */
  fastify.post('/api/agents/login', {
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['hub-auth'],
      summary: 'Fetch encrypted identity blob for login',
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { email: string };
    const identity = getHubIdentityByEmail(db, body.email.toLowerCase());
    if (!identity) {
      return reply.code(404).send({ error: 'Identity not found' });
    }
    return reply.send({
      agent_id: identity.agent_id,
      public_key: identity.public_key,
      encrypted_private_key: identity.encrypted_private_key,
      kdf_salt: identity.kdf_salt,
      display_name: identity.display_name,
    });
  });

  /**
   * POST /api/identity/link — Link an agent to a human guarantor.
   *
   * Body: { agent_id: string, github_login: string }
   * Enforces max 10 agents per guarantor.
   */
  fastify.post('/api/identity/link', {
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
        401: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        409: { type: 'object', properties: { error: { type: 'string' } } },
        503: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    if (!creditDb) {
      return reply.code(503).send({ error: 'Credit database not configured' });
    }

    // Identity verification — only the agent itself can link to a guarantor
    const authResult = await tryVerifyIdentity(request, { agentDb: db });
    if (!authResult.valid) {
      return reply.code(401).send({ error: 'Missing or invalid identity headers' });
    }

    const body = request.body as Record<string, unknown>;
    const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
    const githubLogin = typeof body.github_login === 'string' ? body.github_login.trim() : '';
    if (!agentId || !githubLogin) {
      return reply.code(400).send({ error: 'agent_id and github_login are required' });
    }

    // Verify caller is linking their own agent, not someone else's
    if (agentId !== authResult.agentId) {
      return reply.code(401).send({ error: 'Cannot link an agent you do not own' });
    }
    try {
      const record = linkAgentToGuarantor(creditDb, agentId, githubLogin);
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
  fastify.get('/api/identity/:agent_id', {
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
    if (!creditDb) {
      return reply.code(503).send({ error: 'Credit database not configured' });
    }
    const { agent_id } = request.params as { agent_id: string };
    const guarantor = getAgentGuarantor(creditDb, agent_id);
    return reply.send({ agent_id, guarantor });
  });

  /**
   * GET /api/did/:agent_id — Returns a W3C DID Document for an agent.
   */
  fastify.get('/api/did/:agent_id', {
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
    // Direct SQL query instead of loading all cards and filtering in-memory
    const cardRow = db.prepare(
      "SELECT data FROM capability_cards WHERE json_extract(data, '$.agent_id') = ?"
    ).get(agent_id) as { data: string } | undefined;
    if (!cardRow) {
      return reply.code(404).send({ error: `Agent ${agent_id} not found` });
    }
    const parsed = AnyCardSchema.parse(JSON.parse(cardRow.data));
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
   *
   * Issues live ReputationCredential + SkillCredentials from request_log and feedback data.
   * Credentials are signed by the platform key if available, otherwise unsigned summaries.
   */
  fastify.get('/api/credentials/:agent_id', {
    schema: {
      tags: ['identity'],
      summary: 'Get Verifiable Credentials for an agent',
      params: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };
    const did = `did:agentbnb:${agent_id}`;

    // Direct SQL query instead of loading all cards and filtering in-memory
    const ownerCards = db.prepare(
      "SELECT data FROM capability_cards WHERE json_extract(data, '$.agent_id') = ?"
    ).all(agent_id) as Array<{ data: string }>;

    if (ownerCards.length === 0) {
      return reply.send({ agent_id, did, credentials: [] });
    }

    const cardIds = ownerCards.map((c) => (JSON.parse(c.data) as Record<string, unknown>)['id'] as string);
    const cardIdPlaceholders = cardIds.map(() => '?').join(',');

    // Aggregate execution metrics
    const metricsRow = db.prepare(`
      SELECT
        SUM(CASE WHEN failure_reason IS NULL OR failure_reason IN ('bad_execution','auth_error')
            THEN 1 ELSE 0 END) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
        AVG(CASE WHEN status = 'success' THEN latency_ms END) as avg_latency,
        MIN(created_at) as earliest,
        COALESCE(SUM(CASE WHEN status = 'success' THEN credits_charged ELSE 0 END), 0) as earned
      FROM request_log
      WHERE card_id IN (${cardIdPlaceholders}) AND action_type IS NULL
    `).get(...cardIds) as {
      total: number; successes: number; avg_latency: number | null;
      earliest: string | null; earned: number;
    } | undefined;

    const totalExec = metricsRow?.total ?? 0;
    const successExec = metricsRow?.successes ?? 0;
    const successRate = totalExec > 0 ? successExec / totalExec : 0;
    const avgLatency = metricsRow?.avg_latency ?? 0;
    const activeSince = metricsRow?.earliest ?? new Date().toISOString();
    const totalEarned = metricsRow?.earned ?? 0;

    // Per-skill usage counts
    const skillRows = db.prepare(`
      SELECT skill_id, COUNT(*) as uses,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes
      FROM request_log
      WHERE card_id IN (${cardIdPlaceholders}) AND skill_id IS NOT NULL AND action_type IS NULL
      GROUP BY skill_id
    `).all(...cardIds) as Array<{ skill_id: string; uses: number; successes: number }>;

    // Feedback count
    let feedbackCount = 0;
    try {
      const fbRow = db.prepare(`SELECT COUNT(*) as cnt FROM feedback WHERE provider_agent = ?`).get(agent_id) as { cnt: number } | undefined;
      feedbackCount = fbRow?.cnt ?? 0;
    } catch { /* feedback table may not exist */ }

    // Build credentials array (unsigned summaries — platform signing requires server key)
    const credentials: Record<string, unknown>[] = [];

    // ReputationCredential (always issued if agent has any executions)
    if (totalExec > 0) {
      credentials.push({
        '@context': ['https://www.w3.org/2018/credentials/v1', 'https://agentbnb.dev/credentials/v1'],
        type: ['VerifiableCredential', 'AgentReputationCredential'],
        issuer: 'did:agentbnb:platform',
        issuanceDate: new Date().toISOString(),
        credentialSubject: {
          id: did,
          totalTransactions: totalExec,
          successRate: Math.round(successRate * 1000) / 1000,
          avgResponseTime: `${(avgLatency / 1000).toFixed(1)}s`,
          totalEarned,
          skills: skillRows.map((s) => ({
            id: s.skill_id,
            uses: s.uses,
            rating: s.uses > 0 ? Math.round((s.successes / s.uses) * 50) / 10 : 0,
          })),
          peerEndorsements: feedbackCount,
          activeSince,
        },
      });
    }

    // SkillCredentials (milestone: 100/500/1000 uses)
    const milestones = [1000, 500, 100] as const;
    for (const skill of skillRows) {
      const milestone = milestones.find((m) => skill.uses >= m);
      if (milestone) {
        credentials.push({
          '@context': ['https://www.w3.org/2018/credentials/v1', 'https://agentbnb.dev/credentials/v1'],
          type: ['VerifiableCredential', 'AgentSkillCredential'],
          issuer: 'did:agentbnb:platform',
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: did,
            skillId: skill.skill_id,
            totalUses: skill.uses,
            milestone,
            milestoneLevel: milestone >= 1000 ? 'gold' : milestone >= 500 ? 'silver' : 'bronze',
          },
        });
      }
    }

    return reply.send({ agent_id, did, credentials });
  });
}
