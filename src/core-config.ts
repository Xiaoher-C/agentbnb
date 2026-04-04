import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Core config loader.
 *
 * Attempts to load algorithm config from `@agentbnb/core/config/<name>.json`.
 * If @agentbnb/core is not installed (open-source users), returns null and
 * callers fall back to built-in defaults.
 *
 * This is the ONLY integration point between the public and private repos.
 */

let coreBasePath: string | null = null;
let coreResolved = false;

/**
 * Resolves the base path of @agentbnb/core if installed.
 * Cached after first call.
 */
function resolveCoreBase(): string | null {
  if (coreResolved) return coreBasePath;
  coreResolved = true;

  try {
    // Try to resolve @agentbnb/core package.json
    const pkgPath = require.resolve('@agentbnb/core/package.json');
    coreBasePath = join(pkgPath, '..');
    return coreBasePath;
  } catch {
    // @agentbnb/core not installed — open-source mode
    return null;
  }
}

/**
 * Loads a config JSON file from @agentbnb/core if available.
 *
 * @param configName - Config file name without extension (e.g. 'reputation', 'economics').
 * @returns Parsed JSON object, or null if @agentbnb/core is not installed or file not found.
 *
 * @example
 * ```ts
 * const reputationConfig = loadCoreConfig('reputation');
 * const decayDays = reputationConfig?.decay_days ?? 30; // fallback to default
 * ```
 */
export function loadCoreConfig<T = Record<string, unknown>>(configName: string): T | null {
  const base = resolveCoreBase();
  if (!base) return null;

  try {
    const filePath = join(base, 'config', `${configName}.json`);
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Returns true if @agentbnb/core is installed and accessible.
 */
export function hasCoreConfig(): boolean {
  return resolveCoreBase() !== null;
}
