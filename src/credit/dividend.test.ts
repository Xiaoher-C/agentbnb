import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openCreditDb, bootstrapAgent, getBalance } from './ledger.js';
import { ensureDividendTables, calculateAndDistributeDividends, getAgentDividends, getCycleDetails } from './dividend.js';
import { recordSuccessfulHire } from './reliability-metrics.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

describe('dividend', () => {
  let db: ReturnType<typeof openCreditDb>;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    ensureDividendTables(db);
    // Disable vouchers for predictable balance tests
    db.prepare("UPDATE demand_vouchers SET is_active = 0").run();
  });

  afterEach(() => { db.close(); });

  function setupNetworkFees(amount: number): void {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, 0, ?)',
    ).run('platform_treasury', now);
    db.prepare(
      'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
    ).run(amount, now, 'platform_treasury');
    db.prepare(
      'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), 'platform_treasury', amount, 'network_fee', null, now);
  }

  function setupProvider(owner: string, hires: number): void {
    bootstrapAgent(db, owner, 100);
    db.prepare("UPDATE demand_vouchers SET is_active = 0 WHERE owner = ?").run(owner);
    for (let i = 0; i < hires; i++) {
      recordSuccessfulHire(db, owner, `consumer-${i}`);
    }
  }

  it('returns null when no network fees exist', () => {
    setupProvider('provider-a', 15);
    expect(calculateAndDistributeDividends(db)).toBeNull();
  });

  it('returns null when no qualifying providers exist', () => {
    setupNetworkFees(100);
    setupProvider('provider-a', 5); // only 5 hires, need 10
    expect(calculateAndDistributeDividends(db)).toBeNull();
  });

  it('distributes dividends to qualifying providers', () => {
    setupNetworkFees(200);
    setupProvider('provider-a', 15);
    setupProvider('provider-b', 12);

    const result = calculateAndDistributeDividends(db);

    expect(result).not.toBeNull();
    expect(result!.total_network_fees).toBe(200);
    expect(result!.pool_amount).toBe(100); // 50% of 200
    expect(result!.distributions.length).toBe(2);

    // Total distributed should equal pool (minus rounding)
    const totalDistributed = result!.distributions.reduce((sum, d) => sum + d.amount, 0);
    expect(totalDistributed).toBeLessThanOrEqual(100);
    expect(totalDistributed).toBeGreaterThan(0);
  });

  it('credits agent balances on distribution', () => {
    setupNetworkFees(200);
    setupProvider('provider-a', 15);

    const balanceBefore = getBalance(db, 'provider-a');
    const result = calculateAndDistributeDividends(db);
    const balanceAfter = getBalance(db, 'provider-a');

    const dividend = result!.distributions.find((d) => d.agent_id === 'provider-a');
    expect(balanceAfter).toBe(balanceBefore + dividend!.amount);
  });

  it('is idempotent — second cycle only counts new fees', async () => {
    setupNetworkFees(200);
    setupProvider('provider-a', 15);

    const first = calculateAndDistributeDividends(db);
    expect(first).not.toBeNull();

    // No new fees since first cycle
    const second = calculateAndDistributeDividends(db);
    expect(second).toBeNull();

    // Add more fees after a small delay (ensures timestamp differs from cycle)
    await new Promise((r) => setTimeout(r, 5));
    setupNetworkFees(100);
    const third = calculateAndDistributeDividends(db);
    expect(third).not.toBeNull();
    expect(third!.total_network_fees).toBe(100);
  });

  it('getAgentDividends returns history', () => {
    setupNetworkFees(200);
    setupProvider('provider-a', 15);

    calculateAndDistributeDividends(db);

    const history = getAgentDividends(db, 'provider-a');
    expect(history.length).toBe(1);
    expect(history[0].amount).toBeGreaterThan(0);
  });

  it('getCycleDetails returns full breakdown', () => {
    setupNetworkFees(200);
    setupProvider('provider-a', 15);
    setupProvider('provider-b', 12);

    const result = calculateAndDistributeDividends(db);
    const details = getCycleDetails(db, result!.cycle_id);

    expect(details.cycle).not.toBeNull();
    expect(details.cycle!.pool_amount).toBe(100);
    expect(details.distributions.length).toBe(2);
  });
});
