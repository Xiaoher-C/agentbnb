/**
 * MCP tools: agentbnb_session_open, agentbnb_session_send, agentbnb_session_end
 *
 * Interactive agent-to-agent sessions via the WebSocket relay.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../server.js';

// ---------------------------------------------------------------------------
// agentbnb_session_open
// ---------------------------------------------------------------------------

const sessionOpenInputSchema = {
  provider_id: z.string().describe('Provider agent ID or owner to connect to'),
  card_id: z.string().describe('Capability card ID of the provider'),
  skill_id: z.string().describe('Skill ID to use for the session'),
  budget: z.number().positive().describe('Maximum credits for this session'),
  message: z.string().describe('Initial message to send to the provider'),
  pricing_model: z.enum(['per_message', 'per_minute', 'per_session']).optional()
    .describe('Pricing model (default: per_message)'),
};

/**
 * Handler for agentbnb_session_open.
 */
export async function handleSessionOpen(
  args: { provider_id: string; card_id: string; skill_id: string; budget: number; message: string; pricing_model?: string },
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!ctx.relayClient) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not connected to relay. Run agentbnb serve first.' }) }] };
  }

  try {
    const sessionId = crypto.randomUUID();
    const ws = (ctx.relayClient as unknown as { ws?: { send: (data: string) => void } }).ws;
    if (!ws) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'WebSocket not available on relay client.' }) }] };
    }

    ws.send(JSON.stringify({
      type: 'session_open',
      session_id: sessionId,
      requester_id: ctx.identity.agent_id ?? ctx.identity.owner,
      provider_id: args.provider_id,
      card_id: args.card_id,
      skill_id: args.skill_id,
      budget: args.budget,
      pricing_model: args.pricing_model ?? 'per_message',
      initial_message: args.message,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          session_id: sessionId,
          status: 'opening',
          provider_id: args.provider_id,
          skill_id: args.skill_id,
          budget: args.budget,
          message: 'Session open request sent. Listen for session_ack and session_message responses.',
        }),
      }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }] };
  }
}

export function registerSessionOpenTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_session_open', {
    description: 'Open an interactive session with a provider agent for multi-turn conversation. Returns a session_id to use with session_send and session_end.',
    inputSchema: sessionOpenInputSchema,
  }, async (args) => handleSessionOpen(args as Parameters<typeof handleSessionOpen>[0], ctx));
}

// ---------------------------------------------------------------------------
// agentbnb_session_send
// ---------------------------------------------------------------------------

const sessionSendInputSchema = {
  session_id: z.string().describe('Session ID from session_open'),
  message: z.string().describe('Message to send to the provider'),
};

/**
 * Handler for agentbnb_session_send.
 */
export async function handleSessionSend(
  args: { session_id: string; message: string },
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!ctx.relayClient) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not connected to relay.' }) }] };
  }

  try {
    const ws = (ctx.relayClient as unknown as { ws?: { send: (data: string) => void } }).ws;
    if (!ws) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'WebSocket not available.' }) }] };
    }

    ws.send(JSON.stringify({
      type: 'session_message',
      session_id: args.session_id,
      sender: 'requester',
      content: args.message,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          session_id: args.session_id,
          status: 'sent',
          message: 'Message sent. Listen for session_message response from provider.',
        }),
      }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }] };
  }
}

export function registerSessionSendTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_session_send', {
    description: 'Send a message within an active session. The provider will respond asynchronously.',
    inputSchema: sessionSendInputSchema,
  }, async (args) => handleSessionSend(args as Parameters<typeof handleSessionSend>[0], ctx));
}

// ---------------------------------------------------------------------------
// agentbnb_session_end
// ---------------------------------------------------------------------------

const sessionEndInputSchema = {
  session_id: z.string().describe('Session ID to end'),
  reason: z.enum(['completed', 'cancelled']).optional().describe('Reason for ending (default: completed)'),
};

/**
 * Handler for agentbnb_session_end.
 */
export async function handleSessionEnd(
  args: { session_id: string; reason?: string },
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!ctx.relayClient) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not connected to relay.' }) }] };
  }

  try {
    const ws = (ctx.relayClient as unknown as { ws?: { send: (data: string) => void } }).ws;
    if (!ws) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'WebSocket not available.' }) }] };
    }

    ws.send(JSON.stringify({
      type: 'session_end',
      session_id: args.session_id,
      reason: args.reason ?? 'completed',
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          session_id: args.session_id,
          status: 'ending',
          message: 'Session end request sent. Listen for session_settled response.',
        }),
      }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }] };
  }
}

export function registerSessionEndTool(server: McpServer, ctx: McpServerContext): void {
  server.registerTool('agentbnb_session_end', {
    description: 'End an active session. Credits will be settled and any unused budget refunded.',
    inputSchema: sessionEndInputSchema,
  }, async (args) => handleSessionEnd(args as Parameters<typeof handleSessionEnd>[0], ctx));
}
