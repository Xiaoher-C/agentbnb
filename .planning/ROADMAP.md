# AgentBnB Roadmap

## Milestones

- ✅ **v1.1 Upgrade** - Phases 0-3 (shipped 2026-03-15)
- ✅ **v2.0 Agent Autonomy** - Phases 4-8 (shipped 2026-03-15)
- ✅ **v2.1 Ship It** - Phases 9-11 (shipped 2026-03-16)
- ✅ **v2.2 Full Hub + Distribution** - Phases 12-15 (shipped 2026-03-16)
- ✅ **v2.3 Launch Ready** - Phases 16-18 (shipped 2026-03-17)
- 🚧 **v3.0 Production-Ready Launch** - Phases 19-23 (in progress)

## Phases

<details>
<summary>✅ v1.1 Upgrade (Phases 0-3) - SHIPPED 2026-03-15</summary>

- [x] Phase 0: Dogfood (5/5 plans) — Capability Card schema, SQLite registry, credit ledger, gateway, CLI, OpenClaw integration
- [x] Phase 1: CLI MVP (4/4 plans) — npm package, mDNS discovery, peer management, documentation
- [x] Phase 2: Cold Start (3/3 plans) — Reputation system, public registry, marketplace API
- [x] Phase 2.1: Smart Onboarding (2/2 plans) — Auto-detect API keys, draft card generation
- [x] Phase 2.2: Agent Hub (3/3 plans) — React SPA at /hub, card grid, search/filter
- [x] Phase 2.25: Schema v1.1 (1/1 plan) — _internal field, free_tier, Hub badges
- [x] Phase 2.3: Remote Registry (2/2 plans) — Cross-machine discovery, config
- [x] Phase 3: UX Layer (4/4 plans) — Owner dashboard, auth, share page, request history

</details>

<details>
<summary>✅ v2.0 Agent Autonomy (Phases 4-8) - SHIPPED 2026-03-15</summary>

- [x] Phase 4: Agent Runtime + Multi-Skill Foundation (3/3 plans)
- [x] Phase 5: Autonomy Tiers + Credit Budgeting (2/2 plans)
- [x] Phase 6: Idle Rate Monitoring + Auto-Share (2/2 plans)
- [x] Phase 7: Auto-Request (2/2 plans)
- [x] Phase 8: OpenClaw Deep Integration (3/3 plans)

</details>

<details>
<summary>✅ v2.1 Ship It (Phases 9-11) - SHIPPED 2026-03-16</summary>

- [x] Phase 9: Hub UI Redesign (4/4 plans) — Premium dark SaaS, ambient glow, modal overlays, count-up animations
- [x] Phase 10: ClaWHub Installable Skill (3/3 plans) — bootstrap.ts activate()/deactivate(), install.sh, SKILL.md, HEARTBEAT.rules.md
- [x] Phase 11: Repo Housekeeping (3/3 plans) — CLAUDE.md, README.md, AGENT-NATIVE-PROTOCOL.md

</details>

<details>
<summary>✅ v2.2 Full Hub + Distribution (Phases 12-15) - SHIPPED 2026-03-16</summary>

- [x] Phase 12: Foundation + Agent Directory (3/3 plans) — SPA routing, 5-tab nav, credit badge, CTA, agent ranking list and individual profile pages
- [x] Phase 13: Activity Feed + Docs Page (2/2 plans) — Public exchange feed with 10s polling, 4-section embedded documentation
- [x] Phase 14: Credit UI + Modal + Polish (4/4 plans) — Credit dashboard with earning chart, modal enhancements, design token migration, mobile responsive
- [x] Phase 15: Distribution + Discovery (2/2 plans) — Claude Code plugin, cross-tool SKILL.md, GitHub topics, README visual overhaul

</details>

<details>
<summary>✅ v2.3 Launch Ready (Phases 16-18) - SHIPPED 2026-03-17</summary>

- [x] Phase 16: SPA Routing Fix + Hub Enhancement (2/2 plans) — Fix reply.sendFile 500 error, extract Magic UI components into Hub, add doodle creature mascot
- [x] Phase 17: Below-Fold Sections (1/1 plans) — Compatible With marquee, FAQ accordion, brief description below Discover card grid
- [x] Phase 18: README Visual Overhaul (2/2 plans) — Badges, hero image, structured layout, real hub screenshot

</details>

### v3.0 Production-Ready Launch (Dual-Track Parallel)

> See [v3.0-milestone.md](/v3.0-milestone.md) for full specification.
> Track A (main branch) and Track B (conductor-core worktree) develop in parallel.

**Track A — Core Infrastructure (main branch):**

- [x] **Phase 19: SkillExecutor** — Config-driven execution engine with 4 modes (API/Pipeline/OpenClaw/Command), Gateway integration (6 plans) 🔴 CRITICAL (completed 2026-03-17)
- [ ] **Phase 21: Signed Escrow Receipt** — Ed25519 keypair, cross-machine credit verification, settlement protocol, real P2P tests (4 plans) 🔴 CRITICAL

**Track B — Conductor Foundation (conductor-core worktree, parallel with Phase 19):**

- [x] **Phase 20: Conductor Core** — TaskDecomposer, CapabilityMatcher, BudgetController, Conductor Card registration (2 plans) 🟡 HIGH (completed 2026-03-17)

**Post-Merge:**

- [ ] **Phase 22: Conductor Integration** — PipelineOrchestrator, Gateway wiring, CLI `agentbnb conduct`, E2E tests (4 plans) 🟡 HIGH
- [ ] **Phase 23: Ship** — My Agent route fix, Dockerfile + fly.toml + CI/CD, GitHub public checklist (3 plans) 🟡 MEDIUM

