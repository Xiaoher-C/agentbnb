import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { StructuredFeedbackSchema } from './schema.js';
import { insertFeedback, getFeedbackForSkill, getFeedbackForProvider } from './store.js';
import { computeReputation } from './reputation.js';

/**
 * Options passed to the feedback plugin.
 * The plugin reads the database reference from the Fastify instance's decorations,
 * but needs it passed explicitly since Fastify plugins are type-agnostic.
 */
export interface FeedbackPluginOptions {
  db: Database.Database;
}

/**
 * Fastify plugin that adds Feedback API routes:
 *
 *   POST /api/feedback             — Submit structured feedback after a transaction
 *   GET  /api/feedback/:skill_id   — List feedback for a specific skill
 *   GET  /api/reputation/:agent_id — Get aggregated reputation score for an agent
 *
 * @param fastify - Fastify instance to register routes on.
 * @param opts - Plugin options including the SQLite database reference.
 */
const feedbackPlugin: FastifyPluginAsync<FeedbackPluginOptions> = async (
  fastify: FastifyInstance,
  opts: FeedbackPluginOptions,
): Promise<void> => {
  const { db } = opts;

  /**
   * POST /api/feedback — Submit structured feedback for a completed transaction.
   *
   * Validates the body against StructuredFeedbackSchema.
   * Checks the transaction exists in request_log; returns 404 if not found.
   * Checks for duplicate feedback on the same transaction_id; returns 409 if duplicate.
   * Returns 201 with { feedback_id, received_at } on success.
   */
  fastify.post('/api/feedback', {
    schema: {
      tags: ['feedback'],
      summary: 'Submit structured feedback for a completed transaction',
      body: { type: 'object', additionalProperties: true },
      response: {
        201: {
          type: 'object',
          properties: {
            feedback_id: { type: 'string' },
            received_at: { type: 'string' },
          },
        },
        400: { type: 'object', properties: { error: { type: 'string' }, issues: { type: 'array' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        409: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const parseResult = StructuredFeedbackSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    const feedback = parseResult.data;

    // Verify transaction exists in request_log
    const txRow = db.prepare('SELECT id FROM request_log WHERE id = ?').get(feedback.transaction_id) as
      | { id: string }
      | undefined;
    if (!txRow) {
      return reply.code(404).send({ error: 'transaction_not_found' });
    }

    // Reject duplicate feedback for the same transaction
    const dupRow = db.prepare('SELECT id FROM feedback WHERE transaction_id = ?').get(feedback.transaction_id) as
      | { id: string }
      | undefined;
    if (dupRow) {
      return reply.code(409).send({ error: 'feedback_already_submitted' });
    }

    const feedbackId = insertFeedback(db, feedback);
    const receivedAt = new Date().toISOString();

    return reply.code(201).send({ feedback_id: feedbackId, received_at: receivedAt });
  });

  /**
   * GET /api/feedback/:skill_id — List feedback entries for a specific skill.
   *
   * Query parameters:
   *   limit — Max entries to return (default 20, max 100)
   *   since — Optional ISO datetime; only entries after this timestamp are returned
   */
  fastify.get('/api/feedback/:skill_id', {
    schema: {
      tags: ['feedback'],
      summary: 'List feedback for a specific skill',
      params: {
        type: 'object',
        properties: { skill_id: { type: 'string' } },
        required: ['skill_id'],
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20, description: 'Max entries (max 100)' },
          since: { type: 'string', description: 'ISO datetime filter (optional)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            feedbacks: { type: 'array' },
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { skill_id } = request.params as { skill_id: string };
    const query = request.query as Record<string, string | undefined>;

    const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);

    let feedbacks = getFeedbackForSkill(db, skill_id, limit);

    // Post-filter by since if provided
    const since = query.since?.trim();
    if (since) {
      const sinceDate = new Date(since).getTime();
      if (!isNaN(sinceDate)) {
        feedbacks = feedbacks.filter((f) => new Date(f.timestamp).getTime() > sinceDate);
      }
    }

    return reply.send({ feedbacks, count: feedbacks.length });
  });

  /**
   * GET /api/reputation/:agent_id — Get aggregated reputation score for an agent.
   *
   * Returns { agent_id, reputation_score, feedback_count, last_updated }.
   * Returns reputation_score 0.5 (cold-start default) when no feedback exists.
   */
  fastify.get('/api/reputation/:agent_id', {
    schema: {
      tags: ['feedback'],
      summary: 'Get aggregated reputation score for an agent',
      params: {
        type: 'object',
        properties: { agent_id: { type: 'string' } },
        required: ['agent_id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            reputation_score: { type: 'number' },
            feedback_count: { type: 'integer' },
            last_updated: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };

    const feedbacks = getFeedbackForProvider(db, agent_id);
    const reputationScore = computeReputation(feedbacks);
    const lastUpdated = feedbacks.length > 0
      ? feedbacks[0]!.timestamp  // already sorted DESC by timestamp
      : new Date().toISOString();

    return reply.send({
      agent_id,
      reputation_score: reputationScore,
      feedback_count: feedbacks.length,
      last_updated: lastUpdated,
    });
  });
};

export default feedbackPlugin;
