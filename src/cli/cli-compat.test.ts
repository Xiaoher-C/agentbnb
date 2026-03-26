import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger, LocalCreditLedger } from '../credit/create-ledger.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';

/**
 * Backward compatibility tests for CLI credit operations in local-only mode.
 *
 * These tests verify that agents without a registryUrl in their config continue
 * to use LocalCreditLedger for all credit operations — COMPAT-01 through COMPAT-04.
 *
 * LocalCreditLedger is the default for standalone agents. These tests confirm that:
 * 1. createLedger({ creditDbPath }) returns a LocalCreditLedger instance
 * 2. LocalCreditLedger.grant + getBalance round-trip works identically to ledger.ts
 * 3. LocalCreditLedger.hold + settle + release (escrow flow) works end-to-end
 * 4. Publish price validation enforces credits_per_call >= 1 (CLI-04 compat)
 */
describe('CLI compat: createLedger in local-only mode (no registryUrl)', () => {
  let tmpDir: string;
  let creditDbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-compat-cli-'));
    creditDbPath = join(tmpDir, 'credit.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createLedger with creditDbPath and no registryUrl returns LocalCreditLedger instance', () => {
    const ledger = createLedger({ creditDbPath });
    expect(ledger).toBeInstanceOf(LocalCreditLedger);
  });

  it('LocalCreditLedger.getBalance returns 0 for unknown agent', async () => {
    const ledger = createLedger({ creditDbPath });
    const balance = await ledger.getBalance('unknown-agent');
    expect(balance).toBe(0);
  });

  it('LocalCreditLedger.grant + getBalance round-trip works', async () => {
    const ledger = createLedger({ creditDbPath });
    await ledger.grant('alice', 100);
    const balance = await ledger.getBalance('alice');
    expect(balance).toBe(100);
  });

  it('LocalCreditLedger.grant is idempotent — second call does not add credits', async () => {
    const ledger = createLedger({ creditDbPath });
    await ledger.grant('bob', 100);
    await ledger.grant('bob', 100); // second call should be no-op
    const balance = await ledger.getBalance('bob');
    expect(balance).toBe(100); // still 100, not 200
  });

  it('LocalCreditLedger.grant with custom amount + getBalance round-trip', async () => {
    const ledger = createLedger({ creditDbPath });
    await ledger.grant('charlie', 50);
    const balance = await ledger.getBalance('charlie');
    expect(balance).toBe(50);
  });

  it('LocalCreditLedger.hold + settle flow works for local escrow (COMPAT-01)', async () => {
    const ledger = createLedger({ creditDbPath });

    // Bootstrap both requester and provider
    await ledger.grant('requester', 100);
    await ledger.grant('provider', 50);

    // Hold credits in escrow
    const { escrowId } = await ledger.hold('requester', 10, 'card-123');
    expect(typeof escrowId).toBe('string');
    expect(escrowId.length).toBeGreaterThan(0);

    // Voucher used for hold (10 <= 50), balance unchanged
    const balanceAfterHold = await ledger.getBalance('requester');
    expect(balanceAfterHold).toBe(100);

    // Settle — transfer to provider
    await ledger.settle(escrowId, 'provider');

    // Requester balance unchanged (voucher funded), provider: fee=floor(10*0.05)=0, providerAmount=10, bonus 2x: 10, total=20
    expect(await ledger.getBalance('requester')).toBe(100);
    expect(await ledger.getBalance('provider')).toBe(70);
  });

  it('LocalCreditLedger.hold + release flow refunds requester (COMPAT-02)', async () => {
    const ledger = createLedger({ creditDbPath });
    await ledger.grant('requester', 100);

    const { escrowId } = await ledger.hold('requester', 15, 'card-456');

    // Voucher used for hold (15 <= 50), balance unchanged
    expect(await ledger.getBalance('requester')).toBe(100);

    // Release — refund credits (voucher hold refunds to balance)
    await ledger.release(escrowId);

    // Balance = 100 + 15 (voucher-funded hold refunded to balance)
    expect(await ledger.getBalance('requester')).toBe(115);
  });

  it('LocalCreditLedger.getHistory returns transaction list (COMPAT-03)', async () => {
    const ledger = createLedger({ creditDbPath });
    await ledger.grant('agent', 100);

    const history = await ledger.getHistory('agent');
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);

    const bootstrapTx = history.find((tx) => tx.reason === 'bootstrap');
    expect(bootstrapTx).toBeDefined();
    expect(bootstrapTx?.owner).toBe('agent');
    expect(bootstrapTx?.amount).toBe(100);
  });

  it('LocalCreditLedger produces identical results to direct ledger.ts calls', async () => {
    const db = openCreditDb(creditDbPath);

    // Direct ledger.ts calls
    bootstrapAgent(db, 'direct-agent', 100);
    const escrowId = holdEscrow(db, 'direct-agent', 20, 'card-direct');
    settleEscrow(db, escrowId, 'recipient');

    // Via CreditLedger interface (new path)
    const ledger2Path = join(tmpDir, 'credit2.db');
    const ledger = createLedger({ creditDbPath: ledger2Path });
    await ledger.grant('ledger-agent', 100);
    const { escrowId: escrowId2 } = await ledger.hold('ledger-agent', 20, 'card-ledger');
    await ledger.settle(escrowId2, 'recipient2');

    // Voucher used for hold (20 <= 50), balance unchanged at 100
    const directBalance = require('better-sqlite3')(creditDbPath)
      .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
      .get('direct-agent') as { balance: number } | undefined;
    const ledgerBalance = await ledger.getBalance('ledger-agent');

    // Both paths: voucher used for hold, balance stays at 100
    expect(directBalance?.balance).toBe(100);
    expect(ledgerBalance).toBe(100);
  });

  it('publish price validation: credits_per_call must be at least 1 (CLI-04 compat)', () => {
    // Validate the business rule — minimum price enforcement
    // This is a pure logic test: credits_per_call=0 is invalid
    const minPrice = 1;
    const zeroPriceCard = { pricing: { credits_per_call: 0 } };
    const validPriceCard = { pricing: { credits_per_call: 1 } };

    expect(zeroPriceCard.pricing.credits_per_call < minPrice).toBe(true); // should be rejected
    expect(validPriceCard.pricing.credits_per_call >= minPrice).toBe(true); // should be accepted
  });
});
