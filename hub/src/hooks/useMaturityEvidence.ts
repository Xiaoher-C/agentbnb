/**
 * useMaturityEvidence — v10 Maturity Evidence (ADR-022).
 *
 * Fetches the per-agent evidence categories from
 * `GET /api/agents/:agent_id/maturity-evidence`. Per ADR-022 we surface
 * evidence as a small union of independently-meaningful signals — we NEVER
 * collapse them into a single score.
 *
 * Endpoint is public read (no auth) — uses plain `fetch`, matching the
 * pattern in `useDidDocument` and `useCredentials`. One-shot fetch on mount;
 * re-fetches when `agentId` changes. No polling — evidence is recomputed on
 * demand server-side and a stale tile for ~30s is fine.
 *
 * 404 (fresh agent / unknown id) is treated as a graceful empty state:
 * `evidence` resolves to `null` and the consumer renders an empty-state
 * affordance ("New to AgentBnB"). Network / 5xx errors are surfaced via
 * `error`.
 */
import { useCallback, useEffect, useState } from 'react';

/**
 * One row in `evidence_categories`. The backend emits this list flattened so
 * UI rendering can iterate without knowing each key. `kind` lets renderers
 * choose formatting (count vs rate vs avg vs list-length).
 */
export interface EvidenceCategory {
  key: string;
  value: number | string;
  kind: 'count' | 'rate' | 'avg' | 'list';
}

/** A single recent outcome share artefact surfaced on the Agent Profile. */
export interface ArtifactExample {
  /** Public share token — links to `#/o/${share_token}`. */
  share_token: string;
  /** Epoch ms (0 if upstream had no ended_at). */
  ended_at: number;
  /** Free-form short summary (defaults to "completed"). */
  summary: string;
}

/**
 * Maturity Evidence (ADR-022). Each field is an independent signal — UI
 * surfaces them as discrete rows. `null` means "no data yet" (distinct
 * from 0). Backend always emits every field, but the hook still permits
 * `null` for the rating average since "no ratings yet" is a real state.
 */
export interface MaturityEvidence {
  /** Sessions ended on the AgentBnB platform (status in 'closed'/'settled'). */
  platform_observed_sessions: number;
  /** Threads completed across the agent's sessions. */
  completed_tasks: number;
  /** Distinct renters with > 1 session for this agent. */
  repeat_renters: number;
  /** Top 3 most recent outcome share artefacts (newest first). */
  artifact_examples: ArtifactExample[];
  /** Distinct tools mentioned in the agent's cards (deduped, sorted). */
  verified_tools: string[];
  /** Share of clean session ends, 0..1. Falls back to request_log success rate. */
  response_reliability: number;
  /** Average renter star rating (1..5). `null` when no ratings yet. */
  renter_rating_avg: number | null;
  /** Number of ratings backing `renter_rating_avg`. */
  renter_rating_count: number;
}

interface MaturityEvidenceResponse {
  agent_id: string;
  evidence: MaturityEvidence;
  evidence_categories: EvidenceCategory[];
}

export interface UseMaturityEvidenceResult {
  /** Resolved evidence; `null` while loading or for 404 / fresh agents. */
  evidence: MaturityEvidence | null;
  /** Flattened category list for iterator-style UI rendering. */
  categories: EvidenceCategory[];
  loading: boolean;
  /** Network or 5xx error message; `null` for happy path AND for graceful 404. */
  error: string | null;
  /** Force a re-fetch (no-op when agentId is null/empty). */
  refetch: () => Promise<void>;
}

/**
 * Resolves Maturity Evidence for one agent. No-op when `agentId` is null/empty.
 *
 * @param agentId DID-like id, or `null` to skip the fetch entirely.
 */
export function useMaturityEvidence(agentId: string | null): UseMaturityEvidenceResult {
  const [evidence, setEvidence] = useState<MaturityEvidence | null>(null);
  const [categories, setCategories] = useState<EvidenceCategory[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(agentId));
  const [error, setError] = useState<string | null>(null);

  const fetchEvidence = useCallback(async (): Promise<void> => {
    if (!agentId) {
      setEvidence(null);
      setCategories([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/maturity-evidence`,
      );
      // 404 = fresh / unknown agent — graceful empty state, NOT an error.
      if (res.status === 404) {
        setEvidence(null);
        setCategories([]);
        setError(null);
        return;
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as MaturityEvidenceResponse;
      setEvidence(data.evidence ?? null);
      setCategories(data.evidence_categories ?? []);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load maturity evidence: ${msg}`);
      setEvidence(null);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchEvidence();
  }, [fetchEvidence]);

  return { evidence, categories, loading, error, refetch: fetchEvidence };
}
