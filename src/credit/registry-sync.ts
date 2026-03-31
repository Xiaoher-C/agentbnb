import Database from 'better-sqlite3';
import type { AgentBnBConfig } from '../cli/config.js';
import { getConfigDir } from '../cli/config.js';
import { loadOrRepairIdentity } from '../identity/identity.js';
import { createLedger } from './create-ledger.js';
import { getBalance, openCreditDb } from './ledger.js';

/**
 * Result of a registry credit sync operation.
 */
export interface SyncResult {
  /** Whether the sync completed successfully. */
  synced: boolean;
  /** The remote balance fetched from the registry. */
  remoteBalance?: number;
  /** The local balance before the sync. */
  localWas?: number;
  /** Error message if sync failed. */
  error?: string;
}

/**
 * Syncs credit balance and transaction history from the remote registry into the local SQLite DB.
 *
 * Upserts the balance row and inserts any new transactions (INSERT OR IGNORE) so that
 * escrow holds have accurate balances when the local DB is stale.
 *
 * @param config - Agent configuration (requires `registry` to be set).
 * @param localDb - Open local credit database instance.
 * @returns SyncResult indicating success/failure and balance values.
 */
export async function syncCreditsFromRegistry(
  config: AgentBnBConfig,
  localDb: Database.Database,
): Promise<SyncResult> {
  if (!config.registry) {
    return { synced: false, error: 'no registry configured' };
  }

  try {
    const configDir = getConfigDir();
    const { identity, keys } = loadOrRepairIdentity(configDir, config.owner);

    const ledger = createLedger({
      registryUrl: config.registry,
      ownerPublicKey: identity.public_key,
      privateKey: keys.privateKey,
    });

    const localWas = getBalance(localDb, config.owner);
    const [remoteBalance, transactions] = await Promise.all([
      ledger.getBalance(config.owner),
      ledger.getHistory(config.owner, 200),
    ]);

    if (remoteBalance === localWas && transactions.length === 0) {
      return { synced: true, remoteBalance, localWas };
    }

    const now = new Date().toISOString();

    localDb.transaction(() => {
      localDb
        .prepare(
          'INSERT INTO credit_balances (owner, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at',
        )
        .run(config.owner, remoteBalance, now);

      const insertTx = localDb.prepare(
        'INSERT OR IGNORE INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const tx of transactions) {
        insertTx.run(tx.id, tx.owner, tx.amount, tx.reason, tx.reference_id, tx.created_at);
      }
    })();

    return { synced: true, remoteBalance, localWas };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Convenience wrapper that opens a fresh DB connection, syncs, then closes it.
 * Used by the periodic cron job to avoid holding a stale DB handle across ticks.
 */
export async function syncCreditsFromRegistryOnce(config: AgentBnBConfig): Promise<SyncResult> {
  const db = openCreditDb(config.credit_db_path);
  try {
    return await syncCreditsFromRegistry(config, db);
  } finally {
    db.close();
  }
}
