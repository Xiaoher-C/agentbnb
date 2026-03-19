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
import { openDatabase } from '../../registry/store.js';
import { openCreditDb } from '../../credit/ledger.js';
import { createLedger } from '../../credit/create-ledger.js';
import { loadKeyPair } from '../../credit/signing.js';
import { RelayClient } from '../../relay/websocket-client.js';
import { requestCapability } from '../../gateway/client.js';
import type { CapabilityCard } from '../../types/index.js';
import type { McpServerContext } from '../server.js';

/** Input schema shape for agentbnb_request */
const requestInputSchema = {
  query: z.string().optional().describe('Search query to find a matching capability (auto-request mode)'),
  card_id: z.string().optional().describe('Direct card ID to request (skips search)'),
  skill_id: z.string().optional().describe('Specific skill within a v2.0 card'),
  params: z.record(z.unknown()).optional().describe('Input parameters for the capability'),
  max_cost: z.number().optional().default(50).describe('Maximum credits to spend'),
};

/**
 * Handler logic for agentbnb_request. Exported for direct testing.
 */
export async function handleRequest(
  args: { query?: string; card_id?: string; skill_id?: string; params?: Record<string, unknown>; max_cost?: number },
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const maxCost = args.max_cost ?? 50;

    // Auto-request mode: search + execute via AutoRequestor
    if (args.query) {
      const registryDb = openDatabase(ctx.config.db_path);
      const creditDb = openCreditDb(ctx.config.credit_db_path);
      registryDb.pragma('busy_timeout = 5000');
      creditDb.pragma('busy_timeout = 5000');

      try {
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
        });

        const result = await requestor.requestWithAutonomy({
          query: args.query,
          maxCostCredits: maxCost,
          params: args.params,
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...result }, null, 2) }],
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

      // Local card — use local gateway
      if (localCard) {
        const result = await requestCapability({
          gatewayUrl: ctx.config.gateway_url,
          token: ctx.config.token,
          cardId,
          params: { ...(args.params ?? {}), ...(args.skill_id ? { skill_id: args.skill_id } : {}) },
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
      const gatewayUrl = remoteCard['gateway_url'] as string | undefined;

      // Direct HTTP request with CreditLedger escrow
      if (gatewayUrl) {
        const keys = loadKeyPair(ctx.configDir);
        const ledger = createLedger({
          registryUrl: ctx.config.registry,
          ownerPublicKey: ctx.identity.public_key,
          privateKey: keys.privateKey,
        });

        const { escrowId } = await ledger.hold(ctx.config.owner, maxCost, cardId);
        try {
          const result = await requestCapability({
            gatewayUrl,
            token: '',
            cardId,
            params: { ...(args.params ?? {}), ...(args.skill_id ? { skill_id: args.skill_id } : {}) },
          });
          await ledger.settle(escrowId, targetOwner ?? 'unknown');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: true, result, credits_spent: maxCost }, null, 2) }],
          };
        } catch (err) {
          await ledger.release(escrowId);
          throw err;
        }
      }

      // Relay-only: no gateway_url, relay handles credits server-side
      if (targetOwner) {
        const relay = new RelayClient({
          registryUrl: ctx.config.registry,
          owner: ctx.config.owner,
          token: ctx.config.token ?? '',
          card: { id: ctx.config.owner, owner: ctx.config.owner, name: 'mcp-requester' },
          onRequest: async () => ({ error: { code: -32601, message: 'MCP client does not accept requests' } }),
          silent: true,
        });

        try {
          await relay.connect();
          const result = await relay.request({
            targetOwner,
            cardId,
            skillId: args.skill_id,
            params: args.params ?? {},
            requester: ctx.config.owner,
            timeoutMs: 300_000,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: true, result }, null, 2) }],
          };
        } finally {
          relay.disconnect();
        }
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
