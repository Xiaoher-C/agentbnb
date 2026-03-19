import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateKeyPair,
  saveKeyPair,
  loadKeyPair,
  signEscrowReceipt,
  verifyEscrowReceipt,
  type KeyPair,
} from '../credit/signing.js';
// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Agent Identity — the unified identity record for an AgentBnB agent.
 * Stored at ~/.agentbnb/identity.json.
 */
export const AgentIdentitySchema = z.object({
  /** Deterministic ID derived from public key: sha256(hex).slice(0, 16). */
  agent_id: z.string().min(1),
  /** Human-readable owner name (from config or init). */
  owner: z.string().min(1),
  /** Hex-encoded Ed25519 public key. */
  public_key: z.string().min(1),
  /** ISO 8601 timestamp of identity creation. */
  created_at: z.string().datetime(),
  /** Optional guarantor info if linked to a human. */
  guarantor: z
    .object({
      github_login: z.string().min(1),
      verified_at: z.string().datetime(),
    })
    .optional(),
});

export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

/**
 * Agent Certificate — a self-signed attestation of agent identity.
 * Used for P2P identity verification without a shared auth server.
 */
export const AgentCertificateSchema = z.object({
  identity: AgentIdentitySchema,
  /** ISO 8601 timestamp of certificate issuance. */
  issued_at: z.string().datetime(),
  /** ISO 8601 timestamp of certificate expiry. */
  expires_at: z.string().datetime(),
  /** Hex-encoded public key of the issuer (same as identity for self-signed). */
  issuer_public_key: z.string().min(1),
  /** Base64url Ed25519 signature over { identity, issued_at, expires_at, issuer_public_key }. */
  signature: z.string().min(1),
});

export type AgentCertificate = z.infer<typeof AgentCertificateSchema>;

// ---------------------------------------------------------------------------
// Identity file operations
// ---------------------------------------------------------------------------

const IDENTITY_FILENAME = 'identity.json';

/**
 * Derives a deterministic agent_id from a hex-encoded public key.
 * Uses first 16 chars of SHA-256 hash.
 */
export function deriveAgentId(publicKeyHex: string): string {
  return createHash('sha256').update(publicKeyHex, 'hex').digest('hex').slice(0, 16);
}

/**
 * Creates a new agent identity. Generates an Ed25519 keypair if one does not
 * already exist. Writes identity.json to the config directory.
 *
 * @param configDir - Directory to write identity.json into (e.g. ~/.agentbnb).
 * @param owner - Human-readable agent owner name.
 * @returns The newly created AgentIdentity.
 */
export function createIdentity(configDir: string, owner: string): AgentIdentity {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Generate or load existing keypair
  let keys: KeyPair;
  try {
    keys = loadKeyPair(configDir);
  } catch {
    keys = generateKeyPair();
    saveKeyPair(configDir, keys);
  }

  const publicKeyHex = keys.publicKey.toString('hex');
  const agentId = deriveAgentId(publicKeyHex);

  const identity: AgentIdentity = {
    agent_id: agentId,
    owner,
    public_key: publicKeyHex,
    created_at: new Date().toISOString(),
  };

  saveIdentity(configDir, identity);
  return identity;
}

/**
 * Loads an existing agent identity from disk.
 *
 * @param configDir - Directory containing identity.json.
 * @returns Parsed AgentIdentity or null if file does not exist.
 */
export function loadIdentity(configDir: string): AgentIdentity | null {
  const filePath = join(configDir, IDENTITY_FILENAME);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    return AgentIdentitySchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Persists an agent identity to disk.
 *
 * @param configDir - Directory to write identity.json into.
 * @param identity - The identity to save.
 */
export function saveIdentity(configDir: string, identity: AgentIdentity): void {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  const filePath = join(configDir, IDENTITY_FILENAME);
  writeFileSync(filePath, JSON.stringify(identity, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Agent Certificates
// ---------------------------------------------------------------------------

/**
 * Issues a self-signed Agent Certificate. Valid for 365 days.
 *
 * @param identity - The agent identity to certify.
 * @param privateKey - DER-encoded Ed25519 private key.
 * @returns A signed AgentCertificate.
 */
export function issueAgentCertificate(
  identity: AgentIdentity,
  privateKey: Buffer,
): AgentCertificate {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const payload: Record<string, unknown> = {
    identity,
    issued_at: issuedAt,
    expires_at: expiresAt,
    issuer_public_key: identity.public_key,
  };

  const signature = signEscrowReceipt(payload, privateKey);

  return {
    identity,
    issued_at: issuedAt,
    expires_at: expiresAt,
    issuer_public_key: identity.public_key,
    signature,
  };
}

/**
 * Verifies an Agent Certificate's signature and expiry.
 *
 * @param cert - The certificate to verify.
 * @returns true if signature is valid and certificate has not expired.
 */
export function verifyAgentCertificate(cert: AgentCertificate): boolean {
  // Check expiry
  if (new Date(cert.expires_at) < new Date()) {
    return false;
  }

  const publicKeyHex = cert.issuer_public_key;
  const publicKeyBuf = Buffer.from(publicKeyHex, 'hex');

  const payload: Record<string, unknown> = {
    identity: cert.identity,
    issued_at: cert.issued_at,
    expires_at: cert.expires_at,
    issuer_public_key: cert.issuer_public_key,
  };

  return verifyEscrowReceipt(payload, cert.signature, publicKeyBuf);
}

/**
 * Ensures an identity exists for the given config directory.
 * If identity.json already exists, returns it. Otherwise creates a new one.
 *
 * @param configDir - Config directory path.
 * @param owner - Owner name to use if creating new identity.
 * @returns The loaded or newly created AgentIdentity.
 */
export function ensureIdentity(configDir: string, owner: string): AgentIdentity {
  const existing = loadIdentity(configDir);
  if (existing) {
    // Sync owner if it changed (e.g. re-init with different --owner)
    if (existing.owner !== owner) {
      existing.owner = owner;
      saveIdentity(configDir, existing);
    }
    return existing;
  }
  return createIdentity(configDir, owner);
}
