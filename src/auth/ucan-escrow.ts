/**
 * Escrow-aware UCAN lifecycle management.
 *
 * UCAN tokens are bound to escrow lifecycle — when escrow settles/refunds,
 * all derived UCANs become invalid.
 *
 * @see docs/adr/020-ucan-token.md (state matrix)
 */

import { createUCAN } from './ucan.js';
import type { UCANAttenuation } from './ucan.js';

export interface EscrowBoundUCAN {
  token: string;       // encoded UCAN
  escrowId: string;    // linked escrow ID
  status: 'active' | 'expired' | 'revoked';
}

/**
 * Map escrow state to UCAN state.
 *
 * | Escrow       | UCAN    |
 * |-------------|---------|
 * | held        | active  |
 * | started     | active  |
 * | progressing | active  |
 * | settled     | expired |
 * | released    | revoked |
 * | abandoned   | revoked |
 */
export function escrowStateToUCANState(
  escrowStatus: 'held' | 'started' | 'progressing' | 'settled' | 'released' | 'abandoned',
): 'active' | 'expired' | 'revoked' {
  switch (escrowStatus) {
    case 'held':
    case 'started':
    case 'progressing':
      return 'active';
    case 'settled':
      return 'expired';
    case 'released':
    case 'abandoned':
      return 'revoked';
  }
}

/**
 * Create a UCAN bound to an escrow.
 * UCAN.exp is automatically capped at escrow expiry.
 *
 * @param opts - Escrow-bound UCAN creation options.
 * @returns EscrowBoundUCAN with token, escrowId, and active status.
 */
export function createEscrowBoundUCAN(opts: {
  issuerDid: string;
  audienceDid: string;
  attenuations: UCANAttenuation[];
  signerKey: Buffer;
  escrowId: string;
  escrowExpiresAt: number;  // unix timestamp
  requestedExpiresAt?: number;  // optional: will be capped at escrowExpiresAt
}): EscrowBoundUCAN {
  // Cap expiry at escrow expiry
  const expiresAt = opts.requestedExpiresAt !== undefined
    ? Math.min(opts.requestedExpiresAt, opts.escrowExpiresAt)
    : opts.escrowExpiresAt;

  const token = createUCAN({
    issuerDid: opts.issuerDid,
    audienceDid: opts.audienceDid,
    attenuations: opts.attenuations,
    signerKey: opts.signerKey,
    expiresAt,
    facts: { escrow_id: opts.escrowId },
  });

  return {
    token,
    escrowId: opts.escrowId,
    status: 'active',
  };
}

/**
 * In-memory revocation set covering both escrow-bound UCANs and revoked
 * issuer DIDs. Consumed by `verifyUCAN` when wired via `setRevocationSet`.
 *
 * Two independent revocation domains are tracked:
 *  - `revokeByEscrow(escrowId)` invalidates any UCAN whose `fct.escrow_id`
 *    matches; called when an escrow settles, releases, or is abandoned.
 *  - `revokeIssuer(did)` invalidates every UCAN issued by a DID; called
 *    when a DID is permanently revoked.
 */
export class UCANRevocationSet {
  private readonly revokedEscrows = new Set<string>();
  private readonly revokedIssuers = new Set<string>();

  /** Revoke all UCANs bound to an escrow. */
  revokeByEscrow(escrowId: string): void {
    this.revokedEscrows.add(escrowId);
  }

  /** Revoke all UCANs issued by a DID. */
  revokeIssuer(issuerDid: string): void {
    this.revokedIssuers.add(issuerDid);
  }

  /** Check if a UCAN is revoked by escrow ID. */
  isRevoked(escrowId: string): boolean {
    return this.revokedEscrows.has(escrowId);
  }

  /** Check if an issuer DID has been revoked. */
  isIssuerRevoked(issuerDid: string): boolean {
    return this.revokedIssuers.has(issuerDid);
  }

  /** Get all revoked escrow IDs. */
  listRevoked(): string[] {
    return [...this.revokedEscrows];
  }

  /** Get all revoked issuer DIDs. */
  listRevokedIssuers(): string[] {
    return [...this.revokedIssuers];
  }

  /** Clear all revocations. */
  clear(): void {
    this.revokedEscrows.clear();
    this.revokedIssuers.clear();
  }
}
