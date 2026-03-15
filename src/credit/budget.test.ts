import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { BudgetManager, DEFAULT_BUDGET_CONFIG } from './budget.js';
import { openCreditDb, bootstrapAgent } from './ledger.js';

describe('BudgetManager', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
  });

  describe('DEFAULT_BUDGET_CONFIG', () => {
    it('should have a reserve_credits of 20', () => {
      expect(DEFAULT_BUDGET_CONFIG.reserve_credits).toBe(20);
    });
  });

  describe('availableCredits()', () => {
    it('returns balance minus reserve when balance > reserve', () => {
      bootstrapAgent(db, 'agent-1', 100);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.availableCredits()).toBe(80);
    });

    it('returns 0 when balance equals reserve (never negative)', () => {
      bootstrapAgent(db, 'agent-1', 20);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.availableCredits()).toBe(0);
    });

    it('returns 0 when balance is below reserve (floored at 0)', () => {
      bootstrapAgent(db, 'agent-1', 10);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.availableCredits()).toBe(0);
    });

    it('returns 0 when balance is 0 and reserve is 20', () => {
      bootstrapAgent(db, 'agent-1', 0);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.availableCredits()).toBe(0);
    });

    it('returns balance when reserve is 0', () => {
      bootstrapAgent(db, 'agent-1', 50);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 0 });
      expect(budget.availableCredits()).toBe(50);
    });
  });

  describe('canSpend()', () => {
    it('returns true when amount is within available credits (balance=100, reserve=20, amount=10)', () => {
      bootstrapAgent(db, 'agent-1', 100);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.canSpend(10)).toBe(true);
    });

    it('returns false when amount exceeds available credits (balance=100, reserve=20, amount=85)', () => {
      bootstrapAgent(db, 'agent-1', 100);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.canSpend(85)).toBe(false);
    });

    it('returns true when amount exactly equals available credits (balance=100, reserve=20, amount=80)', () => {
      bootstrapAgent(db, 'agent-1', 100);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.canSpend(80)).toBe(true);
    });

    it('returns false when amount one over available credits (balance=100, reserve=20, amount=81)', () => {
      bootstrapAgent(db, 'agent-1', 100);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.canSpend(81)).toBe(false);
    });

    it('returns false when balance equals reserve (balance=20, reserve=20, amount=1)', () => {
      bootstrapAgent(db, 'agent-1', 20);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.canSpend(1)).toBe(false);
    });

    it('returns true for zero-cost calls (amount=0, balance=20, reserve=20)', () => {
      bootstrapAgent(db, 'agent-1', 20);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.canSpend(0)).toBe(true);
    });

    it('returns false when balance is 0 and reserve is 20 (any positive amount)', () => {
      bootstrapAgent(db, 'agent-1', 0);
      const budget = new BudgetManager(db, 'agent-1', { reserve_credits: 20 });
      expect(budget.canSpend(1)).toBe(false);
      expect(budget.canSpend(100)).toBe(false);
    });

    it('uses default reserve of 20 when no config provided', () => {
      bootstrapAgent(db, 'agent-1', 100);
      const budget = new BudgetManager(db, 'agent-1');
      // default reserve is 20, available = 80
      expect(budget.canSpend(80)).toBe(true);
      expect(budget.canSpend(81)).toBe(false);
    });
  });
});
