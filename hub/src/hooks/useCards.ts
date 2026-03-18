/**
 * useCards — Data fetching hook for the AgentBnB Hub page.
 *
 * Manages search/filter/sort state, fetches from /cards API, polls every 30s,
 * and computes derived stats and available categories.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { inferCategories } from '../lib/categories.js';
import type { Category, HubCard, SortOption } from '../types.js';

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 300;

/**
 * Normalize a v2.0 API card (with skills[]) into HubCard shapes.
 * Each skill becomes its own HubCard so all skills are visible in the grid.
 * v1.0 cards pass through unchanged.
 */
function normalizeCard(raw: Record<string, unknown>, usesMap?: Record<string, number>): HubCard[] {
  // v2.0 card with skills[] array — one HubCard per skill
  if (raw.skills && Array.isArray(raw.skills) && raw.skills.length > 0) {
    return (raw.skills as Record<string, unknown>[]).map((skill) => {
      const skillId = (skill.id as string) || (raw.id as string);
      return {
        id: skillId,
        owner: raw.owner as string,
        name: (skill.name as string) || (raw.name as string) || 'Unknown',
        description: (skill.description as string) || '',
        level: (skill.level as 1 | 2 | 3) || 1,
        inputs: (skill.inputs as HubCard['inputs']) || [],
        outputs: (skill.outputs as HubCard['outputs']) || [],
        pricing: (skill.pricing as HubCard['pricing']) || { credits_per_call: 0 },
        availability: (skill.availability as HubCard['availability']) || (raw.availability as HubCard['availability']) || { online: false },
        powered_by: (skill.powered_by as HubCard['powered_by']) || (raw.powered_by as HubCard['powered_by']),
        metadata: (skill.metadata as HubCard['metadata']) || (raw.metadata as HubCard['metadata']),
        uses_this_week: usesMap?.[skillId] ?? usesMap?.[raw.id as string] ?? undefined,
      };
    });
  }
  // v1.0 card — already in HubCard shape
  const card = raw as unknown as HubCard;
  return [{ ...card, uses_this_week: usesMap?.[card.id] ?? undefined }];
}

interface UseCardsResult {
  // Data
  cards: HubCard[];
  total: number;
  loading: boolean;
  error: string | null;
  // Filter state
  query: string;
  setQuery: (q: string) => void;
  level: number | null;
  setLevel: (l: number | null) => void;
  category: string | null;
  setCategory: (c: string | null) => void;
  onlineOnly: boolean;
  setOnlineOnly: (v: boolean) => void;
  // Sort state
  sort: SortOption;
  setSort: (s: SortOption) => void;
  // Derived
  availableCategories: Category[];
  retry: () => void;
  // Stats
  agentsOnline: number;
  totalCapabilities: number;
  totalExchanges: number;
}

/**
 * Fetches capability cards from the /cards API with search, filter, sort, and 30s polling.
 *
 * Category filtering is client-side (the API has no category param).
 * Search query is debounced at 300ms.
 * Stats are derived from fetched cards (agentsOnline = unique online owners).
 */
export function useCards(): UseCardsResult {
  const [allCards, setAllCards] = useState<HubCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [level, setLevel] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>('popular');

  // Track whether this is the initial fetch
  const isFirstFetch = useRef(true);

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchCards = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
      if (level !== null) params.set('level', String(level));
      if (onlineOnly) params.set('online', 'true');
      params.set('sort', sort);
      params.set('limit', '100');

      const url = `/cards?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Registry returned ${res.status}`);
      }
      const data = await res.json() as {
        total: number;
        limit: number;
        offset: number;
        items: Record<string, unknown>[];
        uses_this_week?: Record<string, number>;
      };
      const usesMap = data.uses_this_week ?? {};
      setAllCards(data.items.flatMap((item) => normalizeCard(item, usesMap)));
      setTotal(data.total);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Registry unreachable: ${msg}`);
      // Keep existing cards on error (graceful degradation)
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, [debouncedQuery, level, onlineOnly, sort]);

  // Fetch on mount and when filters change
  useEffect(() => {
    isFirstFetch.current = true;
    setLoading(true);
    void fetchCards();
  }, [fetchCards]);

  // Poll every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchCards();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCards]);

  // Client-side category filter
  const cards =
    category === null
      ? allCards
      : allCards.filter((card) => {
          const { categories } = inferCategories(card.metadata);
          return categories.some((c) => c.id === category);
        });

  // Available categories from ALL fetched cards (before client-side filter)
  const availableCategories: Category[] = useMemo(() => {
    const seen = new Set<string>();
    const result: Category[] = [];
    for (const card of allCards) {
      const { categories } = inferCategories(card.metadata);
      for (const cat of categories) {
        if (!seen.has(cat.id)) {
          seen.add(cat.id);
          result.push(cat);
        }
      }
    }
    return result;
  }, [allCards]);

  // Stats — fetch from /api/stats for accurate counts
  const [stats, setStats] = useState({ agents_online: 0, total_capabilities: 0, total_exchanges: 0 });
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          const data = await res.json() as { agents_online: number; total_capabilities: number; total_exchanges: number };
          setStats({ agents_online: data.agents_online, total_capabilities: data.total_capabilities, total_exchanges: data.total_exchanges });
        }
      } catch { /* graceful degradation */ }
    };
    void fetchStats();
    const interval = setInterval(() => { void fetchStats(); }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Fallback: use card data for online count if stats endpoint unavailable
  const agentsOnline = stats.agents_online || new Set(
    allCards.filter((c) => c.availability.online).map((c) => c.owner),
  ).size;
  const totalCapabilities = stats.total_capabilities || total;
  const totalExchanges = stats.total_exchanges;

  const retry = useCallback(() => {
    setLoading(true);
    isFirstFetch.current = true;
    void fetchCards();
  }, [fetchCards]);

  return {
    cards,
    total,
    loading,
    error,
    query,
    setQuery,
    level,
    setLevel,
    category,
    setCategory,
    onlineOnly,
    setOnlineOnly,
    sort,
    setSort,
    availableCategories,
    retry,
    agentsOnline,
    totalCapabilities,
    totalExchanges,
  };
}
