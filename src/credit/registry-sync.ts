import Database from 'better-sqlite3';
import { getConfigDir } from '../cli/config.js';
import type { AgentBnBConfig } from '../cli/config.js';
import { loadOrRepairIdentity } from '../identity/identity.js';
import { createLedger } from './create-ledger.js';
import { getBalance } from './ledger.js';
import { canonicalizeCreditOwner } from './owner-normalization.js';

/**
 * Result returned by syncCreditsFromRegistry.
 */
export interface SyncResult {
  /** True if the sync completed successfully and local DB was updated. */
  synced: boolean;
  /** Remote balance fetched from the registry, if sync succeeded. */
  remoteBalance?: number;
  /** Local balance before the sync, if sync succeeded. */
  localWas?: number;
  /** Error message, if sync failed or was skipped. */
  error?: string;
}

/**
 * Syncs the local credit database from the remote Fly registry.
 *
 * Fetches the remote balance and last 50 transactions, then upserts
 * them into the local SQLite database. This resolves the split-brain
 * problem where credits earned/spent on Fly are not reflected locally,
 * causing false "Insufficient credits" errors on cross-machine requests.
 *
 * Returns early (synced: false) when no registry is configured or on
 * any network/auth error — never throws.
 *
 * @param config - Agent configuration (must have `registry` and `owner` set).
 * @param localDb - Open better-sqlite3 Database instance for the local credit DB.
 * @returns SyncResult describing what happened.
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

    const [remoteBalance, remoteHistory] = await Promise.all([
      ledger.getBalance(config.owner),
      ledger.getHistory(config.owner, 50),
    ]);

    const localWas = getBalance(localDb, config.owner);

    localDb.transaction(() => {
      const now = new Date().toISOString();
      // Use canonicalized owner so the upserted row key matches getBalance lookups
      const canonicalOwner = canonicalizeCreditOwner(localDb, config.owner);

      localDb
        .prepare(
          'INSERT OR REPLACE INTO credit_balances (owner, balance, updated_at) VALUES (?, ?, ?)',
        )
        .run(canonicalOwner, remoteBalance, now);

      const insertTxn = localDb.prepare(
        'INSERT OR IGNORE INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const txn of remoteHistory) {
        insertTxn.run(
          txn.id,
          txn.owner,
          txn.amount,
          txn.reason,
          txn.reference_id,
          txn.created_at,
        );
      }
    })();

    return { synced: true, remoteBalance, localWas };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { synced: false, error: message };
  }
}
