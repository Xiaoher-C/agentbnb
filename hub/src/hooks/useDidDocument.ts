/**
 * useDidDocument — Resolves an agent's W3C DID Document from GET /api/did/:agent_id.
 *
 * Fetches once per agent_id, then exposes the service[0].serviceEndpoint (gateway URL)
 * as a convenience field. Skips the fetch when agent_id is undefined.
 * Fails silently (returns null document) — the DID chip renders without the extra
 * gateway line when resolution fails.
 */
import { useState, useEffect } from 'react';

/** Single service entry in a DID Document service[] array. */
export interface DidService {
  id: string;
  type: string;
  serviceEndpoint: string;
}

/** Minimal shape of a W3C DID Document returned by GET /api/did/:agent_id. */
export interface DidDocument {
  '@context': string[];
  id: string;
  verificationMethod?: Array<{ id: string; type: string; controller: string }>;
  authentication?: string[];
  assertionMethod?: string[];
  service?: DidService[];
}

/** Return shape of the useDidDocument hook. */
export interface UseDidDocumentResult {
  /** The resolved DID Document, or null when not yet fetched / resolution failed. */
  document: DidDocument | null;
  /** First service endpoint (typically the agent gateway URL), or null when absent. */
  gatewayEndpoint: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves an agent DID Document. No-ops when agent_id is undefined.
 * Not polled — DID documents are stable; a single fetch per mount is sufficient.
 */
export function useDidDocument(agentId: string | undefined): UseDidDocumentResult {
  const [document, setDocument] = useState<DidDocument | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(agentId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) {
      setDocument(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchDid(id: string): Promise<void> {
      try {
        const res = await fetch(`/api/did/${encodeURIComponent(id)}`);
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }
        const data = (await res.json()) as DidDocument;
        if (cancelled) return;
        setDocument(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(`Failed to resolve DID: ${msg}`);
        setDocument(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchDid(agentId);
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const gatewayEndpoint = document?.service?.[0]?.serviceEndpoint ?? null;

  return { document, gatewayEndpoint, loading, error };
}
