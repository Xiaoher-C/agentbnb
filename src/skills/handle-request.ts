import type { RouteHandlerMethod } from 'fastify';

/**
 * Map of Capability Card IDs to their async handler functions.
 * Each handler receives the request params and returns a result.
 */
export type HandlerMap = {
  [cardId: string]: (params: unknown) => Promise<unknown>;
};

/**
 * Creates a Fastify route handler that dispatches incoming capability execution
 * requests to locally-registered handler functions.
 *
 * The handler expects POST requests with JSON body:
 * ```json
 * { "card_id": "<uuid>", "params": { ...inputFields } }
 * ```
 *
 * On success, responds with the raw handler return value directly (HTTP 200).
 * The gateway's JSON-RPC layer wraps it in `{ result: ... }`.
 *
 * On unknown card_id, responds with HTTP 404:
 * ```json
 * { "error": "No handler registered for card: <card_id>" }
 * ```
 *
 * On handler error, responds with HTTP 500:
 * ```json
 * { "error": "<error message>" }
 * ```
 *
 * This handler is compatible with the gateway server's `handlerUrl` pattern:
 * the gateway POSTs `{ card_id, params }` to this URL and uses the full
 * response body as the JSON-RPC result.
 *
 * @param handlers - Map of card ID to async handler function.
 * @returns A Fastify RouteHandlerMethod for use as a POST route handler.
 */
export function createRequestHandler(handlers: HandlerMap): RouteHandlerMethod {
  return async function (request, reply) {
    const body = request.body as Record<string, unknown>;
    const cardId = body.card_id as string | undefined;
    const params = (body.params ?? body) as unknown;

    if (!cardId) {
      return reply.status(400).send({ error: 'card_id is required' });
    }

    const handler = handlers[cardId];
    if (!handler) {
      return reply.status(404).send({ error: `No handler registered for card: ${cardId}` });
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
