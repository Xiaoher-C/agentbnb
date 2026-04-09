/**
 * Vitest global setup — sets AGENTBNB_TEST_MODE=1 so any code path that
 * checks `isTestMode()` skips best-effort outbound HTTP calls during tests.
 *
 * This propagates to subprocesses spawned via execSync/spawn that inherit
 * `process.env`, so end-to-end CLI tests are also covered.
 */
process.env['AGENTBNB_TEST_MODE'] = '1';
