import type Database from 'better-sqlite3';
import type { CapabilityCard } from '../types/index.js';

/**
 * Filters for capability card search.
 */
export interface SearchFilters {
  /** Filter to a specific capability level: 1 (Atomic), 2 (Pipeline), 3 (Environment). */
  level?: 1 | 2 | 3;
  /** Filter by online availability. */
  online?: boolean;
  /** Filter cards that use all of the specified APIs. */
  apis_used?: string[];
}

/**
 * Searches CapabilityCards using FTS5 full-text search with optional filters.
 * Results are ranked by BM25 relevance score (most relevant first).
 * Returns up to 50 results.
 *
 * @param db - Open database instance.
 * @param query - Full-text search query string.
 * @param filters - Optional filters for level, online status, and apis_used.
 * @returns Array of matching CapabilityCard objects sorted by relevance.
 */
export function searchCards(
  db: Database.Database,
  query: string,
  filters: SearchFilters = {}
): CapabilityCard[] {
  // Build FTS5 MATCH query — wrap each word in double-quotes to treat as phrase
  // tokens. This prevents FTS5 from interpreting hyphens, *, etc. as operators.
  const words = query
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/"/g, ''))
    .filter((w) => w.length > 0);
  if (words.length === 0) return [];

  // Each word is quoted so special chars are treated as literals inside the token
  const ftsQuery = words.map((w) => `"${w}"`).join(' OR ');

  // Build filter conditions on the main table joined via rowid
  const conditions: string[] = [];
  const params: (string | number)[] = [ftsQuery];

  if (filters.level !== undefined) {
    conditions.push(`json_extract(cc.data, '$.level') = ?`);
    params.push(filters.level);
  }

  if (filters.online !== undefined) {
    conditions.push(`json_extract(cc.data, '$.availability.online') = ?`);
    params.push(filters.online ? 1 : 0);
  }

  const whereClause =
    conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT cc.data
    FROM capability_cards cc
    JOIN cards_fts ON cc.rowid = cards_fts.rowid
    WHERE cards_fts MATCH ?
      ${whereClause}
    ORDER BY bm25(cards_fts)
    LIMIT 50
  `;

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{ data: string }>;

  const results = rows.map((row) => JSON.parse(row.data) as CapabilityCard);

  // Post-filter by apis_used if specified (not easily done in FTS5 query)
  if (filters.apis_used && filters.apis_used.length > 0) {
    const requiredApis = filters.apis_used;
    return results.filter((card) => {
      const cardApis = card.metadata?.apis_used ?? [];
      return requiredApis.every((api) => cardApis.includes(api));
    });
  }

  return results;
}

/**
 * Browses CapabilityCards by structured filters without a text query.
 * Useful for listing/browsing all capabilities by level or availability.
 *
 * @param db - Open database instance.
 * @param filters - Filters: level, online status.
 * @returns Array of matching CapabilityCard objects.
 */
export function filterCards(
  db: Database.Database,
  filters: Pick<SearchFilters, 'level' | 'online'>
): CapabilityCard[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.level !== undefined) {
    conditions.push(`json_extract(data, '$.level') = ?`);
    params.push(filters.level);
  }

  if (filters.online !== undefined) {
    conditions.push(`json_extract(data, '$.availability.online') = ?`);
    params.push(filters.online ? 1 : 0);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `SELECT data FROM capability_cards ${whereClause}`;
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{ data: string }>;

  return rows.map((row) => JSON.parse(row.data) as CapabilityCard);
}
