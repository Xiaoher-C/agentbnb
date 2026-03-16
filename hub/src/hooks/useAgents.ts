/**
 * useAgents / useAgentProfile — Data fetching hooks for the AgentBnB agent directory.
 *
 * useAgents: fetches the ranked agent list, polls every 30s without flicker.
 * useAgentProfile: fetches a single agent's full profile (skills + recent activity), polls every 30s.
 *
 * Both follow the established isFirstFetch pattern from useCards.ts:
 * - loading is only set to false on the first fetch
 * - existing data is kept on subsequent fetch errors (graceful degradation)
 * - error is cleared on success
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentProfile, AgentProfileResponse, ActivityEntry, HubCard } from '../types.js';

const POLL_INTERVAL_MS = 30_000;

interface UseAgentsResult {
  agents: AgentProfile[];
  loading: boolean;
  error: string | null;
}

interface UseAgentProfileResult {
  profile: AgentProfile | null;
  skills: HubCard[];
  recentActivity: ActivityEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the ranked agent list from GET /api/agents and polls every 30s.
 *
 * Returns agents sorted by reputation (as returned by the server).
 * On the first fetch, loading=true until data arrives.
 * On subsequent polls, existing data is kept and loading stays false (no flicker).
 */
export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFirstFetch = useRef(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as { items: AgentProfile[]; total: number };
      setAgents(data.items);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load agents: ${msg}`);
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
 * Fetches a single agent's full profile from GET /api/agents/:owner and polls every 30s.
 *
 * Handles 404 by setting error to "Agent not found".
 * Re-fetches automatically when the owner parameter changes.
 */
export function useAgentProfile(owner: string): UseAgentProfileResult {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [skills, setSkills] = useState<HubCard[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFirstFetch = useRef(true);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(owner)}`);
      if (res.status === 404) {
        setError('Agent not found');
        return;
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as AgentProfileResponse;
      setProfile(data.profile);
      setSkills(data.skills);
      setRecentActivity(data.recent_activity);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load agent profile: ${msg}`);
      // Keep existing data on error (graceful degradation)
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, [owner]);

  // Initial fetch + reset when owner changes
  useEffect(() => {
    isFirstFetch.current = true;
    setLoading(true);
    void fetchProfile();
  }, [fetchProfile]);

  // Poll every 30s
  useEffect(() => {
    const id = setInterval(() => void fetchProfile(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchProfile]);

  return { profile, skills, recentActivity, loading, error };
}
