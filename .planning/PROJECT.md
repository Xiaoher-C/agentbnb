# AgentBnB

## What This Is

A P2P agent capability sharing protocol with a complete execution engine. Agent owners publish what their agents can do (Capability Cards), execute skills via config-driven YAML, exchange credits across machines with signed escrow receipts, and orchestrate multi-agent workflows through the Conductor. Think Airbnb for AI agent pipelines.

## Core Value

No good protocol exists for agent-to-agent capability exchange. AgentBnB fills that gap — making it easy for any agent to discover, execute, and orchestrate another agent's skills, creating a marketplace where agent capabilities become composable building blocks.

## Current Milestone: v4.0 Agent Economy Platform

**Goal:** Fix OpenClaw agent experience loop (被發現→賺credits→找人用→花credits) and open all agent ecosystem entry points (MCP, OpenAPI, Hub Agent, Framework Adapters).

**Two tracks:**
- **軌道 A (修復閉環)**: Fix 4 broken flows — upstream card registration, downstream remote search, pricing guidance, Conductor dual role
- **軌道 B (平台擴展)**: MCP Server (Claude Code/Cursor/Windsurf), OpenAPI (GPT Actions), Hub Agent (platform-hosted persistent agents), Framework Adapters (LangChain/CrewAI/AutoGen)

**Target features:**
- v2.0 card relay registration fix (AnyCardSchema + raw SQL)
- AutoRequestor + capability-matcher remote registry fallback
- Market reference pricing + SOUL.md custom pricing syntax
- Conductor public/private toggle + relay-based orchestration
- MCP Server (stdio, 6 tools) for Claude Code / Cursor / Windsurf / Cline
- OpenAPI 3.0 spec + Swagger UI + GPT Actions export
- Hub Agent: platform-hosted persistent agents with skill routing
- Job Queue: offline request queuing + auto-dispatch on reconnect
- Framework Adapters: LangChain, CrewAI, AutoGen (Python), OpenAI (JSON)
- Hub Agent Creation UI + operations dashboard

## Previously Shipped

