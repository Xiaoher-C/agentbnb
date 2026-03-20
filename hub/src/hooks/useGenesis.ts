/**
 * useGenesis — Data fetching hook for the Genesis Dashboard page.
 *
 * Fetches genesis network stats from the registry API and the latest
 * evolution record for the genesis-template.
 */
import { useState, useEffect } from 'react';

/** A single core memory entry in an evolution snapshot. */
export interface CoreMemoryEntry {
  category: string;
  importance: number;
  content: string;
  scope?: string;
}

/** A single template evolution record from the Evolution API. */
export interface TemplateEvolution {
  template_name: string;
  template_version: string;
  publisher_agent: string;
  changelog: string;
  core_memory_snapshot: CoreMemoryEntry[];
  fitness_improvement: number;
  timestamp: string;
}

/** Return type of useGenesisStats hook. */
export interface GenesisStatsResult {
  /** Total number of agents online on the network */
  totalAgents: number;
  /** Total number of exchanges / transactions */
  dailyTransactions: number;
  /** Average fitness score across recent evolutions (0.0–1.0) */
  avgFitness: number;
  /** Latest template version string, or null when no evolutions exist */
  latestVersion: string | null;
  /** Latest evolution record, or null when none exists */
  latestEvolution: TemplateEvolution | null;
  /** All recent evolutions for timeline display */
  evolutions: TemplateEvolution[];
  loading: boolean;
  error: string | null;
}

const TEMPLATE_NAME = 'genesis-template';

/**
 * Fetches genesis network stats from the registry /api/stats endpoint
 * and the latest evolution record from /api/evolution/latest.
 *
 * Returns combined data for the Genesis Dashboard page.
 * Handles errors gracefully — data defaults to zero/null on fetch failure.
 */
export function useGenesisStats(): GenesisStatsResult {
  const [totalAgents, setTotalAgents] = useState(0);
  const [dailyTransactions, setDailyTransactions] = useState(0);
  const [latestEvolution, setLatestEvolution] = useState<TemplateEvolution | null>(null);
  const [evolutions, setEvolutions] = useState<TemplateEvolution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll(): Promise<void> {
      try {
        // Fetch stats and evolution data in parallel
        const [statsRes, latestRes, historyRes] = await Promise.all([
          fetch('/api/stats'),
          fetch(`/api/evolution/latest?template=${encodeURIComponent(TEMPLATE_NAME)}`),
          fetch(`/api/evolution/history?template=${encodeURIComponent(TEMPLATE_NAME)}&limit=20`),
        ]);

        if (cancelled) return;

        if (statsRes.ok) {
          const stats = await statsRes.json() as {
            agents_online?: number;
            total_exchanges?: number;
          };
          setTotalAgents(stats.agents_online ?? 0);
          setDailyTransactions(stats.total_exchanges ?? 0);
        }

        if (latestRes.ok) {
          const data = await latestRes.json() as { evolution: TemplateEvolution | null };
          setLatestEvolution(data.evolution);
        }

        if (historyRes.ok) {
          const data = await historyRes.json() as { evolutions: TemplateEvolution[] };
          setEvolutions(data.evolutions ?? []);
        }

        if (!cancelled) {
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setError(`Failed to load genesis data: ${msg}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchAll();
    return () => { cancelled = true; };
  }, []);

  // Compute average fitness from evolution history
  const avgFitness = evolutions.length > 0
    ? evolutions.reduce((sum, ev) => sum + ev.fitness_improvement, 0) / evolutions.length
    : 0;

  // Clamp avgFitness to [0, 1] for display as a progress bar (fitness_improvement is a delta)
  const clampedAvgFitness = Math.max(0, Math.min(1, (avgFitness + 1) / 2));

  return {
    totalAgents,
    dailyTransactions,
    avgFitness: clampedAvgFitness,
    latestVersion: latestEvolution?.template_version ?? null,
    latestEvolution,
    evolutions,
    loading,
    error,
  };
}
