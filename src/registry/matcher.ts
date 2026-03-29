import type Database from 'better-sqlite3';
import type { CapabilityCard } from '../types/index.js';
import { getReputationScore } from '../feedback/reputation.js';

// ---------------------------------------------------------------------------
// FTS5 search result cache — per-DB LRU with TTL
// ---------------------------------------------------------------------------

/** Maximum cached entries per database. */
const CACHE_MAX_ENTRIES = 100;
/** Cache TTL in milliseconds (30 seconds). */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  results: CapabilityCard[];
  expiresAt: number;
}

/** Per-database cache. WeakMap ensures GC when DB is closed. */
const dbCaches = new WeakMap<object, Map<string, CacheEntry>>();

function getDbCache(db: object): Map<string, CacheEntry> {
  let cache = dbCaches.get(db);
  if (!cache) {
    cache = new Map();
    dbCaches.set(db, cache);
  }
  return cache;
}

function cacheKey(query: string, filters: SearchFilters): string {
  return `${query}|${filters.level ?? ''}|${filters.online ?? ''}|${(filters.apis_used ?? []).join(',')}|${filters.min_reputation ?? ''}`;
}

function evictCache(cache: Map<string, CacheEntry>): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value as string;
    cache.delete(firstKey);
  }
}

/**
 * Clears the FTS5 search cache for a specific DB, or all caches if no DB given.
 */
export function clearSearchCache(db?: object): void {
  if (db) {
    dbCaches.get(db)?.clear();
  }
  // WeakMap doesn't support iteration, but callers can pass their DB ref
}

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
  // Check per-DB cache first
  const cache = getDbCache(db);
  const key = cacheKey(query, filters);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  const trimmedQuery = query.trim();
  const exactSkillMatches = findCardsByExactSkillId(db, trimmedQuery, filters);

  // Build FTS5 MATCH query — sanitize input to prevent FTS5 injection.
  // Strip FTS5 operators and wrap each word in double-quotes to treat as
  // literal phrase tokens. Hyphens within words are preserved (common in
  // skill names like "text-to-speech").
  const words = query
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/["*^{}():]/g, ''))  // Strip FTS5 operators and quotes
    .filter((w) => w.length > 0);
  if (words.length === 0) {
    return exactSkillMatches;
  }

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
  const mergedResults = mergeByCardId(exactSkillMatches, results);

  let filtered = mergedResults;
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

  // Store in per-DB cache
  evictCache(cache);
  cache.set(key, { results: filtered, expiresAt: Date.now() + CACHE_TTL_MS });

  return filtered;
}

function mergeByCardId(primary: CapabilityCard[], secondary: CapabilityCard[]): CapabilityCard[] {
  const seen = new Set<string>();
  const merged: CapabilityCard[] = [];

  for (const card of primary) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    merged.push(card);
  }

  for (const card of secondary) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    merged.push(card);
  }

  return merged;
}

function findCardsByExactSkillId(
  db: Database.Database,
  query: string,
  filters: SearchFilters,
): CapabilityCard[] {
  if (query.length === 0) return [];

  const rows = db.prepare('SELECT data FROM capability_cards').all() as Array<{ data: string }>;
  const cards = rows.map((row) => JSON.parse(row.data) as CapabilityCard);

  return cards.filter((card) => {
    if (filters.level !== undefined && card.level !== filters.level) return false;
    if (filters.online !== undefined && card.availability?.online !== filters.online) return false;

    const asRecord = card as Record<string, unknown>;
    const skills = asRecord['skills'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(skills)) return false;

    return skills.some((skill) => String(skill['id'] ?? '') === query);
  });
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
