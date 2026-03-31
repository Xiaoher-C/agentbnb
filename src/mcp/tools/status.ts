/**
 * MCP tool: agentbnb_status
 *
 * Check your AgentBnB agent status: identity, credit balance, and configuration.
 * When a registry is configured, both local and registry balances are returned
 * so LLM agents can detect stale local state.
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
 * Returns 0 on any error (e.g. fresh install with no DB yet).
 */
function readLocalBalance(creditDbPath: string, creditKey: string): number {
  const creditDb = openCreditDb(creditDbPath);
  try {
    return getBalance(creditDb, creditKey);
  } catch {
    return 0;
  } finally {
    creditDb.close();
  }
}

/**
 * Handler logic for agentbnb_status. Exported for direct testing.
 *
 * When `config.registry` is set the handler fetches the authoritative registry
 * balance via Ed25519-signed HTTP and also reads the local SQLite balance.
 * Both are included in the response along with `sync_needed` (true when they
 * differ by more than 1 credit) so LLM agents can act on stale local state.
 */
export async function handleStatus(
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    // Prefer agent_id (cryptographic identity) over owner (legacy human-chosen string).
    // owner is kept as fallback for agents that pre-date the v8 agent_id migration.
    const creditKey = ctx.identity.agent_id ?? ctx.identity.owner;

    const local_balance = readLocalBalance(ctx.config.credit_db_path, creditKey);

    let registry_balance: number | null = null;
    let sync_needed = false;

    if (ctx.config.registry) {
      try {
        const keys = loadKeyPair(ctx.configDir);
        const ledger = createLedger({
          registryUrl: ctx.config.registry,
          ownerPublicKey: ctx.identity.public_key,
          privateKey: keys.privateKey,
        });
        registry_balance = await ledger.getBalance(creditKey);
        sync_needed = Math.abs(registry_balance - local_balance) > 1;
      } catch {
        // Registry unreachable — fall through with registry_balance = null.
      }
    }

    const balance = registry_balance ?? local_balance;

    const result = {
      agent_id: ctx.identity.agent_id,
      owner: ctx.identity.owner,
      public_key: ctx.identity.public_key,
      balance,
      local_balance,
      ...(ctx.config.registry ? { registry_balance, sync_needed } : {}),
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
