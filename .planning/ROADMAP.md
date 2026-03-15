# AgentBnB Roadmap

## Milestones

- ✅ **v1.1 Upgrade** - Phases 0-3 (shipped 2026-03-15)
- ✅ **v2.0 Agent Autonomy** - Phases 4-8 (shipped 2026-03-15)
- 🚧 **v2.1 Ship It** - Phases 9-11 (in progress)

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

<details>
<summary>✅ v2.0 Agent Autonomy (Phases 4-8) - SHIPPED 2026-03-15</summary>

### Phase 4: Agent Runtime + Multi-Skill Foundation (Complete)
**Goal**: Agents can run with a stable centralized runtime that owns all DB handles and background lifecycle, publishing a single multi-skill Capability Card instead of one card per skill.
**Requirements**: RUN-01, RUN-02, RUN-03, RUN-04
**Plans:** 3/3 plans complete

Plans:
- [x] 04-01-PLAN.md — AgentRuntime class: DB handle ownership, SIGTERM handler, orphaned escrow recovery
- [x] 04-02-PLAN.md — CapabilityCard v2.0 schema: skills[] array, per-skill pricing; SQLite migration + FTS5 trigger update
- [x] 04-03-PLAN.md — Gateway skill_id routing + human verification

### Phase 5: Autonomy Tiers + Credit Budgeting (Complete)
**Goal**: Agents operate under safe-by-default autonomy constraints — all autonomous actions are blocked until the owner explicitly configures tiers, and auto-request can never drain credits below a configurable reserve floor.
**Requirements**: TIER-01, TIER-02, TIER-03, TIER-04, BUD-01, BUD-02, BUD-03
**Plans:** 2/2 plans complete

Plans:
- [x] 05-01-PLAN.md — Autonomy tiers module: getAutonomyTier(), AutonomyEvent types, Tier 3 default, config + audit columns
- [x] 05-02-PLAN.md — BudgetManager with reserve floor, canSpend(), CLI config commands + human verification

### Phase 6: Idle Rate Monitoring + Auto-Share (Complete)
**Goal**: Agents autonomously monitor their utilization per skill and flip availability online when idle, making idle capacity discoverable without human intervention.
**Requirements**: IDLE-01, IDLE-02, IDLE-03, IDLE-04, IDLE-05
**Plans:** 2/2 plans complete

Plans:
- [x] 06-01-PLAN.md — Data layer helpers: getSkillRequestCount() sliding window query + updateSkillAvailability() + updateSkillIdleRate() with tests
- [x] 06-02-PLAN.md — IdleMonitor class: croner polling, idle rate computation, tier-gated auto-share + CLI wiring + human verification

### Phase 7: Auto-Request (Complete)
**Goal**: Agents detect capability gaps and autonomously execute peer requests — finding the best peer, checking the budget, holding escrow, and running the capability — completing the earn/spend loop without human intervention.
**Requirements**: REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06
**Plans:** 2/2 plans complete

Plans:
- [x] 07-01-PLAN.md — Tier 3 approval queue: pending_requests table, CRUD module, owner API endpoints, AutonomyEvent extension
- [x] 07-02-PLAN.md — AutoRequestor class: peer scoring, self-exclusion, budget-gated escrow, failure logging, CLI command + human verification

### Phase 8: OpenClaw Deep Integration (Complete)
**Goal**: AgentBnB installs as a first-class OpenClaw skill — one command wires up gateway, auto-share, auto-request, and credit management into any OpenClaw agent, with SOUL.md sync generating the multi-skill card and HEARTBEAT.md rules enforcing autonomy policy.
**Requirements**: OC-01, OC-02, OC-03, OC-04
**Plans:** 3/3 plans complete

Plans:
- [x] 08-01-PLAN.md — src/openclaw/ modules: soul-sync (parseSoulMdV2 + publishFromSoulV2), heartbeat-writer, skill lifecycle + status
- [x] 08-02-PLAN.md — skills/agentbnb/ installable package: SKILL.md manifest + 4 thin adapter files
- [x] 08-03-PLAN.md — agentbnb openclaw sync|status|rules CLI commands + human verification

</details>

---

### v2.1 Ship It (In Progress)

**Milestone Goal:** Make AgentBnB launchable. Premium Hub UI, one-command OpenClaw skill install, repo ready for public.

