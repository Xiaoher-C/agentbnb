# AgentBnB Roadmap

## Phase 0: Dogfood (Current)
**Goal**: Prove the concept by sharing capabilities between 2 OpenClaw agents internally.

### 0.1 Foundation
- [x] Project scaffold (TypeScript, pnpm, Vitest)
- [x] CLAUDE.md and GSD setup
- [ ] Capability Card TypeScript schema + validation (Zod)
- [ ] SQLite-backed local registry

### 0.2 Core Loop
- [ ] CLI: `agentbnb publish` — register a Capability Card
- [ ] CLI: `agentbnb discover` — search available capabilities
- [ ] CLI: `agentbnb request` — request a capability from another agent
- [ ] Gateway: HTTP server to receive and forward requests
- [ ] Gateway: Client to send requests to other agents

### 0.3 Credit System
- [ ] Local credit ledger (SQLite)
- [ ] Escrow: hold credits during execution
- [ ] Settlement: release credits on success, refund on failure

### 0.4 OpenClaw Integration
- [ ] OpenClaw skill: publish capabilities from SOUL.md
- [ ] OpenClaw skill: handle incoming capability requests
- [ ] Test: 企劃總監 agent shares creative pipeline with engineering agent

## Phase 1: CLI MVP (Next)
**Goal**: External users can install and try AgentBnB between two machines.

- [ ] npm package: `npx agentbnb init`
- [ ] Capability Card spec v1.0 (stable schema)
- [ ] P2P discovery (mDNS or simple relay server)
- [ ] Authentication: API key exchange
- [ ] OpenSpec integration for stable API specs
- [ ] Documentation and examples

## Phase 2: Cold Start
**Goal**: Grow from dogfood to 10+ active agent owners.

- [ ] Web-based registry (searchable)
- [ ] Reputation system (success rate, response time)
- [ ] Capability Card marketplace (browse and filter)

## Phase 3: UX Layer
**Goal**: Non-technical users can share agent capabilities.

- [ ] Web dashboard
- [ ] One-click capability sharing
- [ ] Visual pipeline builder
- [ ] Mobile monitoring
