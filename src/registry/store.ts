import Database from 'better-sqlite3';
import { AnyCardSchema, CapabilityCardSchema, AgentBnBError } from '../types/index.js';
import type { AnyCard, CapabilityCard, CapabilityCardV2 } from '../types/index.js';
import { createRequestLogTable } from './request-log.js';
import { initFeedbackTable } from '../feedback/store.js';
import { initEvolutionTable } from '../evolution/store.js';

export type { Database };

/**
 * SQL for the v2.0 FTS5 triggers that aggregate over skills[] using json_each.
 *
 * The COALESCE fallback ensures backward compatibility: if $.skills is NULL
 * (e.g. a v1.0 card inserted before migration), the trigger falls through to
 * the flat $.name / $.description paths.
 *
 * NOTE: cards_fts uses content="" (contentless) so SQLite does NOT try to read
 * columns from capability_cards during rebuild. All indexing is trigger-managed.
 * The rowid join in matcher.ts still works because we set rowid explicitly.
 *
 * The tags column also indexes skill.capability_type (singular) and all values
 * from skill.capability_types[] (array) so FTS text search finds cards by their
 * routing labels (e.g. "financial_analysis", "audio_generation").
 */
const V2_FTS_TRIGGERS = `
  DROP TRIGGER IF EXISTS cards_ai;
  DROP TRIGGER IF EXISTS cards_au;
  DROP TRIGGER IF EXISTS cards_ad;

  CREATE TRIGGER cards_ai AFTER INSERT ON capability_cards BEGIN
    INSERT INTO cards_fts(rowid, id, owner, name, description, tags)
    VALUES (
      new.rowid,
      new.id,
      new.owner,
      COALESCE(
        (SELECT group_concat(
            COALESCE(json_extract(value, '$.id'), '') || ' ' || COALESCE(json_extract(value, '$.name'), ''),
            ' '
         )
         FROM json_each(json_extract(new.data, '$.skills'))),
        json_extract(new.data, '$.name'),
        ''
      ),
      COALESCE(
        (SELECT group_concat(json_extract(value, '$.description'), ' ')
         FROM json_each(json_extract(new.data, '$.skills'))),
        json_extract(new.data, '$.description'),
        ''
      ),
      COALESCE(
        (SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
         FROM json_each(json_extract(new.data, '$.skills'))),
        (SELECT group_concat(value, ' ')
         FROM json_each(json_extract(new.data, '$.metadata.tags'))),
        ''
      )
      || ' ' || COALESCE(
        (SELECT group_concat(json_extract(skill.value, '$.capability_type'), ' ')
         FROM json_each(json_extract(new.data, '$.skills')) AS skill),
        ''
      )
      || ' ' || COALESCE(
        (SELECT group_concat(cap_type.value, ' ')
         FROM json_each(json_extract(new.data, '$.skills')) AS skill,
              json_each(json_extract(skill.value, '$.capability_types')) AS cap_type),
        ''
      )
    );
  END;

  CREATE TRIGGER cards_au AFTER UPDATE ON capability_cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, id, owner, name, description, tags)
    VALUES (
      'delete',
      old.rowid,
      old.id,
      old.owner,
      COALESCE(
        (SELECT group_concat(
            COALESCE(json_extract(value, '$.id'), '') || ' ' || COALESCE(json_extract(value, '$.name'), ''),
            ' '
         )
         FROM json_each(json_extract(old.data, '$.skills'))),
        json_extract(old.data, '$.name'),
        ''
      ),
      COALESCE(
        (SELECT group_concat(json_extract(value, '$.description'), ' ')
         FROM json_each(json_extract(old.data, '$.skills'))),
        json_extract(old.data, '$.description'),
        ''
      ),
      COALESCE(
        (SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
         FROM json_each(json_extract(old.data, '$.skills'))),
        (SELECT group_concat(value, ' ')
         FROM json_each(json_extract(old.data, '$.metadata.tags'))),
        ''
      )
      || ' ' || COALESCE(
        (SELECT group_concat(json_extract(skill.value, '$.capability_type'), ' ')
         FROM json_each(json_extract(old.data, '$.skills')) AS skill),
        ''
      )
      || ' ' || COALESCE(
        (SELECT group_concat(cap_type.value, ' ')
         FROM json_each(json_extract(old.data, '$.skills')) AS skill,
              json_each(json_extract(skill.value, '$.capability_types')) AS cap_type),
        ''
      )
    );
    INSERT INTO cards_fts(rowid, id, owner, name, description, tags)
    VALUES (
      new.rowid,
      new.id,
      new.owner,
      COALESCE(
        (SELECT group_concat(
            COALESCE(json_extract(value, '$.id'), '') || ' ' || COALESCE(json_extract(value, '$.name'), ''),
            ' '
         )
         FROM json_each(json_extract(new.data, '$.skills'))),
        json_extract(new.data, '$.name'),
        ''
      ),
      COALESCE(
        (SELECT group_concat(json_extract(value, '$.description'), ' ')
         FROM json_each(json_extract(new.data, '$.skills'))),
        json_extract(new.data, '$.description'),
        ''
      ),
      COALESCE(
        (SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
         FROM json_each(json_extract(new.data, '$.skills'))),
        (SELECT group_concat(value, ' ')
         FROM json_each(json_extract(new.data, '$.metadata.tags'))),
        ''
      )
      || ' ' || COALESCE(
        (SELECT group_concat(json_extract(skill.value, '$.capability_type'), ' ')
         FROM json_each(json_extract(new.data, '$.skills')) AS skill),
        ''
      )
      || ' ' || COALESCE(
        (SELECT group_concat(cap_type.value, ' ')
         FROM json_each(json_extract(new.data, '$.skills')) AS skill,
              json_each(json_extract(skill.value, '$.capability_types')) AS cap_type),
        ''
      )
    );
  END;

  CREATE TRIGGER cards_ad AFTER DELETE ON capability_cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, id, owner, name, description, tags)
    VALUES (
      'delete',
      old.rowid,
      old.id,
      old.owner,
      COALESCE(
        (SELECT group_concat(
            COALESCE(json_extract(value, '$.id'), '') || ' ' || COALESCE(json_extract(value, '$.name'), ''),
            ' '
         )
         FROM json_each(json_extract(old.data, '$.skills'))),
        json_extract(old.data, '$.name'),
        ''
      ),
      COALESCE(
        (SELECT group_concat(json_extract(value, '$.description'), ' ')
         FROM json_each(json_extract(old.data, '$.skills'))),
        json_extract(old.data, '$.description'),
        ''
      ),
      COALESCE(
        (SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
         FROM json_each(json_extract(old.data, '$.skills'))),
        (SELECT group_concat(value, ' ')
         FROM json_each(json_extract(old.data, '$.metadata.tags'))),
        ''
      )
      || ' ' || COALESCE(
        (SELECT group_concat(json_extract(skill.value, '$.capability_type'), ' ')
         FROM json_each(json_extract(old.data, '$.skills')) AS skill),
        ''
      )
      || ' ' || COALESCE(
        (SELECT group_concat(cap_type.value, ' ')
         FROM json_each(json_extract(old.data, '$.skills')) AS skill,
              json_each(json_extract(skill.value, '$.capability_types')) AS cap_type),
        ''
      )
    );
  END;
`;

