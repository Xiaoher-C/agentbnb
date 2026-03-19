/**
 * MCP tool: agentbnb_serve_skill
 *
 * Register as a skill provider on the AgentBnB network via relay.
 * Connects to the registry and listens for incoming skill requests.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RelayClient } from '../../relay/websocket-client.js';
import { listCards, openDatabase } from '../../registry/store.js';
import { openCreditDb } from '../../credit/ledger.js';
import { executeCapabilityRequest } from '../../gateway/execute.js';
import type { McpServerContext } from '../server.js';

/** Input schema shape for agentbnb_serve_skill */
const serveSkillInputSchema = {
  handler_url: z.string().optional().default('http://localhost:8080').describe('Local URL that handles capability execution'),
  skills_yaml: z.string().optional().describe('Path to skills.yaml config file'),
};

/**
 * Handler logic for agentbnb_serve_skill. Exported for direct testing.
 */
export async function handleServeSkill(
  args: { handler_url?: string; skills_yaml?: string },
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    if (!ctx.config.registry) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'No remote registry configured. Set one with: agentbnb config set registry <url>' }) }],
      };
    }

    // Build card data from local registry
    const db = openDatabase(ctx.config.db_path);
    let cards;
    try {
      cards = listCards(db, ctx.config.owner);
    } finally {
      db.close();
    }

    if (cards.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'No capability cards found. Publish a card first with agentbnb_publish.' }) }],
      };
    }

    // Use the first card as the provider card
    const card = cards[0]!;
    const handlerUrl = args.handler_url ?? 'http://localhost:8080';

    // Create relay client
    const relay = new RelayClient({
      registryUrl: ctx.config.registry,
      owner: ctx.config.owner,
      token: ctx.config.token ?? '',
      card: card as unknown as Record<string, unknown>,
      onRequest: async (req) => {
        // Execute the request using the standard execution path
        const registryDb = openDatabase(ctx.config.db_path);
        const creditDb = openCreditDb(ctx.config.credit_db_path);
        try {
          const result = await executeCapabilityRequest({
            registryDb,
            creditDb,
            cardId: req.params?.card_id as string ?? card.id,
            skillId: req.params?.skill_id as string | undefined,
            params: (req.params?.params as Record<string, unknown>) ?? {},
            requester: req.params?.requester as string ?? 'unknown',
            handlerUrl,
          });

          if (result.success) {
            return { result: result.result };
          }
          return { error: result.error };
        } finally {
          registryDb.close();
          creditDb.close();
        }
      },
      silent: true,
    });

    await relay.connect();

    // Store relay client on context for cleanup on shutdown
    ctx.relayClient = relay;

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        success: true,
        message: 'Connected to relay as provider',
        owner: ctx.config.owner,
        registry_url: ctx.config.registry,
        card_id: card.id,
        handler_url: handlerUrl,
      }, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during serve_skill';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
    };
  }
}

/**
 * Registers the agentbnb_serve_skill tool on an MCP server.
 *
 * @param server - MCP server instance.
 * @param ctx - Shared MCP server context.
 */
export function registerServeSkillTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_serve_skill', {
    description: 'Register as a skill provider on the AgentBnB network via relay. Connects to the registry and listens for incoming skill requests.',
    inputSchema: serveSkillInputSchema,
  }, async (args) => {
    return handleServeSkill(args, ctx);
  });
}
