import Database from 'better-sqlite3';
import type { AgentBnBConfig } from '../cli/config.js';
import { createLedger } from './create-ledger.js';
import { getBalance } from './ledger.js';
import { generateKeyPair, loadKeyPair, type KeyPair } from './signing.js';
import { ensureIdentity } from '../identity/identity.js';

export interface SyncResult {
  synced: boolean;
  remoteBalance?: number;
  localWas?: number;
  error?: string;
}

/**
 * Pulls the latest balance from the Fly registry and upserts into local SQLite.
 * Safe to call before any credit operation. Returns immediately if no registry configured.
 *
 * @param config - Agent configuration (must have `registry` set for a sync to occur).
 * @param localDb - Open local credit SQLite database instance.
 * @param configDir - Path to the agent config directory (e.g. ~/.agentbnb).
 * @returns SyncResult indicating whether sync occurred and the remote balance written.
 */
export async function syncCreditsFromRegistry(
  config: AgentBnBConfig,
  localDb: Database.Database,
  configDir: string,
): Promise<SyncResult> {
  if (!config.registry) {
    return { synced: false };
  }

  let keys: KeyPair;
  try {
    keys = loadKeyPair(configDir);
  } catch {
    keys = generateKeyPair();
  }

  const identity = ensureIdentity(configDir, config.owner);

  const remoteLedger = createLedger({
    registryUrl: config.registry,
    ownerPublicKey: identity.public_key,
    privateKey: keys.privateKey,
  });

  let remoteBalance: number;
  try {
    remoteBalance = await remoteLedger.getBalance(config.owner);
  } catch (err) {
    return { synced: false, error: (err as Error).message };
  }

  const localWas = getBalance(localDb, config.owner);

  // Overwrite local balance with the authoritative remote value so escrow holds
  // work against the correct figure (not a stale local snapshot).
  const now = new Date().toISOString();
  localDb
    .prepare(
      `INSERT INTO credit_balances (owner, balance, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(owner) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,
    )
    .run(config.owner, remoteBalance, now);

  return { synced: true, remoteBalance, localWas };
}
