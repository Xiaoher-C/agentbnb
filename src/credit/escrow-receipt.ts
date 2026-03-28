import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { holdEscrow } from './escrow.js';
import { signEscrowReceipt } from './signing.js';
import type { EscrowReceipt } from '../types/index.js';

/**
 * Zod schema for validating EscrowReceipt objects.
 * Used by providers to validate incoming receipts before verification.
 */
export const EscrowReceiptSchema = z.object({
  requester_owner: z.string().min(1),
  requester_agent_id: z.string().optional(),
  requester_public_key: z.string().min(1),
  amount: z.number().positive(),
  card_id: z.string().min(1),
  skill_id: z.string().optional(),
  timestamp: z.string(),
  nonce: z.string().uuid(),
  signature: z.string().min(1),
});

/**
 * Options for creating a signed escrow receipt.
 */
export interface CreateReceiptOpts {
  /** Agent owner identifier (requester). */
  owner: string;
  /** V8: Cryptographic agent identity (preferred over owner). */
  agent_id?: string;
  /** Number of credits to commit. */
  amount: number;
  /** Capability Card ID being requested. */
  cardId: string;
  /** Optional skill ID within the card. */
  skillId?: string;
}

/**
 * Creates a signed escrow receipt by atomically holding credits in the local DB
 * and producing a cryptographically signed receipt that can be sent to a provider.
 *
 * This combines local escrow hold + receipt generation from the requester's perspective.
 *
 * @param db - The credit database instance.
 * @param privateKey - DER-encoded Ed25519 private key for signing.
 * @param publicKey - DER-encoded Ed25519 public key (included in receipt for verification).
 * @param opts - Receipt creation options (owner, amount, cardId, skillId).
 * @returns Object with escrowId (local reference) and signed receipt (for transmission).
 * @throws {AgentBnBError} with code 'INSUFFICIENT_CREDITS' if balance is too low.
 */
export function createSignedEscrowReceipt(
  db: Database.Database,
  privateKey: Buffer,
  publicKey: Buffer,
  opts: CreateReceiptOpts,
): { escrowId: string; receipt: EscrowReceipt } {
  // 1. Hold escrow locally — throws INSUFFICIENT_CREDITS if balance too low
  const escrowId = holdEscrow(db, opts.owner, opts.amount, opts.cardId);

  // 2. Build receipt data (everything except signature)
  const receiptData: Omit<EscrowReceipt, 'signature'> = {
    requester_owner: opts.owner,
    ...(opts.agent_id ? { requester_agent_id: opts.agent_id } : {}),
    requester_public_key: publicKey.toString('hex'),
    amount: opts.amount,
    card_id: opts.cardId,
    ...(opts.skillId ? { skill_id: opts.skillId } : {}),
    timestamp: new Date().toISOString(),
    nonce: randomUUID(),
  };

  // 3. Sign the receipt data
  const signature = signEscrowReceipt(receiptData as Record<string, unknown>, privateKey);

  // 4. Assemble complete receipt
  const receipt: EscrowReceipt = {
    ...receiptData,
    signature,
  };

  return { escrowId, receipt };
}
