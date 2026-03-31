/**
 * MCP tool: agentbnb_status
 *
 * Check your AgentBnB agent status: identity, credit balance, and configuration.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLedger } from '../../credit/create-ledger.js';
import { openCreditDb, getBalance } from '../../credit/ledger.js';
import { loadKeyPair } from '../../credit/signing.js';
import type { McpServerContext } from '../server.js';

/** Input schema shape for agentbnb_status (no inputs needed) */
const statusInputSchema = {
  _unused: z.string().optional().describe('No parameters needed'),
};

/**
 * Handler logic for agentbnb_status. Exported for direct testing.
 */
export async function handleStatus(
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    let balance = 0;
    // Prefer agent_id (cryptographic identity) over owner (legacy human-chosen string).
    // owner is kept as fallback for agents that pre-date the v8 agent_id migration.
    const creditKey = ctx.identity.agent_id ?? ctx.identity.owner;

    if (ctx.config.registry) {
      try {
        const keys = loadKeyPair(ctx.configDir);
        const ledger = createLedger({
          registryUrl: ctx.config.registry,
          ownerPublicKey: ctx.identity.public_key,
          privateKey: keys.privateKey,
        });
        balance = await ledger.getBalance(creditKey);
      } catch {
        // Fall back to local balance on error
        const creditDb = openCreditDb(ctx.config.credit_db_path);
        try {
          balance = getBalance(creditDb, creditKey);
        } finally {
          creditDb.close();
        }
      }
    } else {
      const creditDb = openCreditDb(ctx.config.credit_db_path);
      try {
        balance = getBalance(creditDb, creditKey);
      } finally {
        creditDb.close();
      }
    }

    const result = {
      agent_id: ctx.identity.agent_id,
      owner: ctx.identity.owner,
      public_key: ctx.identity.public_key,
      balance,
      registry_url: ctx.config.registry ?? null,
      config_dir: ctx.configDir,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during status check';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
    };
  }
}

/**
 * Registers the agentbnb_status tool on an MCP server.
 *
 * @param server - MCP server instance.
 * @param ctx - Shared MCP server context.
 */
export function registerStatusTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_status', {
    description: 'Check your AgentBnB agent status: identity, credit balance, and configuration.',
    inputSchema: statusInputSchema,
  }, async () => {
    return handleStatus(ctx);
  });
}
