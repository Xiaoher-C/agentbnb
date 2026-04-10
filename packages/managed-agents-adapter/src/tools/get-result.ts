import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register the agentbnb_get_result tool on the MCP server.
 * Retrieves the result of an async skill rental by escrow ID.
 */
export function registerGetResultTool(server: McpServer): void {
  server.tool(
    'agentbnb_get_result',
    'Get the result of an async AgentBnB skill rental. Use the escrow_id returned by agentbnb_rent_skill.',
    {
      escrow_id: z.string().describe('Escrow ID returned by agentbnb_rent_skill for async results'),
    },
    async (args) => {
      // TODO: implement — poll escrow status and retrieve result
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ status: 'not_implemented', escrow_id: args.escrow_id }),
          },
        ],
      };
    },
  );
}
