/**
 * AgentList — Ranked agent directory for the /agents route.
 *
 * Renders all registered agents as a responsive grid of tiles (AgentDirectoryCard).
 * Preserves the ranked order returned by /api/agents (sorted server-side by
 * success_rate DESC, then total_earned DESC).
 *
 * Enrichment: cross-references /cards to surface top capability categories and
 * performance tier per agent. When /cards is unavailable, tiles render without
 * chips/tier — core rank-based info still shows (graceful degradation).
 *
 * Loading/error/empty states are preserved from the previous table layout.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAgents } from '../hooks/useAgents.js';
import { inferCategories } from '../lib/categories.js';
import type { Category } from '../types.js';
import AgentDirectoryCard from './AgentDirectoryCard.js';
import SkeletonCard from './SkeletonCard.js';

/** Maximum number of category chips to display per agent tile. */
const MAX_CHIPS_PER_AGENT = 3;

interface OwnerEnrichment {
  categories: Category[];
  performanceTier?: 0 | 1 | 2;
}

/**
 * Fetches /cards once on mount and returns a map of owner → enrichment data
 * (top capability categories + performance tier). Fails silently — returns an
 * empty map on error so the directory still renders the ranked list.
 */
function useOwnerEnrichment(): Record<string, OwnerEnrichment> {
  const [enrichment, setEnrichment] = useState<Record<string, OwnerEnrichment>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/cards?limit=200');
        if (!res.ok) return;
        const data = (await res.json()) as { items: Record<string, unknown>[] };
        if (cancelled) return;

        // Aggregate apis_used + tags per owner (multiple cards possible per owner).
        const aggMeta: Record<string, { apis_used: string[]; tags: string[] }> = {};
        const tierByOwner: Record<string, 0 | 1 | 2> = {};

        for (const raw of data.items) {
          const owner = raw.owner as string | undefined;
          if (!owner) continue;

          const metadata = raw.metadata as
            | { apis_used?: string[]; tags?: string[] }
            | undefined;
          const bucket = aggMeta[owner] ?? { apis_used: [], tags: [] };
          if (metadata?.apis_used) bucket.apis_used.push(...metadata.apis_used);
          if (metadata?.tags) bucket.tags.push(...metadata.tags);
          aggMeta[owner] = bucket;

          // Prefer highest tier observed if owner has multiple cards.
          const tier = raw.performance_tier as 0 | 1 | 2 | undefined;
          if (tier !== undefined) {
            const current = tierByOwner[owner];
            if (current === undefined || tier > current) tierByOwner[owner] = tier;
          }
        }

        const byOwner: Record<string, OwnerEnrichment> = {};
        for (const [owner, meta] of Object.entries(aggMeta)) {
          const { categories } = inferCategories(meta);
          byOwner[owner] = {
            categories: categories.slice(0, MAX_CHIPS_PER_AGENT),
            performanceTier: tierByOwner[owner],
          };
        }

        setEnrichment(byOwner);
      } catch {
        // Graceful degradation: tiles render without enrichment.
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return enrichment;
}

/**
 * Renders the ranked agent directory as a responsive card grid.
 */
export default function AgentList(): JSX.Element {
  const navigate = useNavigate();
  const { agents, loading, error } = useAgents();
  const enrichment = useOwnerEnrichment();

  const enrichedAgents = useMemo(
    () =>
      agents.map((agent) => ({
        agent,
        enrichment: enrichment[agent.owner],
      })),
    [agents, enrichment],
  );

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-hub-text-primary mb-6">
          Agent Directory
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-hub-text-primary mb-6">
          Agent Directory
        </h2>
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-hub-text-secondary hover:text-hub-text-primary underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-hub-text-primary mb-6">
          Agent Directory
        </h2>
        <p className="text-hub-text-muted">No agents registered yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-hub-text-primary mb-6">
        Agent Directory
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {enrichedAgents.map(({ agent, enrichment: enr }) => (
          <AgentDirectoryCard
            key={agent.owner}
            agent={agent}
            categories={enr?.categories}
            performanceTier={enr?.performanceTier}
            onClick={() => void navigate(`/agents/${agent.owner}`)}
          />
        ))}
      </div>
    </div>
  );
}