/**
 * Opens a SQLite database at the given path (or in-memory if ':memory:').
 * Applies WAL mode, enables foreign keys, creates base tables and FTS virtual table,
 * calls createRequestLogTable, then runs schema migrations (which installs v2.0 triggers).
 *
 * @param path - File path or ':memory:' for in-memory. Defaults to ':memory:'.
 * @returns Opened Database instance.
 */
export function openDatabase(path = ':memory:'): Database.Database {
  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create base tables and FTS virtual table (no triggers — runMigrations installs them).
  // cards_fts uses content="" (contentless FTS) so SQLite does not try to resolve FTS
  // column names as physical columns in capability_cards during rebuild operations.
  // All FTS rows are managed exclusively by triggers.
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_cards (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_requests (
      id TEXT PRIMARY KEY,
      skill_query TEXT NOT NULL,
      max_cost_credits REAL NOT NULL,
      selected_peer TEXT,
      selected_card_id TEXT,
      selected_skill_id TEXT,
      credits REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      params TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      id UNINDEXED,
      owner,
      name,
      description,
      tags,
      content=""
    );

    -- Expression index for capability_type lookups (used by Conductor routing).
    -- Turns json_extract full-table-scan into O(log n) B-tree lookup.
    CREATE INDEX IF NOT EXISTS idx_cards_capability_type
      ON capability_cards(json_extract(data, '$.capability_type'));

    -- Owner index for listCards(owner) and other owner-scoped queries.
    CREATE INDEX IF NOT EXISTS idx_cards_owner
      ON capability_cards(owner);
  `);

  // Create request_log table (adds skill_id column idempotently)
  createRequestLogTable(db);

  // Create feedback table and indexes
  initFeedbackTable(db);

  // Create evolution_versions table and indexes
  initEvolutionTable(db);

  // Run schema migrations — installs v2.0 FTS triggers and migrates v1.0 cards
  runMigrations(db);

  return db;
}

/**
 * Runs all pending SQLite schema migrations.
 *
 * Currently applies:
 * - Version 0→2: migrate v1.0 cards to v2.0 shape (skills[]).
 * - Version 2→3: rebuild FTS index to include skills[].id tokens.
 *
 * Uses PRAGMA user_version as a guard to ensure migrations run only once.
 *
 * @param db - Open database instance.
 */
export function runMigrations(db: Database.Database): void {
  const version =
    (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version ?? 0;

  if (version < 2) {
    migrateV1toV2(db);
    return;
  }

  if (version < 3) {
    migrateV2toV3(db);
  }
}

/**
 * Migration: v1.0 -> v2.0
 *
 * Runs inside a single db.transaction() to ensure atomicity:
 * 1. Reads all v1.0 cards from capability_cards
 * 2. Converts each to v2.0 shape (skills[] wrapping original fields)
 * 3. Drops old v1.0 FTS triggers and installs v2.0 triggers (json_each over skills[])
 * 4. Clears FTS index via 'delete-all' command then repopulates from migrated card data
 * 5. Sets PRAGMA user_version = 3 to prevent re-running
 *
 * @param db - Open database instance.
 */
function migrateV1toV2(db: Database.Database): void {
  const migrate = db.transaction(() => {
    // 1. Read all existing cards
    const rows = db.prepare('SELECT rowid, id, data FROM capability_cards').all() as Array<{
      rowid: number;
      id: string;
      data: string;
    }>;

    // 2. Convert v1.0 cards to v2.0 shape
    const now = new Date().toISOString();
    for (const row of rows) {
      const parsed = JSON.parse(row.data) as Record<string, unknown>;

      // Skip cards that are already v2.0
      if (parsed['spec_version'] === '2.0') continue;

      const v1 = parsed as unknown as CapabilityCard;
      const v2: CapabilityCardV2 = {
        spec_version: '2.0',
        id: v1.id,
        owner: v1.owner,
        agent_name: v1.name,
        skills: [
          {
            id: `skill-${v1.id}`,
            name: v1.name,
            description: v1.description,
            level: v1.level,
            inputs: v1.inputs,
            outputs: v1.outputs,
            pricing: v1.pricing,
            availability: { online: v1.availability.online },
            powered_by: v1.powered_by,
            metadata: v1.metadata,
            _internal: v1._internal,
          },
        ],
        availability: v1.availability,
        created_at: v1.created_at,
        updated_at: now,
      };

      db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(v2),
        now,
        v2.id
      );
    }

    // 3. Drop old triggers and install v2.0 FTS triggers
    db.exec(V2_FTS_TRIGGERS);

    // 4. Rebuild FTS index for contentless FTS5 table.
    rebuildCardsFts(db);

    // 5. Mark migration complete — MUST be last step inside the transaction.
    db.pragma('user_version = 3');
  });

  migrate();
}

/**
 * Migration: v2.0 -> v3.0
 *
 * Re-installs v2 FTS triggers and rebuilds FTS rows so skills[].id tokens are
 * indexed for exact skill_id discovery in search.
 *
 * @param db - Open database instance.
 */
function migrateV2toV3(db: Database.Database): void {
  const migrate = db.transaction(() => {
    db.exec(V2_FTS_TRIGGERS);
    rebuildCardsFts(db);
    db.pragma('user_version = 3');
  });
  migrate();
}

function rebuildCardsFts(db: Database.Database): void {
  // Use FTS5 'delete-all' to clear existing index rows on contentless FTS table.
  db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('delete-all')`);

  const allRows = db.prepare('SELECT rowid, id, owner, data FROM capability_cards').all() as Array<{
    rowid: number;
    id: string;
    owner: string;
    data: string;
  }>;

  const ftsInsert = db.prepare(
    'INSERT INTO cards_fts(rowid, id, owner, name, description, tags) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const row of allRows) {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    const skills = (data['skills'] as Array<Record<string, unknown>> | undefined) ?? [];

    let name: string;
    let description: string;
    let tags: string;

    if (skills.length > 0) {
      // v2.0 card — aggregate from skills[]
      name = skills
        .map((s) => `${String(s['id'] ?? '')} ${String(s['name'] ?? '')}`.trim())
        .join(' ');
      description = skills.map((s) => String(s['description'] ?? '')).join(' ');
      tags = [
        // tags from metadata.tags[]
        ...skills.flatMap((s) => {
          const meta = s['metadata'] as Record<string, unknown> | undefined;
          return (meta?.['tags'] as string[] | undefined) ?? [];
        }),
        // capability_type (singular)
        ...skills
          .map((s) => s['capability_type'] as string | undefined)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
        // capability_types[] (plural)
        ...skills.flatMap((s) => (s['capability_types'] as string[] | undefined) ?? []),
      ].join(' ');
    } else {
      // v1.0 card still in flat format (fallback)
      name = String(data['name'] ?? '');
      description = String(data['description'] ?? '');
      const meta = data['metadata'] as Record<string, unknown> | undefined;
      const rawTags = (meta?.['tags'] as string[] | undefined) ?? [];
      tags = rawTags.join(' ');
    }

    ftsInsert.run(row.rowid, row.id, row.owner, name, description, tags);
  }
}

