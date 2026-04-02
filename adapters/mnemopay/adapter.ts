import { MnemoPayLite } from '@mnemopay/sdk';
import { ensureIdentity, loadIdentity, type AgentIdentity } from '../../src/identity/identity.js';
import { AgentBnBConsumer, type ConsumerRequestOptions } from '../../src/sdk/consumer.js';
import { loadConfig, getConfigDir } from '../../src/cli/config.js';
import { searchCards } from '../../src/registry/matcher.js';
import { openDatabase } from '../../src/registry/store.js';
import { AgentBnBError } from '../../src/types/index.js';

/**
 * Options for constructing a MnemoPayAdapter.
 */
export interface MnemoPayAdapterOptions {
  /** Override the config directory (default: ~/.agentbnb or AGENTBNB_DIR). */
  configDir?: string;
  /** Memory decay rate. Lower = memories last longer. Default 0.05. */
  memoryDecay?: number;
  /** Maximum credits the agent can spend without explicit approval. Default 50. */
  autoApproveLimit?: number;
}

/**
 * Options for requesting a capability with memory-informed decisions.
 */
export interface MemoryAwareRequestOptions {
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

/**
 * MnemoPayAdapter — adds memory-payment feedback loop to AgentBnB agents.
 *
 * When a capability request succeeds (settles), memories accessed during
 * decision-making get reinforced (+0.05 importance). When it fails (refunds),
 * the agent's reputation is docked. Over time, the agent learns which
 * providers deliver and which don't.
 *
 * This is the MnemoPay feedback loop: economic outcomes shape agent memory.
 *
 * @example
 * ```typescript
 * const adapter = new MnemoPayAdapter();
 * await adapter.initialize();
 *
 * // Agent remembers past interactions
 * await adapter.remember("Provider alice delivered clean code on translation task");
 *
 * // Memory-informed capability request
 * const result = await adapter.requestWithMemory("translate to French", {
 *   budget: 10,
 * });
 * // On success: memories reinforced. On failure: reputation docked.
 *
 * // Check what the agent knows
 * const memories = await adapter.recall(5);
 * ```
 */
export class MnemoPayAdapter {
  private configDir: string;
  private consumer: AgentBnBConsumer;
  private identity: AgentIdentity | null = null;
  private agent: MnemoPayLite;
  private autoApproveLimit: number;

  constructor(opts?: MnemoPayAdapterOptions) {
    this.configDir = opts?.configDir ?? getConfigDir();
    this.consumer = new AgentBnBConsumer({ configDir: this.configDir });
    this.agent = new MnemoPayLite(
      'agentbnb-mnemopay',
      opts?.memoryDecay ?? 0.05,
    );
    this.autoApproveLimit = opts?.autoApproveLimit ?? 50;
  }

  /**
   * Initializes the adapter. Creates agent identity if none exists.
   * Call once per session.
   */
  async initialize(): Promise<AgentIdentity> {
    let identity = loadIdentity(this.configDir);

    if (!identity) {
      const config = loadConfig();
      const owner = config?.owner ?? `mnemopay-agent-${Date.now().toString(36)}`;
      identity = ensureIdentity(this.configDir, owner);
    }

    this.consumer.authenticate();
    this.identity = identity;
    return identity;
  }

  /**
   * Store a memory. The agent uses these to make better decisions over time.
   *
   * @param content - What to remember (e.g., "Provider X delivered clean work")
   * @param opts - Optional importance (0-1) and tags
   * @returns The memory ID
   */
  async remember(
    content: string,
    opts?: { importance?: number; tags?: string[] },
  ): Promise<string> {
    return this.agent.remember(content, opts);
  }

  /**
   * Recall memories, ranked by importance × recency × frequency.
   *
   * @param limit - Max memories to return (default 5)
   * @returns Scored memories, highest first
   */
  async recall(limit = 5) {
    return this.agent.recall(limit);
  }

