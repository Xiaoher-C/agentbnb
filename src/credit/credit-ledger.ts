import type { CreditTransaction } from './ledger.js';

// Re-export CreditTransaction for consumer convenience
export type { CreditTransaction };

/**
 * Result type returned by CreditLedger.hold()
 */
export interface EscrowResult {
  escrowId: string;
}

/**
 * CreditLedger — abstract interface for credit operations.
 *
 * All methods are async to allow transparent swapping between:
 * - LocalCreditLedger (SQLite, local node)
 * - RegistryCreditLedger (HTTP, Registry-backed, cross-machine)
 *
 * Implementations must preserve hold/settle/release atomicity and
 * throw AgentBnBError with typed codes on failure.
 */
export interface CreditLedger {
  /**
   * Holds credits in escrow during capability execution.
   * Atomically deducts amount from owner's balance and creates an escrow record.
   *
   * @param owner - Agent identifier (requester).
   * @param amount - Number of credits to hold.
   * @param cardId - Capability Card ID being requested.
   * @returns EscrowResult containing the new escrowId.
   * @throws {AgentBnBError} with code 'INSUFFICIENT_CREDITS' if balance < amount.
   */
  hold(owner: string, amount: number, cardId: string): Promise<EscrowResult>;

  /**
   * Settles an escrow — transfers held credits to the capability provider.
   * Called on successful capability execution.
   *
   * @param escrowId - The escrow ID to settle.
   * @param recipientOwner - Agent identifier who will receive the credits.
   * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
   * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
   */
  settle(escrowId: string, recipientOwner: string): Promise<void>;

  /**
   * Releases an escrow — refunds credits back to the requester.
   * Called on failed or timed-out capability execution.
   *
   * @param escrowId - The escrow ID to release.
   * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
   * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
   */
  release(escrowId: string): Promise<void>;

  /**
   * Returns the current credit balance for an agent.
   *
   * @param owner - Agent identifier.
   * @returns Current balance in credits (0 if agent is unknown).
   */
  getBalance(owner: string): Promise<number>;

  /**
   * Returns the transaction history for an agent, newest first.
   *
   * @param owner - Agent identifier.
   * @param limit - Maximum number of transactions to return. Defaults to 100.
   * @returns Array of credit transactions ordered newest first.
   */
  getHistory(owner: string, limit?: number): Promise<CreditTransaction[]>;

  /**
   * Grants initial credits to an agent (bootstrap grant).
   * Idempotent — calling multiple times has no additional effect on balance.
   *
   * @param owner - Agent identifier.
   * @param amount - Number of credits to grant. Defaults to 100.
   */
  grant(owner: string, amount?: number): Promise<void>;
}
