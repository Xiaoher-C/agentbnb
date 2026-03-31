import { AgentBnBError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Base58btc codec (minimal, no external dependency)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode a Buffer to base58btc string.
 */
function base58btcEncode(buf: Buffer): string {
  const digits: number[] = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] ?? 0) * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  // Preserve leading zeros
  let result = '';
  for (const byte of buf) {
    if (byte === 0) result += BASE58_ALPHABET[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i] ?? 0];
  }
  return result;
}

/**
 * Decode a base58btc string to Buffer.
 */
function base58btcDecode(str: string): Buffer {
  const bytes: number[] = [0];
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new AgentBnBError(`Invalid base58 character: ${ch}`, 'DID_INVALID');
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    while (carry > 0) {
      bytes.push(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }
  // Preserve leading zeros
  const leadingZeros: number[] = [];
  for (const ch of str) {
    if (ch === BASE58_ALPHABET[0]) leadingZeros.push(0);
    else break;
  }
  return Buffer.from([...leadingZeros, ...bytes.reverse()]);
}

// ---------------------------------------------------------------------------
// DID Document type
// ---------------------------------------------------------------------------

/** W3C DID Document structure for an AgentBnB agent. */
export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: {
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }[];
  authentication: string[];
  assertionMethod: string[];
  service?: {
    id: string;
    type: string;
    serviceEndpoint: string;
  }[];
}

// ---------------------------------------------------------------------------
// Multicodec prefix for Ed25519 public key: 0xed 0x01 (varint-encoded)
// ---------------------------------------------------------------------------

const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 32-byte Ed25519 public key as a multibase (z-prefixed base58btc)
 * string with the Ed25519 multicodec prefix.
 */
function toMultibaseKey(rawPubkey: Buffer): string {
  const multicodecKey = Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPubkey]);
  return `z${base58btcEncode(multicodecKey)}`;
}

/**
 * Convert an Ed25519 public key (hex-encoded) to a did:key DID.
 * Uses Multicodec prefix 0xed01 + base58btc encoding with z prefix.
 * @param pubkeyHex - Hex-encoded Ed25519 public key (the raw 32 bytes, NOT the DER/SPKI wrapper)
 * @returns did:key string, e.g., "did:key:z6MkhaXgBZDvot..."
 */
export function toDIDKey(pubkeyHex: string): string {
  const rawKey = Buffer.from(pubkeyHex, 'hex');
  if (rawKey.length !== 32) {
    throw new AgentBnBError(
      `Expected 32-byte Ed25519 public key, got ${rawKey.length} bytes`,
      'DID_INVALID_KEY',
    );
  }
  return `did:key:${toMultibaseKey(rawKey)}`;
}

/**
 * Convert an agent_id to a did:agentbnb DID.
 * @param agentId - 16-char hex agent ID (from deriveAgentId)
 * @returns e.g., "did:agentbnb:6df74745403944c4"
 */
export function toDIDAgentBnB(agentId: string): string {
  if (!/^[0-9a-f]{16}$/.test(agentId)) {
    throw new AgentBnBError(
      `Invalid agent_id: must be 16 lowercase hex chars, got "${agentId}"`,
      'DID_INVALID_AGENT_ID',
    );
  }
  return `did:agentbnb:${agentId}`;
}

/**
 * Parse a DID string into its components.
 * Supports did:key and did:agentbnb methods.
 * For did:key, extracts the raw Ed25519 public key hex.
 */
export function parseDID(did: string): { method: string; id: string; pubkeyHex?: string } {
  const parts = did.split(':');
  if (parts.length < 3 || parts[0] !== 'did') {
    throw new AgentBnBError(`Invalid DID format: "${did}"`, 'DID_INVALID');
  }

  const method = parts[1]!;
  const id = parts.slice(2).join(':');

  if (method === 'key') {
    if (!id.startsWith('z')) {
      throw new AgentBnBError(
        'did:key identifier must start with "z" (base58btc)',
        'DID_INVALID',
      );
    }
    const decoded = base58btcDecode(id.slice(1));
    if (decoded.length < 2 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
      throw new AgentBnBError(
        'did:key does not contain Ed25519 multicodec prefix (0xed01)',
        'DID_UNSUPPORTED_KEY_TYPE',
      );
    }
    const pubkeyHex = decoded.subarray(2).toString('hex');
    return { method, id, pubkeyHex };
  }

  if (method === 'agentbnb') {
    return { method, id };
  }

  throw new AgentBnBError(`Unsupported DID method: "${method}"`, 'DID_UNSUPPORTED_METHOD');
}

/**
 * Build a W3C DID Document for an AgentBnB agent.
 */
export function buildDIDDocument(identity: {
  agent_id: string;
  public_key: string;
  gateway_url?: string;
}): DIDDocument {
  // Extract raw 32-byte key from DER/SPKI hex (last 64 hex chars = 32 bytes)
  const rawPubkey = Buffer.from(identity.public_key.slice(-64), 'hex');
  const didAgentBnB = toDIDAgentBnB(identity.agent_id);
  const multibaseKey = toMultibaseKey(rawPubkey);

  const doc: DIDDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: didAgentBnB,
    verificationMethod: [
      {
        id: `${didAgentBnB}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: didAgentBnB,
        publicKeyMultibase: multibaseKey,
      },
    ],
    authentication: [`${didAgentBnB}#key-1`],
    assertionMethod: [`${didAgentBnB}#key-1`],
  };

  if (identity.gateway_url) {
    doc.service = [
      {
        id: `${didAgentBnB}#agentbnb-gateway`,
        type: 'AgentGateway',
        serviceEndpoint: identity.gateway_url,
      },
    ];
  }

  return doc;
}
