# AgentBnB WebSocket Relay — Zero-Config Networking

## Context

Currently, cross-agent transactions require direct IP connectivity (LAN or Cloudflare Tunnel). This doesn't scale — every agent owner would need to configure port forwarding or tunnels.

The gateway already logs `WebSocket relay active on /ws`, so some relay infrastructure exists. This briefing completes the integration so that `agentbnb serve` automatically connects to the Fly.dev relay, enabling any two agents anywhere in the world to transact with zero network configuration.

## Architecture

```
Agent A (home network)              Agent B (office network)
  agentbnb serve                      agentbnb serve
       |                                   |
       | WS connect (outbound)             | WS connect (outbound)
       ↓                                   ↓
  ┌──────────────────────────────────────────────┐
  │            Fly.dev Relay Server               │
  │                                              │
  │  Registry: knows which agents are online     │
  │  Router: forwards requests to correct agent  │
  │                                              │
  │  Agent A requests skill from Agent B:        │
  │    1. A sends request via WS                 │
  │    2. Relay looks up B's WS connection       │
  │    3. Relay forwards request to B            │
  │    4. B executes skill locally               │
  │    5. B sends result via WS                  │
  │    6. Relay forwards result to A             │
  └──────────────────────────────────────────────┘
```

No port forwarding. No tunnels. No public IP. Both agents only make outbound WebSocket connections (allowed by all firewalls/NATs).

## What Already Exists

Check these files first — relay infrastructure may be partially built:

- `src/gateway/websocket-relay.ts` or similar — the WS server on Fly.dev
- `src/gateway/websocket-client.ts` or similar — the WS client in `serve`
- `src/registry/server.ts` — the `/ws` endpoint logged at startup
- `dist/websocket-client-*.js` — exists in build output

Audit what's there before writing new code. The goal is to wire existing pieces together, not rewrite.

## Implementation

### Part 1: Relay Server (Fly.dev side)

The relay server on Fly.dev needs to:

1. Accept WebSocket connections from agents
2. Track which agent_id is connected on which WS
3. Route incoming requests to the correct agent's WS
4. Forward responses back to the requester's WS

```typescript
// On Fly.dev registry server (src/registry/server.ts)

// Map of connected agents: agent_id → WebSocket
const connectedAgents = new Map<string, WebSocket>();

// WS endpoint: /ws/relay
fastify.register(async (app) => {
  app.get('/ws/relay', { websocket: true }, (socket, req) => {
    // Agent connects and identifies itself
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      
      if (msg.type === 'register') {
        // Agent announces: "I am agent_id X, I can handle these skills"
        connectedAgents.set(msg.agent_id, socket);
        socket.agent_id = msg.agent_id;
        
        // Update card availability to "online" in registry
        updateCardAvailability(msg.agent_id, true);
      }
      
      if (msg.type === 'request') {
        // Agent A wants to call Agent B's skill
        const targetSocket = connectedAgents.get(msg.target_agent_id);
        if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(JSON.stringify({
            type: 'execute',
            request_id: msg.request_id,
            requester_id: msg.agent_id,
            skill_id: msg.skill_id,
            params: msg.params,
          }));
        } else {
          socket.send(JSON.stringify({
            type: 'error',
            request_id: msg.request_id,
            error: 'Target agent is offline',
          }));
        }
      }
      
      if (msg.type === 'response') {
        // Agent B sends result back to Agent A
        const requesterSocket = connectedAgents.get(msg.target_id);
        if (requesterSocket && requesterSocket.readyState === WebSocket.OPEN) {
          requesterSocket.send(JSON.stringify({
            type: 'result',
            request_id: msg.request_id,
            result: msg.result,
          }));
        }
      }
    });
    
    socket.on('close', () => {
      if (socket.agent_id) {
        connectedAgents.delete(socket.agent_id);
        updateCardAvailability(socket.agent_id, false);
      }
    });
  });
});
```

### Part 2: Relay Client (agent side, in `serve`)

When `agentbnb serve` starts, it should:

1. Connect to `wss://agentbnb.fly.dev/ws/relay`
2. Send `register` message with agent_id
3. Listen for incoming `execute` requests
4. Execute skills locally via SkillExecutor
5. Send results back through WS

