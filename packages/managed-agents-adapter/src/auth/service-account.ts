import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

const generateKeyPairAsync = promisify(generateKeyPair);

/**
 * Represents a service account with Ed25519 identity.
 */
export interface ServiceAccount {
  /** Agent ID: sha256(pubkey).slice(0,16) */
  agentId: string;
  /** DID in did:agentbnb:<agent_id> format */
  did: string;
  /** Base64-encoded Ed25519 public key */
  publicKey: string;
  /** Filesystem path to the stored private key */
  privateKeyPath: string;
}

/**
 * Load or create the service-account Ed25519 keypair.
 * Keys are stored in the persistent volume at keystorePath.
 *
 * @param keystorePath - Directory path for persistent key storage
 * @param _owner - Owner name for the service account
 * @returns Resolved service account with identity fields
 */
export async function ensureServiceAccount(keystorePath: string, _owner: string): Promise<ServiceAccount> {
  // TODO: implement — generate Ed25519 keypair, derive agent_id = sha256(pubkey).slice(0,16), build did:agentbnb:<agent_id>
  // Uses keystorePath for persistent storage, checks for existing key before generating.
  void keystorePath;
  void generateKeyPairAsync;
  throw new Error('Not implemented');
}
