import type Database from 'better-sqlite3';
import { ensureAgentsTable, createAgentRecord, lookupAgent, lookupAgentByOwner } from '../identity/agent-identity.js';
import { deriveAgentId } from '../identity/identity.js';

/**
 * V8 migration version marker. Stored in a metadata table to track
 * whether migration has already run (idempotency guard).
 */
const V8_MIGRATION_KEY = 'v8_identity_migration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks if V8 migration has already been applied.
 */
function isMigrated(db: Database.Database): boolean {
  // Ensure metadata table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const row = db
    .prepare('SELECT value FROM migration_metadata WHERE key = ?')
    .get(V8_MIGRATION_KEY) as { value: string } | undefined;

  return row !== undefined;
}

/**
 * Marks V8 migration as applied.
 */
function markMigrated(db: Database.Database): void {
  db.prepare(
    'INSERT OR REPLACE INTO migration_metadata (key, value, applied_at) VALUES (?, ?, ?)',
  ).run(V8_MIGRATION_KEY, 'complete', new Date().toISOString());
}

/**
 * Collects all unique owner strings from the credit database tables.
 */
function collectCreditOwners(db: Database.Database): string[] {
  const owners = new Set<string>();

  const tables = [
    { table: 'credit_balances', column: 'owner' },
    { table: 'credit_transactions', column: 'owner' },
    { table: 'credit_escrow', column: 'owner' },
  ];

  for (const { table, column } of tables) {
    // Check table exists before querying
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(table) as { name: string } | undefined;
    if (!exists) continue;

    const rows = db
      .prepare(`SELECT DISTINCT ${column} FROM ${table}`)
      .all() as Array<Record<string, string>>;

    for (const row of rows) {
      const owner = row[column];
      if (owner) owners.add(owner);
    }
  }

  return [...owners];
}

/**
 * Collects all unique owner strings from the registry database tables.
 */
function collectRegistryOwners(db: Database.Database): string[] {
  const owners = new Set<string>();

  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='capability_cards'")
    .get() as { name: string } | undefined;
  if (!exists) return [];

  const rows = db
    .prepare('SELECT DISTINCT owner FROM capability_cards')
    .all() as Array<{ owner: string }>;

  for (const row of rows) {
    if (row.owner) owners.add(row.owner);
  }

  return [...owners];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result of a V8 migration run.
 */
export interface V8MigrationResult {
  /** Whether the migration was actually executed (false if already applied). */
  applied: boolean;
  /** Number of owner strings that were converted to agent records. */
  agentsCreated: number;
  /** Mapping of old owner → new agent_id for reference. */
  ownerMap: Map<string, string>;
}

/**
 * Runs the V8 identity migration on a credit database.
 *
 * For each unique owner string found in credit_balances, credit_transactions,
 * and credit_escrow:
 * 1. Checks if an agent record already exists (by legacy_owner lookup)
 * 2. If not, creates an agent record with the owner string as both
 *    display_name and legacy_owner
 * 3. Does NOT rename owner columns yet — that happens in Phase 1C
 *
 * Idempotent: safe to run multiple times. Uses migration_metadata table
 * as a guard.
 *
 * @param db - Credit database (must have agents table created via openCreditDb).
 * @param knownAgents - Optional map of owner → { agent_id, public_key } for agents
 *   with known keypairs. When provided, uses the real public key for agent_id derivation.
 *   When absent, generates a deterministic placeholder from the owner string.
 * @returns Migration result with owner → agent_id mapping.
 */
export function runV8CreditMigration(
  db: Database.Database,
  knownAgents?: Map<string, { agent_id: string; public_key: string }>,
): V8MigrationResult {
  ensureAgentsTable(db);

  if (isMigrated(db)) {
    return { applied: false, agentsCreated: 0, ownerMap: new Map() };
  }

  const owners = collectCreditOwners(db);
  const ownerMap = new Map<string, string>();
  let agentsCreated = 0;

  db.transaction(() => {
    for (const owner of owners) {
      // Skip if agent already registered for this owner
      const existing = lookupAgentByOwner(db, owner);
      if (existing) {
        ownerMap.set(owner, existing.agent_id);
        continue;
      }

      // Also skip if owner IS an agent_id that's already registered
      if (/^[a-f0-9]{16}$/.test(owner)) {
        const byId = lookupAgent(db, owner);
        if (byId) {
          ownerMap.set(owner, byId.agent_id);
          continue;
        }
      }

      // Determine agent_id and public_key
      const known = knownAgents?.get(owner);
      let agentId: string;
      let publicKey: string;

      if (known) {
        agentId = known.agent_id;
        publicKey = known.public_key;
      } else {
        // No keypair known — derive a deterministic placeholder agent_id
        // from the owner string. This will be updated when the agent
        // next starts and loads its real keypair.
        publicKey = Buffer.from(`placeholder:${owner}`).toString('hex');
        agentId = deriveAgentId(publicKey);
      }

      createAgentRecord(db, {
        agent_id: agentId,
        display_name: owner,
        public_key: publicKey,
        legacy_owner: owner,
      });

      ownerMap.set(owner, agentId);
      agentsCreated++;
    }

    markMigrated(db);
  })();

  return { applied: true, agentsCreated, ownerMap };
}

/**
 * Runs the V8 identity migration on a registry database.
 * Creates agent records for each unique owner found in capability_cards.
 *
 * This is separate from the credit migration because the registry DB
 * may be on a different machine (Fly) or use a different SQLite file.
 *
 * @param db - Registry database instance.
 * @param knownAgents - Optional owner → identity map.
 * @returns Migration result.
 */
export function runV8RegistryMigration(
  db: Database.Database,
  knownAgents?: Map<string, { agent_id: string; public_key: string }>,
): V8MigrationResult {
  ensureAgentsTable(db);

  if (isMigrated(db)) {
    return { applied: false, agentsCreated: 0, ownerMap: new Map() };
  }

  const owners = collectRegistryOwners(db);
  const ownerMap = new Map<string, string>();
  let agentsCreated = 0;

  db.transaction(() => {
    for (const owner of owners) {
      const existing = lookupAgentByOwner(db, owner);
      if (existing) {
        ownerMap.set(owner, existing.agent_id);
        continue;
      }

      if (/^[a-f0-9]{16}$/.test(owner)) {
        const byId = lookupAgent(db, owner);
        if (byId) {
          ownerMap.set(owner, byId.agent_id);
          continue;
        }
      }

      const known = knownAgents?.get(owner);
      let agentId: string;
      let publicKey: string;

      if (known) {
        agentId = known.agent_id;
        publicKey = known.public_key;
      } else {
        publicKey = Buffer.from(`placeholder:${owner}`).toString('hex');
        agentId = deriveAgentId(publicKey);
      }

      createAgentRecord(db, {
        agent_id: agentId,
        display_name: owner,
        public_key: publicKey,
        legacy_owner: owner,
      });

      ownerMap.set(owner, agentId);
      agentsCreated++;
    }

    markMigrated(db);
  })();

  return { applied: true, agentsCreated, ownerMap };
}
