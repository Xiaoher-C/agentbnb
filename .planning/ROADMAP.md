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
- ✅ **v4.0 Agent Economy Platform** - Phases 30-39 (shipped 2026-03-21)
- ✅ **v5.0 Genesis Flywheel** - Phases 40-44 (shipped 2026-03-21)
- 🚧 **v6.0 Team Formation Protocol** - Phases 50-53 (in progress)

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

<details>
<summary>✅ v4.0 Agent Economy Platform (Phases 30-39) - SHIPPED 2026-03-21</summary>

- [x] Phase 30: 被發現 (Fix Upstream) — upsertCard() AnyCardSchema + online/offline lifecycle
- [x] Phase 31: 找人用 (Fix Downstream) — AutoRequestor + capability-matcher remote fallback, CLI wiring
- [x] Phase 32: 定價引導 (Pricing Guidance) — GET /api/pricing, market reference in openclaw sync
- [x] Phase 33: Conductor 雙重角色 — Push conductor card via relay, conductor.public config
- [x] Phase 34: MCP Server — stdio MCP server with 6 tools
- [x] Phase 35: OpenAPI Spec + GPT Actions — @fastify/swagger, Swagger UI, GPT Actions schema
- [x] Phase 36: Hub Agent Core — Platform-hosted persistent agents with skill routing
- [x] Phase 37: Job Queue + Relay Bridge — SQLite job queue, auto-dispatch on reconnect
- [x] Phase 38: Framework Adapters — LangChain, CrewAI, AutoGen, OpenAI function calling
- [x] Phase 39: Hub Agent UI + Dashboard — Create Agent wizard, operations dashboard

</details>

<details>
<summary>✅ v5.0 Genesis Flywheel (Phases 40-44) - SHIPPED 2026-03-21</summary>

- [x] Phase 40: Feedback API — src/feedback/, POST /api/feedback, GET /api/reputation/:agent
- [x] Phase 41: Enhanced Search + Reputation Filters — min_reputation filter, sort=reputation_desc
- [x] Phase 42: Batch Request API — POST /api/request/batch, executeCapabilityBatch()
- [x] Phase 43: Genesis Template Package — packages/genesis-template/, npx init, Handlebars templates
- [x] Phase 44: Evolution API + Genesis Dashboard — src/evolution/, hub/genesis page

</details>

### 🚧 v6.0 Team Formation Protocol (In Progress)

**Milestone Goal:** Upgrade Conductor from hardcoded-template orchestrator to network-native planner via task_decomposition capability routing, add production stability (FailureReason isolation), and introduce role-aware team formation — without importing any LLM SDK into AgentBnB core.

**Execution order:**
- Wave 1 (parallel): Phase 50 + Phase 51 (independent — different subsystems)
- Wave 2: Phase 52 (requires Phase 50 for SubTask role hints from decomposer)
- Wave 3: Phase 53 (requires Phase 52 for team_id/role data)

- [ ] **Phase 50: Network-Native Decomposer** — capability_type routing, DAG validator, depth limits, self-exclusion guard, genesis-template + bootstrap declarations, Rule Engine fallback
- [ ] **Phase 51: Production Resilience** — FailureReason enum, overload exclusion from reputation, per-skill max_concurrent in skills.yaml, gateway busy response
- [ ] **Phase 52: Team Formation** — Role type schema (4 values), team-formation.ts, role-aware pipeline execution scheduling
- [ ] **Phase 53: Team Traceability** — request_log team_id + role columns, Hub request history role display

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
**Plans:** 2/2 plans complete
**Success Criteria** (what must be TRUE):
  1. `POST /api/agents` creates a persistent Hub Agent with identity and credit balance
  2. Hub Agent has a skill routing table mapping skills to execution paths (direct_api / relay / queue)
  3. Hub Agent can execute direct API skills (reusing ApiExecutor) without a session agent
  4. Hub Agent publishes a Capability Card discoverable by other agents
Plans:
- [x] 36-01-PLAN.md — Hub Agent types, crypto, SQLite store, and CRUD API routes (SUMMARY: 2/2 tasks)
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

### Phase 50: Network-Native Decomposer
**Goal**: Conductor delegates task decomposition to the network — any agent declaring `capability_type: task_decomposition` becomes a decomposer; genesis-template declares the capability by default; Rule Engine fallback preserves existing behavior
**Depends on**: Nothing (parallel with Phase 51)
**Requirements**: COND-01, COND-02, COND-03, COND-03b, COND-04, COND-05, COND-06
**Success Criteria** (what must be TRUE):
  1. `agentbnb conduct "<task>"` routes to a remote agent with `capability_type: task_decomposition` before falling back to text search, and the selected provider's SubTask[] output is validated for DAG integrity (unique IDs, valid dependencies, acyclic, valid roles, sane credits) before entering CapabilityMatcher
  2. When `decomposition_depth >= 1` is present in an incoming request, Conductor routes directly to the Rule Engine without calling any external decomposer; when `orchestration_depth >= 2`, the call returns an error without executing
  3. Conductor never selects itself as the task_decomposition provider unless explicitly configured with `localFallback: true`
  4. A fresh `npx @agentbnb/genesis-template init` project has a SOUL.md with `capability_type: task_decomposition` declared and a bootstrap.ts that auto-registers the matching Capability Card on `activate()`
  5. When no task_decomposition provider is reachable or the remote output fails validation, `agentbnb conduct` completes successfully using the built-in Rule Engine (no behavior change for existing users)
