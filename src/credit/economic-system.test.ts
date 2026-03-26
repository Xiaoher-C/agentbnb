import { describe, it, expect } from 'vitest';
import {
  openCreditDb,
  bootstrapAgent,
  getBalance,
  registerProvider,
  getProviderNumber,
  getProviderBonus,
  getActiveVoucher,
  issueVoucher,
} from './ledger.js';
import { holdEscrow, settleEscrow, NETWORK_FEE_RATE } from './escrow.js';

describe('Network Fee (5%)', () => {
  it('deducts 5% fee to platform_treasury on settlement', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'requester', 100);
    const escrowId = holdEscrow(db, 'requester', 20, 'card-1');
    settleEscrow(db, escrowId, 'provider');

    const providerBal = getBalance(db, 'provider');
    const treasuryBal = getBalance(db, 'platform_treasury');

    // 20 * 0.05 = 1 (fee), provider gets 19 base + 19 bonus (2x for first provider) = 38
    // treasury gets 1 fee
    expect(treasuryBal).toBe(1);
    // provider gets 19 + 19 (bonus) = 38
    expect(providerBal).toBe(38);
  });

  it('fee is zero when amount is too small (floor to 0)', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'requester', 100);
    const escrowId = holdEscrow(db, 'requester', 1, 'card-small');
    settleEscrow(db, escrowId, 'provider');

    // Math.floor(1 * 0.05) = 0, provider gets full 1 + 1 bonus (2x) = 2
    expect(getBalance(db, 'provider')).toBe(2);
  });

  it('NETWORK_FEE_RATE is exported and equals 0.05', () => {
    expect(NETWORK_FEE_RATE).toBe(0.05);
  });

  it('fee is correctly calculated for larger amounts', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'requester', 1000);
    // Exhaust voucher first
    holdEscrow(db, 'requester', 50, 'card-exhaust');
    const escrowId = holdEscrow(db, 'requester', 100, 'card-big');
    // Register provider first so bonus is known
    registerProvider(db, 'established-provider');
    // Fill up to provider #51 so bonus is 1.0x (no bonus)
    for (let i = 2; i <= 51; i++) {
      registerProvider(db, `filler-${i}`);
    }
    settleEscrow(db, escrowId, 'established-provider');

    // fee: floor(100 * 0.05) = 5, providerAmount = 95
    // provider #1, but since already registered, bonus = 2.0x? No, provider_number = 1 which is <= 50, so bonus = 2.0x
    // Wait, established-provider was registered first at provider_number=1
    // bonus = 2.0, bonusAmount = floor(95 * 1) = 95
    // total = 95 + 95 = 190
    expect(getBalance(db, 'established-provider')).toBe(190);
  });
});

describe('First Provider Bonus', () => {
  it('registerProvider assigns sequential numbers', () => {
    const db = openCreditDb();
    const n1 = registerProvider(db, 'p1');
    const n2 = registerProvider(db, 'p2');
    expect(n1).toBe(1);
    expect(n2).toBe(2);
  });

  it('registerProvider is idempotent', () => {
    const db = openCreditDb();
    const n1 = registerProvider(db, 'p1');
    const n1again = registerProvider(db, 'p1');
    expect(n1).toBe(n1again);
  });

  it('getProviderNumber returns null for unregistered', () => {
    const db = openCreditDb();
    expect(getProviderNumber(db, 'unknown')).toBeNull();
  });

  it('getProviderBonus returns correct multipliers', () => {
    expect(getProviderBonus(1)).toBe(2.0);
    expect(getProviderBonus(50)).toBe(2.0);
    expect(getProviderBonus(51)).toBe(1.5);
    expect(getProviderBonus(200)).toBe(1.5);
    expect(getProviderBonus(201)).toBe(1.0);
  });

  it('first provider gets 2x bonus on settlement', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'requester', 100);
    const escrowId = holdEscrow(db, 'requester', 20, 'card-1');
    settleEscrow(db, escrowId, 'new-provider');

    // fee: floor(20*0.05) = 1, providerAmount = 19
    // bonus: floor(19 * (2.0 - 1)) = 19
    // total: 19 + 19 = 38
    expect(getBalance(db, 'new-provider')).toBe(38);
  });

  it('provider #201+ gets no bonus', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'requester', 1000);
    // Exhaust voucher first
    holdEscrow(db, 'requester', 50, 'card-exhaust');

    // Register 200 providers to fill up bonus slots
    for (let i = 1; i <= 200; i++) {
      registerProvider(db, `provider-${i}`);
    }

    const escrowId = holdEscrow(db, 'requester', 100, 'card-no-bonus');
    settleEscrow(db, escrowId, 'provider-201');

    // fee: floor(100*0.05) = 5, providerAmount = 95
    // provider_number = 201, bonus = 1.0 (no bonus)
    // total = 95
    expect(getBalance(db, 'provider-201')).toBe(95);
  });
});

describe('Demand Voucher', () => {
  it('bootstrapAgent issues a 50-credit voucher', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'new-agent', 100);
    const voucher = getActiveVoucher(db, 'new-agent');
    expect(voucher).not.toBeNull();
    expect(voucher!.remaining).toBe(50);
  });

  it('voucher-funded escrow does not deduct from balance', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'voucher-user', 100);
    // voucher has 50 credits
    holdEscrow(db, 'voucher-user', 10, 'card-v');
    // Balance should still be 100 (voucher used, not balance)
    expect(getBalance(db, 'voucher-user')).toBe(100);
  });

  it('voucher is consumed after use', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'voucher-user', 100);
    holdEscrow(db, 'voucher-user', 10, 'card-v');
    const voucher = getActiveVoucher(db, 'voucher-user');
    expect(voucher!.remaining).toBe(40);
  });

  it('falls back to balance when voucher is insufficient', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'voucher-user', 100);
    // Exhaust voucher (50 credits)
    holdEscrow(db, 'voucher-user', 50, 'card-v1');
    // Now voucher is empty, should use balance
    holdEscrow(db, 'voucher-user', 10, 'card-v2');
    expect(getBalance(db, 'voucher-user')).toBe(90);
  });

  it('expired voucher is not used', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'expired-user', 100);
    // Manually expire the voucher
    db.prepare(
      "UPDATE demand_vouchers SET expires_at = '2020-01-01T00:00:00Z' WHERE owner = 'expired-user'",
    ).run();
    // Should use balance since voucher is expired
    holdEscrow(db, 'expired-user', 10, 'card-exp');
    expect(getBalance(db, 'expired-user')).toBe(90);
  });

  it('issueVoucher creates a voucher with correct fields', () => {
    const db = openCreditDb();
    const id = issueVoucher(db, 'test-owner', 100, 60);
    expect(typeof id).toBe('string');
    const voucher = getActiveVoucher(db, 'test-owner');
    expect(voucher).not.toBeNull();
    expect(voucher!.remaining).toBe(100);
  });

  it('second bootstrap does not issue another voucher', () => {
    const db = openCreditDb();
    bootstrapAgent(db, 'agent-once', 100);
    bootstrapAgent(db, 'agent-once', 100); // idempotent
    // Should still have just 1 voucher with 50 remaining
    const voucher = getActiveVoucher(db, 'agent-once');
    expect(voucher).not.toBeNull();
    expect(voucher!.remaining).toBe(50);
  });
});
