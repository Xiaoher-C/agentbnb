import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { TemplateEvolutionSchema } from './schema.js';
import { insertEvolution, getLatestEvolution, getEvolutionHistory } from './store.js';

/**
 * Options passed to the evolution plugin.
 */
export interface EvolutionPluginOptions {
  db: Database.Database;
}

/**
 * Fastify plugin that adds Evolution API routes:
 *
 *   POST /api/evolution/publish          — Publish a new template evolution record
 *   GET  /api/evolution/latest           — Get latest evolution for a template
 *   GET  /api/evolution/history          — Get evolution history for a template
 *
 * @param fastify - Fastify instance to register routes on.
 * @param opts - Plugin options including the SQLite database reference.
 */
const evolutionPlugin: FastifyPluginAsync<EvolutionPluginOptions> = async (
  fastify: FastifyInstance,
  opts: EvolutionPluginOptions,
): Promise<void> => {
  const { db } = opts;

  /**
   * POST /api/evolution/publish — Publish a new template evolution record.
   *
   * Validates the request body against TemplateEvolutionSchema.
   * Returns 201 with { evolution_id, published_at } on success.
   * Returns 400 with validation issues on failure.
   */
  fastify.post('/api/evolution/publish', {
    schema: {
      tags: ['evolution'],
      summary: 'Publish a new template evolution record',
      body: { type: 'object', additionalProperties: true },
      response: {
        201: {
          type: 'object',
          properties: {
            evolution_id: { type: 'string' },
            published_at: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            issues: { type: 'array' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const parseResult = TemplateEvolutionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    const evolutionId = insertEvolution(db, parseResult.data);
    const publishedAt = new Date().toISOString();

    return reply.code(201).send({ evolution_id: evolutionId, published_at: publishedAt });
  });

  /**
   * GET /api/evolution/latest — Get the latest evolution record for a template.
   *
   * Query parameters:
   *   template — Template name to query (required)
   *
   * Returns { evolution: TemplateEvolution | null }.
   */
  fastify.get('/api/evolution/latest', {
    schema: {
      tags: ['evolution'],
      summary: 'Get latest evolution for a template',
      querystring: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Template name to query' },
        },
        required: ['template'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            evolution: {},
          },
        },
        400: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const templateName = query.template?.trim();

    if (!templateName) {
      return reply.code(400).send({ error: 'template query parameter is required' });
    }

    const evolution = getLatestEvolution(db, templateName);
    return reply.send({ evolution });
  });

  /**
   * GET /api/evolution/history — Get evolution history for a template.
   *
   * Query parameters:
   *   template — Template name to query (required)
   *   limit    — Max entries to return (default 10, max 100)
   *
   * Returns { evolutions: TemplateEvolution[], count: number }.
   */
  fastify.get('/api/evolution/history', {
    schema: {
      tags: ['evolution'],
      summary: 'Get evolution history for a template',
      querystring: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Template name to query' },
          limit: { type: 'integer', default: 10, description: 'Max entries (max 100)' },
        },
        required: ['template'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            evolutions: { type: 'array' },
            count: { type: 'integer' },
          },
        },
        400: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const templateName = query.template?.trim();

    if (!templateName) {
      return reply.code(400).send({ error: 'template query parameter is required' });
    }

    const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 10;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 10 : rawLimit, 100);

    const evolutions = getEvolutionHistory(db, templateName, limit);
    return reply.send({ evolutions, count: evolutions.length });
  });
};

export default evolutionPlugin;
