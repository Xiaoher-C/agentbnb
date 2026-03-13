# AgentBnB

## What This Is

A P2P agent capability sharing protocol. Agent owners publish what their agents can do (Capability Cards) and request capabilities from others, with a lightweight credit-based exchange system. Think Airbnb for AI agent pipelines — list your agent's idle capabilities, others book and use them.

## Core Value

No good protocol exists for agent-to-agent capability exchange. AgentBnB fills that gap — making it easy for any agent to discover and use another agent's skills, creating a marketplace where agent capabilities become composable building blocks.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Capability Card schema with three-level model (Atomic, Pipeline, Environment)
- [ ] SQLite-backed local registry with search and filtering
- [ ] CLI for publishing, discovering, and requesting capabilities
- [ ] HTTP gateway for agent-to-agent communication (JSON-RPC)
- [ ] Credit ledger with escrow and settlement
- [ ] OpenClaw integration for dogfooding with real agents

### Out of Scope

- Cloud deployment — Phase 0 is local-first
- Web UI / dashboard — deferred to Phase 3
- Authentication beyond simple API keys — sufficient for dogfood
- Multi-language SDKs — TypeScript only for now

## Context

- **Market gap:** No standard protocol for agent-to-agent capability exchange exists. A2A (Google) focuses on task delegation, not capability sharing with economic incentives.
- **Dogfood with OpenClaw:** Cheng Wen's OpenClaw agents (e.g., creative director, engineering agent) are the first users. They need to share pipelines.
- **Publish-worthy goal:** Phase 0 should produce something worth open-sourcing — a working protocol others can try, not just an internal experiment.
- **Open source:** MIT licensed, intended for community adoption.

## Constraints

- **Tech stack**: TypeScript (strict mode), Node.js 20+, pnpm
- **Database**: SQLite via better-sqlite3 (no external DB dependencies)
- **Protocol**: JSON-RPC over HTTP for agent communication
- **Testing**: Vitest for all test coverage
- **Open source**: MIT license, public repo

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Three-level Capability Card model | Covers atomic skills, multi-step pipelines, and full environments | -- Pending |
| SQLite for local storage | Zero-config, embeddable, good enough for dogfood | -- Pending |
| JSON-RPC over HTTP | Standard, language-agnostic, easy to debug | -- Pending |
| Credit-based exchange | Creates economic incentive without real money in Phase 0 | -- Pending |

---
*Last updated: 2026-03-13 after initialization*
