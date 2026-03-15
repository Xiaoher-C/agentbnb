# AgentBnB Roadmap

## Milestones

- ✅ **v1.1 Upgrade** - Phases 0-3 (shipped 2026-03-15)
- 🚧 **v2.0 Agent Autonomy** - Phases 4-8 (in progress)

## Phases

<details>
<summary>✅ v1.1 Upgrade (Phases 0-3) - SHIPPED 2026-03-15</summary>

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

## Phase 1: CLI MVP (Complete)
**Goal**: External users can install and try AgentBnB between two machines.
**Requirements:** [R-007, R-008, R-009, R-010, R-011, R-012]
**Plans:** 4/4 plans complete

Plans:
- [x] 01-01-PLAN.md — npm publish pipeline + Capability Card spec v1.0 freeze
- [x] 01-02-PLAN.md — mDNS discovery module (bonjour-service)
- [x] 01-03-PLAN.md — Peer management (connect/peers) + CLI wiring for discovery
- [x] 01-04-PLAN.md — Documentation, examples, init LAN IP fix + human verification

## Phase 2: Cold Start (Complete)
**Goal**: Grow from dogfood to 10+ active agent owners with a public web registry and reputation system.
**Requirements:** [R-013, R-014, R-015]
**Plans:** 3/3 plans complete

Plans:
- [x] 02-01-PLAN.md — Reputation system: EWA updateReputation() + gateway instrumentation
- [x] 02-02-PLAN.md — Public registry server: Fastify + CORS + marketplace endpoints
- [x] 02-03-PLAN.md — CLI wiring (--registry-port) + REQUIREMENTS.md + human verification

## Phase 2.1: Smart Onboarding (Complete)
**Goal**: Sub-2-minute onboarding — `agentbnb init` auto-detects API keys, generates draft Capability Cards, and polishes CLI ergonomics to maximize Phase 2 cold start conversion.
**Requirements**: [ONB-01, ONB-02, ONB-03, ONB-04, ONB-05, ONB-06, ONB-07]
**Depends on:** Phase 2
**Plans:** 2/2 plans complete

Plans:
- [x] 02.1-01-PLAN.md — Onboarding detection + card generation (TDD: onboarding.ts pure functions)
- [x] 02.1-02-PLAN.md — CLI integration: wire init with --yes, --no-detect flags + human verify

## Phase 2.2: Agent Hub (Complete)
**Goal**: Build a public, read-only capability browser page served at `/hub` -- a cold-start accelerator for recruiting agent owners.
**Requirements**: [HUB-01, HUB-02, HUB-03, HUB-04, HUB-05]
**Depends on:** Phase 2.1
**Plans:** 3/3 plans complete

Plans:
- [x] 02.2-01-PLAN.md — Scaffold Vite+React+Tailwind project + category mapping utilities
- [x] 02.2-02-PLAN.md — React UI components (card grid, search/filter, stats bar) + data hook
- [x] 02.2-03-PLAN.md — Fastify static serving integration + human verification

## Phase 2.25: Schema v1.1 Upgrade (Complete)
**Goal**: Add _internal and free_tier fields to CapabilityCardSchema, strip _internal from API/CLI responses, render free-tier badges in Hub.
**Requirements**: [SCH-02, SCH-03, SCH-04, SCH-05, SCH-06]
**Depends on:** Phase 2.2
**Plans:** 1/1 plans complete

Plans:
- [x] 02.25-01-PLAN.md — Schema _internal + free_tier fields, server/CLI stripping, Hub free-tier badge

## Phase 2.3: Remote Registry Discovery (Complete)
**Goal**: Enable CLI discovery of capabilities from remote registry servers, completing the cross-machine discovery loop that Phase 2's registry API created.
**Requirements**: [RRD-01, RRD-02]
**Depends on:** Phase 2.25
**Plans:** 2/2 plans complete

Plans:
- [x] 02.3-01-PLAN.md — Remote fetch module + config command + discover wiring
- [x] 02.3-02-PLAN.md — Integration tests + human verification

## Phase 3: UX Layer (Complete)
**Goal**: Non-technical users can share agent capabilities via the Hub's authenticated owner features: dashboard monitoring, one-click sharing, and mobile-responsive status page.
**Requirements**: [UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, UX-12, UX-13, UX-14]
**Depends on:** Phase 2.3
**Plans:** 4/4 plans complete

Plans:
- [x] 03-01-PLAN.md — Backend data layer: API key in config, request_log module, gateway logging
- [x] 03-02-PLAN.md — Auth-protected owner endpoints (GET /me, GET /requests, GET /draft, toggle, patch)
- [x] 03-03a-PLAN.md — Hub frontend hooks + auth components (useAuth, useRequests, useOwnerCards, AuthGate, LoginForm)
- [x] 03-03b-PLAN.md — Hub frontend pages + wiring (OwnerDashboard, SharePage, RequestHistory, App.tsx tabs)

