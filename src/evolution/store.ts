import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { TemplateEvolution } from './schema.js';

/**
 * Creates the evolution_versions table and its index in the given database
 * if they do not already exist. Safe to call multiple times (CREATE IF NOT EXISTS).
 *
 * @param db - Open database instance (WAL mode already set by caller).
 */
export function initEvolutionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_versions (
      id TEXT PRIMARY KEY,
      template_name TEXT NOT NULL,
      template_version TEXT NOT NULL,
      publisher_agent TEXT NOT NULL,
      changelog TEXT NOT NULL,
      core_memory_snapshot TEXT NOT NULL,
      fitness_improvement REAL NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS evolution_template_idx
      ON evolution_versions(template_name, created_at DESC);
  `);
}

/**
 * Inserts a TemplateEvolution record into the evolution_versions table.
 * Generates and returns a new UUID as the evolution record id.
 *
 * @param db - Open database instance.
 * @param ev - Validated evolution data to insert.
 * @returns The generated id UUID string.
 */
export function insertEvolution(db: Database.Database, ev: TemplateEvolution): string {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO evolution_versions (
      id, template_name, template_version, publisher_agent,
      changelog, core_memory_snapshot, fitness_improvement, timestamp, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ev.template_name,
    ev.template_version,
    ev.publisher_agent,
    ev.changelog,
    JSON.stringify(ev.core_memory_snapshot),
    ev.fitness_improvement,
    ev.timestamp,
    now,
  );

  return id;
}

/**
 * Retrieves the most recently created evolution record for a given template name.
 *
 * @param db - Open database instance.
 * @param templateName - Template name to query (e.g. "genesis-template").
 * @returns The latest TemplateEvolution, or null if none exists.
 */
export function getLatestEvolution(
  db: Database.Database,
  templateName: string,
): TemplateEvolution | null {
  const row = db.prepare(`
    SELECT * FROM evolution_versions
    WHERE template_name = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(templateName) as Record<string, unknown> | undefined;

  if (!row) return null;
  return rowToEvolution(row);
}

/**
 * Retrieves the evolution history for a given template name, ordered by newest first.
 *
 * @param db - Open database instance.
 * @param templateName - Template name to query.
 * @param limit - Maximum number of records to return (default 20).
 * @returns Array of TemplateEvolution objects ordered by created_at DESC.
 */
export function getEvolutionHistory(
  db: Database.Database,
  templateName: string,
  limit = 20,
): TemplateEvolution[] {
  const rows = db.prepare(`
    SELECT * FROM evolution_versions
    WHERE template_name = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(templateName, limit) as Array<Record<string, unknown>>;

  return rows.map(rowToEvolution);
}

/**
 * Converts a raw SQLite row to a TemplateEvolution object.
 * core_memory_snapshot is stored as JSON and is parsed back to an array.
 *
 * @param row - Raw database row from evolution_versions.
 * @returns TemplateEvolution object.
 */
function rowToEvolution(row: Record<string, unknown>): TemplateEvolution {
  return {
    template_name: row['template_name'] as string,
    template_version: row['template_version'] as string,
    publisher_agent: row['publisher_agent'] as string,
    changelog: row['changelog'] as string,
    core_memory_snapshot: JSON.parse(row['core_memory_snapshot'] as string) as TemplateEvolution['core_memory_snapshot'],
    fitness_improvement: row['fitness_improvement'] as number,
    timestamp: row['timestamp'] as string,
  };
}
