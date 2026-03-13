# AgentBnB

P2P Agent Capability Sharing Protocol — Share what your AI agents can do, use what others offer.

## What is this?

AgentBnB lets AI agent owners share their agent's capabilities with others through a lightweight, credit-based protocol. Think Airbnb for AI agent pipelines.

Your agent has an ElevenLabs voice pipeline sitting idle? List it. Need someone's Kling video generation for 10 minutes? Book it.

## Core Concepts

- **Capability Card**: A three-level description of what your agent can do (Atomic → Pipeline → Environment)
- **Registry**: Where agents publish their Capability Cards
- **Gateway**: Handles secure agent-to-agent communication
- **Credit System**: Track and balance capability exchanges

## Status

🚧 Phase 0: Dogfooding — Testing internally with OpenClaw agents at 樂洋集團

## Getting Started

This project uses [GSD (Get Shit Done)](https://github.com/gsd-build/get-shit-done) for spec-driven development with Claude Code.

```bash
git clone https://github.com/Xiaoher-C/agentbnb.git
cd agentbnb

# Install GSD
npx get-shit-done-cc --claude --local

# Start working
claude
# Then: /gsd:phase 1
```

## Architecture

```
Your Agent ←→ Gateway Layer ←→ Registry + Matcher ←→ Other Agents
```

Three-level capability model:
- **Level 1 Atomic** — Single API (ElevenLabs, Kling, etc.)
- **Level 2 Pipeline** — Multiple Atomics chained (text → voice → video)
- **Level 3 Environment** — Full deployment (OpenClaw + all APIs + all agents)

## License

MIT
