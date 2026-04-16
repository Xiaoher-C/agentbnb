import type { Migration } from './runner.js';

/**
 * Registry database migrations.
 *
 * Backfill entries (v1_to_v2, v2_to_v3) record that existing PRAGMA user_version
 * migrations already ran. Their `up` functions are no-ops because the actual
 * transforms live in src/registry/store.ts runMigrations().
 *
 * Column-addition entries replace the former try/catch ALTER TABLE blocks that
 * were scattered through src/registry/request-log.ts createRequestLogTable().
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
    up: (db) => {
      db.exec('ALTER TABLE request_log ADD COLUMN skill_id TEXT');
    },
  },
  {
    key: 'request_log_add_action_type',
    description: 'Add action_type column to request_log for autonomy audit events',
    up: (db) => {
      db.exec('ALTER TABLE request_log ADD COLUMN action_type TEXT');
    },
  },
  {
    key: 'request_log_add_tier_invoked',
    description: 'Add tier_invoked column to request_log for autonomy tier tracking',
    up: (db) => {
      db.exec('ALTER TABLE request_log ADD COLUMN tier_invoked INTEGER');
    },
  },
  {
    key: 'request_log_add_failure_reason',
    description: 'Add failure_reason column to request_log for categorizing terminal failures',
    up: (db) => {
      db.exec('ALTER TABLE request_log ADD COLUMN failure_reason TEXT');
    },
  },
  {
    key: 'request_log_add_team_id',
    description: 'Add team_id column to request_log for team-originated executions',
    up: (db) => {
      db.exec('ALTER TABLE request_log ADD COLUMN team_id TEXT');
    },
  },
  {
    key: 'request_log_add_role',
    description: 'Add role column to request_log for team role context',
    up: (db) => {
      db.exec('ALTER TABLE request_log ADD COLUMN role TEXT');
    },
  },
  {
    key: 'request_log_add_capability_type',
    description: 'Add capability_type column to request_log for capability-first team context',
    up: (db) => {
      db.exec('ALTER TABLE request_log ADD COLUMN capability_type TEXT');
    },
  },
];
