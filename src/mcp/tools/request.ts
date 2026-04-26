/**
 * MCP tool: agentbnb_request
 *
 * Request execution of a skill from another agent on the AgentBnB network.
 * Handles credit escrow automatically.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AutoRequestor } from '../../autonomy/auto-request.js';
import { BudgetManager, DEFAULT_BUDGET_CONFIG } from '../../credit/budget.js';
import { DEFAULT_AUTONOMY_CONFIG } from '../../autonomy/tiers.js';
import { checkConsumerBudget, recordConsumerSpend, createSessionState, DEFAULT_CONSUMER_AUTONOMY } from '../../autonomy/consumer-autonomy.js';
import { openDatabase } from '../../registry/store.js';
import { openCreditDb } from '../../credit/ledger.js';
import { loadKeyPair } from '../../credit/signing.js';
import { requestCapability } from '../../gateway/client.js';
import type { IdentityAuth, RequestTimeoutHint } from '../../gateway/client.js';
import { requestViaTemporaryRelay } from '../../gateway/relay-dispatch.js';
import type { CapabilityCard } from '../../types/index.js';
import type { McpServerContext } from '../server.js';

/** Input schema shape for agentbnb_request */
const requestInputSchema = {
  query: z.string().optional().describe('Search query to find a matching capability (auto-request mode)'),
  card_id: z.string().optional().describe('Direct card ID to request (skips search)'),
  skill_id: z.string().optional().describe('Specific skill within a v2.0 card'),
  params: z.record(z.unknown()).optional().describe('Input parameters for the capability'),
  max_cost: z.number().optional().default(50).describe('Maximum credits to spend'),
  timeout_ms: z.number().positive().optional().describe('Requester timeout override in milliseconds'),
};

function parsePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function deriveTimeoutHintFromCard(remoteCard: Record<string, unknown>, skillId?: string): RequestTimeoutHint | undefined {
  const topLevelHint: RequestTimeoutHint = {
    expected_duration_ms: parsePositiveNumber(remoteCard['expected_duration_ms']),
    hard_timeout_ms: parsePositiveNumber(remoteCard['hard_timeout_ms']),
  };

  const skills = remoteCard['skills'];
  if (!Array.isArray(skills)) {
    return topLevelHint.expected_duration_ms !== undefined || topLevelHint.hard_timeout_ms !== undefined
      ? topLevelHint
      : undefined;
  }

  const selectedSkill = skillId
    ? skills.find((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false;
      return (candidate as Record<string, unknown>)['id'] === skillId;
    })
    : skills[0];

  if (!selectedSkill || typeof selectedSkill !== 'object') {
    return topLevelHint.expected_duration_ms !== undefined || topLevelHint.hard_timeout_ms !== undefined
      ? topLevelHint
      : undefined;
  }

  const skillRecord = selectedSkill as Record<string, unknown>;
  const skillHint: RequestTimeoutHint = {
    expected_duration_ms: parsePositiveNumber(skillRecord['expected_duration_ms']) ?? topLevelHint.expected_duration_ms,
    hard_timeout_ms: parsePositiveNumber(skillRecord['hard_timeout_ms']) ?? topLevelHint.hard_timeout_ms,
  };

  return skillHint.expected_duration_ms !== undefined || skillHint.hard_timeout_ms !== undefined
    ? skillHint
    : undefined;
}

/**
 * Handler logic for agentbnb_request. Exported for direct testing.
 */
