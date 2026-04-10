import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AdapterConfig } from '../config.js';

/** Map user-friendly layer names to numeric levels used by the registry API. */
const LAYER_TO_LEVEL: Record<string, number> = {
  atomic: 1,
  pipeline: 2,
  environment: 3,
};

/** Shape of a skill card returned by the registry GET /cards endpoint. */
interface RegistryCard {
  id: string;
  owner: string;
  name: string;
  description: string;
  level: number;
  pricing?: { credits_per_call: number };
  skills?: Array<{
    id: string;
    name?: string;
    description?: string;
    pricing?: { credits_per_call: number };
  }>;
  reputation?: number;
  agent_id?: string;
}

/**
 * Register the agentbnb_search_skills tool on the MCP server.
 * Wraps the registry GET /cards endpoint with FTS5 full-text search.
 */
export function registerSearchSkillsTool(server: McpServer, config: AdapterConfig): void {
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
      try {
        const registryUrl = config.registryUrl.replace(/\/$/, '');
        const params = new URLSearchParams();
        params.set('q', args.query);
        params.set('online', 'true');
        params.set('limit', String(args.max_results ?? 10));
        if (args.layer) {
          params.set('level', String(LAYER_TO_LEVEL[args.layer]));
        }

        const res = await fetch(`${registryUrl}/cards?${params.toString()}`, {
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: `Registry returned ${res.status}`, query: args.query }),
            }],
          };
        }

        const cards = (await res.json()) as RegistryCard[];

        // Map to clean output for the Managed Agent
        const results = cards.map((card) => {
          const skills = card.skills?.map((s) => ({
            skill_id: s.id,
            name: s.name ?? card.name,
            description: s.description ?? card.description,
            credits_per_call: s.pricing?.credits_per_call ?? card.pricing?.credits_per_call ?? 0,
          })) ?? [{
            skill_id: card.id,
            name: card.name,
            description: card.description,
            credits_per_call: card.pricing?.credits_per_call ?? 0,
          }];

          return {
            card_id: card.id,
            name: card.name,
            description: card.description,
            layer: card.level === 1 ? 'atomic' : card.level === 2 ? 'pipeline' : 'environment',
            provider_reputation: card.reputation ?? null,
            skills,
          };
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              results,
              total: results.length,
              query: args.query,
            }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Registry unreachable: ${msg}`, query: args.query }),
          }],
        };
      }
    },
  );
}
