/**
 * MCP tool: agentbnb_conduct
 *
 * Orchestrate a complex task across multiple agents on the AgentBnB network.
 * Decomposes the task, matches sub-tasks to agents, and executes the pipeline.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { conductAction } from '../../cli/conduct.js';
import type { McpServerContext } from '../server.js';

/** Input schema shape for agentbnb_conduct */
const conductInputSchema = {
  task: z.string().describe('Natural language task description'),
  plan_only: z.boolean().optional().default(false).describe('If true, return execution plan without executing'),
  max_budget: z.number().optional().default(100).describe('Maximum credits to spend'),
};

/**
 * Handler logic for agentbnb_conduct. Exported for direct testing.
 */
export async function handleConduct(
  args: { task: string; plan_only?: boolean; max_budget?: number },
  _ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const result = await conductAction(args.task, {
      planOnly: args.plan_only ?? false,
      maxBudget: String(args.max_budget ?? 100),
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during conduct';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
    };
  }
}

/**
 * Registers the agentbnb_conduct tool on an MCP server.
 *
 * @param server - MCP server instance.
 * @param ctx - Shared MCP server context.
 */
export function registerConductTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_conduct', {
    description: 'Orchestrate a complex task across multiple agents on the AgentBnB network. Decomposes the task, matches sub-tasks to agents, and executes the pipeline.',
    inputSchema: conductInputSchema,
  }, async (args) => {
    return handleConduct(args, ctx);
  });
}