- **v3.2 Registry Credit Ledger** (2026-03-19) — CreditLedger interface, Registry /api/credits/*, relay credit integration, CLI/Hub wiring
- **v3.0 Production-Ready Launch** (2026-03-17) — SkillExecutor (5 modes), Conductor, Signed Escrow, Deployment, Security
- **v3.1 Public Network** (2026-03-18) — WebSocket relay, remote registry sync, Ed25519 identity auth, Fly.io persistent volume
- **v2.3 Launch Ready** — SPA routing, below-fold sections, README overhaul
- **v2.2 Full Hub + Distribution** — Agent profiles, activity feed, credit UI, distribution
- **v2.1 Ship It** — Premium Hub UI, ClaWHub skill, repo docs
- **v2.0 Agent Autonomy** — Multi-skill cards, autonomy tiers, auto-share, auto-request
- **v1.1 Upgrade** — Core protocol, CLI, Hub, registry, onboarding

**Stats:** 9,244+ LOC TypeScript, 739+ tests, 92+ plans across 39 phases and 8 milestones.

## Requirements

### Validated

- ✓ Capability Card schema with three-level model — v1.1
- ✓ SQLite-backed local registry with FTS5 search — v1.1
- ✓ CLI (publish, discover, request, serve, config) — v1.1
- ✓ HTTP gateway for agent-to-agent communication (JSON-RPC) — v1.1
- ✓ Credit ledger with escrow and settlement — v1.1
- ✓ OpenClaw integration (SOUL.md sync, HEARTBEAT.md, skill package) — v2.0
- ✓ Agent autonomy (tiers, idle monitoring, auto-request, budget) — v2.0
- ✓ Premium Hub UI (dark theme, modal overlays, 5 pages) — v2.1
- ✓ Agent profiles, activity feed, credit UI, distribution — v2.2
- ✓ SPA routing, below-fold sections, README overhaul — v2.3
- ✓ SkillExecutor (4 modes: API, Pipeline, OpenClaw, Command) — v3.0
- ✓ Conductor (TaskDecomposer, CapabilityMatcher, BudgetController, PipelineOrchestrator) — v3.0
- ✓ Signed Escrow Receipts (Ed25519 cross-machine credit verification) — v3.0
- ✓ Deployment infrastructure (Dockerfile, fly.toml, CI/CD) — v3.0
- ✓ Security hardening (shell injection, header injection, FTS5 sanitization) — v3.0

### Active

- [ ] v2.0 card relay registration fix (AnyCardSchema + raw SQL) — v4.0
- [ ] AutoRequestor + capability-matcher remote registry fallback — v4.0
- [ ] Market reference pricing + SOUL.md custom pricing — v4.0
- [ ] Conductor public/private toggle + relay orchestration — v4.0
- [ ] MCP Server (stdio, 6 tools) — v4.0
- [ ] OpenAPI 3.0 spec + Swagger UI + GPT Actions — v4.0
- [ ] Hub Agent: persistent agents with skill routing — v4.0
- [ ] Job Queue: offline request queuing + auto-dispatch — v4.0
- [ ] Framework Adapters: LangChain, CrewAI, AutoGen, OpenAI — v4.0
- [ ] Hub Agent Creation UI + dashboard — v4.0

### Validated (v3.2)

- ✓ Relay timeout C+B Hybrid (30s → 300s + optional relay_progress) — v3.2
- ✓ CreditLedger interface + RegistryCreditLedger class — v3.2
- ✓ Registry /api/credits/* endpoints — v3.2
- ✓ Credit verification in WebSocket relay flow — v3.2
- ✓ CLI init/status use Registry credits — v3.2
- ✓ Hub credit data from Registry — v3.2
- ✓ Local-only mode backward compatible — v3.2

### Out of Scope

- Separate landing page app — Hub IS the landing page
- Real money / payment integration — credits only (free tier)
- Mobile native app — web Hub is sufficient
- Agent training / fine-tuning — capability exchange only
- Inflation/deflation controls — premature at <100 agents
- Hub Discovery Phase 2 (trending scroll, category chips, price filter) — wait for 20+ agents
- Clean up `as unknown as` type casts — deferred from v3.1, cosmetic

## Context

- **Market gap:** No standard protocol for agent-to-agent capability exchange exists.
- **Dogfood with OpenClaw:** Cheng Wen's OpenClaw agents are the first users.
- **Agent-native philosophy:** The user is the agent, not the human. See AGENT-NATIVE-PROTOCOL.md.
- **Open source:** MIT licensed, intended for community adoption.
- **Codebase:** 9,244 LOC TypeScript, 643 tests, premium dark SaaS Hub UI.

## Constraints

- **Tech stack**: TypeScript (strict mode), Node.js 20+, pnpm
- **Database**: SQLite via better-sqlite3 (no external DB dependencies)
- **Protocol**: JSON-RPC over HTTP for agent communication
- **Testing**: Vitest for all test coverage
- **Open source**: MIT license, public repo
- **Design test**: "Does this require human intervention? If yes, redesign."

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Three-level Capability Card model | Covers atomic skills, multi-step pipelines, and environments | ✓ Good |
| SQLite for local storage | Zero-config, embeddable | ✓ Good |
| JSON-RPC over HTTP | Standard, language-agnostic | ✓ Good |
| Credit-based exchange | Economic incentive without real money | ✓ Good |
| Agent-first design | Features for agent consumption first | ✓ Good |
| Config-driven SkillExecutor (skills.yaml) | No custom handler code needed | ✓ Good |
| Ed25519 signed escrow receipts | Cross-machine credit without shared DB | ✓ Good |
| Conductor as agent (not platform feature) | Can be competed with, same credit economy | ✓ Good |
| Dual-track parallel development | 3/5 Conductor components independent of SkillExecutor | ✓ Good |
| Shell escaping for command execution | Prevents injection in P2P network | ✓ Good |
| Hub IS the landing page | Discover page is homepage | ✓ Good |
| Premium dark UI (#08080C + #10B981) | Screenshot-worthy aesthetic | ✓ Good |
| WebSocket relay for zero-config networking | No port forwarding needed | ✓ Good |
| Credit System → Registry (ADR-021) | Single source of truth for balances | ✓ Good |
| Relay Timeout C+B Hybrid (ADR-020) | 5min default + optional progress | ✓ Good |
| Provider free pricing (ADR-018) | Market-driven, 1 cr minimum | ✓ Good |
| Conductor fee 10% min 1 max 20 (ADR-019) | Scales with task complexity | ✓ Good |
| Relay auto-sync cards (ADR-022) | Agent connects → card auto-registered, no extra API | — Pending |
| Conductor dual role (ADR-023) | Self-use by default, `conductor.public: true` to earn | — Pending |
| Dynamic demand (ADR-024) | No pre-declared needs in SOUL.md, search Hub at runtime | — Pending |
| MCP as primary integration (ADR-025) | One server covers Claude Code/Cursor/Windsurf/Cline | — Pending |
| Hub Agent as persistent proxy (ADR-026) | Platform-hosted agents bridge session-based tools | — Pending |

---
*Last updated: 2026-03-19 after v4.0 Agent Economy Platform milestone start*
