import Database from 'better-sqlite3';
import { bootstrapAgent, getBalance, getTransactions, migrateOwner } from './ledger.js';
import { holdEscrow, settleEscrow, releaseEscrow } from './escrow.js';
import type { CreditLedger, EscrowResult } from './credit-ledger.js';
import type { CreditTransaction } from './ledger.js';

/**
 * LocalCreditLedger — implements CreditLedger using the local SQLite database.
 *
 * All methods are thin async wrappers around the existing synchronous functions
 * in ledger.ts and escrow.ts. No logic is reimplemented here — this class only
 * provides the async interface contract required by CreditLedger.
 *
 * This is the default implementation for standalone agents using local credits.
 * Future implementations (RegistryCreditLedger) will use HTTP calls to the
 * Registry for cross-machine credit operations.
 */
export class LocalCreditLedger implements CreditLedger {
  constructor(private readonly db: Database.Database) {}

  /**
   * Holds credits in escrow during capability execution.
   *
   * @param owner - Agent identifier (requester).
   * @param amount - Number of credits to hold.
   * @param cardId - Capability Card ID being requested.
   * @returns EscrowResult with the new escrowId.
   * @throws {AgentBnBError} with code 'INSUFFICIENT_CREDITS' if balance < amount.
   */
  async hold(owner: string, amount: number, cardId: string): Promise<EscrowResult> {
    const escrowId = holdEscrow(this.db, owner, amount, cardId);
    return { escrowId };
  }

  /**
   * Settles an escrow — transfers held credits to the capability provider.
   *
   * @param escrowId - The escrow ID to settle.
   * @param recipientOwner - Agent identifier who will receive the credits.
   * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
   * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
   */
  async settle(escrowId: string, recipientOwner: string): Promise<void> {
    settleEscrow(this.db, escrowId, recipientOwner);
  }

  /**
   * Releases an escrow — refunds credits back to the requester.
   *
   * @param escrowId - The escrow ID to release.
   * @throws {AgentBnBError} with code 'ESCROW_NOT_FOUND' if escrow does not exist.
   * @throws {AgentBnBError} with code 'ESCROW_ALREADY_SETTLED' if escrow is not in 'held' status.
   */
  async release(escrowId: string): Promise<void> {
    releaseEscrow(this.db, escrowId);
  }

  /**
   * Returns the current credit balance for an agent.
   *
   * @param owner - Agent identifier.
   * @returns Current balance in credits (0 if agent is unknown).
   */
  async getBalance(owner: string): Promise<number> {
    return getBalance(this.db, owner);
  }

  /**
   * Returns the transaction history for an agent, newest first.
   *
   * @param owner - Agent identifier.
   * @param limit - Maximum number of transactions to return. Defaults to 100.
   * @returns Array of credit transactions ordered newest first.
   */
  async getHistory(owner: string, limit?: number): Promise<CreditTransaction[]> {
    return getTransactions(this.db, owner, limit);
  }

  /**
   * Grants initial credits to an agent (bootstrap grant).
   * Idempotent — calling multiple times has no additional effect on balance.
   *
   * @param owner - Agent identifier.
   * @param amount - Number of credits to grant. Defaults to 100.
   */
  async grant(owner: string, amount?: number): Promise<void> {
    bootstrapAgent(this.db, owner, amount);
  }

  async rename(oldOwner: string, newOwner: string): Promise<void> {
    migrateOwner(this.db, oldOwner, newOwner);
  }
}
