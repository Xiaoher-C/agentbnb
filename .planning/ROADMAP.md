# AgentBnB Roadmap

## Phase 0: Dogfood (Complete)
**Goal**: Prove the concept by sharing capabilities between 2 OpenClaw agents internally.
**Requirements:** [R-001, R-002, R-003, R-004, R-005, R-006]
**Plans:** 5/5 plans complete

Plans:
- [x] 00-01-PLAN.md — Registry: Capability Card schema + SQLite store + FTS5 search
- [x] 00-02-PLAN.md — Credit system: ledger + escrow hold/settle/release
- [x] 00-03-PLAN.md — Gateway: Fastify server + JSON-RPC + auth + client
- [x] 00-04-PLAN.md — CLI: wire all 6 subcommands to real implementations
- [x] 00-05-PLAN.md — OpenClaw integration: SOUL.md parser + E2E dogfood test

### 0.1 Foundation
- [x] Project scaffold (TypeScript, pnpm, Vitest)
- [x] CLAUDE.md and GSD setup
- [x] Capability Card TypeScript schema + validation (Zod)
- [x] SQLite-backed local registry

### 0.2 Core Loop
- [x] CLI: `agentbnb publish` — register a Capability Card
- [x] CLI: `agentbnb discover` — search available capabilities
- [x] CLI: `agentbnb request` — request a capability from another agent
- [x] Gateway: HTTP server to receive and forward requests
- [x] Gateway: Client to send requests to other agents

### 0.3 Credit System
- [x] Local credit ledger (SQLite)
- [x] Escrow: hold credits during execution
- [x] Settlement: release credits on success, refund on failure

### 0.4 OpenClaw Integration
- [x] OpenClaw skill: publish capabilities from SOUL.md
- [x] OpenClaw skill: handle incoming capability requests
- [x] Test: 企劃總監 agent shares creative pipeline with engineering agent

## Phase 1: CLI MVP (Complete)
**Goal**: External users can install and try AgentBnB between two machines.
**Requirements:** [R-007, R-008, R-009, R-010, R-011, R-012]
**Plans:** 4/4 plans complete

Plans:
- [x] 01-01-PLAN.md — npm publish pipeline + Capability Card spec v1.0 freeze
- [x] 01-02-PLAN.md — mDNS discovery module (bonjour-service)
- [x] 01-03-PLAN.md — Peer management (connect/peers) + CLI wiring for discovery
- [x] 01-04-PLAN.md — Documentation, examples, init LAN IP fix + human verification

- [x] npm package: `npx agentbnb init`
- [x] Capability Card spec v1.0 (stable schema)
- [x] P2P discovery (mDNS or simple relay server)
- [x] Authentication: API key exchange
- [x] OpenSpec integration for stable API specs
- [x] Documentation and examples

## Phase 2: Cold Start (Complete)
**Goal**: Grow from dogfood to 10+ active agent owners with a public web registry and reputation system.
**Requirements:** [R-013, R-014, R-015]
**Plans:** 3/3 plans complete

Plans:
- [x] 02-01-PLAN.md — Reputation system: EWA updateReputation() + gateway instrumentation
- [x] 02-02-PLAN.md — Public registry server: Fastify + CORS + marketplace endpoints
- [x] 02-03-PLAN.md — CLI wiring (--registry-port) + REQUIREMENTS.md + human verification

- [x] Web-based registry (searchable)
- [x] Reputation system (success rate, response time)
- [x] Capability Card marketplace (browse and filter)

## Phase 2.1: Smart Onboarding (INSERTED)
**Goal**: Sub-2-minute onboarding — `agentbnb init` auto-detects API keys, generates draft Capability Cards, and polishes CLI ergonomics to maximize Phase 2 cold start conversion.
**Requirements**: [ONB-01, ONB-02, ONB-03, ONB-04, ONB-05, ONB-06, ONB-07]
**Depends on:** Phase 2
**Plans:** 2 plans

Plans:
- [ ] 02.1-01-PLAN.md — Onboarding detection + card generation (TDD: onboarding.ts pure functions)
- [ ] 02.1-02-PLAN.md — CLI integration: wire init with --yes, --no-detect flags + human verify

- [ ] Auto-detect env vars (OPENAI_API_KEY, ELEVENLABS_API_KEY, KLING_API_KEY, etc.)
- [ ] Scan for running agent processes
- [ ] Generate draft Capability Card from detected APIs for user confirmation
- [ ] CLI ergonomics improvements (first-impression polish)

## Phase 3: UX Layer
**Goal**: Non-technical users can share agent capabilities.

- [ ] Web dashboard
- [ ] One-click capability sharing
- [ ] Visual pipeline builder
- [ ] Mobile monitoring
