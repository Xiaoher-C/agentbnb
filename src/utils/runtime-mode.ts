/**
 * Runtime mode detection — single source of truth for "should we make
 * outbound network calls right now?"
 *
 * Two independent signals:
 *
 * - **test mode** (`AGENTBNB_TEST_MODE=1`, `NODE_ENV=test`, or `VITEST=true`)
 *   Set by the test harness. Outbound HTTP that is purely best-effort
 *   (registry credit grants, balance fetches, VC refreshes) should short-circuit
 *   so test runs are deterministic and fast.
 *
 * - **offline mode** (`AGENTBNB_OFFLINE=1`)
 *   Explicitly set by a human user who knows their machine has no network
 *   (e.g. on a plane, behind a firewall). Same effect as test mode for
 *   best-effort calls — skip them and tell the user how to recover later.
 */

/** True when running under any test harness (vitest, NODE_ENV=test, or explicit AGENTBNB_TEST_MODE=1). */
export function isTestMode(): boolean {
  return (
    process.env['AGENTBNB_TEST_MODE'] === '1' ||
    process.env['NODE_ENV'] === 'test' ||
    process.env['VITEST'] === 'true'
  );
}

/** True when the user has explicitly opted into offline operation. */
export function isOfflineMode(): boolean {
  return process.env['AGENTBNB_OFFLINE'] === '1';
}

/**
 * True when best-effort outbound HTTP should be skipped entirely.
 * Combines both test and offline mode.
 */
export function shouldSkipNetwork(): boolean {
  return isTestMode() || isOfflineMode();
}