- [x] **Phase 9: Hub UI Redesign** - Premium dark SaaS Hub with ambient glow, modal card overlays, and count-up animations — screenshot-worthy (completed 2026-03-16)
- [ ] **Phase 10: ClaWHub Installable Skill** - One command puts any OpenClaw agent on the AgentBnB network via a single activate() entry point
- [ ] **Phase 11: Repo Housekeeping** - Repo documentation reflects current reality and is ready for public launch

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
- [x] 04-01-PLAN.md — AgentRuntime class: DB handle ownership, SIGTERM handler, orphaned escrow recovery
- [x] 04-02-PLAN.md — CapabilityCard v2.0 schema: skills[] array, per-skill pricing; SQLite migration + FTS5 trigger update
- [x] 04-03-PLAN.md — Gateway skill_id routing + human verification

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
**Plans:** 2/2 plans complete

Plans:
- [x] 05-01-PLAN.md — Autonomy tiers module: getAutonomyTier(), AutonomyEvent types, Tier 3 default, config + audit columns
- [x] 05-02-PLAN.md — BudgetManager with reserve floor, canSpend(), CLI config commands + human verification

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
**Plans:** 2/2 plans complete

Plans:
- [x] 06-01-PLAN.md — Data layer helpers: getSkillRequestCount() sliding window query + updateSkillAvailability() + updateSkillIdleRate() with tests
- [x] 06-02-PLAN.md — IdleMonitor class: croner polling, idle rate computation, tier-gated auto-share + CLI wiring + human verification

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
**Plans:** 2/2 plans complete

Plans:
- [x] 07-01-PLAN.md — Tier 3 approval queue: pending_requests table, CRUD module, owner API endpoints, AutonomyEvent extension
- [x] 07-02-PLAN.md — AutoRequestor class: peer scoring, self-exclusion, budget-gated escrow, failure logging, CLI command + human verification

### Phase 8: OpenClaw Deep Integration
**Goal**: AgentBnB installs as a first-class OpenClaw skill — one command wires up gateway, auto-share, auto-request, and credit management into any OpenClaw agent, with SOUL.md sync generating the multi-skill card and HEARTBEAT.md rules enforcing autonomy policy.
**Depends on**: Phase 7
**Requirements**: OC-01, OC-02, OC-03, OC-04
**Success Criteria** (what must be TRUE):
  1. Running `openclaw install agentbnb` installs the skill package and produces a ready-to-paste HEARTBEAT.md rules block referencing the owner's configured autonomy tier thresholds
  2. Running `agentbnb openclaw sync` reads the agent's SOUL.md and publishes a multi-skill Capability Card with skills[] derived from H2 sections — no manual card editing required
  3. `agentbnb openclaw status` shows whether the skill is installed, which tier is active, current balance, and idle rate per skill
  4. `agentbnb openclaw rules` emits the current HEARTBEAT.md autonomy rules block reflecting live tier and budget configuration
**Plans:** 3/3 plans complete

Plans:
- [x] 08-01-PLAN.md — src/openclaw/ modules: soul-sync (parseSoulMdV2 + publishFromSoulV2), heartbeat-writer, skill lifecycle + status
- [x] 08-02-PLAN.md — skills/agentbnb/ installable package: SKILL.md manifest + 4 thin adapter files
- [x] 08-03-PLAN.md — agentbnb openclaw sync|status|rules CLI commands + human verification

### Phase 9: Hub UI Redesign
**Goal**: The Hub is screenshot-worthy — a premium dark SaaS experience with ambient emerald glow, modal card overlays, and count-up animations that communicates quality before a single interaction.
**Depends on**: Phase 8
**Requirements**: HUI-01, HUI-02, HUI-03, HUI-04, HUI-05, HUI-06, HUI-07
**Success Criteria** (what must be TRUE):
  1. The Hub renders with a dark #08080C background, emerald #10B981 accent, Inter + JetBrains Mono typography, and a radial gradient ambient glow — the aesthetic is immediately distinguishable from a generic Tailwind app
  2. Clicking any capability card opens a centered 520px modal with backdrop blur, scale-in animation, and body scroll lock — ESC and backdrop click both close it cleanly
  3. Stats numbers (agents, capabilities, credits) count up from 0 to their real values over 400ms in JetBrains Mono at 32px — visible on every page load
  4. The search bar, level/category dropdowns, online-only toggle, and pill-style tab switcher all render in the premium dark style with no legacy Tailwind defaults leaking through
  5. Cards show compact layout with 32px identicon, ghost category chips, level pill badge, and green online indicator — hovering any card lifts it 2px with border brightening
**Plans:** 4/4 plans complete

