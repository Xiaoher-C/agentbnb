# AgentBnB Roadmap

## Milestones

- ✅ **v1.1 Upgrade** - Phases 0-3 (shipped 2026-03-15)
- ✅ **v2.0 Agent Autonomy** - Phases 4-8 (shipped 2026-03-15)
- ✅ **v2.1 Ship It** - Phases 9-11 (shipped 2026-03-16)
- ✅ **v2.2 Full Hub + Distribution** - Phases 12-15 (shipped 2026-03-16)
- ✅ **v2.3 Launch Ready** - Phases 16-18 (shipped 2026-03-17)
- ✅ **v3.0 Production-Ready Launch** - Phases 19-23 (shipped 2026-03-17)
- ~~📋 **v3.1 Code Quality** - Phase 24 (superseded — deferred to v3.3+)~~
- ✅ **v3.2 Registry Credit Ledger** - Phases 25-29 (shipped 2026-03-19)
- 🚧 **v4.0 Agent Economy Platform** - Phases 30-39 (in progress)

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

<details>
<summary>✅ v3.2 Registry Credit Ledger (Phases 25-29) - SHIPPED 2026-03-19</summary>

- [x] Phase 25: Relay Timeout (3 plans) — 300s timeout + relay_progress heartbeat
- [x] Phase 26: CreditLedger Interface (2 plans) — Swappable Local/Registry adapters
- [x] Phase 27: Registry Credit Endpoints (2 plans) — /api/credits/* with Ed25519 auth
- [x] Phase 28: Relay Credit Integration (2 plans) — Credit hold/settle/release in relay flow
- [x] Phase 29: CLI + Hub + Compatibility (2 plans) — Registry credits in CLI/Hub + backward compat

</details>

### v4.0 Agent Economy Platform (In Progress)

**Milestone Goal:** Fix OpenClaw agent experience loop (被發現→賺credits→找人用→花credits) and open all agent ecosystem entry points (MCP, OpenAPI, Hub Agent, Framework Adapters).

**Two parallel tracks:**
- **軌道 A (修復閉環)**: Phase 30-33 — Fix 4 broken flows in OpenClaw agent lifecycle
- **軌道 B (平台擴展)**: Phase 34-39 — MCP Server, OpenAPI, Hub Agent, Adapters, UI

**Execution waves:**
- Wave 1 (parallel): Phase 30 + 31 + 32
- Wave 2 (parallel): Phase 33 + 34 + 35
- Wave 3 (parallel): Phase 36 + 38
- Wave 4: Phase 37
- Wave 5: Phase 39

#### 軌道 A：OpenClaw 體驗閉環修復

- [x] **Phase 30: 被發現 (Fix Upstream)** — Fix v2.0 card relay registration (AnyCardSchema + raw SQL), offline/online lifecycle [1/1 plans]
- [x] **Phase 31: 找人用 (Fix Downstream)** — AutoRequestor + capability-matcher remote fallback, CLI request/conduct wired to registry (completed 2026-03-19)
- [x] **Phase 32: 定價引導 (Pricing Guidance)** — GET /api/pricing endpoint, market reference in openclaw sync, SOUL.md custom pricing (completed 2026-03-19)
- [x] **Phase 33: Conductor 雙重角色** — Push conductor card via relay, conductor.public config, relay-based orchestration (completed 2026-03-19)

#### 軌道 B：平台擴展

- [x] **Phase 34: MCP Server** — stdio MCP server with 6 tools (discover, request, publish, status, conduct, serve_skill) (completed 2026-03-19)
- [x] **Phase 35: OpenAPI Spec + GPT Actions** — @fastify/swagger for Registry, Swagger UI, GPT Actions schema
- [ ] **Phase 36: Hub Agent Core** — Platform-hosted persistent agents with skill routing table and direct API execution
- [ ] **Phase 37: Job Queue + Relay Bridge** — SQLite job queue for offline requests, auto-dispatch on agent reconnect
- [ ] **Phase 38: Framework Adapters** — LangChain, CrewAI, AutoGen (Python), OpenAI function calling (JSON)
- [ ] **Phase 39: Hub Agent UI + Dashboard** — Create Agent wizard, operations dashboard, skill marketplace browse

## Phase Details

### Phase 30: 被發現 (Fix Upstream)
**Goal**: v2.0 multi-skill card 能透過 relay 自動註冊到 remote registry，斷線標記 offline，重連恢復 online
**Depends on**: Nothing (first to execute)
**Requirements**: LOOP-01, LOOP-02
**Success Criteria** (what must be TRUE):
  1. A v2.0 multi-skill card sent via relay `upsertCard()` is accepted and stored in remote registry
  2. When a provider disconnects, their card is marked `availability.online = false`
  3. When a provider reconnects, their card is restored to `availability.online = true`
Plans:
- [ ] 30-01-PLAN.md — upsertCard() AnyCardSchema + raw SQL fix + online/offline tests

### Phase 31: 找人用 (Fix Downstream)
**Goal**: agent 搜尋能力時，local 無結果自動 fallback 搜 remote registry；Conductor 能跨機器編排
**Depends on**: Nothing (parallel with Phase 30)
**Requirements**: LOOP-03, LOOP-04, LOOP-05, LOOP-06
**Success Criteria** (what must be TRUE):
  1. `AutoRequestor` with `registryUrl` falls back to remote search when local returns zero matches
  2. `matchSubTasks()` is async and searches remote registry when local has no match
  3. `agentbnb conduct` dispatches sub-tasks to remote agents via relay
  4. `agentbnb request --query` searches remote registry when local is empty

Plans:
- [ ] 31-01-PLAN.md — AutoRequestor + capability-matcher remote fallback
- [ ] 31-02-PLAN.md — CLI request/conduct wiring + relay execution

### Phase 32: 定價引導 (Pricing Guidance)
**Goal**: agent 發佈 skill 時有市場參考價，SOUL.md 支援自訂定價
**Depends on**: Nothing (parallel with Phase 30, 31)
**Requirements**: PRICE-01, PRICE-02, PRICE-03
**Success Criteria** (what must be TRUE):
  1. `GET /api/pricing?q=<query>` returns min/max/median/mean/count for matching skills
  2. `agentbnb openclaw sync` displays market reference prices after publishing
  3. SOUL.md `pricing: N` syntax overrides the default 10 credits per call
Plans:
- [ ] 32-01-PLAN.md — Pricing endpoint + SOUL.md custom pricing + market reference display

### Phase 33: Conductor 雙重角色
**Goal**: 每個 agent 自帶 conductor（自用），可選擇對外開放成為付費 conductor
**Depends on**: Phase 30 (relay card sync), Phase 31 (remote search)
**Requirements**: COND-01, COND-02, COND-03
**Success Criteria** (what must be TRUE):
  1. Agent connecting to relay pushes conductor card alongside SOUL.md card when `conductor.public: true`
  2. `conductor.public` config defaults to `false` — conductor is private (self-use) until explicitly enabled
  3. PipelineOrchestrator can execute sub-tasks on remote agents via relay
Plans:
- [ ] 33-01-PLAN.md — Conductor card relay push + public config + relay-based orchestration

### Phase 34: MCP Server
**Goal**: 任何 MCP-compatible client 能透過 MCP tools 與 AgentBnB 互動
**Depends on**: Phase 31 (remote search for discover)
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06
**Success Criteria** (what must be TRUE):
  1. `agentbnb mcp-server` starts a stdio MCP server
  2. Claude Code can add it via `claude mcp add agentbnb -- agentbnb mcp-server`
  3. Six tools available: discover, request, publish, status, conduct, serve_skill
  4. discover tool searches both local and remote registries
  5. request tool handles credit hold/settle/release transparently
Plans:
- [ ] 34-01-PLAN.md — MCP server implementation with 6 tools

### Phase 35: OpenAPI Spec + GPT Actions
**Goal**: Registry HTTP API 有 OpenAPI 3.0 spec，可被 GPT Actions 和 tool marketplaces 匯入
**Depends on**: Phase 32 (pricing endpoint needs documenting)
**Requirements**: API-01, API-02, API-03
**Success Criteria** (what must be TRUE):
  1. `GET /docs` serves Swagger UI for all Registry endpoints
  2. OpenAPI 3.0 spec is auto-generated from Fastify route schemas
  3. GPT Actions JSON schema is exported and importable in GPT Builder
Plans:
- [x] 35-01-PLAN.md — @fastify/swagger integration + GPT Actions export (SUMMARY: 2/2 tasks)

### Phase 36: Hub Agent Core
**Goal**: 使用者能在 Hub 建立常駐 Agent，配置 skill routing，Agent 能直接呼叫外部 API
**Depends on**: Phase 30 + 31 (relay and remote search must work)
**Requirements**: HUB-AGENT-01, HUB-AGENT-02, HUB-AGENT-03, HUB-AGENT-04
**Plans:** 2 plans
**Success Criteria** (what must be TRUE):
  1. `POST /api/agents` creates a persistent Hub Agent with identity and credit balance
  2. Hub Agent has a skill routing table mapping skills to execution paths (direct_api / relay / queue)
  3. Hub Agent can execute direct API skills (reusing ApiExecutor) without a session agent
  4. Hub Agent publishes a Capability Card discoverable by other agents
Plans:
- [ ] 36-01-PLAN.md — Hub Agent types, crypto, SQLite store, and CRUD API routes
- [ ] 36-02-PLAN.md — Hub Agent skill execution (ApiExecutor routing) and credit escrow

### Phase 37: Job Queue + Relay Bridge
**Goal**: Hub Agent 能排隊離線請求，session-based agents 上線時自動 dispatch
**Depends on**: Phase 36
**Requirements**: QUEUE-01, QUEUE-02, QUEUE-03
**Success Criteria** (what must be TRUE):
  1. Requests to offline relay-based skills are queued in SQLite with status tracking
  2. When a session agent reconnects via relay, queued jobs are automatically dispatched
  3. Job status transitions: queued → dispatched → completed / failed
Plans:
- [ ] 37-01-PLAN.md — SQLite job queue + relay bridge auto-dispatch

### Phase 38: Framework Adapters
**Goal**: LangChain、CrewAI、AutoGen 開發者能用原生語法整合 AgentBnB
**Depends on**: Phase 35 (OpenAPI spec)
**Requirements**: ADAPT-01, ADAPT-02, ADAPT-03, ADAPT-04
**Success Criteria** (what must be TRUE):
  1. LangChain `AgentBnBTool` works as a standard BaseTool
  2. CrewAI `@tool` decorated functions call AgentBnB HTTP API
  3. OpenAI function calling JSON schema is valid and importable
  4. All Python adapters authenticate via Ed25519 signed requests
Plans:
- [ ] 38-01-PLAN.md — Python adapters (LangChain, CrewAI, AutoGen) + OpenAI function schema

### Phase 39: Hub Agent UI + Dashboard
**Goal**: Hub 前端完整的 Agent 建立流程、配置 wizard、營運 dashboard
**Depends on**: Phase 36 + 37
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. Hub has a "Create Agent" wizard (name → skills → API keys → launch)
  2. Agent Dashboard shows request count, revenue, success rate, online status
  3. Skill marketplace page lists all public Hub Agent skills
Plans:
- [ ] 39-01-PLAN.md — Create Agent wizard + operations dashboard + skill marketplace

---

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 0-3 | v1.1 | 24/24 | Complete | 2026-03-15 |
| 4-8 | v2.0 | 12/12 | Complete | 2026-03-15 |
| 9-11 | v2.1 | 10/10 | Complete | 2026-03-16 |
| 12-15 | v2.2 | 11/11 | Complete | 2026-03-16 |
| 16-18 | v2.3 | 5/5 | Complete | 2026-03-17 |
| 19-23 | v3.0 | 16/16 | Complete | 2026-03-17 |
| 24 | v3.1 | — | Superseded | — |
| 25-29 | v3.2 | 11/11 | Complete | 2026-03-19 |
| 30 | v4.0 | 1/1 | Complete | 2026-03-19 |
| 31 | v4.0 | 2/2 | Complete | 2026-03-19 |
| 32 | v4.0 | 1/1 | Complete | 2026-03-19 |
| 33 | v4.0 | 1/1 | Complete | 2026-03-19 |
| 34 | v4.0 | 1/1 | Complete | 2026-03-19 |
| 35 | v4.0 | 1/1 | Complete | 2026-03-19 |
| 36 | v4.0 | 0/2 | **Wave 3** | — |
| 37 | v4.0 | 0/1 | Wave 4 | — |
| 38 | v4.0 | 0/1 | **Wave 3** | — |
| 39 | v4.0 | 0/1 | Wave 5 | — |

**Total:** 39 phases, 93+ plans, 8 milestones (7 shipped), v4.0 in progress.

---
*Full milestone details archived in .planning/milestones/*
