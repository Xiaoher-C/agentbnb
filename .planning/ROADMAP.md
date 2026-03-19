# AgentBnB Roadmap

## Milestones

- ✅ **v1.1 Upgrade** - Phases 0-3 (shipped 2026-03-15)
- ✅ **v2.0 Agent Autonomy** - Phases 4-8 (shipped 2026-03-15)
- ✅ **v2.1 Ship It** - Phases 9-11 (shipped 2026-03-16)
- ✅ **v2.2 Full Hub + Distribution** - Phases 12-15 (shipped 2026-03-16)
- ✅ **v2.3 Launch Ready** - Phases 16-18 (shipped 2026-03-17)
- ✅ **v3.0 Production-Ready Launch** - Phases 19-23 (shipped 2026-03-17)
- ~~📋 **v3.1 Code Quality** - Phase 24 (superseded — deferred to v3.3+)~~
- 🚧 **v3.2 Registry Credit Ledger** - Phases 25-29 (in progress)

## Phases

<details>
<summary>✅ v1.1 Upgrade (Phases 0-3) - SHIPPED 2026-03-15</summary>

- [x] Phase 0-3: 24 plans — Card schema, registry, gateway, CLI, Hub, auth, onboarding

</details>

<details>
<summary>✅ v2.0 Agent Autonomy (Phases 4-8) - SHIPPED 2026-03-15</summary>

- [x] Phase 4-8: 12 plans — AgentRuntime, autonomy tiers, idle monitoring, auto-request, OpenClaw

</details>

<details>
<summary>✅ v2.1 Ship It (Phases 9-11) - SHIPPED 2026-03-16</summary>

- [x] Phase 9-11: 10 plans — Hub UI redesign, ClaWHub skill, repo housekeeping

</details>

<details>
<summary>✅ v2.2 Full Hub + Distribution (Phases 12-15) - SHIPPED 2026-03-16</summary>

- [x] Phase 12-15: 11 plans — Agent directory, activity feed, credit UI, distribution

</details>

<details>
<summary>✅ v2.3 Launch Ready (Phases 16-18) - SHIPPED 2026-03-17</summary>

- [x] Phase 16-18: 5 plans — SPA routing, below-fold sections, README overhaul

</details>

<details>
<summary>✅ v3.0 Production-Ready Launch (Phases 19-23) - SHIPPED 2026-03-17</summary>

- [x] Phase 19: SkillExecutor (6 plans) — Config-driven execution engine, 4 modes, Gateway integration
- [x] Phase 20: Conductor Core (2 plans) — TaskDecomposer, CapabilityMatcher, BudgetController
- [x] Phase 21: Signed Escrow (4 plans) — Ed25519 keypair, cross-machine credit verification
- [x] Phase 22: Conductor Integration (2 plans) — PipelineOrchestrator, CLI `agentbnb conduct`
- [x] Phase 23: Ship (2 plans) — Dockerfile, fly.toml, CI/CD, v3.0 exports, security hardening

</details>

<details>
<summary>~~v3.1 Code Quality - Phase 24 - SUPERSEDED~~</summary>

- ~~Phase 24: Code Quality Polish — Clean up type casts, consolidate card shape detection (deferred to v3.3+)~~

</details>

### v3.2 Registry Credit Ledger (In Progress)

**Milestone Goal:** Centralize credit operations on Registry for trustworthy multi-agent exchanges, and fix relay timeout to enable long-running skill execution.

