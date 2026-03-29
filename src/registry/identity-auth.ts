import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { verifyEscrowReceipt, signEscrowReceipt } from '../credit/signing.js';
import { deriveAgentId } from '../identity/identity.js';
import { lookupAgent } from '../identity/agent-identity.js';

/** Maximum age of a request timestamp before it is considered expired (5 minutes). */
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;

/**
 * Options for identityAuthPlugin.
 */
export interface IdentityAuthOptions {
  /**
   * Optional DB containing the agents table.
   * When provided, known agents are cross-checked so agent_id -> public_key cannot drift.
   */
  agentDb?: Database.Database;
}

/**
 * Normalizes request body payload for signing/verification.
 * Fastify uses `undefined` for no body, while callers often sign `null`.
 */
function normalizeSignedParams(body: unknown): unknown {
  return body === undefined ? null : body;
}

/**
 * Builds the canonical signed identity payload for request auth.
 * This payload is used by both signRequest() and verifyIdentity().
 */
function buildIdentityPayload(
  method: string,
  path: string,
  timestamp: string,
  publicKeyHex: string,
  agentId: string,
  params: unknown,
): Record<string, unknown> {
  return {
    method,
    path,
    timestamp,
    publicKey: publicKeyHex,
    agentId,
    params: normalizeSignedParams(params),
  };
}

/**
 * Extracts the requester identifier declared by the caller, if present.
 * Supports common request shapes during the owner -> agent_id transition.
 */
function extractClaimedRequester(request: FastifyRequest): string | null {
  const extractFromObject = (obj: Record<string, unknown>): string | null => {
    const directOwner = typeof obj.owner === 'string' ? obj.owner.trim() : '';
    if (directOwner) return directOwner;

    const directRequester = typeof obj.requester === 'string' ? obj.requester.trim() : '';
    if (directRequester) return directRequester;

    const oldOwner = typeof obj.oldOwner === 'string' ? obj.oldOwner.trim() : '';
    if (oldOwner) return oldOwner;

    const nestedParams = obj.params;
    if (nestedParams && typeof nestedParams === 'object' && !Array.isArray(nestedParams)) {
      const nested = nestedParams as Record<string, unknown>;
      const nestedOwner = typeof nested.owner === 'string' ? nested.owner.trim() : '';
      if (nestedOwner) return nestedOwner;
      const nestedRequester = typeof nested.requester === 'string' ? nested.requester.trim() : '';
      if (nestedRequester) return nestedRequester;
    }

    return null;
  };

  if (request.body && typeof request.body === 'object' && !Array.isArray(request.body)) {
    const claimed = extractFromObject(request.body as Record<string, unknown>);
    if (claimed) return claimed;
  }

  if (request.params && typeof request.params === 'object' && !Array.isArray(request.params)) {
    const claimed = extractFromObject(request.params as Record<string, unknown>);
    if (claimed) return claimed;
  }

  return null;
}

/**
 * Ed25519 identity verification handler.
 * Verifies required auth headers on incoming requests:
 *   - x-agent-id: deterministic agent identity (sha256(public_key).slice(0, 16))
 *   - x-agent-publickey: hex-encoded Ed25519 public key (DER/SPKI format)
 *   - x-agent-signature: base64url Ed25519 signature
 *   - x-agent-timestamp: ISO 8601 timestamp (must be within 5 minutes)
 *
 * Returns `true` if valid (and sets request.agentPublicKey/request.agentId).
 * Returns `false` and sends a 401 reply if invalid.
 */
