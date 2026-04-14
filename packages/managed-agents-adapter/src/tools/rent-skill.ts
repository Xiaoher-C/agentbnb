import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AdapterConfig } from '../config.js';

/**
 * Open a temporary WebSocket to the relay, send a relay_request,
 * and await the response. Replicates the pattern from
 * src/gateway/relay-dispatch.ts without importing internal modules.
 *
 * The adapter uses only the public relay WebSocket protocol:
 * 1. Connect to registry /ws endpoint
 * 2. Send `register` message (temporary requester identity)
 * 3. On `registered` ack, send `relay_request`
 * 4. Await `response` message with matching request ID
 * 5. Disconnect
 */
async function relayRequest(opts: {
  registryUrl: string;
  serviceAccountOwner: string;
  targetOwner: string;
  targetAgentId?: string;
  cardId: string;
  skillId?: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const { default: WebSocket } = await import('ws');

  const timeoutMs = opts.timeoutMs ?? 300_000;
  const requestId = randomUUID();
  const requesterId = `${opts.serviceAccountOwner}:req:${randomUUID()}`;

  // Build WebSocket URL from registry URL
  let wsUrl = opts.registryUrl;
  if (wsUrl.startsWith('https://')) wsUrl = 'wss://' + wsUrl.slice(8);
  else if (wsUrl.startsWith('http://')) wsUrl = 'ws://' + wsUrl.slice(7);
  wsUrl = wsUrl.replace(/\/$/, '') + '/ws';

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;

    const finish = (value: { result?: unknown; error?: { code: number; message: string } }) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(requestTimer);
      try { ws.close(1000); } catch { /* ignore */ }
      resolve(value);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(requestTimer);
      try { ws.close(); } catch { /* ignore */ }
      reject(err);
    };

    // 10s connection timeout
    const connectTimer = setTimeout(() => {
      fail(new Error('Relay connection timeout (10s)'));
    }, 10_000);

    // Request-level timeout
    const requestTimer = setTimeout(() => {
      finish({ error: { code: -32000, message: `Relay request timeout (${timeoutMs}ms)` } });
    }, timeoutMs);

    ws.on('error', (err) => fail(err));

    ws.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(requestTimer);
        reject(new Error('WebSocket closed before response'));
      }
    });

    ws.on('open', () => {
      clearTimeout(connectTimer);

      // Register as a temporary requester (relay skips card upsert for :req: owners)
      ws.send(JSON.stringify({
        type: 'register',
        owner: requesterId,
        token: 'adapter-service-account',
        card: {
          spec_version: '1.0',
          id: randomUUID(),
          owner: requesterId,
          name: requesterId,
          description: 'Managed Agents adapter temporary requester',
          level: 1,
          inputs: [],
          outputs: [],
          pricing: { credits_per_call: 0 },
          availability: { online: false },
        },
      }));
    });

    ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        const type = msg['type'] as string;

        if (type === 'registered') {
          // Registration acknowledged — send the relay request
          ws.send(JSON.stringify({
            type: 'relay_request',
            id: requestId,
            target_owner: opts.targetOwner,
            ...(opts.targetAgentId ? { target_agent_id: opts.targetAgentId } : {}),
            card_id: opts.cardId,
            ...(opts.skillId ? { skill_id: opts.skillId } : {}),
            params: opts.params,
            requester: opts.serviceAccountOwner,
          }));
        }

        if (type === 'response' && msg['id'] === requestId) {
          if (msg['error']) {
            finish({ error: msg['error'] as { code: number; message: string } });
          } else {
            finish({ result: msg['result'] });
          }
        }

        if (type === 'error') {
          finish({
            error: {
              code: -32000,
              message: (msg['message'] as string) ?? 'Unknown relay error',
            },
          });
        }
      } catch { /* ignore non-JSON */ }
    });
  });
}

/**
 * Cumulative credit spend tracker for billing guardrail.
 * Resets on adapter restart. Prevents runaway costs in a single deployment cycle.
 */
let cumulativeCreditsSpent = 0;

/** Exported for testing. */
export function getCumulativeCreditsSpent(): number {
  return cumulativeCreditsSpent;
}

/** Reset cumulative spend. Exported for testing. */
export function resetCumulativeCreditsSpent(): void {
  cumulativeCreditsSpent = 0;
}

/**
 * Register the agentbnb_rent_skill tool on the MCP server.
 * Executes a skill via the AgentBnB protocol's relay + escrow flow.
 */