  /**
   * Request a capability with memory-informed decision making.
   *
   * Before executing, the agent recalls relevant memories to inform
   * provider selection. After execution:
   * - Success → settle() reinforces recently-accessed memories by +0.05
   * - Failure → refund() docks reputation by -0.05
   *
   * This is the feedback loop. Good providers get remembered more strongly.
   * Bad providers get deprioritized as their memories decay.
   */
  async requestWithMemory(
    query: string,
    opts?: MemoryAwareRequestOptions,
  ): Promise<{ result: unknown; reinforced: number; memories: number }> {
    this.ensureInitialized();

    // Step 1: Recall memories before making the decision
    const memories = await this.agent.recall(10);

    // Step 2: Create escrow via MnemoPay (tracks the payment)
    const amount = opts?.budget ?? 10;
    const tx = await this.agent.charge(amount, `${query}`);

    // Step 3: Execute via AgentBnB consumer
    let cardId = opts?.cardId;
    let gatewayUrl = opts?.gatewayUrl;
    let token = opts?.token ?? '';

    if (!cardId) {
      const config = loadConfig();
      const dbPath = config?.db_path ?? `${this.configDir}/registry.db`;
      const db = openDatabase(dbPath);
      try {
        const matches = searchCards(db, query);
        if (matches.length === 0) {
          // Refund and remember the failure
          await this.agent.refund(tx.id);
          await this.agent.remember(
            `No providers found for "${query}". Search returned empty.`,
            { importance: 0.4, tags: ['no-match', 'search-failure'] },
          );
          throw new AgentBnBError(
            `No capabilities found matching: "${query}"`,
            'NO_MATCH',
          );
        }

        // Use memory to pick the best provider (not just cheapest)
        const best = this.pickBestProvider(matches, memories);
        cardId = best.id;

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

    try {
      const result = await this.consumer.request({
        gatewayUrl: gatewayUrl ?? 'http://localhost:7700',
        token,
        cardId: cardId!,
        credits: amount,
        params: opts?.params,
      });

      // Success: settle payment, reinforce memories
      const settlement = await this.agent.settle(tx.id);
      await this.agent.remember(
        `Successfully used "${query}" via provider ${cardId} for ${amount} credits.`,
        { importance: 0.7, tags: ['success', cardId!] },
      );

      return {
        result,
        reinforced: settlement.reinforced,
        memories: (await this.agent.profile()).memoriesCount,
      };
    } catch (error) {
      // Failure: refund, dock reputation, remember the failure
      await this.agent.refund(tx.id);
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.agent.remember(
        `Failed request for "${query}" via provider ${cardId}. Error: ${errorMsg}`,
        { importance: 0.8, tags: ['failure', cardId!] },
      );

      throw error;
    }
  }

  /**
   * Pick the best provider using memory, not just price.
   *
   * Scoring: memories about a provider boost or penalize their score.
   * Success memories add weight. Failure memories subtract more weight
   * (negativity bias — one bad experience outweighs one good one).
   * If no memories exist, falls back to cheapest.
   */
  private pickBestProvider(
    cards: Array<{ id: string; pricing: { credits_per_call: number }; owner?: string }>,
    memories: Array<{ content: string; importance: number }>,
  ) {
    let bestCard = cards[0];
    let bestScore = -Infinity;

    for (const card of cards) {
      let score = 0;
      let hasMemory = false;

      for (const mem of memories) {
        const content = mem.content.toLowerCase();
        const id = card.id.toLowerCase();
        const owner = (card.owner ?? '').toLowerCase();

        if (content.includes(id) || (owner && content.includes(owner))) {
          hasMemory = true;
          if (content.includes('success') || content.includes('delivered') || content.includes('clean')) {
            score += mem.importance * 2;
          }
          if (content.includes('fail') || content.includes('refund') || content.includes('error')) {
            score -= mem.importance * 3; // Negativity bias
          }
        }
      }

      // No memory? Score by price (cheaper = slightly better)
      if (!hasMemory) {
        score = 0.5 - (card.pricing.credits_per_call / 200);
      }

      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
      }
    }

    return bestCard;
  }

  /**
   * Get agent status including memory and economic state.
   */
  async getStatus() {
    this.ensureInitialized();
    const balance = await this.agent.balance();
    const profile = await this.agent.profile();
    return {
      identity: this.identity!,
      wallet: balance.wallet,
      reputation: balance.reputation,
      memoriesCount: profile.memoriesCount,
      transactionsCount: profile.transactionsCount,
    };
  }

  /**
   * Get the MnemoPayLite instance for direct access.
   * Use this for advanced memory operations (reinforce, consolidate, forget).
   */
  getAgent(): MnemoPayLite {
    return this.agent;
  }

  /**
   * Close resources.
   */
  close(): void {
    this.consumer.close();
  }

  private ensureInitialized(): void {
    if (!this.identity) {
      throw new AgentBnBError(
        'Adapter not initialized. Call initialize() first.',
        'NOT_INITIALIZED',
      );
    }
  }
}
