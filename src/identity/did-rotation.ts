import { signEscrowReceipt, verifyEscrowReceipt, generateKeyPair } from '../credit/signing.js';
import type { KeyPair } from '../credit/signing.js';
import { deriveAgentId } from './identity.js';
import { toDIDAgentBnB } from './did.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A signed record proving the owner of an old keypair authorized a DID transition. */
export interface RotationRecord {
  /** DID being rotated from, e.g. did:agentbnb:<old_agent_id> */
  old_did: string;
  /** DID being rotated to, e.g. did:agentbnb:<new_agent_id> */
  new_did: string;
  /** Hex-encoded old Ed25519 public key (DER/SPKI) */
  old_public_key: string;
  /** Hex-encoded new Ed25519 public key (DER/SPKI) */
  new_public_key: string;
  /** ISO 8601 timestamp of the rotation event */
  timestamp: string;
  /** Days during which old DID still resolves to new DID */
  grace_period_days: number;
  /** Ed25519 signature by the OLD key over the rotation payload */
  old_key_signature: string;
}

/** Default grace period in days during which old DID still resolves to new DID. */
export const ROTATION_GRACE_DAYS = 90;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rotationPayload(record: {
  old_did: string;
  new_did: string;
  new_public_key: string;
  timestamp: string;
}): Record<string, unknown> {
  return {
    old_did: record.old_did,
    new_did: record.new_did,
    new_public_key: record.new_public_key,
    timestamp: record.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a DID rotation record signed by the old key.
 * This proves the owner of the old key authorized the transition.
 *
 * @param opts.oldKeys - The current (soon-to-be-old) keypair.
 * @param opts.newKeys - The new keypair to rotate to.
 * @param opts.gracePeriodDays - Override the default grace period (default 90).
 * @returns A signed RotationRecord.
 */
export function createRotationRecord(opts: {
  oldKeys: KeyPair;
  newKeys: KeyPair;
  gracePeriodDays?: number;
}): RotationRecord {
  const oldPubHex = opts.oldKeys.publicKey.toString('hex');
  const newPubHex = opts.newKeys.publicKey.toString('hex');
  const oldDid = toDIDAgentBnB(deriveAgentId(oldPubHex));
  const newDid = toDIDAgentBnB(deriveAgentId(newPubHex));
  const timestamp = new Date().toISOString();
  const gracePeriodDays = opts.gracePeriodDays ?? ROTATION_GRACE_DAYS;

  const payload = rotationPayload({ old_did: oldDid, new_did: newDid, new_public_key: newPubHex, timestamp });
  const signature = signEscrowReceipt(payload, opts.oldKeys.privateKey);

  return {
    old_did: oldDid,
    new_did: newDid,
    old_public_key: oldPubHex,
    new_public_key: newPubHex,
    timestamp,
    grace_period_days: gracePeriodDays,
    old_key_signature: signature,
  };
}

/**
 * Verify a rotation record's signature using the claimed old public key.
 *
 * @param record - The rotation record to verify.
 * @returns true if the old key's signature over the payload is valid.
 */
export function verifyRotationRecord(record: RotationRecord): boolean {
  const payload = rotationPayload({
    old_did: record.old_did,
    new_did: record.new_did,
    new_public_key: record.new_public_key,
    timestamp: record.timestamp,
  });
  const publicKeyBuf = Buffer.from(record.old_public_key, 'hex');
  return verifyEscrowReceipt(payload, record.old_key_signature, publicKeyBuf);
}

/**
 * Check if a rotation is still within its grace period.
 *
 * @param record - The rotation record to check.
 * @returns true if the current time is within the grace window.
 */
export function isWithinGracePeriod(record: RotationRecord): boolean {
  const rotatedAt = new Date(record.timestamp).getTime();
  const graceMs = record.grace_period_days * 24 * 60 * 60 * 1000;
  return Date.now() < rotatedAt + graceMs;
}

/**
 * Perform a full key rotation: generate new keypair, create signed rotation record.
 * Does NOT persist -- caller is responsible for saving new keys and rotation record.
 *
 * @param oldKeys - The current keypair to rotate away from.
 * @returns The new keypair and a signed rotation record.
 */
export function rotateKeys(oldKeys: KeyPair): {
  newKeys: KeyPair;
  rotationRecord: RotationRecord;
} {
  const newKeys = generateKeyPair();
  const rotationRecord = createRotationRecord({ oldKeys, newKeys });
  return { newKeys, rotationRecord };
}
