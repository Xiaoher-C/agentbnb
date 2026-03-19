import Database from 'better-sqlite3';
import { openCreditDb } from './ledger.js';
import { LocalCreditLedger } from './local-credit-ledger.js';
import { RegistryCreditLedger } from './registry-credit-ledger.js';
import type { CreditLedger } from './credit-ledger.js';

// Re-export the interface and implementations for consumer convenience
export type { CreditLedger };
export { LocalCreditLedger };
export { RegistryCreditLedger };

/**
 * Options for createLedger factory. Three mutually exclusive shapes:
 * 1. Local mode: provide `creditDbPath` with no `registryUrl` → LocalCreditLedger
 * 2. HTTP mode: provide `registryUrl` + `ownerPublicKey` → RegistryCreditLedger (HTTP)
 * 3. Direct DB mode: provide `db` directly → RegistryCreditLedger (direct, for Registry server)
 */
export type CreateLedgerOptions =
  | { creditDbPath: string; registryUrl?: undefined; ownerPublicKey?: string; db?: undefined }
  | { creditDbPath?: string; registryUrl: string; ownerPublicKey: string; db?: undefined }
  | { db: Database.Database; creditDbPath?: undefined; registryUrl?: undefined };

/**
 * createLedger — factory that auto-detects the correct CreditLedger implementation.
 *
 * Selection logic:
 * - `registryUrl` provided → RegistryCreditLedger in HTTP client mode (CRED-03)
 * - `db` provided → RegistryCreditLedger in direct DB mode (CRED-02, for Registry server)
 * - Neither → LocalCreditLedger using a local SQLite file (CRED-05 fallback)
 *
 * @param opts - Configuration options (see CreateLedgerOptions).
 * @returns A CreditLedger implementation appropriate for the given configuration.
 */
export function createLedger(opts: CreateLedgerOptions): CreditLedger {
  // HTTP mode: route credit calls to remote Registry
  if ('registryUrl' in opts && opts.registryUrl !== undefined) {
    return new RegistryCreditLedger({
      mode: 'http',
      registryUrl: opts.registryUrl,
      ownerPublicKey: opts.ownerPublicKey as string,
    });
  }

  // Direct DB mode: Registry server process avoids HTTP round-trips to itself
  if ('db' in opts && opts.db !== undefined) {
    return new RegistryCreditLedger({
      mode: 'direct',
      db: opts.db,
    });
  }

  // Local SQLite mode: standalone agent with no Registry configured
  const db = openCreditDb((opts as { creditDbPath: string }).creditDbPath);
  return new LocalCreditLedger(db);
}
