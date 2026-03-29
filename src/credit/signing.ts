import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { AgentBnBError } from '../types/index.js';

/**
 * Ed25519 keypair as raw DER-encoded Buffers.
 */
export interface KeyPair {
  publicKey: Buffer;
  privateKey: Buffer;
}

/**
 * Generates a new Ed25519 keypair.
 * Uses Node.js built-in crypto — no external dependencies.
 *
 * @returns Object with publicKey and privateKey as DER-encoded Buffers.
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: Buffer.from(publicKey),
    privateKey: Buffer.from(privateKey),
  };
}

/**
 * Saves an Ed25519 keypair to disk.
 * Private key is written with mode 0o600 (owner read/write only).
 *
 * @param configDir - Directory to write key files into.
 * @param keys - The keypair to persist.
 */
export function saveKeyPair(configDir: string, keys: KeyPair): void {
  const privatePath = join(configDir, 'private.key');
  const publicPath = join(configDir, 'public.key');

  writeFileSync(privatePath, keys.privateKey);
  chmodSync(privatePath, 0o600);
  writeFileSync(publicPath, keys.publicKey);
}

/**
 * Loads an Ed25519 keypair from disk.
 *
 * @param configDir - Directory containing private.key and public.key files.
 * @returns The loaded keypair.
 * @throws {AgentBnBError} with code 'KEYPAIR_NOT_FOUND' if either key file is missing.
 */
export function loadKeyPair(configDir: string): KeyPair {
  const privatePath = join(configDir, 'private.key');
  const publicPath = join(configDir, 'public.key');

  if (!existsSync(privatePath) || !existsSync(publicPath)) {
    throw new AgentBnBError('Keypair not found. Run `agentbnb init` to generate one.', 'KEYPAIR_NOT_FOUND');
  }

  return {
    publicKey: readFileSync(publicPath),
    privateKey: readFileSync(privatePath),
  };
}

/**
 * Produces a canonical JSON string from an object by sorting keys recursively.
 * This ensures the same data always produces the same byte representation.
 */
function canonicalJson(data: Record<string, unknown>): string {
  return JSON.stringify(sortForCanonicalJson(data));
}

/**
 * Recursively sorts object keys to produce deterministic JSON.
 * Arrays keep their original order while each element is canonicalized.
 */
function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortForCanonicalJson(item));
  }

  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    // Only canonicalize plain JSON objects; preserve special objects as-is.
    if (proto === Object.prototype || proto === null) {
      const input = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      const sortedKeys = Object.keys(input).sort();
      for (const key of sortedKeys) {
        output[key] = sortForCanonicalJson(input[key]);
      }
      return output;
    }
  }

  return value;
}

/**
 * Signs escrow receipt data with an Ed25519 private key.
 * Data is serialized to canonical JSON (sorted keys) before signing.
 *
 * @param data - The receipt data to sign (all fields except 'signature').
 * @param privateKey - DER-encoded Ed25519 private key.
 * @returns Base64url-encoded signature string.
 */
export function signEscrowReceipt(data: Record<string, unknown>, privateKey: Buffer): string {
  const message = Buffer.from(canonicalJson(data), 'utf-8');
  const keyObject = createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' });
  const signature = sign(null, message, keyObject);
  return signature.toString('base64url');
}

/**
 * Verifies an Ed25519 signature over escrow receipt data.
 * Returns false (does not throw) for invalid signatures or wrong keys.
 *
 * @param data - The receipt data that was signed (all fields except 'signature').
 * @param signature - Base64url-encoded signature string.
 * @param publicKey - DER-encoded Ed25519 public key.
 * @returns true if signature is valid, false otherwise.
 */
export function verifyEscrowReceipt(
  data: Record<string, unknown>,
  signature: string,
  publicKey: Buffer,
): boolean {
  try {
    const message = Buffer.from(canonicalJson(data), 'utf-8');
    const keyObject = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
    const sigBuffer = Buffer.from(signature, 'base64url');
    return verify(null, message, keyObject, sigBuffer);
  } catch {
    return false;
  }
}
