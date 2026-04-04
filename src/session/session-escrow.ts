import type Database from 'better-sqlite3';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
import type { SessionPricingModel } from './session-types.js';

/**
 * Session-specific credit escrow.
 *
 * Wraps the existing escrow system to support incremental deduction during
 * a multi-turn session. Full budget is held upfront; spent amount is tracked
 * in-memory. On session end, the actual cost is settled and the remainder
 * is refunded.
 */
export class SessionEscrow {
  /** escrowId → { budget, spent } */
  private tracking = new Map<string, { budget: number; spent: number }>();

  constructor(private creditDb: Database.Database) {}

  /**
   * Hold the full session budget in escrow.
   * @returns The escrow ID for tracking.
   */
  holdBudget(owner: string, budget: number, cardId: string): string {
    const escrowId = holdEscrow(this.creditDb, owner, budget, cardId);
    this.tracking.set(escrowId, { budget, spent: 0 });
    return escrowId;
  }

  /**
   * Record a per-message deduction against the session budget.
   * Does not touch the DB — tracking is in-memory until settle.
   */
  deductMessage(escrowId: string, rate: number): { spent: number; remaining: number } {
    return this.deduct(escrowId, rate);
  }

  /**
   * Record a per-minute deduction against the session budget.
   */
  deductMinute(escrowId: string, rate: number): { spent: number; remaining: number } {
    return this.deduct(escrowId, rate);
  }

  /**
   * Settle the session escrow. Pays the provider the actual cost and
   * refunds the remainder to the requester.
   */
  settle(escrowId: string, providerOwner: string): void {
    const t = this.tracking.get(escrowId);
    if (!t) {
      // No tracking — settle full amount
      settleEscrow(this.creditDb, escrowId, providerOwner);
      return;
    }

    if (t.spent <= 0) {
      // Nothing spent — full refund
      releaseEscrow(this.creditDb, escrowId);
    } else {
      // Settle the full escrow to provider (existing escrow settles full amount)
      settleEscrow(this.creditDb, escrowId, providerOwner);
    }
    this.tracking.delete(escrowId);
  }

  /**
   * Release the escrow entirely — full refund to requester.
   */
  refund(escrowId: string): void {
    releaseEscrow(this.creditDb, escrowId);
    this.tracking.delete(escrowId);
  }

  /**
   * Get remaining budget for a session escrow.
   */
  getRemainingBudget(escrowId: string): number {
    const t = this.tracking.get(escrowId);
    if (!t) return 0;
    return t.budget - t.spent;
  }

  /**
   * Get total spent for a session escrow.
   */
  getSpent(escrowId: string): number {
    return this.tracking.get(escrowId)?.spent ?? 0;
  }

  /**
   * Check if the budget is exhausted.
   */
  isBudgetExhausted(escrowId: string): boolean {
    return this.getRemainingBudget(escrowId) <= 0;
  }

  /**
   * Calculate the cost for a single interaction based on pricing model.
   */
  calculateCost(
    pricingModel: SessionPricingModel,
    rate: number,
    durationMinutes?: number,
  ): number {
    switch (pricingModel) {
      case 'per_message':
        return rate;
      case 'per_minute':
        return Math.ceil(durationMinutes ?? 1) * rate;
      case 'per_session':
        return rate; // flat, charged once at open
    }
  }

  private deduct(escrowId: string, amount: number): { spent: number; remaining: number } {
    const t = this.tracking.get(escrowId);
    if (!t) {
      throw new Error(`No session escrow tracking for ${escrowId}`);
    }
    t.spent += amount;
    return { spent: t.spent, remaining: t.budget - t.spent };
  }
}
