/**
 * DID-based auth header generation for Hub API requests.
 *
 * Reads session metadata from localStorage (agentId, publicKeyHex only — never
 * private key material) and signs each request to produce X-Agent-* headers
 * matching the server expectations in src/registry/identity-auth.ts.
 *
 * The Ed25519 private key is held only in module memory as a non-extractable
 * CryptoKey object. It is never persisted to disk and is cleared on logout or
 * page reload. After a hard reload the user must re-authenticate.
 */
import { signPayload } from './crypto.js';

/** Session metadata stored after successful login. Never contains private key bytes. */
export interface HubSession {
  agentId: string;
  publicKeyHex: string;
  /** ISO 8601 timestamp recorded when the session was created. */
  createdAt: string;
}

/** Thrown by signRequest when the in-memory key has been cleared (e.g. after a reload). */
export class HubSessionExpiredError extends Error {
  constructor(message = 'Hub session expired — please sign in again.') {
    super(message);
    this.name = 'HubSessionExpiredError';
  }
}

/** localStorage key for the active Hub session metadata. */
const SESSION_KEY = 'agentbnb_hub_session';

/** Module-level non-extractable Ed25519 private key. Never persisted. */
let inMemoryPrivateKey: CryptoKey | null = null;

/**
 * Stores the non-extractable private key in module memory.
 * Callers MUST import the key with extractable=false before calling this
 * (see HubAuthForm). The key is wiped on logout or hard reload.
 */
export function setHubPrivateKey(key: CryptoKey): void {
  inMemoryPrivateKey = key;
}

/** Returns the in-memory private key, or null if none has been set. */
export function getHubPrivateKey(): CryptoKey | null {
  return inMemoryPrivateKey;
}

/** Clears the in-memory private key. Called on logout. */
export function clearHubPrivateKey(): void {
  inMemoryPrivateKey = null;
}

/** Persists session metadata (agentId + publicKeyHex). Never includes private key bytes. */
export function saveSession(session: HubSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Loads session metadata from localStorage.
 *
 * If the stored object contains a legacy `privateKeyBase64` field, the entry
 * is wiped (forcing re-login) and null is returned. This migrates users away
 * from the prior insecure shape.
 */
export function loadSession(): HubSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if ('privateKeyBase64' in parsed) {
      // Legacy shape — wipe and force re-login.
      localStorage.removeItem(SESSION_KEY);
      // eslint-disable-next-line no-console
      console.warn('[hub] migrated legacy session shape — please re-login');
      return null;
    }
    if (typeof parsed.agentId !== 'string' || typeof parsed.publicKeyHex !== 'string') {
      return null;
    }
    return {
      agentId: parsed.agentId,
      publicKeyHex: parsed.publicKeyHex,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Clears the session metadata. Caller is responsible for clearing the in-memory key separately. */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Signs an outgoing request and returns DID auth headers.
 * Matches the server-side buildIdentityPayload format.
 *
 * @param method - HTTP method (e.g. 'GET')
 * @param path - Request URL path (e.g. '/me/events?limit=50')
 * @param body - Request body object (null if no body)
 * @returns Auth headers, or null if no session metadata exists.
 * @throws HubSessionExpiredError when session metadata exists but the
 *   in-memory key has been cleared (e.g. after a page reload).
 */
export async function signRequest(
  method: string,
  path: string,
  body: unknown = null,
): Promise<Record<string, string> | null> {
  const session = loadSession();
  if (!session) return null;

  const privateKey = getHubPrivateKey();
  if (!privateKey) {
    throw new HubSessionExpiredError();
  }

  const timestamp = new Date().toISOString();
  const payload = {
    method,
    path,
    timestamp,
    publicKey: session.publicKeyHex,
    agentId: session.agentId,
    params: body === undefined ? null : body,
  };

  const signature = await signPayload(privateKey, payload);

  return {
    'X-Agent-Id': session.agentId,
    'X-Agent-PublicKey': session.publicKeyHex,
    'X-Agent-Signature': signature,
    'X-Agent-Timestamp': timestamp,
  };
}

/**
 * Wraps fetch() with automatic DID auth headers if a session exists.
 * Falls back to plain fetch if no session.
 * If the session metadata exists but the in-memory key is gone (post-reload),
 * a HubSessionExpiredError is thrown so callers can redirect to login.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;

  let body: unknown = null;
  if (init.body && typeof init.body === 'string') {
    try { body = JSON.parse(init.body); } catch { body = init.body; }
  }

  const signedHeaders = await signRequest(method, path, body);
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    ...(signedHeaders ?? {}),
  };

  return fetch(url, { ...init, headers });
}
