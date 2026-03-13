import Database from 'better-sqlite3';
import { CapabilityCardSchema, AgentBnBError } from '../types/index.js';
import type { CapabilityCard } from '../types/index.js';

export type { Database };

/**
 * Opens a SQLite database at the given path (or in-memory if ':memory:').
 * Applies WAL mode, enables foreign keys, and runs schema migrations.
 *
 * @param path - File path or ':memory:' for in-memory. Defaults to ':memory:'.
 * @returns Opened Database instance.
 */
export function openDatabase(path = ':memory:'): Database.Database {
  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_cards (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      id UNINDEXED,
      owner,
      name,
      description,
      tags,
      content=capability_cards,
      content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON capability_cards BEGIN
      INSERT INTO cards_fts(rowid, id, owner, name, description, tags)
      VALUES (
        new.rowid,
        new.id,
        new.owner,
        json_extract(new.data, '$.name'),
        json_extract(new.data, '$.description'),
        COALESCE(
          (SELECT group_concat(value, ' ')
           FROM json_each(json_extract(new.data, '$.metadata.tags'))),
          ''
        )
      );
    END;

    CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON capability_cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, id, owner, name, description, tags)
      VALUES (
        'delete',
        old.rowid,
        old.id,
        old.owner,
        json_extract(old.data, '$.name'),
        json_extract(old.data, '$.description'),
        COALESCE(
          (SELECT group_concat(value, ' ')
           FROM json_each(json_extract(old.data, '$.metadata.tags'))),
          ''
        )
      );
      INSERT INTO cards_fts(rowid, id, owner, name, description, tags)
      VALUES (
        new.rowid,
        new.id,
        new.owner,
        json_extract(new.data, '$.name'),
        json_extract(new.data, '$.description'),
        COALESCE(
          (SELECT group_concat(value, ' ')
           FROM json_each(json_extract(new.data, '$.metadata.tags'))),
          ''
        )
      );
    END;

    CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON capability_cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, id, owner, name, description, tags)
      VALUES (
        'delete',
        old.rowid,
        old.id,
        old.owner,
        json_extract(old.data, '$.name'),
        json_extract(old.data, '$.description'),
        COALESCE(
          (SELECT group_concat(value, ' ')
           FROM json_each(json_extract(old.data, '$.metadata.tags'))),
          ''
        )
      );
    END;
  `);

  return db;
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

  const parsed = CapabilityCardSchema.safeParse(merged);
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
