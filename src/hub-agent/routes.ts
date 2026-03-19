import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AgentBnBError, AnyCardSchema } from '../types/index.js';
import { bootstrapAgent } from '../credit/ledger.js';
import {
  initHubAgentTable,
  createHubAgent,
  getHubAgent,
  listHubAgents,
  updateHubAgent,
  deleteHubAgent,
} from './store.js';
import { CreateAgentRequestSchema } from './types.js';
import type { SkillRoute } from './types.js';

/** Options for hubAgentRoutesPlugin. */
export interface HubAgentRoutesOptions {
  registryDb: Database.Database;
  creditDb: Database.Database;
}

/**
 * Builds a v2.0 CapabilityCard from a Hub Agent's data.
 * Uses skill_routes to generate skills array with pricing from route config.
 */
function buildCapabilityCard(
  agentId: string,
  name: string,
  publicKey: string,
  skillRoutes: SkillRoute[],
): Record<string, unknown> {
  const now = new Date().toISOString();
  const skills = skillRoutes.map((route) => ({
    id: route.skill_id,
    name: route.mode === 'direct_api' ? route.config.name : route.skill_id,
    description: route.mode === 'direct_api' ? `API skill: ${route.config.name}` : `${route.mode} skill: ${route.skill_id}`,
    level: 1 as const,
    inputs: [],
    outputs: [],
    pricing: route.mode === 'direct_api'
      ? route.config.pricing
      : { credits_per_call: 10 },
  }));

  // At least one skill required for v2.0 card
  if (skills.length === 0) {
    skills.push({
      id: 'default',
      name: name,
      description: `Hub Agent: ${name}`,
      level: 1 as const,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 10 },
    });
  }

  return {
    spec_version: '2.0',
    id: agentId.padEnd(32, '0').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'),
    owner: publicKey.slice(0, 16),
    agent_name: name,
    skills,
    availability: { online: true },
    created_at: now,
    updated_at: now,
  };
}

/**
 * Upserts a card into the registry via raw SQL.
 * Uses AnyCardSchema validation + raw SQL (same pattern as relay upsertCard).
 */
function upsertCardRaw(db: Database.Database, cardData: Record<string, unknown>, owner: string): string {
  const parsed = AnyCardSchema.safeParse(cardData);
  if (!parsed.success) {
    throw new AgentBnBError(
      `Card validation failed: ${parsed.error.message}`,
      'VALIDATION_ERROR',
    );
  }

  const card = parsed.data;
  const cardId = card.id;
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM capability_cards WHERE id = ?').get(cardId) as { id: string } | undefined;

  if (existing) {
    db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(card), now, cardId);
  } else {
    db.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(cardId, owner, JSON.stringify(card), now, now);
  }

  return cardId;
}

/**
 * Strips sensitive fields from a Hub Agent before sending in API response.
 * Removes secrets values (keeps key names only) and private_key.
 */
function sanitizeAgent(agent: Record<string, unknown>): Record<string, unknown> {
  const { secrets, private_key_enc, ...safe } = agent as Record<string, unknown>;
  if (secrets && typeof secrets === 'object') {
    return { ...safe, secret_keys: Object.keys(secrets as Record<string, string>) };
  }
  return safe;
}

/**
 * Fastify plugin that registers Hub Agent CRUD API endpoints.
 *
 * Routes:
 *   POST   /api/hub-agents     — Create a new Hub Agent
 *   GET    /api/hub-agents     — List all Hub Agents
 *   GET    /api/hub-agents/:id — Get a single Hub Agent
 *   PUT    /api/hub-agents/:id — Update a Hub Agent
 *   DELETE /api/hub-agents/:id — Delete a Hub Agent
 *
 * @param fastify - The Fastify instance
 * @param options - Must include registryDb and creditDb
 */
