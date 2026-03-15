import Database from 'better-sqlite3';
import { getBalance } from './ledger.js';

/**
 * Configuration for credit budget enforcement.
 * Controls how many credits are kept in reserve and unavailable for auto-spending.
 */
export interface BudgetConfig {
  /** Minimum credits to keep in reserve. Auto-requests cannot reduce balance below this floor. Default: 20. */
  reserve_credits: number;
}

/**
 * Default budget configuration.
 * Reserves 20 credits as a safety floor to prevent agents from fully isolating
 * themselves from the network due to depleted balances.
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  reserve_credits: 20,
};

/**
 * Enforces credit reserve floors to prevent auto-request from draining balances to zero.
 *
 * Phase 7 auto-request MUST call canSpend() before every escrow hold.
 * Without reserve enforcement, auto-request can drain credits to zero,
 * isolating the agent from the network.
 *
 * @example
 * ```typescript
 * const budget = new BudgetManager(creditDb, config.owner, config.budget);
 * if (!budget.canSpend(card.pricing.credits_per_call)) {
 *   throw new AgentBnBError('Insufficient credits — reserve floor would be breached');
 * }
 * ```
 */
export class BudgetManager {
  /**
   * Creates a new BudgetManager.
   *
   * @param creditDb - The credit SQLite database instance.
   * @param owner - Agent owner identifier.
   * @param config - Budget configuration. Defaults to DEFAULT_BUDGET_CONFIG (20 credit reserve).
   */
  constructor(
    private readonly creditDb: Database.Database,
    private readonly owner: string,
    private readonly config: BudgetConfig = DEFAULT_BUDGET_CONFIG,
  ) {}

  /**
   * Returns the number of credits available for spending.
   * Computed as: max(0, balance - reserve_credits).
   * Always returns a non-negative number — never goes below zero.
   *
   * @returns Available credits (balance minus reserve, floored at 0).
   */
  availableCredits(): number {
    const balance = getBalance(this.creditDb, this.owner);
    return Math.max(0, balance - this.config.reserve_credits);
  }

  /**
   * Returns true if spending `amount` credits is permitted by budget rules.
   *
   * Rules:
   * - Zero-cost calls (amount <= 0) always return true.
   * - Any positive amount requires availableCredits() >= amount.
   * - If balance is at or below the reserve floor, all positive-cost calls return false.
   *
   * @param amount - Number of credits to spend.
   * @returns true if the spend is allowed, false if it would breach the reserve floor.
   */
  canSpend(amount: number): boolean {
    if (amount <= 0) return true;
    return this.availableCredits() >= amount;
  }
}
