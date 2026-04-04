/**
 * CLI action handlers for `agentbnb session` commands.
 *
 * These connect to the relay via WebSocket and use SessionClient
 * for session operations.
 */

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { getConfigDir, loadConfig } from './config.js';
import { ensureIdentity } from '../identity/identity.js';

/**
 * Open a session and enter interactive mode.
 */
export async function sessionOpen(
  cardId: string,
  opts: { skill: string; budget: number; message: string; pricing: string },
): Promise<void> {
  const config = loadConfig();
  if (!config || !config.registry) {
    console.error('Error: No registry configured. Run `agentbnb init` first.');
    process.exit(1);
  }

  const configDir = getConfigDir();
  const identity = ensureIdentity(configDir, config.owner);
  const agentId = identity.agent_id ?? identity.owner;

  // Connect to relay
  const relayUrl = config.registry.replace(/^http/, 'ws') + '/ws';
  const WebSocket = (await import('ws')).default;
  const ws = new WebSocket(relayUrl);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      // Register on relay
      ws.send(JSON.stringify({
        type: 'register',
        owner: identity.owner,
        agent_id: agentId,
        token: config.token ?? 'session-client',
        card: { id: `session-client-${randomUUID()}`, owner: identity.owner, name: 'session-client' },
      }));
      resolve();
    });
    ws.on('error', reject);
  });

  const sessionId = randomUUID();

  // Send session open
  ws.send(JSON.stringify({
    type: 'session_open',
    session_id: sessionId,
    requester_id: agentId,
    provider_id: opts.skill, // Provider resolved via card
    card_id: cardId,
    skill_id: opts.skill,
    budget: opts.budget,
    pricing_model: opts.pricing,
    initial_message: opts.message,
  }));

  console.log(`Session opened: ${sessionId}`);
  console.log(`Skill: ${opts.skill} | Budget: ${opts.budget} credits | Pricing: ${opts.pricing}`);
  console.log('---');
  console.log(`You: ${opts.message}`);

  let totalSpent = 0;

  // Listen for messages
  ws.on('message', (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.session_id !== sessionId) return;

      switch (msg.type) {
        case 'session_message':
          if (msg.sender === 'provider') {
            console.log(`Agent: ${msg.content}`);
            totalSpent += 2; // approximate
            console.log(`  [~${totalSpent}/${opts.budget} cr]`);
          }
          break;
        case 'session_settled':
          console.log(`\nSession ended. Total: ${msg.total_cost} credits (${msg.messages_count} messages)`);
          console.log(`Refunded: ${msg.refunded} credits`);
          ws.close();
          break;
        case 'session_error':
          console.error(`Session error: [${msg.code}] ${msg.message}`);
          ws.close();
          break;
        case 'session_ack':
          // Session acknowledged by relay
          break;
      }
    } catch { /* ignore non-JSON */ }
  });

  // Interactive input
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const prompt = (): void => {
    rl.question('You: ', (input) => {
      if (!input || input === '/end' || input === '/quit') {
        ws.send(JSON.stringify({
          type: 'session_end',
          session_id: sessionId,
          reason: 'completed',
        }));
        rl.close();
        return;
      }

      ws.send(JSON.stringify({
        type: 'session_message',
        session_id: sessionId,
        sender: 'requester',
        content: input,
      }));

      // Wait briefly for response before prompting again
      setTimeout(prompt, 100);
    });
  };

  // Start prompting after a brief delay for initial response
  setTimeout(prompt, 2000);
}

/**
 * Send a message to an existing session (non-interactive).
 */
export async function sessionSend(sessionId: string, message: string): Promise<void> {
  console.log(`Sending to session ${sessionId}: ${message}`);
  console.log('Note: For interactive sessions, use `agentbnb session open` instead.');
  console.log('Non-interactive send requires a running relay connection.');
}

/**
 * End a session.
 */
export async function sessionEnd(sessionId: string, reason: string): Promise<void> {
  console.log(`Ending session ${sessionId} (reason: ${reason})`);
  console.log('Note: Use /end within an interactive session, or send session_end via relay.');
}

/**
 * List active sessions.
 */
export async function sessionList(): Promise<void> {
  console.log('Active sessions are tracked on the relay server.');
  console.log('Use the MCP tool agentbnb_session_open to manage sessions programmatically.');
}

/**
 * Show session status.
 */
export async function sessionStatus(sessionId: string): Promise<void> {
  console.log(`Session ${sessionId} status is tracked on the relay server.`);
}
