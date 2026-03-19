/**
 * MCP tool: agentbnb_serve_skill
 *
 * Register as a skill provider on the AgentBnB network via relay.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
  _ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Stub — will be fully implemented in Task 2
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Not yet implemented' }) }],
  };
  void args;
}

/**
 * Registers the agentbnb_serve_skill tool on an MCP server.
 */
export function registerServeSkillTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_serve_skill', {
    description: 'Register as a skill provider on the AgentBnB network via relay. Connects to the registry and listens for incoming skill requests.',
    inputSchema: serveSkillInputSchema,
  }, async (args) => {
    return handleServeSkill(args, ctx);
  });
}
