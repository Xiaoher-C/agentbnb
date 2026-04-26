/**
 * UCAN replay protection.
 *
 * Tracks UCAN nonce/jti values that have already been verified to prevent
 * replay attacks within a token's validity window. Cache is bounded; once
 * MAX_CACHE_SIZE is reached, expired entries are evicted.
 *
 * This is intentionally an in-process module-level cache. ADR-020 step 9 of
 * the verification algorithm requires nonce tracking; we use the canonical
 * `jti` (or `nnc`) field as the key.
 *
 * @see docs/adr/020-ucan-token.md
 */

/** Maximum number of jti entries the cache will hold before eviction kicks in. */
export const MAX_CACHE_SIZE = 10_000;

const cache = new Map<string, number>();

/**
 * Returns the current Unix timestamp in seconds.
 * Internal helper, exported for testing time-based eviction.
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Evicts every entry whose `exp` has passed.
 * Called lazily when the cache approaches its size limit so that a single
 * sweep keeps insertion amortized O(1).
 */
function evictExpired(now: number): void {
  for (const [jti, exp] of cache) {
    if (exp <= now) {
      cache.delete(jti);
    }
  }
}

/**
 * Checks whether a UCAN jti has already been seen and, if not, records it.
 *
 * Returns `false` when the jti has been used previously (i.e. this verification
 * attempt should be rejected as a replay).
 * Returns `true` when the jti is fresh and was successfully recorded.
 *
 * The cache is bounded at MAX_CACHE_SIZE entries. When full, expired entries
 * are evicted first; if no entries are evictable the oldest entry is dropped.
 *
 * @param jti - UCAN nonce/jti value (must be globally unique).
 * @param expSeconds - Unix timestamp (seconds) at which the token expires.
 * @returns true when the jti was recorded, false when it is a replay.
 */
export function checkAndRecordJti(jti: string, expSeconds: number): boolean {
  if (cache.has(jti)) {
    return false;
  }

  const now = nowSeconds();

  if (cache.size >= MAX_CACHE_SIZE) {
    evictExpired(now);
    // If still over the limit (no expirable entries), evict the oldest.
    if (cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
  }

  cache.set(jti, expSeconds);
  return true;
}

/**
 * Clears the entire replay cache.
 * Intended for tests; production code should rely on natural eviction.
 */
export function clearReplayCache(): void {
  cache.clear();
}

/**
 * Returns the current number of entries in the replay cache.
 * Intended for tests/diagnostics.
 */
export function replayCacheSize(): number {
  return cache.size;
}
