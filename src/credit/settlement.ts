import Database from 'better-sqlite3';
import { recordEarning } from './ledger.js';
import { confirmEscrowDebit } from './escrow.js';
import { releaseEscrow, NETWORK_FEE_RATE } from './escrow.js';
import type { EscrowReceipt } from '../types/index.js';

/**
 * @deprecated Use relay-based settlement instead. This function deducts a 5% network
 * fee from the provider amount but does NOT credit `platform_treasury`, so the fee
 * effectively vanishes. The relay's `settleEscrow()` correctly handles the fee.
 * Kept for backward compatibility and audit trail.
 *
 * Provider-side settlement: records earnings from a signed escrow receipt.
 * The provider calls this after successfully executing a capability.
 * Credits are recorded in the provider's own local DB.
 *
 * @param providerDb - The provider's local credit database.
 * @param providerOwner - Provider agent identifier.
 * @param receipt - The signed escrow receipt from the requester.
 * @returns Object indicating settlement success.
 */
export function settleProviderEarning(
  providerDb: Database.Database,
  providerOwner: string,
  receipt: EscrowReceipt,
): { settled: true } {
  const feeAmount = Math.floor(receipt.amount * NETWORK_FEE_RATE);
  const providerAmount = receipt.amount - feeAmount;
  recordEarning(
    providerDb,
    providerOwner,
    providerAmount,
    receipt.card_id,
    receipt.nonce,
  );
  return { settled: true };
}

/**
 * Requester-side settlement: confirms that the escrow debit is permanent.
 * Called after the requester receives confirmation that the provider
 * successfully executed the capability. Marks escrow as 'settled' without
 * crediting anyone (credits stay deducted from requester).
 *
 * @param requesterDb - The requester's local credit database.
 * @param escrowId - The escrow ID to confirm as settled.
 */
export function settleRequesterEscrow(
  requesterDb: Database.Database,
  escrowId: string,
): void {
  confirmEscrowDebit(requesterDb, escrowId);
}

/**
 * Requester-side failure handling: releases escrowed credits (refund).
 * Called when the capability execution fails and the requester needs
 * their credits back.
 *
 * @param requesterDb - The requester's local credit database.
 * @param escrowId - The escrow ID to release.
 */
export function releaseRequesterEscrow(
  requesterDb: Database.Database,
  escrowId: string,
): void {
  releaseEscrow(requesterDb, escrowId);
}
