import type { FastifyPluginAsync } from 'fastify';

/**
 * Options for the auth plugin.
 */
export interface AuthPluginOptions {
  /** List of valid bearer tokens. */
  tokens: string[];
}

/**
 * Fastify plugin that validates Bearer token authentication on all routes
 * except GET /health (skipped to allow unauthenticated health checks).
 *
 * Returns a 401 JSON-RPC error response for unauthorized requests.
 *
 * NOTE: This plugin must be registered on the root Fastify instance (not as a
 * scoped child) so that its hooks apply to all routes. Use
 * `fastify.addHook('onRequest', ...)` directly if you encounter scope issues,
 * or install `fastify-plugin` to break encapsulation.
 *
 * @param fastify - Fastify instance.
 * @param opts - Plugin options including valid tokens list.
 */
export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const tokenSet = new Set(opts.tokens);

  fastify.addHook('onRequest', async (request, reply) => {
    // Skip auth for health check
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
};