- [ ] **Phase 25: Relay Timeout** - Increase relay/client timeout to 300s and add relay_progress heartbeat protocol (gap closure in progress)
- [ ] **Phase 26: CreditLedger Interface** - Define CreditLedger abstraction with Local, Registry-server, and Registry-client adapters
- [ ] **Phase 27: Registry Credit Endpoints** - Implement /api/credits/* endpoints on Registry server with Ed25519 auth
- [ ] **Phase 28: Relay Credit Integration** - Wire credit hold/settle/release into WebSocket relay flow
- [ ] **Phase 29: CLI + Hub + Compatibility** - Update CLI commands, Hub endpoints, and preserve backward compatibility

## Phase Details

### Phase 25: Relay Timeout
**Goal**: Long-running agent skills can execute over relay without timing out
**Depends on**: Nothing (independent fix)
**Requirements**: RELAY-01, RELAY-02, RELAY-03, RELAY-04, RELAY-05, RELAY-06
**Success Criteria** (what must be TRUE):
  1. A skill that takes 4 minutes to respond completes successfully over WebSocket relay
  2. A provider agent can send `relay_progress` messages during execution and the relay timer resets
  3. PipelineExecutor automatically emits a progress update between each step without manual instrumentation
  4. ConductorMode automatically emits a progress update between each orchestrated sub-task
  5. Gateway client and `agentbnb request` wait up to 300s before declaring timeout
**Plans:** 3 plans (2 complete + 1 gap closure)
Plans:
- [x] 25-01-PLAN.md — Timeout constants 30s to 300s + relay_progress protocol message type
- [x] 25-02-PLAN.md — PipelineExecutor and ConductorMode auto-progress callbacks
- [ ] 25-03-PLAN.md — Gap closure: wire relay-to-executor progress bridge

### Phase 26: CreditLedger Interface
**Goal**: Credit operations are routed through a swappable interface — local SQLite or Registry HTTP — based on configuration
**Depends on**: Phase 25 (independent, but relay timeout must be stable before wiring credits)
**Requirements**: CRED-01, CRED-02, CRED-03, CRED-04, CRED-05
**Success Criteria** (what must be TRUE):
  1. A single `CreditLedger` interface exposes hold, settle, release, getBalance, getHistory, and grant methods
  2. `LocalCreditLedger` wraps existing ledger.ts and all existing tests continue to pass against it
  3. `RegistryCreditLedger` routes calls to the Registry HTTP API when `registryUrl` is configured
  4. `RegistryCreditLedger` performs DB operations directly when running inside the Registry server process
  5. An agent with no `registryUrl` config falls back to `LocalCreditLedger` automatically
**Plans**: TBD

### Phase 27: Registry Credit Endpoints
**Goal**: The Registry server exposes authenticated credit endpoints that any agent can call to hold, settle, release, grant, and query credits
**Depends on**: Phase 26
**Requirements**: REG-01, REG-02, REG-03, REG-04, REG-05, REG-06, REG-07, REG-08
**Success Criteria** (what must be TRUE):
  1. POST /api/credits/hold deducts credits from requester balance and returns an escrow ID
  2. POST /api/credits/settle transfers held credits to provider and closes the escrow
  3. POST /api/credits/release refunds held credits to requester and closes the escrow
  4. POST /api/credits/grant credits a new agent 50 credits exactly once per Ed25519 public key
  5. GET /api/credits/:owner returns the agent's current balance
  6. GET /api/credits/:owner/history returns paginated transaction history
  7. All six endpoints reject requests lacking a valid Ed25519 identity signature
**Plans**: TBD

### Phase 28: Relay Credit Integration
**Goal**: Every request routed through the WebSocket relay has credits held before forwarding and settled or released based on outcome
**Depends on**: Phase 27
**Requirements**: INTG-01, INTG-02, INTG-03, INTG-04
**Success Criteria** (what must be TRUE):
  1. A relay request is rejected before reaching the provider if the requester's Registry balance is insufficient
  2. A successful relay response triggers automatic credit settlement to the provider on the Registry
  3. A provider disconnect, relay timeout, or error triggers automatic credit release back to the requester
  4. A Conductor orchestration charges a fee of 10% of total sub-task cost (minimum 1 cr, maximum 20 cr) settled to the Conductor agent
**Plans**: TBD

### Phase 29: CLI + Hub + Compatibility
**Goal**: Agents interact with the Registry credit system through CLI commands and the Hub UI, while agents without Registry config continue working unchanged
**Depends on**: Phase 28
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, HUB-01, HUB-02, HUB-03, HUB-04, COMPAT-01, COMPAT-02, COMPAT-03, COMPAT-04
**Success Criteria** (what must be TRUE):
  1. `agentbnb init` on a new machine receives a 50 cr grant from Registry and shows the balance
  2. `agentbnb status` displays the credit balance fetched from the Registry (not local DB)
  3. `agentbnb request` uses Registry-backed escrow for remote skills and rejects publish attempts with price below 1 cr
  4. The Hub OwnerDashboard displays a real-time credit balance sourced from the Registry CreditLedger
  5. An agent configured with local-only mode (no registryUrl) continues all P2P exchanges with local SQLite credits, and all 739+ existing tests pass
**Plans**: TBD

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 0-3 | v1.1 | 24/24 | Complete | 2026-03-15 |
| 4-8 | v2.0 | 12/12 | Complete | 2026-03-15 |
| 9-11 | v2.1 | 10/10 | Complete | 2026-03-16 |
| 12-15 | v2.2 | 11/11 | Complete | 2026-03-16 |
| 16-18 | v2.3 | 5/5 | Complete | 2026-03-17 |
| 19-23 | v3.0 | 16/16 | Complete | 2026-03-17 |
| 24 | v3.1 | — | Superseded | — |
| 25 | v3.2 | 2/3 | Gap closure | — |
| 26 | v3.2 | 0/TBD | Not started | — |
| 27 | v3.2 | 0/TBD | Not started | — |
| 28 | v3.2 | 0/TBD | Not started | — |
| 29 | v3.2 | 0/TBD | Not started | — |

**Total:** 29 phases (24 superseded), 80+ plans, 6 milestones shipped, v3.2 in progress.

---
*Full milestone details archived in .planning/milestones/*
