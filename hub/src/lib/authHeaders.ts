/**
 * DID-based auth header generation for Hub API requests.
 *
 * Reads session state (agent_id, public key, private key) from the auth store
 * and signs each request to produce X-Agent-* headers matching the server
 * expectations in src/registry/identity-auth.ts.
 */
import { canonicalJson, signPayload, importPrivateKey } from './crypto.js';

/** Session state stored after successful login. */
export interface HubSession {
  agentId: string;
  publicKeyHex: string;
  /** Base64-encoded PKCS#8 private key bytes (unwrapped from passphrase encryption). */
  privateKeyBase64: string;
}

/** localStorage key for the active Hub session (unencrypted, session-only). */
const SESSION_KEY = 'agentbnb_hub_session';

/** Stores the decrypted session in localStorage. */
export function saveSession(session: HubSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** Loads the active session from localStorage. */
export function loadSession(): HubSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HubSession;
  } catch {
    return null;
  }
}

/** Clears the active session. */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** Decodes a base64 string to an ArrayBuffer. */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Cached imported private key (avoids re-importing on every request). */
let cachedPrivateKey: CryptoKey | null = null;
let cachedPrivateKeyHex: string | null = null;

async function getPrivateKey(session: HubSession): Promise<CryptoKey> {
  if (cachedPrivateKey && cachedPrivateKeyHex === session.privateKeyBase64) {
    return cachedPrivateKey;
  }
  const bytes = base64ToArrayBuffer(session.privateKeyBase64);
  cachedPrivateKey = await importPrivateKey(bytes);
  cachedPrivateKeyHex = session.privateKeyBase64;
  return cachedPrivateKey;
}

/**
 * Signs an outgoing request and returns DID auth headers.
 * Matches the server-side buildIdentityPayload format.
 *
 * @param method - HTTP method (e.g. 'GET')
 * @param path - Request URL path (e.g. '/me/events?limit=50')
 * @param body - Request body object (null if no body)
 */
export async function signRequest(
  method: string,
  path: string,
  body: unknown = null,
): Promise<Record<string, string> | null> {
  const session = loadSession();
  if (!session) return null;

  const timestamp = new Date().toISOString();
  const payload = {
    method,
    path,
    timestamp,
    publicKey: session.publicKeyHex,
    agentId: session.agentId,
    params: body === undefined ? null : body,
  };

  // canonicalJson used for deterministic sorting (not directly sent — subtle.sign takes the canonical form)
  void canonicalJson;

  const privateKey = await getPrivateKey(session);
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
 * Falls back to plain fetch if no session or session fails.
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
