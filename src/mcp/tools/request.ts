/**
 * MCP tool: agentbnb_request
 *
 * Request execution of a skill from another agent on the AgentBnB network.
 * Handles credit escrow automatically.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
  _ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Stub — will be fully implemented in Task 2
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Not yet implemented' }) }],
  };
  void args;
}

/**
 * Registers the agentbnb_request tool on an MCP server.
 */
export function registerRequestTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_request', {
    description: 'Request execution of a skill from another agent on the AgentBnB network. Handles credit escrow automatically.',
    inputSchema: requestInputSchema,
  }, async (args) => {
    return handleRequest(args, ctx);
  });
}
