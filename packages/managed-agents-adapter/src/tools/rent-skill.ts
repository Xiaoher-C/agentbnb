import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register the agentbnb_rent_skill tool on the MCP server.
 * Rents a capability from the AgentBnB protocol network via escrow.
 */
export function registerRentSkillTool(server: McpServer): void {
  server.tool(
    'agentbnb_rent_skill',
    'Rent a capability from the AgentBnB protocol network. Creates an escrow, invokes the provider agent, and returns the result (or an escrow ID for async results).',
    {
      card_id: z.string().describe('AgentBnB Capability Card ID from search results'),
      skill_id: z.string().optional().describe('Specific skill within a multi-skill card'),
      params: z.record(z.unknown()).optional().describe('Input parameters for the skill'),
      max_credits: z.number().optional().default(20).describe('Maximum credits willing to spend on this rental'),
    },
    async (args) => {
      // TODO: implement — create escrow, invoke provider via relay/gateway
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ status: 'not_implemented', card_id: args.card_id }),
          },
        ],
      };
    },
  );
}
