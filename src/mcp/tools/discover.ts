/**
 * MCP tool: agentbnb_discover
 *
 * Searches for agent capabilities on the AgentBnB network.
 * Returns matching capability cards from both local and remote registries.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchCards } from '../../registry/matcher.js';
import { openDatabase } from '../../registry/store.js';
import { fetchRemoteCards, mergeResults } from '../../cli/remote-registry.js';
import type { McpServerContext } from '../server.js';

/** Input schema shape for agentbnb_discover */
const discoverInputSchema = {
  query: z.string().describe('Natural language search query'),
  level: z.number().optional().describe('Filter by capability level (1=Atomic, 2=Pipeline, 3=Environment)'),
  online_only: z.boolean().optional().describe('Only show online agents'),
};

/**
 * Handler logic for agentbnb_discover. Exported for direct testing.
 */
export async function handleDiscover(
  args: { query: string; level?: number; online_only?: boolean },
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const db = openDatabase(ctx.config.db_path);
    let localCards;
    try {
      localCards = searchCards(db, args.query, {
        level: args.level as 1 | 2 | 3 | undefined,
        online: args.online_only,
      });
    } finally {
      db.close();
    }

    let remoteCards: Awaited<ReturnType<typeof fetchRemoteCards>> = [];
    if (ctx.config.registry) {
      try {
        remoteCards = await fetchRemoteCards(ctx.config.registry, {
          q: args.query,
          level: args.level,
          online: args.online_only,
        });
      } catch {
        // Remote failure is non-fatal — continue with local results only
      }
    }

    const merged = mergeResults(localCards, remoteCards, true);

    const results = merged.map((card) => {
      const raw = card as Record<string, unknown>;
      const skills = Array.isArray(raw['skills'])
        ? (raw['skills'] as Array<{ id: string; name: string; description: string; pricing: { credits_per_call: number } }>).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            credits_per_call: s.pricing.credits_per_call,
          }))
        : undefined;

      return {
        id: card.id,
        name: card.name,
        owner: card.owner,
        description: card.description,
        level: card.level,
        skills,
        pricing: card.pricing,
        source: card.source,
        online: card.availability?.online ?? false,
      };
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ results, count: results.length }, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during discover';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
    };
  }
}

/**
 * Registers the agentbnb_discover tool on an MCP server.
 *
 * @param server - MCP server instance.
 * @param ctx - Shared MCP server context.
 */
export function registerDiscoverTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_discover', {
    description: 'Search for agent capabilities on the AgentBnB network. Returns matching capability cards from both local and remote registries.',
    inputSchema: discoverInputSchema,
  }, async (args) => {
    return handleDiscover(args, ctx);
  });
}
