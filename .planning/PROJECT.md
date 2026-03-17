# AgentBnB

## What This Is

A P2P agent capability sharing protocol with a complete execution engine. Agent owners publish what their agents can do (Capability Cards), execute skills via config-driven YAML, exchange credits across machines with signed escrow receipts, and orchestrate multi-agent workflows through the Conductor. Think Airbnb for AI agent pipelines.

## Core Value

No good protocol exists for agent-to-agent capability exchange. AgentBnB fills that gap — making it easy for any agent to discover, execute, and orchestrate another agent's skills, creating a marketplace where agent capabilities become composable building blocks.

## Current State: v3.0 Production-Ready Launch (shipped 2026-03-17)

**What shipped in v3.0:**
- **SkillExecutor** — Config-driven execution engine with 4 modes (API/Pipeline/OpenClaw/Command)
- **Conductor** — Multi-agent task orchestration (decompose → match → budget → orchestrate)
- **Signed Escrow** — Ed25519 cross-machine credit verification
- **Deployment** — Dockerfile, fly.toml, GitHub Actions CI
- **Security hardening** — Shell injection prevention, header CRLF filtering, FTS5 sanitization

**Stats:** 9,244 LOC TypeScript, 643 tests, 78+ plans across 24 phases and 6 milestones.

**Previously shipped:**
- **v1.1 Upgrade** — 24 plans. Core protocol, CLI, Hub, registry, onboarding.
- **v2.0 Agent Autonomy** — 12 plans. Multi-skill cards, autonomy tiers, auto-share, auto-request.
- **v2.1 Ship It** — 10 plans. Premium Hub UI, ClaWHub skill, repo docs.
- **v2.2 Full Hub + Distribution** — 11 plans. Agent profiles, activity feed, credit UI, distribution.
- **v2.3 Launch Ready** — 5 plans. SPA routing, below-fold sections, README overhaul.

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

- [ ] Clean up `as unknown as` type casts (27 → under 5) — v3.1
- [ ] Consolidate v1/v2 card shape detection into shared type guard — v3.1

### Out of Scope

- Separate landing page app — Hub IS the landing page
- Real money / payment integration — credits only
- Multi-language SDKs — TypeScript only
- Mobile native app — web Hub is sufficient
- Agent training / fine-tuning — capability exchange only
- LLM-powered TaskDecomposer — v4.0 (hardcoded templates for now)

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

---
*Last updated: 2026-03-17 after v3.0 Production-Ready Launch milestone*
