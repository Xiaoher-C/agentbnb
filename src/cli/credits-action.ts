/**
 * CLI actions for credit management commands.
 *
 * Provides sync, history, and grant operations for the credit ledger.
 */

import { join } from 'node:path';
import { getConfigDir, loadConfig } from './config.js';
import { openCreditDb, getBalance, getTransactions } from '../credit/ledger.js';
import { syncCreditsFromRegistry } from '../credit/registry-sync.js';
import type { CreditTransaction } from '../credit/ledger.js';

/**
 * Sync local credit balance from remote registry.
 */
export async function creditsSync(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('Error: not initialized. Run `agentbnb init` first.');
    process.exit(1);
  }
  if (!config.registry) {
    console.error('Error: no registry configured. Run `agentbnb config set registry <url>`');
    process.exit(1);
  }

  const creditDbPath = join(getConfigDir(), 'credit.db');
  const db = openCreditDb(creditDbPath);

  try {
    const localBefore = getBalance(db, config.owner);
    console.log(`Syncing credits from ${config.registry}...`);

    const result = await syncCreditsFromRegistry(config, db);

    if (result.synced) {
      const localAfter = getBalance(db, config.owner);
      console.log(`Local:  ${localBefore} → ${localAfter} credits`);
      console.log(`Remote: ${result.remoteBalance ?? '?'} credits`);
    } else {
      console.error(`Sync failed: ${result.error ?? 'unknown error'}`);
    }
  } finally {
    db.close();
  }
}

/**
 * Display recent credit transaction history.
 */
export async function creditsHistory(opts: { limit?: string; json?: boolean }): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('Error: not initialized. Run `agentbnb init` first.');
    process.exit(1);
  }

  const creditDbPath = join(getConfigDir(), 'credit.db');
  const db = openCreditDb(creditDbPath);

  try {
    const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
    const balance = getBalance(db, config.owner);
    const txns = getTransactions(db, config.owner, limit);

    if (opts.json) {
      console.log(JSON.stringify({ balance, transactions: txns }, null, 2));
      return;
    }

    console.log(`Balance: ${balance} credits`);
    console.log(`\nRecent transactions (last ${txns.length}):`);

    if (txns.length === 0) {
      console.log('  (none)');
      return;
    }

    const col = (s: string, w: number) => s.slice(0, w).padEnd(w);

    console.log(`  ${col('Date', 20)} ${col('Amount', 8)} ${col('Reason', 28)} Ref`);
    console.log(`  ${'-'.repeat(72)}`);

    for (const tx of txns) {
      const date = tx.created_at.slice(0, 19).replace('T', ' ');
      const amount = tx.amount >= 0 ? `+${tx.amount}` : String(tx.amount);
      const ref = tx.reference_id ? tx.reference_id.slice(0, 12) + '...' : '';
      console.log(`  ${col(date, 20)} ${col(amount, 8)} ${col(formatReason(tx.reason), 28)} ${ref}`);
    }
  } finally {
    db.close();
  }
}

/**
 * Admin grant credits to an agent (requires ADMIN_TOKEN on remote registry).
 */
export async function creditsGrant(agentId: string, amount: string): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('Error: not initialized. Run `agentbnb init` first.');
    process.exit(1);
  }
  if (!config.registry) {
    console.error('Error: no registry configured.');
    process.exit(1);
  }

  const adminToken = process.env['ADMIN_TOKEN'];
  if (!adminToken) {
    console.error('Error: ADMIN_TOKEN environment variable required for grant.');
    process.exit(1);
  }

  const credits = parseInt(amount, 10);
  if (!Number.isFinite(credits) || credits <= 0) {
    console.error('Error: amount must be a positive integer.');
    process.exit(1);
  }

  const registryUrl = config.registry.replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${registryUrl}/api/credits/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ agent_id: agentId, amount: credits }),
    });
  } catch (err) {
    console.error('Error: failed to connect to registry —', (err as Error).message);
    process.exit(1);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.error(`Error ${res.status}: ${body['error'] ?? 'unknown error'}`);
    process.exit(1);
  }

  const body = (await res.json()) as Record<string, unknown>;
  console.log(`Granted ${credits} credits to ${agentId}. New balance: ${body['balance'] ?? '?'}`);
}

/** Human-readable reason labels. */
function formatReason(reason: CreditTransaction['reason']): string {
  const labels: Record<string, string> = {
    bootstrap: 'Initial grant',
    escrow_hold: 'Escrow hold',
    escrow_release: 'Escrow release',
    settlement: 'Settlement (earned)',
    refund: 'Refund',
    remote_earning: 'Remote earning',
    remote_settlement_confirmed: 'Remote confirmed',
    network_fee: 'Network fee (5%)',
    provider_bonus: 'Provider bonus',
    voucher_hold: 'Voucher hold',
    voucher_settlement: 'Voucher settlement',
  };
  return labels[reason] ?? reason;
}
