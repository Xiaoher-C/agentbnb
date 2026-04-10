import {
  generateKeyPairSync,
  createHash,
  createPublicKey,
} from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Represents a service account with Ed25519 identity.
 * One per adapter deployment — all Managed Agent requests share this DID.
 */
export interface ServiceAccount {
  /** Agent ID: sha256(pubkey_hex).slice(0,16) */
  agentId: string;
  /** DID in did:agentbnb:<agent_id> format */
  did: string;
  /** Hex-encoded Ed25519 public key (SPKI DER) */
  publicKey: string;
  /** Raw DER-encoded private key buffer */
  privateKey: Buffer;
  /** Owner name for this service account */
  owner: string;
}

const PRIVATE_KEY_FILENAME = 'private.key';
const PUBLIC_KEY_FILENAME = 'public.key';
const IDENTITY_FILENAME = 'identity.json';

/**
 * Derive agent_id from a public key buffer.
 * Matches the pattern in src/identity/identity.ts:
 *   agent_id = sha256(publicKey.toString('hex')).slice(0, 16)
 */
function deriveAgentId(publicKey: Buffer): string {
  const hex = publicKey.toString('hex');
  return createHash('sha256').update(hex).digest('hex').slice(0, 16);
}

/**
 * Load or create the service-account Ed25519 keypair.
 * Keys are stored in the persistent volume at keystorePath.
 *
 * On first boot: generates new Ed25519 keypair, derives agent_id and DID,
 * stores keys + identity.json in keystorePath.
 *
 * On subsequent boots: loads existing keypair from keystorePath.
 *
 * @param keystorePath - Directory path for persistent key storage
 * @param owner - Owner name for the service account
 * @returns Resolved service account with identity fields
 */
export function ensureServiceAccount(keystorePath: string, owner: string): ServiceAccount {
  // Ensure directory exists
  if (!existsSync(keystorePath)) {
    mkdirSync(keystorePath, { recursive: true });
  }

  const privatePath = join(keystorePath, PRIVATE_KEY_FILENAME);
  const publicPath = join(keystorePath, PUBLIC_KEY_FILENAME);
  const identityPath = join(keystorePath, IDENTITY_FILENAME);

  let publicKey: Buffer;
  let privateKey: Buffer;

  if (existsSync(privatePath) && existsSync(publicPath)) {
    // Load existing keypair
    privateKey = readFileSync(privatePath);
    publicKey = readFileSync(publicPath);
  } else {
    // Generate new Ed25519 keypair
    const keypair = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    publicKey = Buffer.from(keypair.publicKey);
    privateKey = Buffer.from(keypair.privateKey);

    // Persist to disk
    writeFileSync(privatePath, privateKey);
    chmodSync(privatePath, 0o600);
    writeFileSync(publicPath, publicKey);
  }

  const agentId = deriveAgentId(publicKey);
  const did = `did:agentbnb:${agentId}`;

  // Write/update identity.json for reference
  const identity = {
    agent_id: agentId,
    owner,
    public_key: publicKey.toString('hex'),
    did,
    created_at: new Date().toISOString(),
  };

  if (!existsSync(identityPath)) {
    writeFileSync(identityPath, JSON.stringify(identity, null, 2));
  }

  return {
    agentId,
    did,
    publicKey: publicKey.toString('hex'),
    privateKey,
    owner,
  };
}

/**
 * Derive the raw 32-byte Ed25519 public key from the SPKI DER buffer.
 * Useful for signing operations that need the raw key.
 */
export function getRawPublicKey(spkiDer: Buffer): Buffer {
  const keyObject = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  // Export as JWK to get the raw 'x' parameter
  const jwk = keyObject.export({ format: 'jwk' });
  return Buffer.from(jwk.x as string, 'base64url');
}