async function verifyIdentity(
  request: FastifyRequest,
  reply: FastifyReply,
  options: IdentityAuthOptions,
): Promise<boolean> {
  const agentIdHeader = request.headers['x-agent-id'] as string | undefined;
  const publicKeyHeader = request.headers['x-agent-publickey'] as string | undefined;
  const signatureHeader = request.headers['x-agent-signature'] as string | undefined;
  const timestampHeader = request.headers['x-agent-timestamp'] as string | undefined;
  const agentId = agentIdHeader?.trim();
  const publicKeyHex = publicKeyHeader?.trim();
  const signature = signatureHeader?.trim();
  const timestamp = timestampHeader?.trim();

  // Check all required headers are present
  if (!agentId || !publicKeyHex || !signature || !timestamp) {
    await reply.code(401).send({ error: 'Missing identity headers' });
    return false;
  }

  // Check timestamp is within 5 minutes of current time
  const requestTime = new Date(timestamp).getTime();
  if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > MAX_REQUEST_AGE_MS) {
    await reply.code(401).send({ error: 'Request expired' });
    return false;
  }

  // Validate key encoding before deriving IDs/signature verification.
  if (!/^[0-9a-fA-F]+$/.test(publicKeyHex) || publicKeyHex.length % 2 !== 0) {
    await reply.code(401).send({ error: 'Invalid identity signature' });
    return false;
  }

  // Bind agent_id to the claimed public key.
  let expectedAgentId: string;
  try {
    expectedAgentId = deriveAgentId(publicKeyHex);
  } catch {
    await reply.code(401).send({ error: 'Invalid identity signature' });
    return false;
  }
  if (agentId !== expectedAgentId) {
    await reply.code(401).send({ error: 'Invalid identity signature' });
    return false;
  }

  // Convert public key hex to Buffer (DER/SPKI format)
  let publicKeyBuffer: Buffer;
  try {
    publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
  } catch {
    await reply.code(401).send({ error: 'Invalid identity signature' });
    return false;
  }

  // Lookup known record when DB is available; if present, enforce same public key.
  const knownAgent = options.agentDb ? lookupAgent(options.agentDb, agentId) : null;
  if (knownAgent && knownAgent.public_key.toLowerCase() !== publicKeyHex.toLowerCase()) {
    await reply.code(401).send({ error: 'Invalid identity signature' });
    return false;
  }

  // Construct the signed payload (includes all params, including nested objects)
  const payload = buildIdentityPayload(
    request.method,
    request.url,
    timestamp,
    publicKeyHex,
    agentId,
    request.body,
  );

  // Verify signature
  const valid = verifyEscrowReceipt(payload, signature, publicKeyBuffer);
  if (!valid) {
    await reply.code(401).send({ error: 'Invalid identity signature' });
    return false;
  }

  // Bind caller-declared requester/owner identifiers to authenticated identity.
  // Skip this check for new agents (not yet in the registry DB) — their Ed25519
  // signature is sufficient proof of identity.  For known agents, allow the claim
  // to match any of: canonical agent_id, current display name, or legacy owner.
  const claimedRequester = extractClaimedRequester(request);
  if (claimedRequester && knownAgent !== null) {
    const matchesAgentId = claimedRequester === agentId;
    const matchesDisplayName = knownAgent.display_name === claimedRequester;
    const matchesLegacyOwner = knownAgent.legacy_owner === claimedRequester;

    if (!matchesAgentId && !matchesDisplayName && !matchesLegacyOwner) {
      await reply.code(401).send({ error: 'Identity does not match requester' });
      return false;
    }
  }

  // Store the verified public key on the request for downstream use
  request.agentPublicKey = publicKeyHex;
  request.agentId = agentId;
  return true;
}

/**
 * Scoped Fastify plugin that enforces Ed25519 identity authentication on all routes
 * registered within the same `server.register()` scope.
 *
 * Adds a `preHandler` hook directly to the Fastify scope it's called on.
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
 * The signed payload is:
 * `{ method, path, timestamp, publicKey, agentId, params }` (canonical JSON).
 * On success, sets request.agentPublicKey/request.agentId for downstream route use.
 */
export function identityAuthPlugin(
  fastify: FastifyInstance,
  options: IdentityAuthOptions = {},
): void {
  // Must run after body parsing so signed payload can include full params/body.
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const ok = await verifyIdentity(request, reply, options);
    if (!ok) {
      return reply;
    }
  });
}

/**
 * Creates the authentication headers required by identityAuthPlugin.
 *
 * Constructs the canonical signed payload from request method, path, timestamp,
 * caller identity, and request params/body, then signs with Ed25519 private key.
 *
 * @param method - HTTP method (e.g. 'GET', 'POST')
 * @param path - Request URL path (e.g. '/api/credits/hold')
 * @param body - Request body object (included in signature as `params`)
 * @param privateKey - DER-encoded Ed25519 private key (PKCS8 format)
 * @param publicKeyHex - Hex-encoded Ed25519 public key (SPKI format)
 * @param agentIdOverride - Optional agent_id override (tests only). Defaults to deriveAgentId(publicKeyHex).
 * @returns Object with X-Agent-Id, X-Agent-PublicKey, X-Agent-Signature, X-Agent-Timestamp headers
 */
export function signRequest(
  method: string,
  path: string,
  body: unknown | null,
  privateKey: Buffer,
  publicKeyHex: string,
  agentIdOverride?: string,
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const agentId = agentIdOverride ?? deriveAgentId(publicKeyHex);
  const payload = buildIdentityPayload(method, path, timestamp, publicKeyHex, agentId, body);

  const signature = signEscrowReceipt(payload, privateKey);

  return {
    'X-Agent-Id': agentId,
    'X-Agent-PublicKey': publicKeyHex,
    'X-Agent-Signature': signature,
    'X-Agent-Timestamp': timestamp,
  };
}

// Extend FastifyRequest type to include agentPublicKey
declare module 'fastify' {
  interface FastifyRequest {
    agentPublicKey: string;
    agentId: string;
  }
}
