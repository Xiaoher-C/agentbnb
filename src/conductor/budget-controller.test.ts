import { describe, it, expect } from 'vitest';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { BudgetManager } from '../credit/budget.js';
import { BudgetController, ORCHESTRATION_FEE } from './budget-controller.js';
import type { MatchResult } from './types.js';

/** Helper to create 3 match results at a given credit cost each. */
function makeMatches(creditsPer: number): MatchResult[] {
  return [
    { subtask_id: 'st-1', selected_agent: 'agent-a', selected_skill: 'skill-1', score: 0.9, credits: creditsPer, alternatives: [] },
    { subtask_id: 'st-2', selected_agent: 'agent-b', selected_skill: 'skill-2', score: 0.8, credits: creditsPer, alternatives: [] },
    { subtask_id: 'st-3', selected_agent: 'agent-c', selected_skill: 'skill-3', score: 0.7, credits: creditsPer, alternatives: [] },
  ];
}

describe('BudgetController', () => {
  function setupCreditDb(owner: string, balance: number, reserve: number) {
    const db = openCreditDb();
    bootstrapAgent(db, owner, balance);
    const bm = new BudgetManager(db, owner, { reserve_credits: reserve });
    return { db, bm };
  }

  it('ORCHESTRATION_FEE is 5', () => {
    expect(ORCHESTRATION_FEE).toBe(5);
  });

  it('calculateBudget returns correct estimated_total (sum + orchestration fee)', () => {
    const { bm } = setupCreditDb('test-agent', 100, 20);
    const controller = new BudgetController(bm, 100);
    const matches = makeMatches(10); // 3 x 10 = 30

    const budget = controller.calculateBudget(matches);

    expect(budget.estimated_total).toBe(35); // 30 + 5 fee
    expect(budget.orchestration_fee).toBe(5);
    expect(budget.per_task_spending.get('st-1')).toBe(10);
    expect(budget.per_task_spending.get('st-2')).toBe(10);
    expect(budget.per_task_spending.get('st-3')).toBe(10);
  });

  it('requires_approval=false when max_budget >= estimated_total', () => {
    const { bm } = setupCreditDb('test-agent', 100, 20);
    const controller = new BudgetController(bm, 100);
    const matches = makeMatches(10); // estimated_total = 35

    const budget = controller.calculateBudget(matches);

    expect(budget.requires_approval).toBe(false);
    expect(budget.max_budget).toBe(100);
  });

  it('requires_approval=true when max_budget < estimated_total', () => {
    const { bm } = setupCreditDb('test-agent', 100, 20);
    const controller = new BudgetController(bm, 20); // max_budget=20 < estimated=35
    const matches = makeMatches(10);

    const budget = controller.calculateBudget(matches);

    expect(budget.requires_approval).toBe(true);
  });

  it('canExecute returns true when budget fits and no approval needed', () => {
    const { bm } = setupCreditDb('test-agent', 100, 20);
    // available = 100 - 20 = 80, estimated = 35, max_budget = 100
    const controller = new BudgetController(bm, 100);
    const matches = makeMatches(10);

    const budget = controller.calculateBudget(matches);

    expect(controller.canExecute(budget)).toBe(true);
  });

  it('canExecute returns false when requires_approval is true', () => {
    const { bm } = setupCreditDb('test-agent', 100, 20);
    const controller = new BudgetController(bm, 20);
    const matches = makeMatches(10);

    const budget = controller.calculateBudget(matches);

    expect(budget.requires_approval).toBe(true);
    expect(controller.canExecute(budget)).toBe(false);
  });

  it('canExecute returns false when balance insufficient (reserve floor)', () => {
    const { bm } = setupCreditDb('test-agent', 30, 20);
    // available = 30 - 20 = 10, estimated = 35
    const controller = new BudgetController(bm, 100);
    const matches = makeMatches(10);

    const budget = controller.calculateBudget(matches);

    expect(budget.requires_approval).toBe(false);
    expect(controller.canExecute(budget)).toBe(false);
  });

  it('approveAndCheck returns true when balance sufficient (ignores approval flag)', () => {
    const { bm } = setupCreditDb('test-agent', 100, 20);
    // available = 80, estimated = 35
    const controller = new BudgetController(bm, 20); // max_budget=20 triggers requires_approval
    const matches = makeMatches(10);

    const budget = controller.calculateBudget(matches);

    expect(budget.requires_approval).toBe(true);
    // canExecute would return false, but approveAndCheck ignores approval flag
    expect(controller.canExecute(budget)).toBe(false);
    expect(controller.approveAndCheck(budget)).toBe(true);
  });
});
