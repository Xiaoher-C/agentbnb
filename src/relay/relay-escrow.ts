import type Database from 'better-sqlite3';
import { holdEscrow, settleEscrow, releaseEscrow, NETWORK_FEE_RATE } from '../credit/escrow.js';
import { getBalance } from '../credit/ledger.js';
import { verifyEscrowReceipt } from '../credit/signing.js';

/**
 * Result of an escrow hold operation.
 */
export interface EscrowHoldResult {
  escrow_id: string;
  hold_amount: number;
  consumer_remaining: number;
}

/**
 * Result of an escrow settlement operation.
 */
export interface EscrowSettleResult {
  escrow_id: string;
  provider_earned: number;
  network_fee: number;
  consumer_remaining: number;
  provider_balance: number;
}

/**
 * Verifies an Ed25519 signature over a relay escrow request.
 * The signature covers a canonical JSON of the request fields (excluding the signature itself).
 *
 * @param data - Request fields to verify (everything except `signature`).
 * @param signature - Base64url-encoded Ed25519 signature.
 * @param publicKeyHex - Hex-encoded Ed25519 public key of the signer.
 * @returns true if signature is valid.
 */
export function verifyRelaySignature(
  data: Record<string, unknown>,
  signature: string,
  publicKeyHex: string,
): boolean {
  try {
    const publicKeyBuf = Buffer.from(publicKeyHex, 'hex');
    return verifyEscrowReceipt(data, signature, publicKeyBuf);
  } catch {
    return false;
  }
}

/**
 * Processes an escrow hold request on the relay.
 *
 * 1. Optionally verifies consumer signature
 * 2. Checks consumer has sufficient balance
 * 3. Deducts amount from consumer balance, creates escrow record
 * 4. Returns hold confirmation with escrow_id
 *
 * @param creditDb - Relay's credit database (source of truth).
 * @param consumerAgentId - Consumer agent identifier (owner string for DB lookup).
 * @param providerAgentId - Provider agent identifier.
 * @param skillId - Skill being requested.
 * @param amount - Credits to hold.
 * @param requestId - Unique request identifier.
 * @param signature - Optional Ed25519 signature from consumer.
 * @param publicKeyHex - Optional hex-encoded public key for verification.
 * @returns EscrowHoldResult on success.
 * @throws Error if insufficient balance or signature invalid.
 */
export function processEscrowHold(
  creditDb: Database.Database,
  consumerAgentId: string,
  providerAgentId: string,
  skillId: string,
  amount: number,
  requestId: string,
  signature?: string,
  publicKeyHex?: string,
): EscrowHoldResult {
  // Verify signature if provided
  if (signature && publicKeyHex) {
    const signData: Record<string, unknown> = {
      consumer_agent_id: consumerAgentId,
      provider_agent_id: providerAgentId,
      skill_id: skillId,
      amount,
      request_id: requestId,
    };
    if (!verifyRelaySignature(signData, signature, publicKeyHex)) {
      throw new Error('Invalid consumer signature on escrow hold');
    }
  }

  // Hold escrow — throws INSUFFICIENT_CREDITS if balance too low
  const escrowId = holdEscrow(creditDb, consumerAgentId, amount, `${providerAgentId}:${skillId}`);

  const remaining = getBalance(creditDb, consumerAgentId);

  return {
    escrow_id: escrowId,
    hold_amount: amount,
    consumer_remaining: remaining,
  };
}

/**
 * Processes an escrow settlement request on the relay.
 *
 * On success:
 * 1. Calculates network fee (5%)
 * 2. Credits provider: amount - network_fee
 * 3. Credits platform treasury: network_fee
 * 4. Returns settlement confirmation to both parties
 *
 * On failure:
 * 1. Refunds consumer
 * 2. Returns refund confirmation
 *
 * @param creditDb - Relay's credit database.
 * @param escrowId - The escrow ID from the hold.
 * @param success - Whether the execution succeeded.
 * @param providerAgentId - Provider to credit on success.
 * @param signature - Optional Ed25519 signature from consumer.
 * @param publicKeyHex - Optional hex-encoded public key for verification.
 * @param consumerAgentId - Consumer identifier for signature verification.
 * @returns EscrowSettleResult on success, or refund info on failure.
 */
export function processEscrowSettle(
  creditDb: Database.Database,
  escrowId: string,
  success: boolean,
  providerAgentId: string,
  signature?: string,
  publicKeyHex?: string,
  consumerAgentId?: string,
): EscrowSettleResult {
  // Verify signature if provided
  if (signature && publicKeyHex && consumerAgentId) {
    const signData: Record<string, unknown> = {
      escrow_id: escrowId,
      success,
      consumer_agent_id: consumerAgentId,
    };
    if (!verifyRelaySignature(signData, signature, publicKeyHex)) {
      throw new Error('Invalid consumer signature on escrow settle');
    }
  }

  // Look up escrow to get the amount
  const escrowRow = creditDb
    .prepare(
      "SELECT amount, owner FROM credit_escrow WHERE id = ? AND status IN ('held', 'started', 'progressing', 'abandoned')",
    )
    .get(escrowId) as { amount: number; owner: string } | undefined;

  if (!escrowRow) {
    throw new Error(`Escrow not found or already settled: ${escrowId}`);
  }

  // Use the canonical NETWORK_FEE_RATE from escrow.ts (imported above)

  if (success) {
    // settleEscrow handles: network fee, provider credit, provider bonus, reliability metrics
    settleEscrow(creditDb, escrowId, providerAgentId);

    const networkFee = Math.floor(escrowRow.amount * NETWORK_FEE_RATE);
    const providerAmount = escrowRow.amount - networkFee;

    return {
      escrow_id: escrowId,
      provider_earned: providerAmount,
      network_fee: networkFee,
      consumer_remaining: getBalance(creditDb, escrowRow.owner),
      provider_balance: getBalance(creditDb, providerAgentId),
    };
  } else {
    // Failure — refund consumer
    releaseEscrow(creditDb, escrowId);

    return {
      escrow_id: escrowId,
      provider_earned: 0,
      network_fee: 0,
      consumer_remaining: getBalance(creditDb, escrowRow.owner),
      provider_balance: getBalance(creditDb, providerAgentId),
    };
  }
}

/**
 * Settles a relay-mediated request with network fee.
 * Used by the existing relay_request/relay_response flow (Phase 2 upgrade).
 *
 * @param creditDb - Credit database.
 * @param escrowId - Escrow ID from the hold.
 * @param providerOwner - Provider to credit.
 * @returns Settlement result with network fee info.
 */
export function settleWithNetworkFee(
  creditDb: Database.Database,
  escrowId: string,
  providerOwner: string,
): EscrowSettleResult {
  return processEscrowSettle(creditDb, escrowId, true, providerOwner);
}
