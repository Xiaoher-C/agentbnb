/**
 * useCards — Data fetching hook for the AgentBnB Hub page.
 *
 * Manages search/filter/sort state, fetches from /cards API, polls every 30s,
 * and computes derived stats and available categories.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { inferCategories } from '../lib/categories.js';
import { normalizeCard } from '../lib/normalize-card.js';
import type { Category, HubCard, SortOption } from '../types.js';

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 300;
const PAGE_SIZE = 12;

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
  minSuccessRate: number | null;
  setMinSuccessRate: (v: number | null) => void;
  verifiedOnly: boolean;
  setVerifiedOnly: (v: boolean) => void;
  capabilityType: string;
  setCapabilityType: (v: string) => void;
  // Sort state
  sort: SortOption;
  setSort: (s: SortOption) => void;
  // Pagination
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  filteredTotal: number;
  // Derived
  availableCategories: Category[];
  retry: () => void;
  // Stats (Hub v2: includes executions_7d + verifiedProviders)
  agentsOnline: number;
  totalCapabilities: number;
  totalExchanges: number;
  executions7d: number;
  verifiedProviders: number;
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
  const [minSuccessRate, setMinSuccessRate] = useState<number | null>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [capabilityType, setCapabilityType] = useState('');
  const [sort, setSort] = useState<SortOption>('popular');
  const [page, setPage] = useState(1);

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
      if (minSuccessRate !== null) params.set('min_success_rate', String(minSuccessRate));
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
  }, [debouncedQuery, level, onlineOnly, minSuccessRate, sort]);

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

  // Client-side filters: category + minSuccessRate + verifiedOnly + capabilityType
  const filteredCards = allCards.filter((card) => {
    if (category !== null) {
      const { categories } = inferCategories(card.metadata);
      if (!categories.some((c) => c.id === category)) return false;
    }
    if (minSuccessRate !== null) {
      const rate = card.metadata?.success_rate ?? 0;
      if (rate < minSuccessRate) return false;
    }
    // verifiedOnly: filter by metadata tag "verified" (Phase 1 approximation)
    if (verifiedOnly) {
      const tags = card.metadata?.tags ?? [];
      if (!tags.includes('verified')) return false;
    }
    // capabilityType: substring match against any capability_types entry
    if (capabilityType.trim() !== '') {
      const needle = capabilityType.trim().toLowerCase();
      const haystack = card.capability_types ?? [];
      if (!haystack.some((ct) => ct.toLowerCase().includes(needle))) return false;
    }
    return true;
  });

  // Paginate the filtered results
  const filteredTotal = filteredCards.length;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  // Reset to page 1 when filters change (but don't add to deps — handled via setPage in setters)
  const clampedPage = Math.min(page, totalPages);
  const cards = filteredCards.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

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

  // Stats — fetch from /api/stats for accurate counts (Hub v2: includes executions_7d + verified_providers_count)
  const [stats, setStats] = useState({
    agents_online: 0,
    total_capabilities: 0,
    total_exchanges: 0,
    executions_7d: 0,
    verified_providers_count: 0,
  });
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          const data = await res.json() as {
            agents_online: number;
            total_capabilities: number;
            total_exchanges: number;
            executions_7d?: number;
            verified_providers_count?: number;
          };
          setStats({
            agents_online: data.agents_online,
            total_capabilities: data.total_capabilities,
            total_exchanges: data.total_exchanges,
            executions_7d: data.executions_7d ?? 0,
            verified_providers_count: data.verified_providers_count ?? 0,
          });
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
  const executions7d = stats.executions_7d;
  const verifiedProviders = stats.verified_providers_count;

  const retry = useCallback(() => {
    setLoading(true);
    isFirstFetch.current = true;
    void fetchCards();
  }, [fetchCards]);

  // Wrappers that reset page to 1 on filter changes
  const setQueryAndReset = useCallback((q: string) => { setQuery(q); setPage(1); }, []);
  const setLevelAndReset = useCallback((l: number | null) => { setLevel(l); setPage(1); }, []);
  const setCategoryAndReset = useCallback((c: string | null) => { setCategory(c); setPage(1); }, []);
  const setOnlineOnlyAndReset = useCallback((v: boolean) => { setOnlineOnly(v); setPage(1); }, []);
  const setMinSuccessRateAndReset = useCallback((v: number | null) => { setMinSuccessRate(v); setPage(1); }, []);
  const setVerifiedOnlyAndReset = useCallback((v: boolean) => { setVerifiedOnly(v); setPage(1); }, []);
  const setCapabilityTypeAndReset = useCallback((v: string) => { setCapabilityType(v); setPage(1); }, []);
  const setSortAndReset = useCallback((s: SortOption) => { setSort(s); setPage(1); }, []);

  return {
    cards,
    total,
    loading,
    error,
    query,
    setQuery: setQueryAndReset,
    level,
    setLevel: setLevelAndReset,
    category,
    setCategory: setCategoryAndReset,
    onlineOnly,
    setOnlineOnly: setOnlineOnlyAndReset,
    minSuccessRate,
    setMinSuccessRate: setMinSuccessRateAndReset,
    verifiedOnly,
    setVerifiedOnly: setVerifiedOnlyAndReset,
    capabilityType,
    setCapabilityType: setCapabilityTypeAndReset,
    sort,
    setSort: setSortAndReset,
    page: clampedPage,
    setPage,
    totalPages,
    filteredTotal,
    availableCategories,
    retry,
    agentsOnline,
    totalCapabilities,
    totalExchanges,
    executions7d,
    verifiedProviders,
  };
}