**Plans**: 3 plans

Plans:
- [ ] 50-01-PLAN.md — capability_type field on CapabilityCard schema + getCardsByCapabilityType() registry query + Conductor routing logic
- [ ] 50-02-PLAN.md — decomposition-validator.ts (DAG integrity) + depth limit enforcement + self-exclusion guard
- [ ] 50-03-PLAN.md — genesis-template SOUL.md + bootstrap.ts task_decomposition declarations + Rule Engine fallback wiring

### Phase 51: Production Resilience
**Goal**: Execution failures are categorized by cause so overload events do not damage provider reputation, and per-skill concurrency limits prevent providers from being overwhelmed
**Depends on**: Nothing (parallel with Phase 50)
**Requirements**: RESIL-01, RESIL-02, RESIL-03, RESIL-04
**Success Criteria** (what must be TRUE):
  1. Every terminal execution failure recorded in request_log has a `failure_reason` value drawn from the enum `bad_execution | overload | timeout | auth_error | not_found`
  2. When computing a provider's reputation score, rows with `failure_reason = 'overload'` are excluded from the denominator — an overloaded agent's success rate is not reduced
  3. A skill declared with `capacity.max_concurrent: N` in skills.yaml allows at most N simultaneous in-flight executions; the gateway rejects the N+1th request with a structured busy response without running the skill handler
  4. A rejected overload request is recorded in request_log with `failure_reason: overload` and the response body contains `{ error: 'overload', retry_after_ms: N }`
**Plans**: 2 plans

Plans:
- [ ] 51-01-PLAN.md — FailureReason enum in src/types/index.ts + failure_reason column in request_log + reputation denominator exclusion
- [ ] 51-02-PLAN.md — per-skill max_concurrent in skills.yaml schema (Zod) + gateway in-flight counter + busy response + overload log entry

### Phase 52: Team Formation
**Goal**: Conductor can assemble a Team from SubTask[] using role-aware agent matching and execute the team pipeline with role-based scheduling
**Depends on**: Phase 50 (SubTask role hints populated by network decomposer)
**Requirements**: TEAM-01, TEAM-02, TEAM-03
**Success Criteria** (what must be TRUE):
  1. The Role type exported from src/types/index.ts defines exactly 4 values — `researcher | executor | validator | coordinator` — and is documented as routing hint only (not authorization boundary)
  2. Calling `formTeam(subtasks, strategy)` with a `cost_optimized`, `quality_optimized`, or `balanced` strategy returns a Team where each SubTask with a role hint is matched to a TeamMember (agent + card) from the registry
  3. PipelineOrchestrator schedules role-same subtasks to the same agent when that agent has available capacity, reducing round-trip overhead for batched work
**Plans**: 2 plans

Plans:
- [ ] 52-01-PLAN.md — Role type in src/types/index.ts + role-schema.ts (TeamMember/Team) + team-formation.ts with 3 formation strategies
- [ ] 52-02-PLAN.md — pipeline-orchestrator.ts optional team param + team-aware agent override + conductor-mode.ts formTeam() wiring

### Phase 53: Team Traceability
**Goal**: Every team-originated execution is traceable — request_log records which team and role produced each call, and the Hub surfaces that context in request history
**Depends on**: Phase 52 (team_id and role only exist after team formation is live)
**Requirements**: TRACE-01, TRACE-02
**Success Criteria** (what must be TRUE):
  1. A request_log entry for a team-originated execution contains non-null `team_id` (UUID matching the Team) and `role` (one of the 4 Role values); solo executions have both fields as NULL
  2. The Hub request history page displays a role badge (e.g., "executor", "validator") next to any log entry where `role` is present, without breaking the display of entries where `role` is NULL
**Plans**: 2 plans

Plans:
- [ ] 53-01-PLAN.md — team_id + role columns in request_log SQLite schema + migration + PipelineOrchestrator population
- [ ] 53-02-PLAN.md — Hub request history role badge component + conditional render for null role entries

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
| 36 | v4.0 | 2/2 | Complete | 2026-03-19 |
| 37 | v4.0 | 1/1 | Complete | 2026-03-19 |
| 38 | v4.0 | 1/1 | Complete | 2026-03-19 |
| 39 | v4.0 | 1/1 | Complete | 2026-03-19 |
| 40 | v5.0 | 1/1 | Complete | 2026-03-21 |
| 41 | v5.0 | 1/1 | Complete | 2026-03-21 |
| 42 | v5.0 | 1/1 | Complete | 2026-03-21 |
| 43 | v5.0 | 1/1 | Complete | 2026-03-21 |
| 44 | v5.0 | 1/1 | Complete | 2026-03-21 |
| 50 | v6.0 | 0/3 | In progress (1 plan written) | - |
| 51 | v6.0 | 0/2 | Planned | - |
| 52 | v6.0 | 2/2 | Planned | - |
| 53 | v6.0 | 2/2 | Planned | - |

**Total:** 48 phases, 104+ plans, 9 milestones (8 shipped, 1 in progress).

---
*Last updated: 2026-03-24 — Phase 53 plans created (53-01, 53-02)*