/**
 * Inserts a CapabilityCard into the registry.
 * Validates the card via Zod schema before inserting.
 * Auto-sets created_at and updated_at to current ISO timestamp.
 *
 * @param db - Open database instance.
 * @param card - Card to insert.
 * @throws {AgentBnBError} with code VALIDATION_ERROR if card fails schema validation.
 */
export function insertCard(db: Database.Database, card: CapabilityCard): void {
  const now = new Date().toISOString();
  const withTimestamps = { ...card, created_at: card.created_at ?? now, updated_at: now };

  const parsed = CapabilityCardSchema.safeParse(withTimestamps);
  if (!parsed.success) {
    throw new AgentBnBError(
      `Card validation failed: ${parsed.error.message}`,
      'VALIDATION_ERROR'
    );
  }

  const stmt = db.prepare(`
    INSERT INTO capability_cards (id, owner, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    parsed.data.id,
    parsed.data.owner,
    JSON.stringify(parsed.data),
    parsed.data.created_at ?? now,
    parsed.data.updated_at ?? now
  );
}

/**
 * Retrieves a CapabilityCard by its ID.
 *
 * @param db - Open database instance.
 * @param id - UUID of the card to retrieve.
 * @returns The CapabilityCard if found, or null if not found.
 */
export function getCard(db: Database.Database, id: string): CapabilityCard | null {
  const stmt = db.prepare('SELECT data FROM capability_cards WHERE id = ?');
  const row = stmt.get(id) as { data: string } | undefined;
  if (!row) return null;

  return JSON.parse(row.data) as CapabilityCard;
}

/**
 * Updates a CapabilityCard with partial data. Verifies owner before updating.
 * Re-validates the merged result via Zod schema.
 *
 * @param db - Open database instance.
 * @param id - UUID of the card to update.
 * @param owner - The requester's owner identifier (must match stored owner).
 * @param updates - Partial card fields to apply.
 * @throws {AgentBnBError} with code FORBIDDEN if owner does not match.
 * @throws {AgentBnBError} with code NOT_FOUND if card does not exist.
 * @throws {AgentBnBError} with code VALIDATION_ERROR if merged card fails validation.
 */
export function updateCard(
  db: Database.Database,
  id: string,
  owner: string,
  updates: Partial<CapabilityCard>
): void {
  const existing = getCard(db, id);
  if (!existing) {
    throw new AgentBnBError(`Card not found: ${id}`, 'NOT_FOUND');
  }
  if (existing.owner !== owner) {
    throw new AgentBnBError('Forbidden: you do not own this card', 'FORBIDDEN');
  }

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updated_at: now };

  const parsed = AnyCardSchema.safeParse(merged);
  if (!parsed.success) {
    throw new AgentBnBError(
      `Card validation failed: ${parsed.error.message}`,
      'VALIDATION_ERROR'
    );
  }

  const stmt = db.prepare(`
    UPDATE capability_cards
    SET data = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(JSON.stringify(parsed.data), now, id);
}

/**
 * Deletes a CapabilityCard by ID. Verifies owner before deleting.
 *
 * @param db - Open database instance.
 * @param id - UUID of the card to delete.
 * @param owner - The requester's owner identifier (must match stored owner).
 * @throws {AgentBnBError} with code FORBIDDEN if owner does not match.
 * @throws {AgentBnBError} with code NOT_FOUND if card does not exist.
 */
export function deleteCard(db: Database.Database, id: string, owner: string): void {
  const existing = getCard(db, id);
  if (!existing) {
    throw new AgentBnBError(`Card not found: ${id}`, 'NOT_FOUND');
  }
  if (existing.owner !== owner) {
    throw new AgentBnBError('Forbidden: you do not own this card', 'FORBIDDEN');
  }

  db.prepare('DELETE FROM capability_cards WHERE id = ?').run(id);
}

/**
 * Updates the reputation metadata of a CapabilityCard using Exponentially Weighted Averages (EWA).
 *
 * Updates both `success_rate` and `avg_latency_ms` in the card's metadata using an
 * alpha of 0.1. If no prior reputation exists, bootstraps from the observed values.
 * If the card does not exist, returns silently (no-op). All other metadata fields
 * (apis_used, tags) are preserved.
 *
 * @param db - Open database instance.
 * @param cardId - UUID of the card to update.
 * @param success - Whether the capability execution succeeded.
 * @param latencyMs - Observed execution latency in milliseconds.
 */
export function updateReputation(
  db: Database.Database,
  cardId: string,
  success: boolean,
  latencyMs: number
): void {
  const existing = getCard(db, cardId);
  if (!existing) return;

  const ALPHA = 0.1;
  const observed = success ? 1.0 : 0.0;

  const prevSuccessRate = existing.metadata?.success_rate;
  const prevLatency = existing.metadata?.avg_latency_ms;

  const newSuccessRate =
    prevSuccessRate === undefined
      ? observed
      : ALPHA * observed + (1 - ALPHA) * prevSuccessRate;

  const newLatency =
    prevLatency === undefined
      ? latencyMs
      : ALPHA * latencyMs + (1 - ALPHA) * prevLatency;

  const now = new Date().toISOString();
  const updatedMetadata = {
    ...existing.metadata,
    success_rate: Math.round(newSuccessRate * 1000) / 1000,
    avg_latency_ms: Math.round(newLatency),
  };

  const updatedCard = { ...existing, metadata: updatedMetadata, updated_at: now };

  const stmt = db.prepare(`
    UPDATE capability_cards
    SET data = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(JSON.stringify(updatedCard), now, cardId);
}

/**
 * Updates the online availability flag for a specific skill on a v2.0 card.
 *
 * Uses raw JSON read/mutate/write pattern to avoid Zod v1.0 validation rejection
 * of v2.0 card shapes. Only the target skill's availability.online field is modified;
 * sibling skills are left unchanged.
 *
 * No-op if cardId or skillId is not found.
 *
 * @param db - Open database instance.
 * @param cardId - UUID of the capability card containing the skill.
 * @param skillId - ID of the specific skill to update.
 * @param online - New availability online value to set.
 */
export function updateSkillAvailability(
  db: Database.Database,
  cardId: string,
  skillId: string,
  online: boolean
): void {
  const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as
    | { data: string }
    | undefined;
  if (!row) return;

  const card = JSON.parse(row.data) as Record<string, unknown>;
  const skills = card['skills'] as Array<Record<string, unknown>> | undefined;
  if (!skills) return;

  const skill = skills.find((s) => s['id'] === skillId);
  if (!skill) return;

  const existing = (skill['availability'] as Record<string, unknown> | undefined) ?? {};
  skill['availability'] = { ...existing, online };

  const now = new Date().toISOString();
  db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(card),
    now,
    cardId
  );
}

/**
 * Persists the computed idle_rate (and timestamp) to a skill's _internal field.
 *
 * Uses raw JSON read/mutate/write pattern to avoid Zod v1.0 validation rejection
 * of v2.0 card shapes. Merges into any existing _internal keys so pre-existing
 * fields are never clobbered.
 *
 * No-op if cardId or skillId is not found.
 *
 * @param db - Open database instance.
 * @param cardId - UUID of the capability card containing the skill.
 * @param skillId - ID of the specific skill to update.
 * @param idleRate - Computed idle rate value (0.0–1.0) to persist.
 */
export function updateSkillIdleRate(
  db: Database.Database,
  cardId: string,
  skillId: string,
  idleRate: number
): void {
  const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as
    | { data: string }
    | undefined;
  if (!row) return;

  const card = JSON.parse(row.data) as Record<string, unknown>;
  const skills = card['skills'] as Array<Record<string, unknown>> | undefined;
  if (!skills) return;

  const skill = skills.find((s) => s['id'] === skillId);
  if (!skill) return;

  const existing = (skill['_internal'] as Record<string, unknown> | undefined) ?? {};
  skill['_internal'] = {
    ...existing,
    idle_rate: idleRate,
    idle_rate_computed_at: new Date().toISOString(),
  };

  const now = new Date().toISOString();
  db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(card),
    now,
    cardId
  );
}

/**
 * Lists CapabilityCards, optionally filtered by owner.
 *
 * @param db - Open database instance.
 * @param owner - Optional owner filter. If omitted, returns all cards.
 * @returns Array of CapabilityCard objects.
 */
export function listCards(db: Database.Database, owner?: string): CapabilityCard[] {
  let stmt: Database.Statement;
  let rows: Array<{ data: string }>;

  if (owner !== undefined) {
    stmt = db.prepare('SELECT data FROM capability_cards WHERE owner = ?');
    rows = stmt.all(owner) as Array<{ data: string }>;
  } else {
    stmt = db.prepare('SELECT data FROM capability_cards');
    rows = stmt.all() as Array<{ data: string }>;
  }

  return rows.map((row) => JSON.parse(row.data) as CapabilityCard);
}

/**
 * Returns all Capability Cards (v1.0 or v2.0) where the card's top-level
 * `capability_type` field exactly matches the given value.
 *
 * Uses SQLite json_extract for an exact-match lookup — does NOT use FTS5.
 * Returns an empty array when no cards match.
 *
 * @param db - Open database instance.
 * @param capabilityType - Exact value to match (e.g. 'task_decomposition').
 * @returns Array of AnyCard objects.
 */
export function getCardsByCapabilityType(
  db: Database.Database,
  capabilityType: string,
): AnyCard[] {
  const rows = db
    .prepare(
      "SELECT data FROM capability_cards WHERE json_extract(data, '$.capability_type') = ?"
    )
    .all(capabilityType) as Array<{ data: string }>;
  return rows.map((row) => JSON.parse(row.data) as AnyCard);
}

/**
 * Returns all Capability Cards (v2.0) where any skill in the skills[] array
 * has the given capability type in its `capability_type` or `capability_types[]` field.
 *
 * This enables skill-level precision routing: a Conductor looking for 'tts' will find
 * a card that has a skill with capability_types: ['tts', 'audio_gen'] rather than
 * requiring a card-level capability_type match.
 *
 * Falls back to in-memory filtering (safe for local registry sizes).
 *
 * @param db - Open database instance.
 * @param capabilityType - Capability type to search for (e.g. 'tts').
 * @returns Array of matching AnyCard objects.
 */
export function getCardsBySkillCapability(
  db: Database.Database,
  capabilityType: string,
): AnyCard[] {
  const rows = db
    .prepare('SELECT data FROM capability_cards')
    .all() as Array<{ data: string }>;

  return rows
    .map((row) => JSON.parse(row.data) as AnyCard)
    .filter((card) => {
      const skills = (card as Record<string, unknown>)['skills'] as
        | Array<Record<string, unknown>>
        | undefined;
      if (!skills) return false;
      return skills.some((skill) => {
        if (skill['capability_type'] === capabilityType) return true;
        const types = skill['capability_types'] as string[] | undefined;
        return Array.isArray(types) && types.includes(capabilityType);
      });
    });
}
