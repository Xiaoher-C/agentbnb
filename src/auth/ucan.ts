/**
 * UCAN (User Controlled Authorization Networks) token engine.
 *
 * Creates, verifies, and decodes UCAN tokens using Ed25519 signatures.
 * Tokens are encoded as: base64url(header).base64url(payload).base64url(signature)
 *
 * @see docs/adr/020-ucan-token.md
 */

import { randomUUID } from 'node:crypto';
import { sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';
import { canonicalize } from './canonical-json.js';
import { checkAndRecordJti } from './ucan-replay.js';
import { AgentBnBError } from '../types/index.js';

export interface UCANHeader {
  alg: 'EdDSA';
  typ: 'JWT';
  ucv: '0.10.0';
}

export interface UCANAttenuation {
  with: string;    // agentbnb:// resource URI
  can: string;     // action: read, write, invoke, settle, delegate
  nb?: Record<string, unknown>;  // caveats (e.g., max_calls, max_cost)
}

export interface UCANPayload {
  iss: string;     // issuer DID (did:agentbnb:<agent_id>)
  aud: string;     // audience DID
  exp: number;     // expiry (unix timestamp)
  nbf?: number;    // not-before (unix timestamp)
  nnc: string;     // nonce (replay protection — legacy)
  jti: string;     // JWT ID (replay protection — RFC 7519)
  att: UCANAttenuation[];   // attenuations (permissions)
  prf: string[];   // proof chain (parent token IDs)
  fct?: Record<string, unknown>;  // facts (metadata: escrow_id, task_description)
}

export interface UCAN {
  header: UCANHeader;
  payload: UCANPayload;
  signature: string;  // base64url Ed25519 signature
}

const UCAN_HEADER: UCANHeader = {
  alg: 'EdDSA',
  typ: 'JWT',
  ucv: '0.10.0',
};

/**
 * Encode a Buffer or string to base64url.
 */
function toBase64Url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return buf.toString('base64url');
}

/**
 * Decode a base64url string to a UTF-8 string.
 */
function fromBase64Url(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf-8');
}

/**
 * Create a UCAN token signed with Ed25519.
 * Encodes as base64url(header).base64url(payload).base64url(signature)
 *
 * @param opts - Token creation options.
 * @returns Encoded UCAN token string.
 */
export function createUCAN(opts: {
  issuerDid: string;
  audienceDid: string;
  attenuations: UCANAttenuation[];
  signerKey: Buffer;           // DER-encoded Ed25519 private key
  expiresAt: number;           // unix timestamp
  notBefore?: number;
  proofs?: string[];           // parent UCAN token strings
  facts?: Record<string, unknown>;
}): string {
  const payload: UCANPayload = {
    iss: opts.issuerDid,
    aud: opts.audienceDid,
    exp: opts.expiresAt,
    nnc: randomUUID(),
    jti: randomUUID(),
    att: opts.attenuations,
    prf: opts.proofs ?? [],
  };

  if (opts.notBefore !== undefined) {
    payload.nbf = opts.notBefore;
  }

  if (opts.facts !== undefined) {
    payload.fct = opts.facts;
  }

  const headerEncoded = toBase64Url(canonicalize(UCAN_HEADER));
  const payloadEncoded = toBase64Url(canonicalize(payload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const keyObject = createPrivateKey({ key: opts.signerKey, format: 'der', type: 'pkcs8' });
  const sig = sign(null, Buffer.from(signingInput, 'utf-8'), keyObject);
  const signatureEncoded = sig.toString('base64url');

  return `${signingInput}.${signatureEncoded}`;
}

/**
 * Options that toggle the post-signature verification stages.
 * Defaults are secure; tests and callers performing chain validation can
 * disable them to inspect signature-only validity.
 */
export interface VerifyUCANOptions {
  /** When false, skip the jti replay-cache consultation. Default: true. */
  checkReplay?: boolean;
  /** When false, skip the revocation-set consultation. Default: true. */
  checkRevocation?: boolean;
}

/**
 * Verify a UCAN token's Ed25519 signature plus replay/revocation status.
 * Does NOT verify the proof chain — use validateChain() for that.
 *
 * Verification stages, in order:
 *   1. Token format + Ed25519 signature.
 *   2. Issuer DID revocation check (if a revocation set is wired in).
 *   3. jti replay-cache check (records on success).
 *
 * @param token - Encoded UCAN token string.
 * @param issuerPublicKey - DER-encoded Ed25519 public key.
 * @param options - Optional flags to disable replay/revocation checks.
 * @returns Verification result with valid flag and optional reason.
 */
export function verifyUCAN(
  token: string,
  issuerPublicKey: Buffer,
  options: VerifyUCANOptions = {},
): { valid: boolean; reason?: string } {
  const checkReplay = options.checkReplay ?? true;
  const checkRevocation = options.checkRevocation ?? true;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, reason: 'Invalid token format: expected 3 parts' };
    }

    const signingInput = `${parts[0]}.${parts[1]}`;
    const signatureBuffer = Buffer.from(parts[2]!, 'base64url');

    const keyObject = createPublicKey({ key: issuerPublicKey, format: 'der', type: 'spki' });
    const isValid = verify(null, Buffer.from(signingInput, 'utf-8'), keyObject, signatureBuffer);

    if (!isValid) {
      return { valid: false, reason: 'Signature verification failed' };
    }

    // Stage 2 + 3 require the decoded payload. Decode once and reuse.
    const decoded = decodeUCAN(token);

    if (checkRevocation) {
      const revocationSet = getRevocationSet();
      if (revocationSet && revocationSet.isIssuerRevoked(decoded.payload.iss)) {
        return { valid: false, reason: 'issuer_revoked' };
      }
      const escrowId = decoded.payload.fct?.escrow_id;
      if (
        revocationSet &&
        typeof escrowId === 'string' &&
        revocationSet.isRevoked(escrowId)
      ) {
        return { valid: false, reason: 'escrow_revoked' };
      }
    }

    if (checkReplay) {
      const jti = decoded.payload.jti ?? decoded.payload.nnc;
      if (typeof jti !== 'string' || jti.length === 0) {
        return { valid: false, reason: 'missing_jti' };
      }
      const recorded = checkAndRecordJti(jti, decoded.payload.exp);
      if (!recorded) {
        return { valid: false, reason: 'replay_detected' };
      }
    }

    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `Verification error: ${message}` };
  }
}

