import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * AgentBnB local agent configuration stored at ~/.agentbnb/config.json
 */
export interface AgentBnBConfig {
  /** Agent owner identifier (chosen at init). */
  owner: string;
  /**
   * URL of this agent's own gateway.
   * For multi-machine scenarios, use the LAN IP (e.g., http://192.168.1.50:7700)
   * so other agents can reach it. LAN IP auto-detection is planned for Plan 04.
   */
  gateway_url: string;
  /** Port this agent's own gateway listens on. */
  gateway_port: number;
  /** Path to the registry SQLite database. */
  db_path: string;
  /** Path to the credit SQLite database. */
  credit_db_path: string;
  /** Bearer token for this agent's gateway auth. */
  token: string;
  /** Optional default remote registry URL (e.g. http://host:7701). */
  registry?: string;
  /** API key for authenticating Hub dashboard access. 64-char hex string generated on init. */
  api_key?: string;
}

/**
 * Returns the path to the ~/.agentbnb/ config directory.
 * Respects AGENTBNB_DIR env var for overriding in tests.
 *
 * @returns Absolute path to config directory.
 */
export function getConfigDir(): string {
  return process.env['AGENTBNB_DIR'] ?? join(homedir(), '.agentbnb');
}

/**
 * Returns the path to the config file.
 *
 * @returns Absolute path to config.json.
 */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

/**
 * Reads and parses ~/.agentbnb/config.json.
 * Returns null if the file does not exist.
 *
 * @returns Parsed config or null if not initialized.
 */
export function loadConfig(): AgentBnBConfig | null {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as AgentBnBConfig;
  } catch {
    return null;
  }
}

/**
 * Writes config to ~/.agentbnb/config.json, creating the directory if needed.
 *
 * @param config - Configuration to persist.
 */
export function saveConfig(config: AgentBnBConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
