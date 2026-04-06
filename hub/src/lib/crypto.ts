/**
 * Browser crypto helpers for Hub-first agent registration.
 *
 * Uses WebCrypto (subtle) for:
 * - Ed25519 keypair generation
 * - PBKDF2 passphrase derivation
 * - AES-GCM encryption of private key
 * - Ed25519 signing for DID auth
 *
 * All operations happen client-side. Server never sees plaintext private keys.
 */

/** Number of PBKDF2 iterations for passphrase derivation. */
const PBKDF2_ITERATIONS = 100_000;

/** AES-GCM key length in bits. */
const AES_KEY_LENGTH = 256;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Keypair generation
// ---------------------------------------------------------------------------

/** A generated Ed25519 keypair with exported material. */
export interface GeneratedKeypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyHex: string;
  privateKeyBytes: ArrayBuffer; // PKCS#8 exported
}

/**
 * Generates a fresh Ed25519 keypair using WebCrypto.
 * Returns both CryptoKey objects and exported raw material for storage.
 */
export async function generateKeypair(): Promise<GeneratedKeypair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true, // extractable
    ['sign', 'verify'],
  ) as CryptoKeyPair;

  // Export public key as SPKI (DER) for compat with server-side verification
  const publicSpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privatePkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyHex: bytesToHex(publicSpki),
    privateKeyBytes: privatePkcs8,
  };
}

// ---------------------------------------------------------------------------
// Passphrase encryption
// ---------------------------------------------------------------------------

/**
 * Derives an AES-GCM key from a passphrase using PBKDF2.
 */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a private key with a passphrase.
 * Returns base64-encoded ciphertext (iv + encrypted) and base64-encoded salt.
 */
export async function encryptPrivateKey(
  privateKeyBytes: ArrayBuffer,
  passphrase: string,
): Promise<{ encrypted: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, privateKeyBytes);

  // Combine iv + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return {
    encrypted: bytesToBase64(combined),
    salt: bytesToBase64(salt),
  };
}

/**
 * Decrypts a private key with a passphrase.
 * Returns the PKCS#8 raw bytes.
 */
export async function decryptPrivateKey(
  encryptedBase64: string,
  saltBase64: string,
  passphrase: string,
): Promise<ArrayBuffer> {
  const salt = base64ToBytes(saltBase64);
  const combined = base64ToBytes(encryptedBase64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const key = await deriveKey(passphrase, salt);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return plaintext;
  } catch {
    throw new Error('Decryption failed — wrong passphrase?');
  }
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Imports a private key from PKCS#8 bytes for signing.
 */
export async function importPrivateKey(pkcs8Bytes: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
}

/**
 * Signs a canonicalized JSON payload with an Ed25519 private key.
 * Returns base64url-encoded signature (matches server format).
 */
export async function signPayload(privateKey: CryptoKey, payload: unknown): Promise<string> {
  const canonical = canonicalJson(payload);
  const data = new TextEncoder().encode(canonical);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data);
  return base64UrlEncode(sig);
}

/**
 * Canonical JSON serialization (RFC 8785 simplified).
 * Must match server-side canonicalization in src/auth/canonical-json.ts.
 * For MVP: sort keys alphabetically at every level.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]));
  return '{' + entries.join(',') + '}';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const cryptoHelpers = {
  bytesToHex,
  hexToBytes,
  base64ToBytes,
  bytesToBase64,
  base64UrlEncode,
};