```typescript
// In serve command (src/cli/index.ts or src/gateway/relay-client.ts)

async function connectToRelay(config: Config, identity: Identity) {
  const relayUrl = config.registry?.replace('https://', 'wss://') + '/ws/relay';
  
  const ws = new WebSocket(relayUrl);
  
  ws.on('open', () => {
    // Register this agent with the relay
    ws.send(JSON.stringify({
      type: 'register',
      agent_id: identity.agent_id,
      owner: config.owner,
      capabilities: getLocalSkillIds(), // from skills.yaml
    }));
    console.log(`Connected to relay: ${relayUrl}`);
  });
  
  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString());
    
    if (msg.type === 'execute') {
      // Someone wants to use our skill
      console.log(`Relay request: ${msg.skill_id} from ${msg.requester_id}`);
      
      try {
        const result = await skillExecutor.execute(msg.skill_id, msg.params);
        ws.send(JSON.stringify({
          type: 'response',
          request_id: msg.request_id,
          target_id: msg.requester_id,
          result,
        }));
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'response',
          request_id: msg.request_id,
          target_id: msg.requester_id,
          result: { error: err.message },
        }));
      }
    }
  });
  
  // Auto-reconnect on disconnect
  ws.on('close', () => {
    console.log('Relay disconnected. Reconnecting in 5s...');
    setTimeout(() => connectToRelay(config, identity), 5000);
  });
  
  return ws;
}
```

### Part 3: Request via Relay (client side)

When `agentbnb request` finds a remote card but can't directly connect to the gateway_url (timeout or connection refused), it should fall back to relay:

```typescript
// In request command

async function executeRemoteRequest(card, params, identity) {
  // Try 1: Direct connection to gateway_url
  try {
    const result = await directRequest(card.gateway_url, params, identity);
    return result;
  } catch (err) {
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      console.log('Direct connection failed. Using relay...');
    } else {
      throw err; // Non-network error, don't retry
    }
  }
  
  // Try 2: Via relay
  const relayUrl = config.registry?.replace('https://', 'wss://') + '/ws/relay';
  const result = await relayRequest(relayUrl, {
    target_agent_id: card.owner_agent_id,
    skill_id: params.skill_id,
    params: params.input,
    requester_id: identity.agent_id,
  });
  return result;
}
```

### Part 4: Card schema update

Cards need to include the `owner_agent_id` so the relay knows where to route:

```typescript
// When publishing/syncing cards, include agent_id
{
  ...card,
  owner_agent_id: identity.agent_id,  // NEW: for relay routing
  gateway_url: config.gateway_url,     // existing: for direct connection
}
```

## Modified `serve` Command Flow

```
agentbnb serve
  1. Start local Fastify gateway on port (existing) ✅
  2. Load skills.yaml (existing) ✅
  3. Start IdleMonitor (existing) ✅
  4. NEW: Connect to relay (wss://agentbnb.fly.dev/ws/relay)
  5. NEW: Register agent_id + capabilities with relay
  6. NEW: Listen for relay execute requests
  7. NEW: Auto-reconnect on disconnect
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/gateway/relay-client.ts` | Create or update — WS client that connects to relay, handles execute/response |
| `src/registry/server.ts` | Update — enhance `/ws` endpoint with agent routing (register/request/response) |
| `src/cli/index.ts` (serve) | Update — call `connectToRelay()` after gateway starts |
| `src/cli/index.ts` (request) | Update — fallback to relay when direct connection fails |
| `src/types/index.ts` | Update — add `owner_agent_id` to card schema |
| `src/gateway/relay-client.test.ts` | Create — test register, execute, response, reconnect |

## Key Decisions

- **Direct-first, relay-fallback**: Always try direct gateway_url first (faster, no relay overhead). Only use relay when direct fails.
- **Auto-reconnect**: WS client reconnects every 5s on disconnect. Agent stays reachable as long as `serve` is running.
- **No auth on relay WS**: The execute request itself carries Ed25519 signature. Relay just forwards — it doesn't need to verify.
- **Card update**: `owner_agent_id` added to card schema. Relay uses this to route. Direct connection still uses `gateway_url`.
- **Presence tracking**: Relay server tracks which agents are connected. Can expose `GET /api/online` endpoint for Hub to show real-time online status.

## Verification

1. Agent A runs `agentbnb serve` → connects to relay → logs "Connected to relay"
2. Agent B runs `agentbnb serve` → connects to relay → logs "Connected to relay"
3. Agent A runs `agentbnb request <B's card>` → direct connection fails (different network) → falls back to relay → succeeds
4. Hub shows both agents as "online" (via relay presence)
5. All existing tests pass (relay is additive, doesn't change direct flow)
6. Auto-reconnect: kill relay WS → client reconnects in 5s → requests resume

## User Experience (Final)

```bash
# User anywhere in the world:
npx agentbnb init --owner my-agent     # 30 seconds
npx agentbnb serve                      # connects to relay automatically

# That's it. Zero network config.
# Their agent is now discoverable and callable by any other agent.
# They can also call any other agent's skills.
```