export async function handleRequest(
  args: { query?: string; card_id?: string; skill_id?: string; params?: Record<string, unknown>; max_cost?: number; timeout_ms?: number },
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const maxCost = args.max_cost ?? 50;
    const consumerConfig = ctx.config.consumer_autonomy ?? DEFAULT_CONSUMER_AUTONOMY;

    // Lazily initialize consumer session state (persists across calls within an MCP session)
    if (!ctx.consumerSession) {
      ctx.consumerSession = createSessionState();
    }

    // Auto-request mode: search + execute via AutoRequestor
    if (args.query) {
      // Consumer autonomy check: use maxCost as estimated cost for auto-request
      const budgetCheck = checkConsumerBudget(consumerConfig, ctx.consumerSession, maxCost);
      if (!budgetCheck.allowed) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: budgetCheck.error, budget_exceeded: true }) }],
        };
      }

      const registryDb = openDatabase(ctx.config.db_path);
      const creditDb = openCreditDb(ctx.config.credit_db_path);
      registryDb.pragma('busy_timeout = 5000');
      creditDb.pragma('busy_timeout = 5000');

      try {
        // Load local signing identity so AutoRequestor can mint real UCAN
        // tokens for relay calls (audit finding CRITICAL-2).
        const { loadOrRepairIdentity } = await import('../../identity/identity.js');
        let identity: { did: string; privateKey: Buffer } | undefined;
        try {
          const loaded = loadOrRepairIdentity(ctx.configDir, ctx.config.owner);
          if (loaded.identity.did) {
            identity = { did: loaded.identity.did, privateKey: loaded.keys.privateKey };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[mcp:request] failed to load signing identity: ${message}`);
        }

        const budgetManager = new BudgetManager(
          creditDb,
          ctx.config.owner,
          ctx.config.budget ?? DEFAULT_BUDGET_CONFIG,
        );
        const requestor = new AutoRequestor({
          owner: ctx.config.owner,
          registryDb,
          creditDb,
          autonomyConfig: ctx.config.autonomy ?? DEFAULT_AUTONOMY_CONFIG,
          budgetManager,
          registryUrl: ctx.config.registry,
          identity,
        });

        const result = await requestor.requestWithAutonomy({
          query: args.query,
          maxCostCredits: maxCost,
          params: args.params,
        });

        // Record spend in session state
        const creditsUsed = typeof result?.creditsSpent === 'number' ? result.creditsSpent : 0;
        recordConsumerSpend(ctx.consumerSession, creditsUsed);

        const response: Record<string, unknown> = { success: true, ...result };
        if (budgetCheck.warning) response.spend_warning = budgetCheck.warning;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      } finally {
        registryDb.close();
        creditDb.close();
      }
    }

    // Direct request mode: card_id is required
    if (args.card_id) {
      const cardId = args.card_id;

      // Check if card exists locally
      const db = openDatabase(ctx.config.db_path);
      let localCard: CapabilityCard | undefined;
      try {
        const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string } | undefined;
        if (row) {
          localCard = JSON.parse(row.data) as CapabilityCard;
        }
      } finally {
        db.close();
      }

      // Build signed identity auth when key material is available.
      let identityAuth: IdentityAuth | undefined;
      try {
        const keys = loadKeyPair(ctx.configDir);
        identityAuth = {
          agentId: ctx.identity.agent_id,
          publicKey: ctx.identity.public_key,
          privateKey: keys.privateKey,
        };
      } catch {
        // Backward compatibility: allow bearer-only requests when keypair is unavailable.
      }

      // Local card (owned by this agent) — use local gateway
      if (localCard && localCard.owner === ctx.config.owner) {
        const result = await requestCapability({
          gatewayUrl: ctx.config.gateway_url,
          token: ctx.config.token,
          cardId,
          params: { ...(args.params ?? {}), ...(args.skill_id ? { skill_id: args.skill_id } : {}), requester: ctx.config.owner },
          timeoutMs: args.timeout_ms,
          identity: identityAuth,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: true, result }, null, 2) }],
        };
      }

      // Card not local — try remote registry
      if (!ctx.config.registry) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Card not found locally and no remote registry configured' }) }],
        };
      }

      // Fetch card from remote registry
      const cardUrl = `${ctx.config.registry.replace(/\/$/, '')}/cards/${cardId}`;
      let remoteCard: Record<string, unknown>;
      try {
        const resp = await fetch(cardUrl);
        if (!resp.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `Card ${cardId} not found on remote registry (${resp.status})` }) }],
          };
        }
        remoteCard = await resp.json() as Record<string, unknown>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Registry unreachable';
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `Cannot reach registry: ${msg}` }) }],
        };
      }

      const targetOwner = (remoteCard['owner'] ?? remoteCard['agent_name']) as string | undefined;
      const targetAgentId = typeof remoteCard['agent_id'] === 'string' ? remoteCard['agent_id'] : undefined;
      const gatewayUrl = remoteCard['gateway_url'] as string | undefined;
      const timeoutHint = deriveTimeoutHintFromCard(remoteCard, args.skill_id);

      // Extract pricing from remote card for consumer budget check and escrow
      let remoteCost = 0;
      const remoteSkills = remoteCard['skills'] as Array<{ id: string; pricing: { credits_per_call: number } }> | undefined;
      if (Array.isArray(remoteSkills)) {
        const matchedSkill = args.skill_id
          ? remoteSkills.find((s) => s.id === args.skill_id)
          : remoteSkills[0];
        remoteCost = matchedSkill?.pricing?.credits_per_call ?? 0;
      } else {
        const remotePricing = remoteCard['pricing'] as { credits_per_call: number } | undefined;
        remoteCost = remotePricing?.credits_per_call ?? 0;
      }

      // Direct HTTP request to provider gateway.
      // Match CLI behavior: local SQLite escrow + signed receipt for cross-machine
      // credit verification. The provider gateway verifies the receipt and skips
      // its own credit check (see execute.ts receipt path).
      if (gatewayUrl) {
        if (remoteCost > 0) {
          // Consumer autonomy check before paid execution
          const budgetCheck = checkConsumerBudget(consumerConfig, ctx.consumerSession, remoteCost);
          if (!budgetCheck.allowed) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: budgetCheck.error, budget_exceeded: true }) }],
            };
          }

          // Paid skill: route via relay so the Hub handles escrow + network fee.
          // This avoids the fee bypass bug in the signed receipt path (see settlement.ts).
          if (!targetOwner) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Paid remote request requires a target owner for relay routing' }) }],
            };
          }
          const result = await requestViaTemporaryRelay({
            registryUrl: ctx.config.registry,
            owner: ctx.config.owner,
            token: ctx.config.token ?? '',
            targetOwner,
            targetAgentId,
            cardId,
            skillId: args.skill_id,
            params: { ...(args.params ?? {}), ...(args.skill_id ? { skill_id: args.skill_id } : {}), requester: ctx.config.owner },
            timeoutMs: args.timeout_ms,
          });
          // Record spend in session state
          recordConsumerSpend(ctx.consumerSession, remoteCost);
          const response: Record<string, unknown> = { success: true, result, creditsSpent: remoteCost };
          if (budgetCheck.warning) response.spend_warning = budgetCheck.warning;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        } else {
          // Free skill: no escrow needed
          const result = await requestCapability({
            gatewayUrl,
            token: ctx.config.token ?? '',
            cardId,
            params: { ...(args.params ?? {}), ...(args.skill_id ? { skill_id: args.skill_id } : {}), requester: ctx.config.owner },
            timeoutMs: args.timeout_ms,
            timeoutHint,
            identity: identityAuth,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: true, result }, null, 2) }],
          };
        }
      }

      // Relay-only: no gateway_url, relay handles credits server-side
      if (targetOwner) {
        // Consumer autonomy check before relay-routed request
        if (remoteCost > 0) {
          const budgetCheck = checkConsumerBudget(consumerConfig, ctx.consumerSession, remoteCost);
          if (!budgetCheck.allowed) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: budgetCheck.error, budget_exceeded: true }) }],
            };
          }
        }

        const result = await requestViaTemporaryRelay({
          registryUrl: ctx.config.registry,
          owner: ctx.config.owner,
          token: ctx.config.token ?? '',
          targetOwner,
          targetAgentId,
          cardId,
          skillId: args.skill_id,
          params: { ...(args.params ?? {}), ...(args.skill_id ? { skill_id: args.skill_id } : {}) },
          timeoutMs: args.timeout_ms,
        });
        // Record spend in session state
        if (remoteCost > 0) {
          recordConsumerSpend(ctx.consumerSession, remoteCost);
        }
        const response: Record<string, unknown> = { success: true, result };
        if (remoteCost > 0) response.creditsSpent = remoteCost;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Remote card has no gateway_url and no owner for relay routing' }) }],
      };
    }

    // Neither query nor card_id provided
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Provide either query or card_id' }) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during request';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
    };
  }
}

/**
 * Registers the agentbnb_request tool on an MCP server.
 *
 * @param server - MCP server instance.
 * @param ctx - Shared MCP server context.
 */
export function registerRequestTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_request', {
    description: 'Request execution of a skill from another agent on the AgentBnB network. Handles credit escrow automatically.',
    inputSchema: requestInputSchema,
  }, async (args) => {
    return handleRequest(args, ctx);
  });
}