Plans:
- [x] 09-01-PLAN.md — Design system (CSS vars, fonts, Tailwind config) + card component redesign (HUI-01, HUI-02)
- [x] 09-02-PLAN.md — Modal overlay with backdrop blur, scale animation, ESC/backdrop close, scroll lock (HUI-03)
- [x] 09-03-PLAN.md — Header + stats bar + ambient glow + search/filter bar + pill tab switcher (HUI-04, HUI-05, HUI-06)
- [x] 09-04-PLAN.md — Polish: count-up animation, empty/error state theming, visual audit + human verification (HUI-07)

### Phase 10: ClaWHub Installable Skill
**Goal**: One command puts any OpenClaw agent on the AgentBnB network — activate() initializes the runtime, publishes the card, starts the gateway and IdleMonitor, and install.sh handles all setup automatically.
**Depends on**: Phase 9
**Requirements**: CLW-01, CLW-02, CLW-03, CLW-04, CLW-05
**Success Criteria** (what must be TRUE):
  1. Calling `activate()` from bootstrap.ts brings an OpenClaw agent fully online: AgentRuntime initialized, card published from SOUL.md, gateway listening, IdleMonitor running — one function call, zero additional setup
  2. Running install.sh after cloning automatically installs the CLI, initializes config, and syncs capabilities from SOUL.md — a new agent can join the network without reading documentation
  3. SKILL.md contains agent-executable instructions with frontmatter metadata, on-install steps, autonomy rules, and CLI reference — an agent reading it knows exactly what to do without human interpretation
  4. HEARTBEAT.rules.md contains a standalone autonomy rules block that any agent can copy-paste directly into its HEARTBEAT.md to govern AgentBnB behavior
  5. The integration test confirms the full lifecycle: mock SOUL.md, activate(), assert card published + gateway listening + IdleMonitor running, deactivate(), assert all resources cleaned up
**Plans:** 3 plans

Plans:
- [ ] 10-01-PLAN.md — bootstrap.ts: activate()/deactivate() entry point wiring AgentRuntime, card publish, gateway, IdleMonitor (CLW-01)
- [ ] 10-02-PLAN.md — install.sh + HEARTBEAT.rules.md: post-install automation + standalone autonomy rules (CLW-02, CLW-04)
- [ ] 10-03-PLAN.md — SKILL.md rewrite + integration test: agent-executable instructions + full lifecycle test (CLW-03, CLW-05)

### Phase 11: Repo Housekeeping
**Goal**: The repo is ready for public launch — CLAUDE.md reflects current reality, README.md has the new tagline and architecture story, and AGENT-NATIVE-PROTOCOL.md is committed at root.
**Depends on**: Phase 10
**Requirements**: DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. CLAUDE.md accurately reflects v1.1 (8 phases, 24 plans, 302+ tests), v2.0 (5 phases, 12 plans), and v2.1, with agent-first philosophy and current architecture — no stale references
  2. README.md opens with the new tagline, shows a multi-skill cards JSON example, explains autonomy tiers and auto-share/auto-request, and includes the Hub screenshot — a new visitor understands the project in under 2 minutes
  3. AGENT-NATIVE-PROTOCOL.md exists at the repo root and is committed — it is the design bible referenced throughout the codebase and must be publicly accessible
**Plans**: TBD

Plans:
- [ ] 11-01: CLAUDE.md update — reflect v1.1, v2.0, v2.1, agent-first philosophy, updated architecture
- [ ] 11-02: README.md rewrite — tagline, multi-skill JSON example, autonomy tiers, Hub screenshot, OpenClaw integration, author update
- [ ] 11-03: AGENT-NATIVE-PROTOCOL.md — ensure committed and accessible at repo root

---

## Progress

**Execution Order:**
Phases execute in numeric order: 9 → 10 → 11

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
| 4. Agent Runtime + Multi-Skill Foundation | v2.0 | 3/3 | Complete | 2026-03-15 |
| 5. Autonomy Tiers + Credit Budgeting | v2.0 | 2/2 | Complete | 2026-03-15 |
| 6. Idle Rate Monitoring + Auto-Share | v2.0 | 2/2 | Complete | 2026-03-15 |
| 7. Auto-Request | v2.0 | 2/2 | Complete | 2026-03-15 |
| 8. OpenClaw Deep Integration | v2.0 | 3/3 | Complete | 2026-03-15 |
| 9. Hub UI Redesign | v2.1 | 4/4 | Complete | 2026-03-16 |
| 10. ClaWHub Installable Skill | v2.1 | 0/3 | Not started | - |
| 11. Repo Housekeeping | v2.1 | 0/3 | Not started | - |
