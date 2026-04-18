/**
 * useCredentials — Fetches Verifiable Credentials for an agent from GET /api/credentials/:agent_id.
 *
 * One-shot fetch on mount (re-fetches when agent_id changes). No polling —
 * credentials refresh weekly on the server, so live polling would be wasteful.
 * Returns an empty list (without fetching) when agent_id is undefined.
 */
import { useCallback, useEffect, useState } from 'react';

export interface ReputationCredentialSubject {
  id: string;
  totalTransactions: number;
  successRate: number;
  avgResponseTime: string;
  totalEarned: number;
  skills: Array<{ id: string; uses: number; rating: number }>;
  peerEndorsements: number;
  activeSince: string;
}

export interface SkillCredentialSubject {
  id: string;
  skillId: string;
  totalUses: number;
  milestone: 100 | 500 | 1000;
  milestoneLevel: 'bronze' | 'silver' | 'gold';
}

export interface TeamCredentialSubject {
  id: string;
  teamId?: string;
  teamRole?: string;
  teamSize?: number;
}

export interface VerifiableCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: ReputationCredentialSubject | SkillCredentialSubject | TeamCredentialSubject;
  proof?: { type: string; [k: string]: unknown };
}

interface CredentialsResponse {
  agent_id: string;
  did: string;
  credentials: VerifiableCredential[];
}

interface UseCredentialsResult {
  credentials: VerifiableCredential[];
  loading: boolean;
  error: string | null;
}

export function useCredentials(agent_id: string | undefined): UseCredentialsResult {
  const [credentials, setCredentials] = useState<VerifiableCredential[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(agent_id));
  const [error, setError] = useState<string | null>(null);

  const fetchCredentials = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/credentials/${encodeURIComponent(id)}`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as CredentialsResponse;
      setCredentials(data.credentials ?? []);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load credentials: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!agent_id) {
      setCredentials([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    void fetchCredentials(agent_id);
  }, [agent_id, fetchCredentials]);

  return { credentials, loading, error };
}