/**
 * Decode a UCAN token without verifying the signature.
 *
 * @param token - Encoded UCAN token string.
 * @returns Decoded UCAN object with header, payload, and signature.
 * @throws {AgentBnBError} with code 'UCAN_INVALID' if the token format is invalid.
 */
export function decodeUCAN(token: string): UCAN {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AgentBnBError(
      `Invalid UCAN token format: expected 3 dot-separated parts, got ${parts.length}`,
      'UCAN_INVALID',
    );
  }

  let header: UCANHeader;
  let payload: UCANPayload;

  try {
    header = JSON.parse(fromBase64Url(parts[0]!)) as UCANHeader;
  } catch {
    throw new AgentBnBError('Invalid UCAN token: failed to decode header', 'UCAN_INVALID');
  }

  try {
    payload = JSON.parse(fromBase64Url(parts[1]!)) as UCANPayload;
  } catch {
    throw new AgentBnBError('Invalid UCAN token: failed to decode payload', 'UCAN_INVALID');
  }

  return {
    header,
    payload,
    signature: parts[2]!,
  };
}

/**
 * Check if a UCAN token has expired.
 *
 * @param token - Encoded UCAN token string.
 * @returns true if the token has expired (exp < now).
 */
export function isExpired(token: string): boolean {
  const decoded = decodeUCAN(token);
  const now = Math.floor(Date.now() / 1000);
  return decoded.payload.exp < now;
}

/**
 * Mint a short-lived self-delegated UCAN authorising the holder to invoke
 * `agentbnb://skill/<skillId>` (or `agentbnb://skill/*` when omitted).
 *
 * The token is issued by `did` to `did` (self-issued), signed with the
 * holder's own Ed25519 private key. This is the standard authorisation
 * shape for autonomous outbound requests where the agent acts on its
 * own behalf.
 *
 * @param opts - Self-delegation options.
 * @returns Encoded UCAN token string.
 */
export function mintSelfDelegatedSkillToken(opts: {
  /** Issuer + audience DID (self-delegation). */
  did: string;
  /** DER-encoded Ed25519 private key matching the DID. */
  signerKey: Buffer;
  /** Optional skill id; when omitted, scope is `agentbnb://skill/*`. */
  skillId?: string;
  /** Token TTL in seconds. Defaults to 300 (5 minutes). */
  ttlSeconds?: number;
}): string {
  const ttl = opts.ttlSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  const resource = opts.skillId
    ? `agentbnb://skill/${opts.skillId}`
    : 'agentbnb://skill/*';

  return createUCAN({
    issuerDid: opts.did,
    audienceDid: opts.did,
    attenuations: [{ with: resource, can: 'invoke' }],
    signerKey: opts.signerKey,
    expiresAt: now + ttl,
  });

/**
 * Minimal interface a revocation registry must implement to participate in
 * UCAN verification. Implemented by `UCANRevocationSet` in `ucan-escrow.ts`.
 */
export interface UCANRevocationSetLike {
  /** Whether the given escrow ID has been revoked. */
  isRevoked(escrowId: string): boolean;
  /** Whether the given issuer DID has been revoked. */
  isIssuerRevoked(issuerDid: string): boolean;
}

let revocationSet: UCANRevocationSetLike | null = null;

/**
 * Inject the live revocation set used by `verifyUCAN`.
 * Pass `null` to clear (mainly for tests).
 *
 * @param set - The revocation set, or null to clear.
 */
export function setRevocationSet(set: UCANRevocationSetLike | null): void {
  revocationSet = set;
}

/**
 * Read the currently-wired revocation set. Returns null when not wired.
 */
export function getRevocationSet(): UCANRevocationSetLike | null {
  return revocationSet;
}
