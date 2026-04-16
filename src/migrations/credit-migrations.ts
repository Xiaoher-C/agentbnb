import type { Migration } from './runner.js';

/**
 * Credit database migrations.
 *
 * These replace the former try/catch ALTER TABLE blocks in:
 * - src/credit/ledger.ts openCreditDb()  (funding_source)
 * - src/registry/credit-routes.ts creditRoutesPlugin()  (credit_grants owner)
 */
export const creditMigrations: Migration[] = [
  {
    key: 'credit_escrow_funding_source',
    description: 'Add funding_source column to credit_escrow table',
    up: (db) => {
      db.exec(
        "ALTER TABLE credit_escrow ADD COLUMN funding_source TEXT NOT NULL DEFAULT 'balance'",
      );
    },
  },
  {
    key: 'credit_grants_owner',
    description: 'Add owner column to credit_grants table for rename tracking',
    up: (db) => {
      db.exec('ALTER TABLE credit_grants ADD COLUMN owner TEXT');
    },
  },
];
