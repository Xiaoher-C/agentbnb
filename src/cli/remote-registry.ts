import { AgentBnBError } from '../types/index.js';
import type { CapabilityCard } from '../types/index.js';

/**
 * A CapabilityCard tagged with its data source (local or remote registry).
 */
export type TaggedCard = CapabilityCard & { source: 'local' | 'remote' };

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when the remote registry does not respond within the timeout window.
 */
export class RegistryTimeoutError extends AgentBnBError {
  constructor(url: string) {
    super(
      `Registry at ${url} did not respond within 5s. Showing local results only.`,
      'REGISTRY_TIMEOUT',
    );
    this.name = 'RegistryTimeoutError';
  }
}

/**
 * Thrown when the remote registry is unreachable (connection refused, network failure).
 */
export class RegistryConnectionError extends AgentBnBError {
  constructor(url: string) {
    super(
      `Cannot reach ${url}. Is the registry running? Showing local results only.`,
      'REGISTRY_CONNECTION',
    );
    this.name = 'RegistryConnectionError';
  }
}

/**
 * Thrown when the remote registry returns 401 or 403.
 */
export class RegistryAuthError extends AgentBnBError {
  constructor(url: string) {
    super(
      `Authentication failed for ${url}. Run \`agentbnb config set token <your-token>\`.`,
      'REGISTRY_AUTH',
    );
    this.name = 'RegistryAuthError';
  }
}

// ---------------------------------------------------------------------------
// fetchRemoteCards
// ---------------------------------------------------------------------------

/**
 * Fetches Capability Cards from a remote AgentBnB registry server.
 *
 * Builds a GET /cards request with the provided query parameters and a
 * hard limit of 100. Uses AbortController for a configurable timeout.
 *
 * @param registryUrl - Base URL of the remote registry (e.g. http://host:7701).
 * @param params - Optional query filters: q, level, online, tag.
 * @param timeoutMs - Abort timeout in milliseconds (default 5000).
 * @returns Array of CapabilityCard objects from the remote registry.
 * @throws {AgentBnBError} INVALID_REGISTRY_URL — if registryUrl is not a valid URL.
 * @throws {RegistryTimeoutError} — if the request exceeds timeoutMs.
 * @throws {RegistryConnectionError} — if the registry is unreachable.
 * @throws {RegistryAuthError} — if the registry returns 401 or 403.
 */
export async function fetchRemoteCards(
  registryUrl: string,
  params: { q?: string; level?: number; online?: boolean; tag?: string },
  timeoutMs = 5_000,
): Promise<CapabilityCard[]> {
  // Validate URL before attempting fetch
  let cardsUrl: URL;
  try {
    cardsUrl = new URL('/cards', registryUrl);
  } catch {
    throw new AgentBnBError(`Invalid registry URL: ${registryUrl}`, 'INVALID_REGISTRY_URL');
  }

  // Build query params
  const searchParams = new URLSearchParams();
  if (params.q !== undefined) searchParams.set('q', params.q);
  if (params.level !== undefined) searchParams.set('level', String(params.level));
  if (params.online !== undefined) searchParams.set('online', String(params.online));
  if (params.tag !== undefined) searchParams.set('tag', params.tag);
  searchParams.set('limit', '100');
  cardsUrl.search = searchParams.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(cardsUrl.toString(), { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    if (isTimeout) {
      throw new RegistryTimeoutError(registryUrl);
    }
    throw new RegistryConnectionError(registryUrl);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new RegistryAuthError(registryUrl);
  }

  if (!response.ok) {
    throw new RegistryConnectionError(registryUrl);
  }

  const body = await response.json() as { items: CapabilityCard[] };
  return body.items;
}

// ---------------------------------------------------------------------------
// mergeResults
// ---------------------------------------------------------------------------

/**
 * Merges local and remote Capability Cards into a deduplicated, tagged list.
 *
 * - Deduplication is by card.id — local cards always win (remote dups are dropped).
 * - When hasQuery is false: returns local cards first, then non-duplicate remote cards.
 * - When hasQuery is true: interleaves (alternating zip) local and remote sublists.
 * - Every returned card has a `source` field set to 'local' or 'remote'.
 *
 * @param localCards - Cards from the local SQLite registry.
 * @param remoteCards - Cards from the remote registry.
 * @param hasQuery - Whether a search query was provided (triggers interleave mode).
 * @returns Merged, deduplicated array of TaggedCard objects.
 */
export function mergeResults(
  localCards: CapabilityCard[],
  remoteCards: CapabilityCard[],
  hasQuery: boolean,
): TaggedCard[] {
  const taggedLocal: TaggedCard[] = localCards.map((c) => ({ ...c, source: 'local' as const }));
  const taggedRemote: TaggedCard[] = remoteCards.map((c) => ({ ...c, source: 'remote' as const }));

  // Dedup remote: drop any card whose id already appears in local
  const localIds = new Set(localCards.map((c) => c.id));
  const dedupedRemote = taggedRemote.filter((c) => !localIds.has(c.id));

  if (!hasQuery) {
    // Local-first order: all local, then remaining remote
    return [...taggedLocal, ...dedupedRemote];
  }

  // Interleaved (alternating zip)
  const result: TaggedCard[] = [];
  const maxLen = Math.max(taggedLocal.length, dedupedRemote.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < taggedLocal.length) result.push(taggedLocal[i]!);
    if (i < dedupedRemote.length) result.push(dedupedRemote[i]!);
  }
  return result;
}