</details>

---

### v2.0 Agent Autonomy (In Progress)

**Milestone Goal:** The agent handles everything. The human says Yes once.

- [x] **Phase 4: Agent Runtime + Multi-Skill Foundation** - Centralized runtime scaffold and schema v2.0 with multi-skill cards (completed 2026-03-15)
- [ ] **Phase 5: Autonomy Tiers + Credit Budgeting** - Pure logic modules enforcing safe-by-default autonomous behavior
- [ ] **Phase 6: Idle Rate Monitoring + Auto-Share** - First active autonomous behavior: agents share when idle
- [ ] **Phase 7: Auto-Request** - Second active autonomous behavior: agents spend credits to fill capability gaps
- [ ] **Phase 8: OpenClaw Deep Integration** - Install AgentBnB as an OpenClaw skill with SOUL.md sync and HEARTBEAT.md rules

## Phase Details

### Phase 4: Agent Runtime + Multi-Skill Foundation
**Goal**: Agents can run with a stable centralized runtime that owns all DB handles and background lifecycle, publishing a single multi-skill Capability Card instead of one card per skill.
**Depends on**: Phase 3
**Requirements**: RUN-01, RUN-02, RUN-03, RUN-04
**Success Criteria** (what must be TRUE):
  1. Running `agentbnb serve` starts an `AgentRuntime` that gracefully shuts down on SIGTERM, recovering any orphaned escrows before exit
  2. An agent can publish one Capability Card containing multiple independently-priced skills in a `skills[]` array
  3. Existing v1.x cards in SQLite are automatically migrated to v2.0 schema with no data loss and FTS5 search continues returning results for skill names nested in the array
  4. A gateway request specifying `{ card_id, skill_id }` routes to the correct skill handler on a multi-skill card
**Plans:** 3/3 plans complete

Plans:
- [ ] 04-01-PLAN.md — AgentRuntime class: DB handle ownership, SIGTERM handler, orphaned escrow recovery
- [ ] 04-02-PLAN.md — CapabilityCard v2.0 schema: skills[] array, per-skill pricing; SQLite migration + FTS5 trigger update
- [ ] 04-03-PLAN.md — Gateway skill_id routing + human verification

### Phase 5: Autonomy Tiers + Credit Budgeting
**Goal**: Agents operate under safe-by-default autonomy constraints — all autonomous actions are blocked until the owner explicitly configures tiers, and auto-request can never drain credits below a configurable reserve floor.
**Depends on**: Phase 4
**Requirements**: TIER-01, TIER-02, TIER-03, TIER-04, BUD-01, BUD-02, BUD-03
**Success Criteria** (what must be TRUE):
  1. A freshly initialized agent defaults to Tier 3 — all autonomous actions are blocked until the owner runs `agentbnb config set tier1 <N>`
  2. `getAutonomyTier(creditAmount)` correctly classifies any credit amount into Tier 1 (<10cr auto), Tier 2 (10-50cr notify-after), or Tier 3 (>50cr ask-before) based on owner-configured thresholds
  3. Tier 2 actions write an audit event to `request_log` with `action_type` and `tier_invoked` fields visible in request history
  4. `BudgetManager.canSpend()` blocks any auto-request when the agent's balance is at or below the reserve floor (default 20cr)
  5. Owner can change reserve and tier thresholds via `agentbnb config set reserve <N>` and `agentbnb config set tier1 <N>`
**Plans**: TBD

Plans:
- [ ] 05-01: src/autonomy/tiers.ts — getAutonomyTier(), AutonomyEvent types, Tier 3 default, config read/write
- [ ] 05-02: src/credit/budget.ts — BudgetManager with reserve floor, canSpend(), config commands + human verification

### Phase 6: Idle Rate Monitoring + Auto-Share
**Goal**: Agents autonomously monitor their utilization per skill and flip availability online when idle, making idle capacity discoverable without human intervention.
**Depends on**: Phase 5
**Requirements**: IDLE-01, IDLE-02, IDLE-03, IDLE-04, IDLE-05
**Success Criteria** (what must be TRUE):
  1. After 60 seconds of low inbound traffic, an agent's skill with idle_rate > 70% automatically appears as `availability.online: true` in the registry
  2. Each skill on a multi-skill card tracks its idle rate independently — one busy skill does not suppress sharing of an idle sibling skill
  3. Idle rate is computed from real `request_log` data using a sliding 60-minute window — not hardcoded or estimated
  4. The `capacity.calls_per_hour` field on each skill is owner-declared (default 60) and visible in the published card
  5. `agentbnb serve` starts the IdleMonitor background loop automatically; stopping the server stops the loop cleanly