export async function hubAgentRoutesPlugin(
  fastify: FastifyInstance,
  options: HubAgentRoutesOptions,
): Promise<void> {
  const { registryDb, creditDb } = options;

  // Initialize hub_agents table
  initHubAgentTable(registryDb);

  /**
   * POST /api/agents — Create a new Hub Agent
   */
  fastify.post('/api/hub-agents', {
    schema: {
      tags: ['hub-agents'],
      summary: 'Create a new Hub Agent with Ed25519 identity',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          skill_routes: { type: 'array' },
          secrets: { type: 'object' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            name: { type: 'string' },
            public_key: { type: 'string' },
            skill_routes: { type: 'array' },
            status: { type: 'string' },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateAgentRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.message });
    }

    const req = parseResult.data;
    // Use a placeholder owner public key for now (Hub Agent is server-managed)
    const ownerPublicKey = 'hub-server';

    try {
      const agent = createHubAgent(registryDb, req, ownerPublicKey);

      // Bootstrap 50 credits for the new agent
      bootstrapAgent(creditDb, agent.agent_id, 50);

      // Build and insert a v2.0 CapabilityCard into the registry
      const cardData = buildCapabilityCard(agent.agent_id, agent.name, agent.public_key, agent.skill_routes);
      try {
        upsertCardRaw(registryDb, cardData, agent.agent_id);
      } catch {
        // Non-fatal: agent is created even if card insertion fails
      }

      return reply.code(201).send(sanitizeAgent(agent as unknown as Record<string, unknown>));
    } catch (err) {
      if (err instanceof AgentBnBError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * GET /api/agents — List all Hub Agents
   */
  fastify.get('/api/hub-agents', {
    schema: {
      tags: ['hub-agents'],
      summary: 'List all Hub Agents',
      response: {
        200: {
          type: 'object',
          properties: {
            agents: { type: 'array' },
          },
        },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const agents = listHubAgents(registryDb);
    return reply.send({ agents });
  });

  /**
   * GET /api/agents/:id — Get a single Hub Agent
   */
  fastify.get('/api/hub-agents/:id', {
    schema: {
      tags: ['hub-agents'],
      summary: 'Get a single Hub Agent by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            name: { type: 'string' },
            public_key: { type: 'string' },
            skill_routes: { type: 'array' },
            status: { type: 'string' },
            secret_keys: { type: 'array', items: { type: 'string' } },
          },
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const agent = getHubAgent(registryDb, id);
    if (!agent) {
      return reply.code(404).send({ error: 'Hub Agent not found' });
    }
    return reply.send(sanitizeAgent(agent as unknown as Record<string, unknown>));
  });

  /**
   * PUT /api/agents/:id — Update a Hub Agent
   */
  fastify.put('/api/hub-agents/:id', {
    schema: {
      tags: ['hub-agents'],
      summary: 'Update a Hub Agent',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          skill_routes: { type: 'array' },
          secrets: { type: 'object' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            name: { type: 'string' },
            skill_routes: { type: 'array' },
            status: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const updates: { name?: string; skill_routes?: SkillRoute[]; secrets?: Record<string, string> } = {};
    if (typeof body.name === 'string') updates.name = body.name;
    if (Array.isArray(body.skill_routes)) updates.skill_routes = body.skill_routes as SkillRoute[];
    if (body.secrets && typeof body.secrets === 'object') updates.secrets = body.secrets as Record<string, string>;

    const agent = updateHubAgent(registryDb, id, updates);
    if (!agent) {
      return reply.code(404).send({ error: 'Hub Agent not found' });
    }

    // Update the CapabilityCard in registry if skill_routes changed
    if (updates.skill_routes) {
      const cardData = buildCapabilityCard(agent.agent_id, agent.name, agent.public_key, agent.skill_routes);
      try {
        upsertCardRaw(registryDb, cardData, agent.agent_id);
      } catch { /* non-fatal */ }
    }

    return reply.send(sanitizeAgent(agent as unknown as Record<string, unknown>));
  });

  /**
   * DELETE /api/agents/:id — Delete a Hub Agent
   */
  fastify.delete('/api/hub-agents/:id', {
    schema: {
      tags: ['hub-agents'],
      summary: 'Delete a Hub Agent',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Get agent to find its card ID before deletion
    const agent = getHubAgent(registryDb, id);
    if (!agent) {
      return reply.code(404).send({ error: 'Hub Agent not found' });
    }

    deleteHubAgent(registryDb, id);

    // Delete the agent's CapabilityCard from registry
    const cardId = id.padEnd(32, '0').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
    try {
      registryDb.prepare('DELETE FROM capability_cards WHERE id = ?').run(cardId);
    } catch { /* non-fatal */ }

    return reply.send({ ok: true });
  });
}
