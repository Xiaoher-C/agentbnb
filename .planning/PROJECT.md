# AgentBnB

## What This Is

A P2P agent capability sharing protocol with a complete execution engine. Agent owners publish what their agents can do (Capability Cards), execute skills via config-driven YAML, exchange credits across machines with signed escrow receipts, and orchestrate multi-agent workflows through the Conductor. Think Airbnb for AI agent pipelines.

## Core Value

No good protocol exists for agent-to-agent capability exchange. AgentBnB fills that gap — making it easy for any agent to discover, execute, and orchestrate another agent's skills, creating a marketplace where agent capabilities become composable building blocks.

## Current Milestone: v3.2 Registry Credit Ledger

**Goal:** Centralize credit operations on the Registry server for trustworthy multi-agent exchanges, and fix relay timeout to enable long-running skill execution.

**Target features:**
- Relay timeout C+B Hybrid (30s → 300s + optional relay_progress)
- CreditLedger interface with swappable implementations
- Registry `/api/credits/*` endpoints (hold, settle, release, grant, balance, history)
- Credit verification integrated into WebSocket relay flow
- CLI init/status use Registry for credits
- Hub credit data seamlessly switches to Registry backend
- Local-only mode preserved for offline/LAN usage

## Previously Shipped

- **v3.0 Production-Ready Launch** (2026-03-17) — SkillExecutor (5 modes), Conductor, Signed Escrow, Deployment, Security
- **v3.1 Public Network** (2026-03-18) — WebSocket relay, remote registry sync, Ed25519 identity auth, Fly.io persistent volume
- **v2.3 Launch Ready** — SPA routing, below-fold sections, README overhaul
- **v2.2 Full Hub + Distribution** — Agent profiles, activity feed, credit UI, distribution
- **v2.1 Ship It** — Premium Hub UI, ClaWHub skill, repo docs
- **v2.0 Agent Autonomy** — Multi-skill cards, autonomy tiers, auto-share, auto-request
- **v1.1 Upgrade** — Core protocol, CLI, Hub, registry, onboarding

**Stats:** 9,244+ LOC TypeScript, 739 tests, 78+ plans across 24 phases and 7 milestones.

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

- [ ] Relay timeout C+B Hybrid (30s → 300s + optional relay_progress) — v3.2
- [ ] CreditLedger interface + RegistryCreditLedger class — v3.2
- [ ] Registry /api/credits/* endpoints — v3.2
- [ ] Credit verification in WebSocket relay flow — v3.2
- [ ] CLI init/status use Registry credits — v3.2
- [ ] Hub credit data from Registry — v3.2
- [ ] Local-only mode backward compatible — v3.2

### Out of Scope

- Separate landing page app — Hub IS the landing page
- Real money / payment integration — credits only (free tier)
- Multi-language SDKs — TypeScript only
- Mobile native app — web Hub is sufficient
- Agent training / fine-tuning — capability exchange only
- LLM-powered TaskDecomposer — v4.0 (hardcoded templates for now)
- Autonomous Conductor (resource scanning, self-initiated earning) — v4.0
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
| Credit System → Registry (ADR-021) | Single source of truth for balances | — Pending |
| Relay Timeout C+B Hybrid (ADR-020) | 5min default + optional progress | — Pending |
| Provider free pricing (ADR-018) | Market-driven, 1 cr minimum | — Pending |
| Conductor fee 10% min 1 max 20 (ADR-019) | Scales with task complexity | — Pending |

---
*Last updated: 2026-03-19 after v3.2 Registry Credit Ledger milestone start*