**Plans**: TBD

Plans:
- [ ] 06-01: capacity.calls_per_hour on skill schema + per-skill idle rate in _internal + getSkillRequestCount() in request-log.ts
- [ ] 06-02: src/autonomy/idle-monitor.ts — croner polling, sliding window computation, auto-share trigger via tiers + human verification

### Phase 7: Auto-Request
**Goal**: Agents detect capability gaps and autonomously execute peer requests — finding the best peer, checking the budget, holding escrow, and running the capability — completing the earn/spend loop without human intervention.
**Depends on**: Phase 6
**Requirements**: REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06
**Success Criteria** (what must be TRUE):
  1. When an agent emits a capability gap event, the auto-request flow fires: it finds peers, scores them, and either executes or routes to the approval queue depending on tier
  2. Peer selection scores candidates by `success_rate * (1/credits_per_call) * idle_rate` with min-max normalization — the highest-scoring peer is selected
  3. The agent's own cards are never selected as auto-request peers — self-exclusion is enforced before scoring
  4. A Tier 3 pending request appears in `GET /me/pending-requests` and in the Hub owner dashboard awaiting approval before any escrow is touched
  5. Auto-request failures (peer not found, budget blocked, tier blocked) are written to `request_log` even when no escrow is initiated
**Plans**: TBD

Plans:
- [ ] 07-01: pending_requests table + GET /me/pending-requests endpoint + capability gap event type
- [ ] 07-02: src/autonomy/auto-request.ts — AutoRequestor class, peer scoring, self-exclusion, budget-gated escrow + human verification

### Phase 8: OpenClaw Deep Integration
**Goal**: AgentBnB installs as a first-class OpenClaw skill — one command wires up gateway, auto-share, auto-request, and credit management into any OpenClaw agent, with SOUL.md sync generating the multi-skill card and HEARTBEAT.md rules enforcing autonomy policy.
**Depends on**: Phase 7
**Requirements**: OC-01, OC-02, OC-03, OC-04
**Success Criteria** (what must be TRUE):
  1. Running `openclaw install agentbnb` installs the skill package and produces a ready-to-paste HEARTBEAT.md rules block referencing the owner's configured autonomy tier thresholds
  2. Running `agentbnb openclaw sync` reads the agent's SOUL.md and publishes a multi-skill Capability Card with skills[] derived from H2 sections — no manual card editing required
  3. `agentbnb openclaw status` shows whether the skill is installed, which tier is active, current balance, and idle rate per skill
  4. `agentbnb openclaw rules` emits the current HEARTBEAT.md autonomy rules block reflecting live tier and budget configuration
**Plans**: TBD

Plans:
- [ ] 08-01: src/openclaw/ — soul-sync.ts (parseSoulMd() → skills[]), heartbeat-writer.ts (rules block generator), skill.ts (lifecycle hooks)
- [ ] 08-02: skills/agentbnb/ directory — SKILL.md, gateway.ts, auto-share.ts, auto-request.ts, credit-mgr.ts
- [ ] 08-03: agentbnb openclaw [sync|status|rules] CLI commands + human verification

---

## Progress

**Execution Order:**
Phases execute in numeric order: 4 → 5 → 6 → 7 → 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 0. Dogfood | v1.1 | 5/5 | Complete | 2026-03-15 |
| 1. CLI MVP | v1.1 | 4/4 | Complete | 2026-03-15 |
| 2. Cold Start | v1.1 | 3/3 | Complete | 2026-03-15 |
| 2.1. Smart Onboarding | v1.1 | 2/2 | Complete | 2026-03-15 |
| 2.2. Agent Hub | v1.1 | 3/3 | Complete | 2026-03-15 |
| 2.25. Schema v1.1 | v1.1 | 1/1 | Complete | 2026-03-15 |
| 2.3. Remote Registry | v1.1 | 2/2 | Complete | 2026-03-15 |
| 3. UX Layer | v1.1 | 4/4 | Complete | 2026-03-15 |
| 4. Agent Runtime + Multi-Skill Foundation | 3/3 | Complete   | 2026-03-15 | - |
| 5. Autonomy Tiers + Credit Budgeting | v2.0 | 0/2 | Not started | - |
| 6. Idle Rate Monitoring + Auto-Share | v2.0 | 0/2 | Not started | - |
| 7. Auto-Request | v2.0 | 0/2 | Not started | - |
| 8. OpenClaw Deep Integration | v2.0 | 0/3 | Not started | - |
