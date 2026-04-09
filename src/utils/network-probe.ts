/**
 * Network probe — fast pre-check for "is this registry reachable right now?"
 *
 * Used by user-facing commands (init, serve, request, status…) to decide
 * whether to attempt longer registry operations or skip them with a clear
 * "offline" message instead of making the user wait through a 10-second
 * AbortController timeout.
 *
 * Probe budget: 2000ms (chosen to tolerate trans-Pacific RTT plus some slack
 * while still feeling instantaneous to a human).
 */

import { shouldSkipNetwork } from './runtime-mode.js';

/** Default probe deadline. Tuned for "feels instant" while tolerating slow links. */
export const PROBE_TIMEOUT_MS = 2_000;

/**
 * Probes a registry URL by GETting `/health` with a hard 2s timeout.
 *
 * Returns `true` only if the registry responded with a 2xx status before
 * the deadline. Any failure (test mode, offline mode, DNS, connection refused,
 * 5xx, slow response, abort) returns `false`.
 *
 * This function never throws.
 *
 * @param registryUrl - Base URL of the registry (e.g., `https://agentbnb.fly.dev`).
 * @param timeoutMs - Optional override for the probe deadline. Defaults to PROBE_TIMEOUT_MS.
 * @returns `true` if the registry is reachable, `false` otherwise.
 */
export async function probeRegistry(
  registryUrl: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (shouldSkipNetwork()) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${registryUrl.replace(/\/$/, '')}/health`;
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
