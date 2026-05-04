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

  // -- v10 rental session metadata (ADR-022 / ADR-023 / ADR-024) --
  {
    key: 'rental_sessions_create',
    description: 'Create rental_sessions table for v10 Agent Maturity Rental sessions',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rental_sessions (
          id TEXT PRIMARY KEY,
          renter_did TEXT NOT NULL,
          owner_did TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          card_id TEXT,
          status TEXT NOT NULL CHECK(status IN ('open', 'active', 'paused', 'closing', 'settled', 'closed')),
          escrow_id TEXT,
          duration_min INTEGER NOT NULL,
          budget_credits INTEGER NOT NULL,
          spent_credits INTEGER NOT NULL DEFAULT 0,
          current_mode TEXT NOT NULL DEFAULT 'direct' CHECK(current_mode IN ('direct', 'proxy')),
          created_at TEXT NOT NULL,
          started_at TEXT,
          ended_at TEXT,
          end_reason TEXT,
          outcome_json TEXT,
          share_token TEXT UNIQUE
        );
        CREATE INDEX IF NOT EXISTS rental_sessions_renter_idx
          ON rental_sessions (renter_did, created_at DESC);
        CREATE INDEX IF NOT EXISTS rental_sessions_owner_idx
          ON rental_sessions (owner_did, created_at DESC);
        CREATE INDEX IF NOT EXISTS rental_sessions_share_token_idx
          ON rental_sessions (share_token);
      `);
    },
  },
  {
    key: 'rental_ratings_create',
    description: 'Create rental_ratings table for v10 renter ratings',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rental_ratings (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          rater_did TEXT NOT NULL,
          rated_agent_id TEXT NOT NULL,
          stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
          comment TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES rental_sessions (id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS rental_ratings_agent_idx
          ON rental_ratings (rated_agent_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS rental_ratings_session_idx
          ON rental_ratings (session_id);
      `);
    },
  },
  {
    key: 'rental_threads_create',
    description: 'Create rental_threads table for v10 task threads within sessions',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rental_threads (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed')),
          created_at TEXT NOT NULL,
          completed_at TEXT,
          FOREIGN KEY (session_id) REFERENCES rental_sessions (id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS rental_threads_session_idx
          ON rental_threads (session_id, created_at);
      `);
    },
  },
  {
    key: 'session_messages_create',
    description: 'Create session_messages table for paginated v10 rental message reads',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          thread_id TEXT,
          sender_did TEXT NOT NULL,
          sender_role TEXT NOT NULL,
          content TEXT NOT NULL,
          attachments TEXT,
          is_human_intervention INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES rental_sessions (id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS session_messages_session_idx
          ON session_messages (session_id, created_at, id);
        CREATE INDEX IF NOT EXISTS session_messages_thread_idx
          ON session_messages (thread_id, created_at);
      `);
    },
  },
  // -- provider_events: per-identity scoping (audit P0, findings #3-#5) --
  {
    key: 'provider_events_add_agent_id',
    description: 'Add agent_id column + index to provider_events for per-identity scoping (audit P0)',
    up: (db) => {
      // Ensure the table exists; ensureProviderEventsTable runs eagerly elsewhere
      // but the migration runner may execute before any route plugin touches it.
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          skill_id TEXT,
          session_id TEXT,
          requester TEXT,
          credits INTEGER DEFAULT 0,
          duration_ms INTEGER DEFAULT 0,
          metadata TEXT,
          created_at TEXT NOT NULL
        );
      `);
      addColumnIfNotExists(db, 'provider_events', 'agent_id', "TEXT NOT NULL DEFAULT ''");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_provider_events_agent_id
          ON provider_events(agent_id, created_at DESC);
      `);

      // Best-effort backfill: events that match a known card via skill_id can be
      // attributed to that card's owner -> canonical agent_id. Rows where the
      // mapping is unclear stay with empty string (safe — they will be filtered
      // out, not leaked across identities).
      //
      // Skip the backfill when capability_cards or agents tables are missing
      // (fresh test DBs, or DBs that have never registered an agent yet).
      const hasCards = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capability_cards'")
        .get() as { name: string } | undefined;
      const hasAgents = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agents'")
        .get() as { name: string } | undefined;

      if (hasCards && hasAgents) {
        db.exec(`
          UPDATE provider_events
          SET agent_id = (
            SELECT COALESCE(a.agent_id, c.owner)
            FROM capability_cards c
            LEFT JOIN agents a ON a.legacy_owner = c.owner OR a.agent_id = c.owner
            WHERE c.id = provider_events.skill_id
            LIMIT 1
          )
          WHERE agent_id = ''
            AND skill_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM capability_cards c WHERE c.id = provider_events.skill_id);
        `);
      } else if (hasCards) {
        // No agents table — fall back to using card.owner directly. This is the
        // pre-V8 stack; canonicalization happens at query time via the route layer.
        db.exec(`
          UPDATE provider_events
          SET agent_id = (
            SELECT c.owner
            FROM capability_cards c
            WHERE c.id = provider_events.skill_id
            LIMIT 1
          )
          WHERE agent_id = ''
            AND skill_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM capability_cards c WHERE c.id = provider_events.skill_id);
        `);
      }
    },
  },
  {
    key: 'session_files_create',
    description: 'Create session_files table for v10 rental file uploads',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_files (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          thread_id TEXT,
          uploader_did TEXT NOT NULL,
          filename TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          storage_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES rental_sessions (id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS session_files_session_idx
          ON session_files (session_id, created_at);
      `);
    },
  },
];