export function registerRentSkillTool(server: McpServer, config: AdapterConfig): void {
  server.tool(
    'agentbnb_rent_skill',
    'Rent and execute a capability from another agent on the AgentBnB protocol network. AgentBnB Skills (cross-org capabilities exchanged via DID + escrow) are distinct from Anthropic Agent Skills (uploaded bundles). Credits are held in escrow during execution and settled on completion.',
    {
      card_id: z.string().describe('AgentBnB Capability Card ID from search results'),
      skill_id: z.string().optional().describe('Specific skill within a multi-skill card'),
      params: z.record(z.unknown()).optional().describe('Input parameters for the skill'),
      max_credits: z.number().optional().default(20).describe('Maximum credits willing to spend on this rental'),
    },
    async (args) => {
      try {
        const registryUrl = config.registryUrl.replace(/\/$/, '');

        // Billing guardrail: early check against cumulative spend before fetching card
        // Approximate: 1 credit ~= $0.01 for cost comparison
        const estimatedCostUsd = cumulativeCreditsSpent * 0.01;
        if (estimatedCostUsd >= config.maxSessionCost) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'billing_guardrail',
                cumulative_credits_spent: cumulativeCreditsSpent,
                estimated_cost_usd: estimatedCostUsd.toFixed(2),
                max_session_cost_usd: config.maxSessionCost.toFixed(2),
                message: `Cumulative spend ($${estimatedCostUsd.toFixed(2)}) has reached the billing guardrail ($${config.maxSessionCost.toFixed(2)}). Restart the adapter or increase MAX_SESSION_COST to continue.`,
              }),
            }],
          };
        }

        // Step 1: Fetch the card to get pricing and provider info
        const cardRes = await fetch(`${registryUrl}/cards/${args.card_id}`, {
          signal: AbortSignal.timeout(10_000),
        });

        if (!cardRes.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: `Card ${args.card_id} not found (${cardRes.status})` }),
            }],
          };
        }

        const card = (await cardRes.json()) as Record<string, unknown>;

        // Step 2: Extract pricing and validate max_credits
        let creditsRequired = 0;
        const skills = card['skills'] as Array<{ id: string; pricing?: { credits_per_call: number } }> | undefined;
        if (Array.isArray(skills)) {
          const matched = args.skill_id
            ? skills.find((s) => s.id === args.skill_id)
            : skills[0];
          creditsRequired = matched?.pricing?.credits_per_call ?? 0;
        } else {
          const pricing = card['pricing'] as { credits_per_call: number } | undefined;
          creditsRequired = pricing?.credits_per_call ?? 0;
        }

        // Billing guardrail: check if this request would push cumulative spend over the cap
        const projectedCostUsd = (cumulativeCreditsSpent + creditsRequired) * 0.01;
        if (projectedCostUsd > config.maxSessionCost) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'billing_guardrail',
                credits_required: creditsRequired,
                cumulative_credits_spent: cumulativeCreditsSpent,
                projected_cost_usd: projectedCostUsd.toFixed(2),
                max_session_cost_usd: config.maxSessionCost.toFixed(2),
                message: `This request (${creditsRequired} credits) would push cumulative spend to $${projectedCostUsd.toFixed(2)}, exceeding the billing guardrail ($${config.maxSessionCost.toFixed(2)}). Restart the adapter or increase MAX_SESSION_COST to continue.`,
              }),
            }],
          };
        }

        if (creditsRequired > (args.max_credits ?? 20)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'max_credits_exceeded',
                credits_required: creditsRequired,
                max_credits: args.max_credits ?? 20,
                message: `Skill costs ${creditsRequired} credits but max_credits is ${args.max_credits ?? 20}. Increase max_credits to proceed.`,
              }),
            }],
          };
        }

        // Step 3: Get target owner/agent info for relay routing
        const targetOwner = (card['owner'] ?? card['agent_name']) as string | undefined;
        const targetAgentId = typeof card['agent_id'] === 'string' ? card['agent_id'] : undefined;

        if (!targetOwner) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'Card has no owner — cannot route relay request' }),
            }],
          };
        }

        // Step 4: Dispatch via relay WebSocket
        const relayResult = await relayRequest({
          registryUrl: config.registryUrl,
          serviceAccountOwner: config.serviceAccountOwner,
          targetOwner,
          targetAgentId,
          cardId: args.card_id,
          skillId: args.skill_id,
          params: {
            ...(args.params ?? {}),
            ...(args.skill_id ? { skill_id: args.skill_id } : {}),
            requester: config.serviceAccountOwner,
          },
          timeoutMs: 300_000,
        });

        if (relayResult.error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: relayResult.error.message,
                code: relayResult.error.code,
              }),
            }],
          };
        }

        // Track cumulative spend for billing guardrail
        cumulativeCreditsSpent += creditsRequired;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              result: relayResult.result,
              card_id: args.card_id,
              skill_id: args.skill_id,
              credits_charged: creditsRequired,
              cumulative_credits_spent: cumulativeCreditsSpent,
            }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Relay dispatch failed: ${msg}` }),
          }],
        };
      }
    },
  );
}
