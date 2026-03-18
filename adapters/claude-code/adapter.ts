import { ensureIdentity, loadIdentity, type AgentIdentity } from '../../src/identity/identity.js';
import { AgentBnBConsumer, type ConsumerRequestOptions } from '../../src/sdk/consumer.js';
import { loadConfig, getConfigDir } from '../../src/cli/config.js';
import { searchCards } from '../../src/registry/matcher.js';
import { openDatabase } from '../../src/registry/store.js';
import { AgentBnBError } from '../../src/types/index.js';
import type { CapabilityCard } from '../../src/types/index.js';

/**
 * Budget tier thresholds for the Claude Code adapter.
 */
export interface BudgetTiers {
  /** Max credits for auto-execution (Tier 1). Default 10. */
  tier1: number;
  /** Max credits for notify-after (Tier 2). Default 50. */
  tier2: number;
}

/**
 * Options for constructing a ClaudeCodeAdapter.
 */
export interface ClaudeCodeAdapterOptions {
  /** Override the config directory (default: ~/.agentbnb or AGENTBNB_DIR). */
  configDir?: string;
  /** Custom budget tier thresholds. */
  budgetTiers?: Partial<BudgetTiers>;
}

/**
 * Options for requesting a capability.
 */
export interface RequestCapabilityOptions {
  /** Maximum credits to spend. */
  budget?: number;
  /** Direct gateway URL (skips search). */
  gatewayUrl?: string;
  /** Specific card ID to request. */
  cardId?: string;
  /** Bearer token for the target gateway. */
  token?: string;
  /** Input parameters. */
  params?: Record<string, unknown>;
}

const DEFAULT_BUDGET_TIERS: BudgetTiers = {
  tier1: 10,
  tier2: 50,
};

/**
 * ClaudeCodeAdapter — connects Claude Code agents to the AgentBnB network.
 *
 * Features:
 * - Auto-registration on first use (identity creation + credit bootstrap)
 * - Budget tier enforcement (auto/notify/ask based on credit cost)
 * - Capability search and request via the Consumer SDK
 *
 * @example
 * ```typescript
 * const adapter = new ClaudeCodeAdapter();
 * await adapter.initialize();
 * const tier = adapter.getBudgetTier(5); // 'auto'
 * const result = await adapter.requestCapability('translate to French');
 * ```
 */
export class ClaudeCodeAdapter {
  private configDir: string;
  private budgetTiers: BudgetTiers;
  private consumer: AgentBnBConsumer;
  private identity: AgentIdentity | null = null;

  constructor(opts?: ClaudeCodeAdapterOptions) {
    this.configDir = opts?.configDir ?? getConfigDir();
    this.budgetTiers = { ...DEFAULT_BUDGET_TIERS, ...opts?.budgetTiers };
    this.consumer = new AgentBnBConsumer({ configDir: this.configDir });
  }

  /**
   * Initializes the adapter. Creates agent identity if none exists.
   * This is the entry point — call once per Claude Code session.
   *
   * @returns The agent identity.
   */
  async initialize(): Promise<AgentIdentity> {
    // Check for existing identity first
    let identity = loadIdentity(this.configDir);

    if (!identity) {
      // First-use: create identity via CLI init pattern
      const config = loadConfig();
      const owner = config?.owner ?? `claude-code-${Date.now().toString(36)}`;
      identity = ensureIdentity(this.configDir, owner);
    }

    // Authenticate the consumer SDK
    this.consumer.authenticate();
    this.identity = identity;
    return identity;
  }

  /**
   * Returns the budget tier for a given credit cost.
   *
   * @param cost - Number of credits the operation would cost.
   * @returns 'auto' (Tier 1), 'notify' (Tier 2), or 'ask' (Tier 3).
   */
  getBudgetTier(cost: number): 'auto' | 'notify' | 'ask' {
    if (cost < this.budgetTiers.tier1) return 'auto';
    if (cost <= this.budgetTiers.tier2) return 'notify';
    return 'ask';
  }

  /**
   * Requests a capability from the network.
   *
   * If no cardId or gatewayUrl is provided, searches for matching capabilities
   * and picks the cheapest available option.
   *
   * @param query - Natural language description of the capability needed.
   * @param opts - Optional overrides for target, budget, and params.
   * @returns The result from the capability execution.
   * @throws {AgentBnBError} on no matches, insufficient credits, or execution failure.
   */
  async requestCapability(
    query: string,
    opts?: RequestCapabilityOptions,
  ): Promise<unknown> {
    this.ensureInitialized();

    let cardId = opts?.cardId;
    let gatewayUrl = opts?.gatewayUrl;
    let token = opts?.token ?? '';
    let credits = opts?.budget ?? 0;

    // If no direct target, search for matching capabilities
    if (!cardId) {
      const config = loadConfig();
      const dbPath = config?.db_path ?? `${this.configDir}/registry.db`;
      const db = openDatabase(dbPath);
      try {
        const matches = searchCards(db, query);
        if (matches.length === 0) {
          throw new AgentBnBError(
            `No capabilities found matching: "${query}"`,
            'NO_MATCH',
          );
        }

        // Pick cheapest match
        const sorted = [...matches].sort(
          (a, b) => a.pricing.credits_per_call - b.pricing.credits_per_call,
        );
        const best = sorted[0];
        cardId = best.id;
        credits = opts?.budget ?? best.pricing.credits_per_call;

        // Try to get gateway URL from config or card metadata
        if (!gatewayUrl) {
          gatewayUrl = config?.gateway_url ?? 'http://localhost:7700';
        }
        if (!token) {
          token = config?.token ?? '';
        }
      } finally {
        db.close();
      }
    }

    return this.consumer.request({
      gatewayUrl: gatewayUrl ?? 'http://localhost:7700',
      token,
      cardId: cardId!,
      credits,
      params: opts?.params,
    });
  }

  /**
   * Returns current agent status.
   */
  getStatus(): { balance: number; identity: AgentIdentity; tier: string } {
    this.ensureInitialized();
    const balance = this.consumer.getBalance();
    return {
      balance,
      identity: this.identity!,
      tier: this.getBudgetTier(balance),
    };
  }

  /**
   * Closes underlying resources. Call when done.
   */
  close(): void {
    this.consumer.close();
  }

  /** Throws if not initialized. */
  private ensureInitialized(): void {
    if (!this.identity) {
      throw new AgentBnBError(
        'Adapter not initialized. Call initialize() first.',
        'NOT_INITIALIZED',
      );
    }
  }
}
