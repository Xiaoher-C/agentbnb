/**
 * MCP tool: agentbnb_publish
 *
 * Publish a capability card to the AgentBnB network.
 * Stores locally and optionally syncs to remote registry.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AnyCardSchema } from '../../types/index.js';
import { openDatabase, insertCard } from '../../registry/store.js';
import type { CapabilityCard } from '../../types/index.js';
import type { McpServerContext } from '../server.js';

/** Input schema shape for agentbnb_publish */
const publishInputSchema = {
  card_json: z.string().describe('JSON string of the capability card to publish'),
};

/**
 * Handler logic for agentbnb_publish. Exported for direct testing.
 */
export async function handlePublish(
  args: { card_json: string },
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    // Parse and validate
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.card_json);
    } catch {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Invalid JSON in card_json' }) }],
      };
    }

    const validated = AnyCardSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Card validation failed', details: validated.error.issues }) }],
      };
    }

    const card = validated.data;

    // Enforce minimum price
    const rawCard = card as Record<string, unknown>;
    if (Array.isArray(rawCard['skills'])) {
      const skills = rawCard['skills'] as Array<{ pricing: { credits_per_call: number } }>;
      for (const skill of skills) {
        if (skill.pricing.credits_per_call < 1) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Minimum price is 1 credit per call for each skill' }) }],
          };
        }
      }
    } else {
      const pricing = rawCard['pricing'] as { credits_per_call: number } | undefined;
      if (pricing && pricing.credits_per_call < 1) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Minimum price is 1 credit per call' }) }],
        };
      }
    }

    // Insert into local registry
    const db = openDatabase(ctx.config.db_path);
    try {
      insertCard(db, card as CapabilityCard);
    } finally {
      db.close();
    }

    // Optionally publish to remote registry
    let remotePublished = false;
    if (ctx.config.registry) {
      try {
        const publishUrl = new URL('/cards', ctx.config.registry);
        const body = {
          ...card,
          gateway_url: ctx.config.gateway_url,
        };
        const res = await fetch(publishUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        remotePublished = res.ok;
      } catch {
        // Remote publish failure is non-fatal
      }
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        success: true,
        card_id: card.id,
        card_name: (rawCard['name'] ?? rawCard['agent_name'] ?? card.id) as string,
        remote_published: remotePublished,
      }, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during publish';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
    };
  }
}

/**
 * Registers the agentbnb_publish tool on an MCP server.
 *
 * @param server - MCP server instance.
 * @param ctx - Shared MCP server context.
 */
export function registerPublishTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_publish', {
    description: 'Publish a capability card to the AgentBnB network. Stores locally and optionally syncs to remote registry.',
    inputSchema: publishInputSchema,
  }, async (args) => {
    return handlePublish(args, ctx);
  });
}
