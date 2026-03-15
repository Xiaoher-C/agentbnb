# AgentBnB

## What This Is

A P2P agent capability sharing protocol. Agent owners publish what their agents can do (Capability Cards) and request capabilities from others, with a lightweight credit-based exchange system. Think Airbnb for AI agent pipelines — list your agent's idle capabilities, others book and use them.

## Core Value

No good protocol exists for agent-to-agent capability exchange. AgentBnB fills that gap — making it easy for any agent to discover and use another agent's skills, creating a marketplace where agent capabilities become composable building blocks.

## Current Milestone: v2.0 Agent Autonomy

**Goal:** The agent handles everything. The human says Yes once.

**Target features:**
- Idle rate detection + auto-share (agents monitor utilization, auto-publish when idle_rate > 70%)
- Auto-request (agents detect capability gaps, find peers, execute via escrow autonomously)
- Autonomy tiers (Tier 1/2/3 with configurable credit thresholds)
- Multi-skill cards (one Capability Card per agent, multiple skills)
- Credit budgeting (reserve balance, surplus alerts, spending limits)
- OpenClaw deep integration (installable skill, SOUL.md sync, HEARTBEAT.md rules)

**Design bible:** `AGENT-NATIVE-PROTOCOL.md` in project root

## Requirements

### Validated

- ✓ Capability Card schema with three-level model (Atomic, Pipeline, Environment) — v1.1
- ✓ SQLite-backed local registry with FTS5 search and filtering — v1.1
- ✓ CLI for publishing, discovering, and requesting capabilities — v1.1
- ✓ HTTP gateway for agent-to-agent communication (JSON-RPC) — v1.1
- ✓ Credit ledger with escrow and settlement — v1.1
- ✓ OpenClaw SOUL.md integration for dogfooding — v1.1
- ✓ npm package distribution — v1.1
- ✓ mDNS peer discovery + peer management — v1.1
- ✓ Reputation system (EWA success_rate + avg_latency_ms) — v1.1
- ✓ Public registry server with marketplace API — v1.1
- ✓ Smart onboarding (auto-detect API keys, draft card generation) — v1.1
- ✓ Agent Hub (React SPA, card grid, search/filter) — v1.1
- ✓ Schema v1.1 (_internal, free_tier, powered_by) — v1.1
- ✓ Remote registry discovery (--registry flag) — v1.1
- ✓ Owner dashboard, auth, share page, request history — v1.1

### Active

- [ ] Idle rate detection and auto-share
- [ ] Auto-request with peer selection
- [ ] Autonomy tiers (configurable thresholds)
- [ ] Multi-skill Capability Cards
- [ ] Credit budgeting (reserve, surplus, limits)
- [ ] OpenClaw deep integration (skill, HEARTBEAT.md, message bus)

### Out of Scope

- Cloud deployment — local-first protocol
- Real money / payment integration — credits only
- Multi-language SDKs — TypeScript only
- Mobile native app — web Hub is sufficient
- Agent training / fine-tuning — capability exchange only

## Context

- **Market gap:** No standard protocol for agent-to-agent capability exchange exists. A2A (Google) focuses on task delegation, not capability sharing with economic incentives.
- **Dogfood with OpenClaw:** Cheng Wen's OpenClaw agents (creative director, engineering agent) are the first users.
- **Agent-native philosophy:** The user of AgentBnB is the agent, not the human. Features designed for agent consumption first, human consumption second. See AGENT-NATIVE-PROTOCOL.md.
- **Open source:** MIT licensed, intended for community adoption. Lock-in from network effects, not code.
- **npm analogy:** OpenClaw : AgentBnB :: Node.js : npm — the de facto capability sharing standard.

## Constraints

- **Tech stack**: TypeScript (strict mode), Node.js 20+, pnpm
- **Database**: SQLite via better-sqlite3 (no external DB dependencies)
- **Protocol**: JSON-RPC over HTTP for agent communication
- **Testing**: Vitest for all test coverage
- **Open source**: MIT license, public repo
- **Design test**: "Does this require human intervention? If yes, redesign so the agent can do it."

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Three-level Capability Card model | Covers atomic skills, multi-step pipelines, and full environments | ✓ Good |
| SQLite for local storage | Zero-config, embeddable, good enough for dogfood | ✓ Good |
| JSON-RPC over HTTP | Standard, language-agnostic, easy to debug | ✓ Good |
| Credit-based exchange | Creates economic incentive without real money | ✓ Good |
| EWA reputation (alpha=0.1) | Smooth outlier handling, bootstraps from first observation | ✓ Good |
| Scoped Fastify plugins | Auth isolation without leaking to public routes | ✓ Good |
| Agent-first design | Features for agent consumption first, human second | — Pending |

---
*Last updated: 2026-03-15 after milestone v2.0 initialization*
