/**
 * useRentableAgents — v10 Discovery hook.
 *
 * Fetches the agent profile list from `GET /api/agents` and maps each row into
 * a RentableAgent shape suitable for `AgentProfileCard` rendering.
 *
 * The dedicated `/api/agents/:id/maturity-evidence` endpoint is being added in
 * unit D1 in parallel — until that lands, we synthesise an `evidence`
 * structure from the per-agent aggregate fields (`skill_count`, `success_rate`,
 * `total_earned`, `member_since`) plus the capability cards already returned
 * by the existing endpoints.
 *
 * v10 contract (ADR-022): we MUST surface evidence as discrete categories — we
 * do NOT collapse maturity into a single score.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProfile, HubCard } from '../types.js';

const POLL_INTERVAL_MS = 30_000;

/**
 * Per-category maturity evidence (ADR-022).
 *
 * Each field tracks one observable signal — UI is free to render any subset
 * but should never collapse the union into a single number. `null` means
 * "we don't have data for this category yet" (different from 0).
 */
export interface MaturityEvidence {
  /** Sessions that ran on the AgentBnB platform (observed by us). */
  platform_sessions: number | null;
  /** Discrete tasks the agent has completed. */
  completed_tasks: number | null;
  /** Distinct renters who came back. */
  repeat_renters: number | null;
  /** Public outcome share tokens (max 3 surfaced). */
  artifact_examples: string[];
  /** Tools/skills the agent has been observed to use successfully. */
  verified_tools: string[];
  /** Aggregate success rate (0..1). null if no runs yet. */
  response_reliability: number | null;
  /** Aggregate renter rating (0..5). null if no rating yet. */
  renter_rating: number | null;
}

/**
 * Pricing for a single agent. Either per-minute or per-session is mandatory
 * — fall back to per-message if the upstream card only specifies that.
 */
export interface RentablePricing {
  per_minute?: number;
  per_message?: number;
  per_session?: number;
}

/**
 * Public availability slot. v10 backend may not expose this yet — empty array
 * is the legitimate fallback and the UI must tolerate it.
 */
export interface AvailabilitySlot {
  /** Human-readable label e.g. "Weekdays 9–17 UTC+8". */
  label: string;
  starts_at?: string;
  ends_at?: string;
}

export interface RentableAgent {
  /** DID-like agent identifier (uses owner DID for now). */
  agent_id: string;
  /** Display name of the agent. */
  name: string;
  /** Owner DID — same as renter contract counterparty. */
  owner_did: string;
  /** Short tagline / short_description. */
  tagline: string;
  /** Star rating (0..5) or null if no ratings yet. */
  rating: number | null;
  /** Runtime adapter: 'hermes' for the v10 canonical supply, 'openclaw' for legacy. */
  runtime: 'hermes' | 'openclaw' | 'unknown';
  /** When the agent first appeared. */
  member_since: string;
  evidence: MaturityEvidence;
  /** Public outcome share tokens — clicking surfaces /o/:share_token (max 3). */
  recent_outcomes: string[];
  availability: AvailabilitySlot[];
  pricing: RentablePricing;
  /** Skill / capability tags — demoted from primary to secondary surface. */
  tags: string[];
}

interface UseRentableAgentsResult {
  agents: RentableAgent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface AgentsApiResponse {
  items: AgentProfile[];
  total: number;
}

/** Tags pulled from raw HubCard metadata — used only when we have a card to mine. */
function extractTagsFromCard(card: HubCard): string[] {
  const fromMeta = card.metadata?.tags ?? [];
  const fromCaps = card.capability_types ?? [];
  return Array.from(new Set([...fromMeta, ...fromCaps])).slice(0, 8);
}

/**
 * Build a per-minute price from a HubCard. Uses `pricing.credits_per_minute`
 * directly when available; otherwise approximates from `credits_per_call`
 * (heuristic: ~1 minute per call is "fine for now" until backend exposes
 * dedicated rental pricing).
 */
function deriveMinutePrice(card: HubCard | undefined): number | undefined {
  if (!card) return undefined;
  const perMin = card.pricing.credits_per_minute;
  if (typeof perMin === 'number' && perMin > 0) return perMin;
  const perCall = card.pricing.credits_per_call;
  if (typeof perCall === 'number' && perCall > 0) return perCall;
  return undefined;
}

/**
 * Transform an AgentProfile (+ optional HubCards) into a RentableAgent.
 * Pure function — no fetching, easy to unit-test.
 */
export function buildRentableAgent(
  profile: AgentProfile,
  cards: HubCard[] = [],
): RentableAgent {
  const ownerCards = cards.filter((c) => c.owner === profile.owner);
  const primaryCard = ownerCards[0];

  const tagSet = new Set<string>();
  for (const card of ownerCards) {
    for (const t of extractTagsFromCard(card)) tagSet.add(t);
  }
  const tags = Array.from(tagSet).slice(0, 8);

  const verifiedTools = ownerCards
    .flatMap((c) => c.metadata?.apis_used ?? [])
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const minutePrice = deriveMinutePrice(primaryCard);

  return {
    agent_id: profile.agent_id ?? profile.owner,
    name: primaryCard?.name ?? profile.owner,
    owner_did: profile.owner,
    tagline: primaryCard?.description?.slice(0, 120) ?? '',
    rating: null, // TODO(D1): wire from /api/agents/:id/maturity-evidence
    runtime: 'unknown', // TODO(D1): backend hasn't exposed runtime label yet
    member_since: profile.member_since,
    // TODO(D1): wire platform_sessions / completed_tasks / repeat_renters /
    // renter_rating / recent_outcomes from /api/agents/:id/maturity-evidence.
    evidence: {
      platform_sessions: null,
      completed_tasks: null,
      repeat_renters: null,
      artifact_examples: [],
      verified_tools: verifiedTools,
      response_reliability: profile.success_rate,
      renter_rating: null,
    },
    recent_outcomes: [],
    availability: [],
    pricing: minutePrice !== undefined ? { per_minute: minutePrice } : {},
    tags,
  };
}

/**
 * Fetch the rentable agent list and poll every 30s. Mirrors the pattern in
 * `useAgents`/`useCards` (`isFirstFetch` ref keeps existing data on errors).
 *
 * Optional `cards` lets the caller pass HubCards from `useCards()` so we can
 * enrich each agent with tags/runtime without a second network round-trip.
 */
export function useRentableAgents(cards: HubCard[] = []): UseRentableAgentsResult {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFirstFetch = useRef(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as AgentsApiResponse;
      setProfiles(data.items);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load agents: ${msg}`);
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isFirstFetch.current = true;
    setLoading(true);
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const id = setInterval(() => void fetchAgents(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAgents]);

  const agents = useMemo(
    () => profiles.map((p) => buildRentableAgent(p, cards)),
    [profiles, cards],
  );

  return { agents, loading, error, refetch: fetchAgents };
}
