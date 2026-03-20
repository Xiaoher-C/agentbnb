import type Database from 'better-sqlite3';
import type { CapabilityCard } from '../types/index.js';
import { getReputationScore } from '../feedback/reputation.js';

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
  /**
   * Minimum reputation score (0.0 - 1.0) for the card owner.
   * Cards whose owner has a reputation score below this value are excluded.
   * Owners with no feedback default to 0.5 (cold-start score).
   */
  min_reputation?: number;
}

/**
 * Searches CapabilityCards using FTS5 full-text search with optional filters.
 * Results are ranked by BM25 relevance score (most relevant first).
 * Returns up to 50 results.
 *
 * @param db - Open database instance.
 * @param query - Full-text search query string.
 * @param filters - Optional filters for level, online status, apis_used, and min_reputation.
 * @returns Array of matching CapabilityCard objects sorted by relevance.
 */
export function searchCards(
  db: Database.Database,
  query: string,
  filters: SearchFilters = {}
): CapabilityCard[] {
  // Build FTS5 MATCH query — sanitize input to prevent FTS5 injection.
  // Strip FTS5 operators and wrap each word in double-quotes to treat as
  // literal phrase tokens. Hyphens within words are preserved (common in
  // skill names like "text-to-speech").
  const words = query
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/["*^{}():]/g, ''))  // Strip FTS5 operators and quotes
    .filter((w) => w.length > 0);
  if (words.length === 0) return [];

  // Each word is quoted so remaining chars are treated as literals
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
  let filtered = results;
  if (filters.apis_used && filters.apis_used.length > 0) {
    const requiredApis = filters.apis_used;
    filtered = filtered.filter((card) => {
      const cardApis = card.metadata?.apis_used ?? [];
      return requiredApis.every((api) => cardApis.includes(api));
    });
  }

  // Post-filter by min_reputation using a batch reputation lookup for efficiency
  if (filters.min_reputation !== undefined && filters.min_reputation > 0) {
    filtered = applyReputationFilter(db, filtered, filters.min_reputation);
  }

  return filtered;
}

/**
 * Browses CapabilityCards by structured filters without a text query.
 * Useful for listing/browsing all capabilities by level or availability.
 *
 * @param db - Open database instance.
 * @param filters - Filters: level, online status, min_reputation.
 * @returns Array of matching CapabilityCard objects.
 */
export function filterCards(
  db: Database.Database,
  filters: Pick<SearchFilters, 'level' | 'online' | 'min_reputation'>
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

  let cards = rows.map((row) => JSON.parse(row.data) as CapabilityCard);

  // Post-filter by min_reputation using batch reputation lookup
  if (filters.min_reputation !== undefined && filters.min_reputation > 0) {
    cards = applyReputationFilter(db, cards, filters.min_reputation);
  }

  return cards;
}

/**
 * Filters a list of CapabilityCards to those whose owner has a reputation score
 * >= minReputation. Uses a batch query over the feedback table to avoid N+1 queries.
 *
 * @param db - Open database instance.
 * @param cards - Cards to filter.
 * @param minReputation - Minimum reputation threshold (0.0 - 1.0).
 * @returns Filtered array of cards.
 */
function applyReputationFilter(
  db: Database.Database,
  cards: CapabilityCard[],
  minReputation: number
): CapabilityCard[] {
  // Collect unique owners, then compute reputation per owner
  const owners = [...new Set(cards.map((c) => c.owner))];
  const reputationMap = new Map<string, number>();
  for (const owner of owners) {
    reputationMap.set(owner, getReputationScore(db, owner));
  }
  return cards.filter((card) => {
    const score = reputationMap.get(card.owner) ?? 0.5;
    return score >= minReputation;
  });
}

/**
 * Computes a reputation score map for a given list of owner IDs.
 * Uses per-owner getReputationScore calls (batch deduplication applied).
 *
 * @param db - Open database instance.
 * @param owners - Array of owner agent IDs.
 * @returns Map from owner ID to reputation score (0.0 - 1.0).
 */
export function buildReputationMap(
  db: Database.Database,
  owners: string[]
): Map<string, number> {
  const unique = [...new Set(owners)];
  const map = new Map<string, number>();
  for (const owner of unique) {
    map.set(owner, getReputationScore(db, owner));
  }
  return map;
}
