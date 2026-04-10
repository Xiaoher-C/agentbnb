import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AdapterConfig } from '../config.js';

/** Escrow status values from the relay escrow state machine. */
type EscrowStatus = 'held' | 'started' | 'progressing' | 'settled' | 'released' | 'abandoned';

/** Map escrow status to a user-friendly result status. */
function mapEscrowStatus(status: EscrowStatus): string {
  switch (status) {
    case 'held':
    case 'started':
    case 'progressing':
      return 'in_progress';
    case 'settled':
      return 'complete';
    case 'released':
      return 'failed';
    case 'abandoned':
      return 'expired';
    default:
      return 'unknown';
  }
}

/**
 * Register the agentbnb_get_result tool on the MCP server.
 * Retrieves the result of an async skill rental by escrow ID.
 */
export function registerGetResultTool(server: McpServer, config: AdapterConfig): void {
  server.tool(
    'agentbnb_get_result',
    'Get the result of an async AgentBnB skill rental. Use the escrow_id returned by agentbnb_rent_skill when a rental is still pending.',
    {
      escrow_id: z.string().describe('Escrow ID returned by agentbnb_rent_skill for async results'),
    },
    async (args) => {
      try {
        const registryUrl = config.registryUrl.replace(/\/$/, '');

        const res = await fetch(`${registryUrl}/api/credits/escrow/${encodeURIComponent(args.escrow_id)}`, {
          signal: AbortSignal.timeout(10_000),
        });

        if (res.status === 404) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'not_found', escrow_id: args.escrow_id, message: 'Escrow record not found' }),
            }],
          };
        }

        if (!res.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: `Registry returned ${res.status}`, escrow_id: args.escrow_id }),
            }],
          };
        }

        const escrow = (await res.json()) as {
          status: EscrowStatus;
          result?: unknown;
          error?: string;
          amount?: number;
          settled_at?: string;
        };

        const status = mapEscrowStatus(escrow.status);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              escrow_id: args.escrow_id,
              status,
              escrow_status: escrow.status,
              ...(status === 'complete' ? { result: escrow.result } : {}),
              ...(status === 'failed' ? { error: escrow.error ?? 'Execution failed — credits released' } : {}),
              ...(status === 'expired' ? { error: 'Request timed out — credits released' } : {}),
              ...(escrow.amount !== undefined ? { credits: escrow.amount } : {}),
              ...(escrow.settled_at ? { settled_at: escrow.settled_at } : {}),
            }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Registry unreachable: ${msg}`, escrow_id: args.escrow_id }),
          }],
        };
      }
    },
  );
}
