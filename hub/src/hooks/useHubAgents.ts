/**
 * useHubAgents / useHubAgent / useHubAgentJobs — Data fetching hooks for Hub Agent pages.
 *
 * Follows the established isFirstFetch polling pattern from useAgents.ts:
 * - loading only true on first fetch
 * - existing data kept on error (graceful degradation)
 * - error cleared on success
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { HubAgentSummary, HubAgentJob } from '../types.js';

const POLL_INTERVAL_MS = 30_000;
const JOBS_POLL_INTERVAL_MS = 10_000;

interface UseHubAgentsResult {
  agents: HubAgentSummary[];
  loading: boolean;
  error: string | null;
}

interface UseHubAgentResult {
  agent: HubAgentSummary | null;
  loading: boolean;
  error: string | null;
}

interface UseHubAgentJobsResult {
  jobs: HubAgentJob[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches all Hub Agents from GET /api/hub-agents and polls every 30s.
 */
export function useHubAgents(): UseHubAgentsResult {
  const [agents, setAgents] = useState<HubAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFirstFetch = useRef(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/hub-agents');
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as { agents: HubAgentSummary[] };
      setAgents(data.agents);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load Hub Agents: ${msg}`);
      // Keep existing agents on error (graceful degradation)
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    isFirstFetch.current = true;
    setLoading(true);
    void fetchAgents();
  }, [fetchAgents]);

  // Poll every 30s
  useEffect(() => {
    const id = setInterval(() => void fetchAgents(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAgents]);

  return { agents, loading, error };
}

/**
 * Fetches a single Hub Agent from GET /api/hub-agents/:id and polls every 30s.
 * Re-fetches when agentId changes.
 */
export function useHubAgent(agentId: string): UseHubAgentResult {
  const [agent, setAgent] = useState<HubAgentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFirstFetch = useRef(true);

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`/api/hub-agents/${encodeURIComponent(agentId)}`);
      if (res.status === 404) {
        setError('Hub Agent not found');
        return;
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as HubAgentSummary;
      setAgent(data);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load Hub Agent: ${msg}`);
      // Keep existing data on error (graceful degradation)
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, [agentId]);

  // Initial fetch + reset when agentId changes
  useEffect(() => {
    isFirstFetch.current = true;
    setLoading(true);
    void fetchAgent();
  }, [fetchAgent]);

  // Poll every 30s
  useEffect(() => {
    const id = setInterval(() => void fetchAgent(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAgent]);

  return { agent, loading, error };
}

/**
 * Fetches jobs for a Hub Agent from GET /api/hub-agents/:id/jobs and polls every 10s.
 * Jobs change more frequently so use a shorter poll interval.
 */
export function useHubAgentJobs(agentId: string): UseHubAgentJobsResult {
  const [jobs, setJobs] = useState<HubAgentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFirstFetch = useRef(true);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/hub-agents/${encodeURIComponent(agentId)}/jobs`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as { jobs: HubAgentJob[] };
      setJobs(data.jobs);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load jobs: ${msg}`);
      // Keep existing jobs on error (graceful degradation)
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, [agentId]);

  // Initial fetch + reset when agentId changes
  useEffect(() => {
    isFirstFetch.current = true;
    setLoading(true);
    void fetchJobs();
  }, [fetchJobs]);

  // Poll every 10s
  useEffect(() => {
    const id = setInterval(() => void fetchJobs(), JOBS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchJobs]);

  return { jobs, loading, error };
}
