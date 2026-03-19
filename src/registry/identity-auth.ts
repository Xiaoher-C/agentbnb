import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyEscrowReceipt, signEscrowReceipt } from '../credit/signing.js';

/** Maximum age of a request timestamp before it is considered expired (5 minutes). */
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;

/**
 * Ed25519 identity verification handler.
 * Verifies the three required auth headers on incoming requests:
 *   - x-agent-publickey: hex-encoded Ed25519 public key (DER/SPKI format)
 *   - x-agent-signature: base64url Ed25519 signature
 *   - x-agent-timestamp: ISO 8601 timestamp (must be within 5 minutes)
 *
 * Returns `true` if valid (and sets request.agentPublicKey).
 * Returns `false` and sends a 401 reply if invalid.
 */
async function verifyIdentity(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const publicKeyHex = request.headers['x-agent-publickey'] as string | undefined;
  const signature = request.headers['x-agent-signature'] as string | undefined;
  const timestamp = request.headers['x-agent-timestamp'] as string | undefined;

  // Check all 3 required headers are present
  if (!publicKeyHex || !signature || !timestamp) {
    await reply.code(401).send({ error: 'Missing identity headers' });
    return false;
  }

  // Check timestamp is within 5 minutes of current time
  const requestTime = new Date(timestamp).getTime();
  if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > MAX_REQUEST_AGE_MS) {
    await reply.code(401).send({ error: 'Request expired' });
    return false;
  }

  // Construct the signed payload
  const payload: Record<string, unknown> = {
    method: request.method,
    path: request.url,
    timestamp,
    publicKey: publicKeyHex,
  };

  // Convert public key hex to Buffer (DER/SPKI format)
  let publicKeyBuffer: Buffer;
  try {
    publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
  } catch {
    await reply.code(401).send({ error: 'Invalid identity signature' });
    return false;
  }

  // Verify signature
  const valid = verifyEscrowReceipt(payload, signature, publicKeyBuffer);
  if (!valid) {
    await reply.code(401).send({ error: 'Invalid identity signature' });
    return false;
  }

  // Store the verified public key on the request for downstream use
  request.agentPublicKey = publicKeyHex;
  return true;
}

/**
 * Scoped Fastify plugin that enforces Ed25519 identity authentication on all routes
 * registered within the same `server.register()` scope.
 *
 * Adds an `onRequest` hook directly to the Fastify scope it's called on.
 * To use correctly, add routes to the SAME scope (not a child register call):
 *
 * @example
 * ```ts
 * // CORRECT: routes and plugin in the same scope via addHook helper
 * server.register(async (scope) => {
 *   identityAuthPlugin(scope);   // adds hook to scope
 *   scope.get('/protected', handler);
 * });
 *
 * // ALSO CORRECT: use creditRoutesPlugin which wraps everything internally
 * server.register(creditRoutesPlugin, { creditDb });
 * ```
 *
 * The signed payload is: `{ method, path, timestamp, publicKey }` (canonical JSON).
 * On success, sets `request.agentPublicKey` (hex string) for downstream route use.
 */
export function identityAuthPlugin(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await verifyIdentity(request, reply);
  });
}

/**
 * Creates the three authentication headers required by identityAuthPlugin.
 *
 * Constructs the canonical signed payload from the request method, path, and
 * current timestamp, then signs it with the given Ed25519 private key.
 *
 * @param method - HTTP method (e.g. 'GET', 'POST')
 * @param path - Request URL path (e.g. '/api/credits/hold')
 * @param body - Request body object (accepted for API compatibility, not included in signature)
 * @param privateKey - DER-encoded Ed25519 private key (PKCS8 format)
 * @param publicKeyHex - Hex-encoded Ed25519 public key (SPKI format)
 * @returns Object with X-Agent-PublicKey, X-Agent-Signature, X-Agent-Timestamp headers
 */
export function signRequest(
  method: string,
  path: string,
  body: unknown | null,
  privateKey: Buffer,
  publicKeyHex: string,
): Record<string, string> {
  const timestamp = new Date().toISOString();

  const payload: Record<string, unknown> = {
    method,
    path,
    timestamp,
    publicKey: publicKeyHex,
  };

  // body param accepted for API compatibility but not included in payload signature
  // (avoids body-parsing timing issues — body is not parsed during onRequest hook)
  void body;

  const signature = signEscrowReceipt(payload, privateKey);

  return {
    'X-Agent-PublicKey': publicKeyHex,
    'X-Agent-Signature': signature,
    'X-Agent-Timestamp': timestamp,
  };
}

// Extend FastifyRequest type to include agentPublicKey
declare module 'fastify' {
  interface FastifyRequest {
    agentPublicKey: string;
  }
}
