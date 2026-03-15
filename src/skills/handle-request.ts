import type { RouteHandlerMethod } from 'fastify';

/**
 * Map of skill IDs or Capability Card IDs to their async handler functions.
 * Keys can be either a skill_id (v2.0 dispatch) or a card_id (v1.0 backward compat).
 * Each handler receives the request params and returns a result.
 */
export type HandlerMap = {
  [skillOrCardId: string]: (params: unknown) => Promise<unknown>;
};

/**
 * Creates a Fastify route handler that dispatches incoming capability execution
 * requests to locally-registered handler functions.
 *
 * The handler expects POST requests with JSON body:
 * ```json
 * { "card_id": "<uuid>", "skill_id": "<skill_id>", "params": { ...inputFields } }
 * ```
 *
 * Dispatch priority:
 * 1. If `skill_id` is present and a handler is registered for it, use that handler.
 * 2. If no handler found for `skill_id`, fall back to `card_id` handler (v1.0 backward compat).
 * 3. If neither `skill_id` nor `card_id` is provided, returns HTTP 400.
 * 4. If no handler found for either key, returns HTTP 404.
 *
 * On success, responds with the raw handler return value directly (HTTP 200).
 * The gateway's JSON-RPC layer wraps it in `{ result: ... }`.
 *
 * On unknown card_id/skill_id, responds with HTTP 404:
 * ```json
 * { "error": "No handler registered for skill: <skill_id> or card: <card_id>" }
 * ```
 *
 * On handler error, responds with HTTP 500:
 * ```json
 * { "error": "<error message>" }
 * ```
 *
 * This handler is compatible with the gateway server's `handlerUrl` pattern:
 * the gateway POSTs `{ card_id, skill_id, params }` to this URL and uses the full
 * response body as the JSON-RPC result.
 *
 * @param handlers - Map of skill ID or card ID to async handler function.
 * @returns A Fastify RouteHandlerMethod for use as a POST route handler.
 */
export function createRequestHandler(handlers: HandlerMap): RouteHandlerMethod {
  return async function (request, reply) {
    const body = request.body as Record<string, unknown>;
    const skillId = body.skill_id as string | undefined;
    const cardId = body.card_id as string | undefined;
    const params = (body.params ?? body) as unknown;

    // Require at least one of card_id or skill_id
    if (!cardId && !skillId) {
      return reply.status(400).send({ error: 'card_id or skill_id is required' });
    }

    // Dispatch: try skill_id first, then fall back to card_id
    const handler =
      (skillId ? handlers[skillId] : undefined) ??
      (cardId ? handlers[cardId] : undefined);

    if (!handler) {
      const key = skillId ?? cardId ?? 'unknown';
      return reply.status(404).send({ error: `No handler registered for skill: ${key}` });
    }

    try {
      const result = await handler(params);
      // Return handler result directly — gateway's JSON-RPC layer wraps it in { result }
      return reply.status(200).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  };
}