---

## Phase Details

### Phase 19: SkillExecutor
**Goal**: Agent can execute capabilities via config-driven skills.yaml — no more empty localhost:8080
**Depends on**: Phase 18 (v2.3 complete)
**Track**: A (main branch)
**Requirements**: EXEC-01 through EXEC-06
**Success Criteria** (what must be TRUE):
  1. `agentbnb serve` with skills.yaml starts SkillExecutor alongside Gateway
  2. API Executor successfully calls external REST APIs with auth and input/output mapping
  3. Pipeline Executor chains multiple skills with `${prev.result}` piping
  4. OpenClaw Bridge forwards requests to OpenClaw agent and returns result
  5. Command Executor runs sandboxed shell commands with timeout
  6. Gateway dispatches to SkillExecutor instead of empty handler URL
**Plans:** 6/6 plans complete
Plans:
- [ ] 19-01-PLAN.md — Skill Config Schema + SkillExecutor Interface + YAML Parser
- [ ] 19-02-PLAN.md — API Executor (Mode A — config-driven REST API calls)
- [ ] 19-03-PLAN.md — Pipeline Executor (Mode B — chain skills with ${prev.result})
- [ ] 19-04-PLAN.md — OpenClaw Bridge (Mode C — forward to OpenClaw agent)
- [ ] 19-05-PLAN.md — Command Executor (Mode D — sandboxed shell commands)
- [ ] 19-06-PLAN.md — Gateway Integration (wire SkillExecutor into Gateway dispatch)

### Phase 20: Conductor Core
**Goal**: Build independent Conductor components that don't depend on SkillExecutor
**Depends on**: Phase 18 (v2.3 complete, for shared code access)
**Track**: B (conductor-core worktree, parallel with Phase 19)
**Requirements**: COND-01 through COND-04
**Success Criteria** (what must be TRUE):
  1. TaskDecomposer decomposes tasks into SubTask[] via hardcoded templates
  2. CapabilityMatcher finds best agent for each sub-task using existing peer scoring
  3. BudgetController pre-calculates cost and enforces spending limits
  4. Conductor's CapabilityCardV2 registers on the network
**Plans:** 2/2 plans complete
Plans:
- [x] 20-01-PLAN.md — Types + TaskDecomposer + Conductor Card registration
- [ ] 20-02-PLAN.md — CapabilityMatcher + BudgetController

### Phase 21: Signed Escrow Receipt
**Goal**: Cross-machine credit verification works — two agents on different machines can exchange credits
**Depends on**: Phase 19 (SkillExecutor complete)
**Track**: A (main branch)
**Requirements**: CREDIT-01 through CREDIT-05
**Success Criteria** (what must be TRUE):
  1. `agentbnb init` generates Ed25519 keypair at `~/.agentbnb/`
  2. Requester signs escrow receipt with private key
  3. Provider verifies receipt signature with requester's public key
  4. Credits settle independently on both agents' local SQLite DBs
  5. Integration tests pass with TWO separate SQLite databases
**Plans:** 4 plans
Plans:
- [ ] 21-01-PLAN.md — Ed25519 keypair generation + EscrowReceipt type + signing functions
- [ ] 21-02-PLAN.md — Gateway credit verification update + client receipt attachment
- [ ] 21-03-PLAN.md — Settlement protocol (independent credit resolution)
- [ ] 21-04-PLAN.md — Full P2P integration tests with two separate SQLite databases

### Phase 22: Conductor Integration
**Goal**: Wire Conductor components to SkillExecutor and Signed Escrow for end-to-end orchestration
**Depends on**: Phase 19, Phase 20, Phase 21 (all complete + merge)
**Track**: main (post-merge)
**Requirements**: COND-05 through COND-08
**Success Criteria** (what must be TRUE):
  1. PipelineOrchestrator executes sub-tasks across remote agents via Gateway
  2. Conductor's orchestrate skill is callable via SkillExecutor
  3. `agentbnb conduct "task"` CLI command works end-to-end
  4. E2E test with 3 agents (Conductor + 2 providers) passes
**Plans:** 0/4 — not yet planned

### Phase 23: Ship
**Goal**: AgentBnB deployed to production, GitHub repo public
**Depends on**: Phase 22 (Conductor integrated)
**Requirements**: SHIP-01 through SHIP-03
**Success Criteria** (what must be TRUE):
  1. /#/my-agent Hub route renders OwnerDashboard
  2. Registry + Hub deployed on Fly.io at agentbnb.dev
  3. GitHub repo is public with no secrets, correct license, CI passing
**Plans:** 0/3 — not yet planned

---

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 0-3 | v1.1 | 24/24 | Complete | 2026-03-15 |
| 4-8 | v2.0 | 12/12 | Complete | 2026-03-15 |
| 9-11 | v2.1 | 10/10 | Complete | 2026-03-16 |
| 12-15 | v2.2 | 11/11 | Complete | 2026-03-16 |
| 16-18 | v2.3 | 5/5 | Complete | 2026-03-17 |
| 19. SkillExecutor | v3.0 | 6/6 | Complete | 2026-03-17 |
| 20. Conductor Core | v3.0 | 2/2 | Complete | 2026-03-17 |
| 21. Signed Escrow | v3.0 | 0/4 | Planned | — |
| 22. Conductor Integration | v3.0 | 0/4 | Not started | — |
| 23. Ship | v3.0 | 0/3 | Not started | — |

**Total:** 23 phases, 71+ plans, 5 milestones shipped, 1 in progress.

---
*Full milestone details archived in .planning/milestones/*
