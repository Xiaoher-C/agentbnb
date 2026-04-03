import { signEscrowReceipt, verifyEscrowReceipt } from '../credit/signing.js';
import { AgentBnBError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A signed record that permanently invalidates a DID. */
export interface RevocationRecord {
  /** The DID being revoked */
  did: string;
  /** Human-readable reason for revocation */
  reason: string;
  /** ISO 8601 timestamp of revocation */
  timestamp: string;
  /** Hex-encoded Ed25519 public key of the revoker (DER/SPKI) */
  revoker_public_key: string;
  /** Ed25519 signature over {did, reason, timestamp} */
  signature: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function revocationPayload(record: {
  did: string;
  reason: string;
  timestamp: string;
}): Record<string, unknown> {
  return {
    did: record.did,
    reason: record.reason,
    timestamp: record.timestamp,
  };
}

// ---------------------------------------------------------------------------
// DIDRevocationRegistry
// ---------------------------------------------------------------------------

/**
 * In-memory revocation registry.
 * Tracks revoked DIDs for fast lookup.
 */
export class DIDRevocationRegistry {
  private readonly records = new Map<string, RevocationRecord>();

  /**
   * Revoke a DID with a signed revocation record.
   * Throws if the record's signature is invalid.
   *
   * @param record - A signed revocation record.
   * @throws {AgentBnBError} with code 'REVOCATION_INVALID_SIGNATURE' if signature check fails.
   */
  revoke(record: RevocationRecord): void {
    if (!verifyRevocationRecord(record)) {
      throw new AgentBnBError(
        'Revocation record has an invalid signature',
        'REVOCATION_INVALID_SIGNATURE',
      );
    }
    this.records.set(record.did, record);
  }

  /**
   * Check if a DID is revoked.
   *
   * @param did - The DID to check.
   * @returns true if the DID has been revoked.
   */
  isRevoked(did: string): boolean {
    return this.records.has(did);
  }

  /**
   * Get the revocation record for a DID.
   *
   * @param did - The DID to look up.
   * @returns The revocation record, or null if not revoked.
   */
  getRevocation(did: string): RevocationRecord | null {
    return this.records.get(did) ?? null;
  }

  /**
   * List all revoked DIDs.
   *
   * @returns Array of revoked DID strings.
   */
  listRevoked(): string[] {
    return [...this.records.keys()];
  }

  /**
   * Clear all revocations.
   */
  clear(): void {
    this.records.clear();
  }
}

/**
 * Create a signed revocation record.
 *
 * @param opts.did - The DID to revoke.
 * @param opts.reason - Human-readable reason.
 * @param opts.revokerKey - DER-encoded Ed25519 private key of the revoker.
 * @param opts.revokerPublicKeyHex - Hex-encoded public key of the revoker.
 * @returns A signed RevocationRecord.
 */
export function createRevocationRecord(opts: {
  did: string;
  reason: string;
  revokerKey: Buffer;
  revokerPublicKeyHex: string;
}): RevocationRecord {
  const timestamp = new Date().toISOString();
  const payload = revocationPayload({ did: opts.did, reason: opts.reason, timestamp });
  const signature = signEscrowReceipt(payload, opts.revokerKey);

  return {
    did: opts.did,
    reason: opts.reason,
    timestamp,
    revoker_public_key: opts.revokerPublicKeyHex,
    signature,
  };
}

/**
 * Verify a revocation record's signature.
 *
 * @param record - The revocation record to verify.
 * @returns true if the signature is valid for the claimed revoker public key.
 */
export function verifyRevocationRecord(record: RevocationRecord): boolean {
  const payload = revocationPayload({
    did: record.did,
    reason: record.reason,
    timestamp: record.timestamp,
  });
  const publicKeyBuf = Buffer.from(record.revoker_public_key, 'hex');
  return verifyEscrowReceipt(payload, record.signature, publicKeyBuf);
}
