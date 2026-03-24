import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AutonomyConfig } from '../autonomy/tiers.js';
import type { BudgetConfig } from '../credit/budget.js';

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
  /**
   * Autonomy tier configuration controlling how much credit spending is auto-approved.
   * Defaults to Tier 3 (all actions require owner approval) when not configured.
   * Set via `agentbnb config set tier1 <N>` and `agentbnb config set tier2 <N>`.
   */
  autonomy?: AutonomyConfig;
  /**
   * Credit budget configuration controlling the reserve floor.
   * The reserve floor prevents auto-request from draining credits to zero.
   * Defaults to 20 credit reserve when not configured.
   * Set via `agentbnb config set reserve <N>`.
   */
  budget?: BudgetConfig;
  /** Hex-encoded Ed25519 public key for convenience (canonical source is public.key file). */
  public_key?: string;
  /**
   * Conductor configuration. When `conductor.public` is true, the agent's
   * built-in Conductor is published as a paid capability card on the relay.
   * Defaults to undefined (treated as `{ public: false }`).
   */
  conductor?: { public: boolean };
  /**
   * When true, sends a Telegram message to the owner each time a skill is
   * successfully executed on this agent. Requires telegram_bot_token and
   * telegram_chat_id. Defaults to false.
   */
  telegram_notifications?: boolean;
  /** Telegram Bot API token (from @BotFather). Used when telegram_notifications is true. */
  telegram_bot_token?: string;
  /** Telegram chat ID to send notifications to. Used when telegram_notifications is true. */
  telegram_chat_id?: string;
  /**
   * Whitelist of skill IDs to publish via `agentbnb openclaw sync`.
   * When set, only skills with matching IDs are included in the published card.
   * When empty/omitted, respects each skill's `visibility` field.
   */
  shared_skills?: string[];
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
