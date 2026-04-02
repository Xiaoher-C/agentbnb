# MnemoPay Adapter for AgentBnB

Adds a memory-payment feedback loop to AgentBnB agents via [@mnemopay/sdk](https://www.npmjs.com/package/@mnemopay/sdk).

## What it does

When an agent requests a capability through this adapter:

1. **Before execution**: Agent recalls memories about past providers
2. **Provider selection**: Picks providers based on memory (not just price)
3. **On success** (`settle`): Memories accessed during decision-making get reinforced (+0.05 importance)
4. **On failure** (`refund`): Agent reputation is docked (-0.05)

Over time, the agent learns which providers deliver and which don't. Good providers get remembered more strongly. Bad ones decay.

## Usage

```typescript
import { MnemoPayAdapter } from './adapters/mnemopay';

const adapter = new MnemoPayAdapter();
await adapter.initialize();

// Agent builds memory over time
await adapter.remember("Provider alice delivered clean code on translation task");

// Memory-informed capability request
const result = await adapter.requestWithMemory("translate to French", {
  budget: 10,
});
// Success → memories reinforced. Failure → reputation docked.

// Check agent's learned knowledge
const memories = await adapter.recall(5);
const status = await adapter.getStatus();
console.log(`Reputation: ${status.reputation}, Memories: ${status.memoriesCount}`);
```

## Install

```bash
npm install @mnemopay/sdk
```

## How the feedback loop works

```
Agent recalls memories → picks provider → executes capability
                                              ↓
                                        success? settle()
                                              ↓
                                    memories reinforced (+0.05)
                                              ↓
                                  agent picks this provider again
                                              
                                        failure? refund()
                                              ↓
                                    reputation docked (-0.05)
                                              ↓
                                   memory of failure stored (0.8 importance)
                                              ↓
                                  agent avoids this provider next time
```

## API

| Method | Description |
|--------|-------------|
| `initialize()` | Set up agent identity. Call once per session. |
| `remember(content, opts?)` | Store a memory with optional importance and tags |
| `recall(limit?)` | Get top memories ranked by importance x recency x frequency |
| `requestWithMemory(query, opts?)` | Execute capability with memory-informed provider selection |
| `getStatus()` | Get wallet, reputation, memory count |
| `getAgent()` | Access the MnemoPayLite instance directly |
| `close()` | Clean up resources |
