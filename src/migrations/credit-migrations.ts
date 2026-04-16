import type Database from 'better-sqlite3';
import type { Migration } from './runner.js';

/**
 * Adds a column to a table only if it does not already exist.
 * Handles backfill case where production DB had column added via old try/catch
 * ALTER TABLE pattern before the migration runner existed.
 */
function addColumnIfNotExists(
  db: Database.Database,
  table: string,
  column: string,
  typeAndConstraints: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeAndConstraints}`);
}

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
    up: (db) =>
      addColumnIfNotExists(db, 'credit_escrow', 'funding_source', "TEXT NOT NULL DEFAULT 'balance'"),
  },
  {
    key: 'credit_grants_owner',
    description: 'Add owner column to credit_grants table for rename tracking',
    up: (db) => addColumnIfNotExists(db, 'credit_grants', 'owner', 'TEXT'),
  },
];
