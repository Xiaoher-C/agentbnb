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
 * In-memory revocation set for settled/refunded escrows.
 * When escrow settles or refunds, all derived UCANs are revoked.
 */
export class UCANRevocationSet {
  private readonly revoked = new Set<string>();

  /** Revoke all UCANs for an escrow. */
  revokeByEscrow(escrowId: string): void {
    this.revoked.add(escrowId);
  }

  /** Check if a UCAN is revoked by escrow ID. */
  isRevoked(escrowId: string): boolean {
    return this.revoked.has(escrowId);
  }

  /** Get all revoked escrow IDs. */
  listRevoked(): string[] {
    return [...this.revoked];
  }

  /** Clear all revocations. */
  clear(): void {
    this.revoked.clear();
  }
}
