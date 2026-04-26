import type Database from 'better-sqlite3';
import type { Migration } from './runner.js';
import { assertSafeMigrationIdentifiers } from './migration-identifiers.js';

/**
 * Adds a column to a table only if it does not already exist.
 *
 * This is idempotent and handles the backfill case: production databases that
 * had the column added via the old try/catch ALTER TABLE pattern (before the
 * migration runner existed) will have the column but no `migration_metadata`
 * row. Checking first lets us safely mark the migration as applied without
 * erroring on `duplicate column name`.
 *
 * SQLite does not support binding table or column names through prepared
 * statement parameters, so the names are interpolated into SQL. To keep this
 * helper safe against future callers that might pass dynamic input, every
 * identifier is validated against a strict allow-list before any SQL is built.
 */
function addColumnIfNotExists(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  assertSafeMigrationIdentifiers(table, column, type);
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * Registry database migrations.
 *
 * Backfill entries (v1_to_v2, v2_to_v3) record that existing PRAGMA user_version
 * migrations already ran. Their `up` functions are no-ops because the actual
 * transforms live in src/registry/store.ts runMigrations().
 *
 * Column-addition entries replace the former try/catch ALTER TABLE blocks that
 * were scattered through src/registry/request-log.ts createRequestLogTable().
 * Use `addColumnIfNotExists` to safely handle production DBs that already have
 * the column from the old pattern.
 */
export const registryMigrations: Migration[] = [
  // -- Backfill entries for PRAGMA user_version migrations (already applied) --
  {
    key: 'registry_v1_to_v2',
    description: 'Backfill: v1.0 cards migrated to v2.0 shape (skills[])',
    up: () => {
      // No-op — migration was applied via PRAGMA user_version in store.ts
    },
  },
  {
    key: 'registry_v2_to_v3',
    description: 'Backfill: FTS index rebuilt to include skills[].id tokens',
    up: () => {
      // No-op — migration was applied via PRAGMA user_version in store.ts
    },
  },

  // -- request_log column additions (previously try/catch in createRequestLogTable) --
  {
    key: 'request_log_add_skill_id',
    description: 'Add skill_id column to request_log for per-skill tracking',
    up: (db) => addColumnIfNotExists(db, 'request_log', 'skill_id', 'TEXT'),
  },
  {
    key: 'request_log_add_action_type',
    description: 'Add action_type column to request_log for autonomy audit events',
    up: (db) => addColumnIfNotExists(db, 'request_log', 'action_type', 'TEXT'),
  },
  {
    key: 'request_log_add_tier_invoked',
    description: 'Add tier_invoked column to request_log for autonomy tier tracking',
    up: (db) => addColumnIfNotExists(db, 'request_log', 'tier_invoked', 'INTEGER'),
  },
  {
    key: 'request_log_add_failure_reason',
    description: 'Add failure_reason column to request_log for categorizing terminal failures',
    up: (db) => addColumnIfNotExists(db, 'request_log', 'failure_reason', 'TEXT'),
  },
  {
    key: 'request_log_add_team_id',
    description: 'Add team_id column to request_log for team-originated executions',
    up: (db) => addColumnIfNotExists(db, 'request_log', 'team_id', 'TEXT'),
  },
  {
    key: 'request_log_add_role',
    description: 'Add role column to request_log for team role context',
    up: (db) => addColumnIfNotExists(db, 'request_log', 'role', 'TEXT'),
  },
  {
    key: 'request_log_add_capability_type',
    description: 'Add capability_type column to request_log for capability-first team context',
    up: (db) => addColumnIfNotExists(db, 'request_log', 'capability_type', 'TEXT'),
  },
];
