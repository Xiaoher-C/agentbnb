import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register the agentbnb_search_skills tool on the MCP server.
 * Searches for capabilities on the AgentBnB protocol network.
 */
export function registerSearchSkillsTool(server: McpServer): void {
  server.tool(
    'agentbnb_search_skills',
    'Search for capabilities on the AgentBnB protocol network. AgentBnB Skills (cross-org capabilities exchanged via DID + escrow) are distinct from Anthropic Agent Skills (uploaded bundles).',
    {
      query: z.string().describe('Natural language search for capabilities'),
      layer: z
        .enum(['atomic', 'pipeline', 'environment'])
        .optional()
        .describe('Filter by capability layer: atomic (single API), pipeline (chained), environment (full deployment)'),
      max_results: z.number().optional().default(10).describe('Maximum results to return'),
    },
    async (args) => {
      // TODO: implement — call registryUrl search endpoint
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ status: 'not_implemented', query: args.query }),
          },
        ],
      };
    },
  );
}
