import bs58 from 'bs58';
import { AgentBnBError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed DID result. */
export interface ParsedDID {
  method: string;
  id: string;
  /** Only present for did:key — the decoded Ed25519 public key hex. */
  pubkeyHex?: string;
}

/** W3C DID Document (subset used by AgentBnB). */
export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  service?: ServiceEndpoint[];
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Multicodec prefix for Ed25519 public key (0xed 0x01). */
const ED25519_MULTICODEC_PREFIX = Uint8Array.from([0xed, 0x01]);

/** Ed25519 raw public key length (32 bytes). */
const ED25519_KEY_LENGTH = 32;

/**
 * Ed25519 SPKI DER header (12 bytes).
 * A DER-encoded SPKI Ed25519 key = this header + 32-byte raw key.
 */
const SPKI_ED25519_HEADER = Buffer.from('302a300506032b6570032100', 'hex');

// ---------------------------------------------------------------------------
// Public Functions
// ---------------------------------------------------------------------------

/**
 * Converts a hex-encoded Ed25519 public key (DER SPKI or raw 32-byte) to a
 * `did:key` identifier using Multicodec prefix 0xed01 + base58btc + 'z'.
 *
 * @param pubkeyHex - Hex-encoded Ed25519 public key (DER SPKI or raw 32 bytes).
 * @returns DID string in `did:key:z6Mk...` format.
 */
export function toDIDKey(pubkeyHex: string): string {
  const raw = extractRawEd25519(pubkeyHex);
  const multicodec = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + raw.length);
  multicodec.set(ED25519_MULTICODEC_PREFIX, 0);
  multicodec.set(raw, ED25519_MULTICODEC_PREFIX.length);
  return `did:key:z${bs58.encode(multicodec)}`;
}

/**
 * Converts an AgentBnB agent_id to a `did:agentbnb` identifier.
 *
 * @param agentId - 16-character hex agent ID.
 * @returns DID string in `did:agentbnb:<agent_id>` format.
 */
export function toDIDAgentBnB(agentId: string): string {
  if (!/^[a-f0-9]{16}$/.test(agentId)) {
    throw new AgentBnBError('Invalid agent_id: must be 16 hex characters', 'INVALID_AGENT_ID');
  }
  return `did:agentbnb:${agentId}`;
}

/**
 * Parses a DID string into its method and method-specific ID.
 * Supports `did:key` (with Ed25519 pubkey extraction) and `did:agentbnb`.
 *
 * @param did - A DID string (e.g. "did:key:z6Mk..." or "did:agentbnb:abc123...").
 * @returns Parsed DID with method, id, and optional pubkeyHex.
 */
export function parseDID(did: string): ParsedDID {
  const match = /^did:([a-z0-9]+):(.+)$/.exec(did);
  if (!match) {
    throw new AgentBnBError(`Invalid DID format: ${did}`, 'INVALID_DID');
  }

  const method = match[1];
  const id = match[2];

  if (method === 'key') {
    if (!id.startsWith('z')) {
      throw new AgentBnBError('did:key identifier must start with z (base58btc)', 'INVALID_DID');
    }
    const decoded = bs58.decode(id.slice(1));
    if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
      throw new AgentBnBError('did:key multicodec prefix is not Ed25519 (0xed01)', 'INVALID_DID');
    }
    const rawKey = decoded.slice(2);
    if (rawKey.length !== ED25519_KEY_LENGTH) {
      throw new AgentBnBError(
        `Expected 32-byte Ed25519 key, got ${rawKey.length} bytes`,
        'INVALID_DID',
      );
    }
    return { method, id, pubkeyHex: Buffer.from(rawKey).toString('hex') };
  }

  if (method === 'agentbnb') {
    if (!/^[a-f0-9]{16}$/.test(id)) {
      throw new AgentBnBError('did:agentbnb identifier must be 16 hex characters', 'INVALID_DID');
    }
    return { method, id };
  }

  return { method, id };
}

/**
 * Builds a W3C DID Core 1.0 compliant DID Document for an AgentBnB agent.
 *
 * @param identity - Object with agent_id, public_key (hex), and optional gateway_url.
 * @returns DID Document JSON structure.
 */
export function buildDIDDocument(identity: {
  agent_id: string;
  public_key: string;
  gateway_url?: string;
}): DIDDocument {
  const did = toDIDAgentBnB(identity.agent_id);
  const multibase = toPublicKeyMultibase(identity.public_key);

  const doc: DIDDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: multibase,
      },
    ],
    authentication: [`${did}#key-1`],
  };

  if (identity.gateway_url) {
    doc.service = [
      {
        id: `${did}#agentbnb-gateway`,
        type: 'AgentGateway',
        serviceEndpoint: identity.gateway_url,
      },
    ];
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a hex public key to publicKeyMultibase format (z-prefixed base58btc
 * of multicodec-prefixed raw key).
 */
function toPublicKeyMultibase(pubkeyHex: string): string {
  const raw = extractRawEd25519(pubkeyHex);
  const multicodec = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + raw.length);
  multicodec.set(ED25519_MULTICODEC_PREFIX, 0);
  multicodec.set(raw, ED25519_MULTICODEC_PREFIX.length);
  return `z${bs58.encode(multicodec)}`;
}

/**
 * Extracts the raw 32-byte Ed25519 public key from either a DER SPKI hex
 * string or a raw 32-byte hex string.
 */
function extractRawEd25519(pubkeyHex: string): Uint8Array {
  const buf = Buffer.from(pubkeyHex, 'hex');

  // Raw 32-byte key
  if (buf.length === ED25519_KEY_LENGTH) {
    return new Uint8Array(buf);
  }

  // DER SPKI format: 12-byte header + 32-byte raw key = 44 bytes
  if (buf.length === 44 && buf.subarray(0, 12).equals(SPKI_ED25519_HEADER)) {
    return new Uint8Array(buf.subarray(12));
  }

  throw new AgentBnBError(
    `Invalid Ed25519 public key: expected 32 or 44 bytes, got ${buf.length}`,
    'INVALID_PUBLIC_KEY',
  );
}
