/**
 * BudgetController — pre-calculates orchestration cost and enforces spending limits.
 *
 * Extends BudgetManager to add orchestration-specific logic: fee calculation,
 * approval gating when estimated cost exceeds max budget, and per-task spending tracking.
 */

import { BudgetManager } from '../credit/budget.js';
import type { MatchResult, ExecutionBudget } from './types.js';

/** Credits retained by the Conductor for coordination overhead. */
export const ORCHESTRATION_FEE = 5;

/**
 * Controls budget enforcement for orchestration runs.
 *
 * Wraps BudgetManager and adds:
 * - Pre-calculation of total cost (sub-task credits + orchestration fee)
 * - Approval gating when estimated total exceeds max budget
 * - Reserve floor enforcement via BudgetManager.canSpend()
 *
 * @example
 * ```typescript
 * const controller = new BudgetController(budgetManager, 100);
 * const budget = controller.calculateBudget(matchResults);
 * if (controller.canExecute(budget)) {
 *   // proceed with orchestration
 * }
 * ```
 */
export class BudgetController {
  /**
   * Creates a new BudgetController.
   *
   * @param budgetManager - Underlying BudgetManager for reserve floor enforcement.
   * @param maxBudget - Hard ceiling for the orchestration run.
   */
  constructor(
    private readonly budgetManager: BudgetManager,
    private readonly maxBudget: number,
  ) {}

  /**
   * Pre-calculates the total budget for an orchestration run.
   *
   * Sums all matched sub-task credits, adds the orchestration fee,
   * and determines whether approval is required (estimated > max).
   *
   * @param matches - MatchResult[] from the CapabilityMatcher.
   * @returns An ExecutionBudget with cost breakdown and approval status.
   */
  calculateBudget(matches: MatchResult[]): ExecutionBudget {
    const perTaskSpending = new Map<string, number>();
    let subTotal = 0;

    for (const match of matches) {
      perTaskSpending.set(match.subtask_id, match.credits);
      subTotal += match.credits;
    }

    const estimatedTotal = subTotal + ORCHESTRATION_FEE;

    return {
      estimated_total: estimatedTotal,
      max_budget: this.maxBudget,
      orchestration_fee: ORCHESTRATION_FEE,
      per_task_spending: perTaskSpending,
      requires_approval: estimatedTotal > this.maxBudget,
    };
  }

  /**
   * Checks whether orchestration can proceed without explicit approval.
   *
   * Returns true only when:
   * 1. The budget does NOT require approval (estimated_total <= max_budget)
   * 2. The BudgetManager confirms sufficient credits (respecting reserve floor)
   *
   * @param budget - ExecutionBudget from calculateBudget().
   * @returns true if execution can proceed autonomously.
   */
  canExecute(budget: ExecutionBudget): boolean {
    if (budget.requires_approval) return false;
    return this.budgetManager.canSpend(budget.estimated_total);
  }

  /**
   * Checks budget after explicit user/agent approval.
   *
   * Ignores the requires_approval flag — used when the caller has already
   * obtained explicit approval for the over-budget orchestration.
   * Still enforces the reserve floor via BudgetManager.canSpend().
   *
   * @param budget - ExecutionBudget from calculateBudget().
   * @returns true if the agent has sufficient credits (reserve floor check only).
   */
  approveAndCheck(budget: ExecutionBudget): boolean {
    return this.budgetManager.canSpend(budget.estimated_total);
  }
}
