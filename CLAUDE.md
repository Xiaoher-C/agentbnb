# CLAUDE.md — AgentBnB

## Project Overview

AgentBnB is a P2P agent capability sharing protocol. Agent owners publish what their agents can do (Capability Cards) and request capabilities from others, with a lightweight credit-based exchange system. Think Airbnb for AI agent pipelines.

**Core Insight: The user of AgentBnB is not the human. The user is the agent.** (See [AGENT-NATIVE-PROTOCOL.md](AGENT-NATIVE-PROTOCOL.md) for the full design philosophy.)

**Founder**: Cheng Wen Chen
**Domain**: agentbnb.dev
**IP**: © 2026 Cheng Wen Chen, MIT License
**Primary Language**: TypeScript (Node.js)
**Package Manager**: pnpm

## Current State

- **Version**: 7.0.0-beta.1 (package.json)
- **Milestones shipped**: v1.1 → v2.x → v3.0 (SkillExecutor, Conductor, Signed Escrow) → v3.1 (WebSocket Relay) → v4.0 (Agent Economy Platform) → v5.0 (Genesis Flywheel) → v5.1 (OpenClaw Hardening) → v6.0 (Team Formation Protocol, shipped 2026-03-24)
- **v7.0 in progress**: Agent Economy Infrastructure (Phases 54-60)
  - Phase 54-55: FailureReason, Reputation Protection, Capacity Enforcement ✅
  - Phase 56-60: Owner Console, Claude Code Executor, Multi-Provider, Social Layer
- **Tests**: 302+
- **Phase numbering**: Phases 1-49 (v1-v5), 50-53 (v6), 54-60 (v7)

## Tech Stack

- Runtime: Node.js 20+
- Language: TypeScript (strict mode)
- Database: SQLite (via better-sqlite3, WAL mode) for local registry + credits
- Protocol: JSON-RPC over HTTP for agent-to-agent communication
- Testing: Vitest
- Linting: ESLint + Prettier
- Hub: React 18 + Vite + Tailwind CSS (premium dark SaaS theme, served at `/hub`)
- Background Jobs: croner (cron scheduling)
- Events: typed-emitter
- AI: @anthropic-ai/sdk (Claude API for Conductor NLP decomposition)
- MCP: @modelcontextprotocol/sdk (stdio-based MCP server, 6 tools)
- WebSocket: @fastify/websocket (relay system)

## Architecture

```
src/
├── registry/    # Card storage, FTS5 search, health-checker, pricing, credit-routes, openapi (22 files)
├── gateway/     # Agent-to-agent HTTP + batch execution (11 files)
├── credit/      # Ledger, escrow, vouchers, economic system, cross-machine credits (20+ files)
├── runtime/     # Agent lifecycle, ProcessGuard, ServiceCoordinator (7 files)
├── relay/       # WebSocket relay for zero-config P2P networking (6 files)
├── hub-agent/   # Hub-hosted agent management, job queue, relay bridge (13 files)
├── feedback/    # Reputation & feedback scoring (8 files)
├── evolution/   # Agent skill evolution tracking (7 files)
├── identity/    # Agent identity, Ed25519 certs, guarantor/Sybil protection (7 files)
├── sdk/         # Consumer/Provider SDK for LangChain/CrewAI/AutoGen (7 files)
├── mcp/         # MCP server — tools: discover, request, publish, status, conduct, serve_skill
├── app/         # AgentBnB service entry point
├── onboarding/  # Advanced onboarding (auto-detect from docs, capability templates)
├── autonomy/    # Tier-based autonomy, idle monitor, auto-request (10 files)
├── openclaw/    # OpenClaw integration (SOUL.md sync, heartbeat rules)
├── skills/      # SkillExecutor (5 modes: API, Pipeline, OpenClaw, Command, Conductor)
├── conductor/   # Multi-agent orchestration, team formation, role schema (19 files)
├── utils/       # Shared utilities (interpolation)
├── discovery/   # mDNS peer discovery
├── cli/         # CLI: init, publish, discover, request, serve, quickstart, conduct, mcp-server (17 files)
└── types/       # Core TypeScript types + Zod schemas

hub/             # React SPA at /hub (Vite + Tailwind, premium dark theme)
├── pages/       # Discover, Agents, CreateAgent, AgentDashboard, Genesis, CreditPolicy
├── components/  # 40+ components (cards, charts, hero sections, trust badges)
└── hooks/       # useCards, useAuth, useOwnerCards, useRequests

skills/agentbnb/ # OpenClaw installable skill package
```

## Capability Card Schema

Multi-skill cards — one card per agent, multiple independently-priced skills.

Key fields: `id`, `owner`, `name`, `skills[]`, `pricing`, `availability`, `capability_type`, `performance_tier`, `authority_source`, `gateway_url`

Per-skill fields: `capability_types[]`, `requires_capabilities[]`, `visibility` ('public'|'private'), `capacity.max_concurrent`

Full interfaces: `src/types/index.ts` (CapabilityCard, CapabilityCardV2, Skill)

## Agent Autonomy Model

- **Tier 1** — Full autonomy (no notification): < configured threshold (default 0 = disabled)
- **Tier 2** — Notify after action: between tier1 and tier2 thresholds
- **Tier 3** — Ask before action: above tier2 threshold (DEFAULT for fresh installs)
- **IdleMonitor**: Per-skill idle rate tracking via sliding 60-min window, auto-shares when idle_rate > 70%
- **AutoRequestor**: Peer scoring (success_rate × cost_efficiency × idle_rate), self-exclusion, budget-gated
- **BudgetManager**: Reserve floor (default 20 credits), blocks auto-request when balance ≤ reserve

## Credit Economic System

Beyond basic escrow, the credit system now includes:
- **Voucher system**: Demand vouchers issued to new agents on bootstrap (funding_source: 'voucher')
- **Cross-machine credits**: `remote_earning`, `remote_settlement_confirmed` transaction types
- **Network economics**: `network_fee` on relay transactions, `provider_bonus` for early providers
- **Transaction reasons**: bootstrap | escrow_hold | escrow_release | settlement | refund | remote_earning | remote_settlement_confirmed | network_fee | provider_bonus | voucher_hold | voucher_settlement
- **Tables**: credit_transactions, credit_escrow (+ funding_source), provider_registry, demand_vouchers

Full implementation: `src/credit/ledger.ts`, `src/credit/escrow.ts`

## OpenClaw Integration

AgentBnB is an installable OpenClaw skill (`openclaw install agentbnb`):
- `agentbnb openclaw sync` — reads SOUL.md, publishes multi-skill Capability Card
- `agentbnb openclaw status` — shows sync state, tier, balance, idle rates
- `agentbnb openclaw rules` — outputs HEARTBEAT.md autonomy rules block

## Coding Conventions

- Use `async/await` everywhere, no raw Promises
- All public functions must have JSDoc comments
- Error handling: custom error classes extending `AgentBnBError`
- File naming: kebab-case (e.g., `capability-card.ts`)
- Test files: co-located as `*.test.ts`
- No `any` type — use `unknown` and narrow

## GSD Integration

This project uses GSD for spec-driven development:
- `.planning/ROADMAP.md` — Phase-based development plan
- `.planning/REQUIREMENTS.md` — Detailed requirements
- `.planning/config.json` — GSD configuration

## Trust Architecture

Two-axis trust model:
- **`performance_tier`** (0/1/2 = Listed/Active/Trusted) — computed from execution metrics, never conflated with "verified"
- **`verification_badges`** — external grants only (Phase 2+, currently `[]`)
- **`authority_source`** (`self` | `platform` | `org`)
- **FailureReason** (v7.0): `bad_execution` | `overload` | `timeout` | `auth_error` | `not_found` — non-quality failures excluded from reputation

See `docs/hub-v2-trust-signals.md` for design rationale.

## Package Manager Rules

This project uses **pnpm**. Never use npm or yarn in the project root.

### Hard rules:
- ALWAYS use `pnpm install`, `pnpm add`, `pnpm test`, `pnpm build`
- NEVER run `npm install` in the project root — it creates
  package-lock.json which conflicts with pnpm-lock.yaml
- NEVER use `import.meta.url` relative path traversal (../../) to
  find project root — pnpm global layout uses symlinks into a
  content-addressable store, so relative paths break. Use
  `require.resolve()` or read package.json bin field instead.

### Exception — OpenClaw extensions directory:
- `~/.openclaw/extensions/agentbnb/` uses npm-style flat layout
  (managed by OpenClaw, not by us)
- Native modules in that directory (e.g. better-sqlite3) must be
  rebuilt with `npm rebuild better-sqlite3` (not pnpm)
- This rebuild is needed after every OpenClaw plugin update

### How to tell which package manager manages a directory:
- Has `pnpm-lock.yaml` → use pnpm
- Has `package-lock.json` → use npm
- Has `node_modules/.pnpm/` folder → pnpm-managed
- Has flat `node_modules/` without `.pnpm/` → npm-managed

## Important Context

- v6.0 shipped. v7.0 Phases 54-60 in progress (Agent Economy Infrastructure).
- Agent-first philosophy: every feature must pass "Does this require human intervention? If yes, redesign."
- Hub at `/hub` is the recruiting tool — must be visually polished.
- Founder (Cheng Wen Chen) is the primary developer using vibe coding with Claude Code + GSD.
- Key v7.0 additions: FailureReason enum, capacity enforcement (max_concurrent), demand vouchers, provider bonuses.

## Local Deployment Checklist

After building a new version, TWO paths must be updated:

### Path 1: Global CLI + SkillExecutor (pnpm-managed)
```bash
cd ~/Github/agentbnb
pnpm build
pnpm link --global
# Restart serve:
kill $(pgrep -f "agentbnb serve" | head -1)
agentbnb serve --announce &
# Verify:
agentbnb --version  # should match package.json
```

### Path 2: OpenClaw Plugin (npm-managed, separate copy)
```bash
# Copy built artifacts
cp -R ~/Github/agentbnb/dist/* ~/.openclaw/extensions/agentbnb/dist/
cp ~/Github/agentbnb/package.json ~/.openclaw/extensions/agentbnb/package.json
# Rebuild native modules
cd ~/.openclaw/extensions/agentbnb && npm rebuild better-sqlite3
# Restart daemon
openclaw daemon restart
```

**Why both?** Path 1 runs `agentbnb serve` (gateway + relay + SkillExecutor). Path 2 runs inside OpenClaw agents (Telegram bot, genesis-bot) as a plugin. They are independent copies — updating one does NOT update the other.

## Session Protocol

### Notion Brain Integration
This project uses Notion as shared brain across AI sessions.
- **Brain page**: `32f7ff03-7282-81b5-b6b6-e2236627c316`
- **Backlog DB**: `ce6d1503-3a81-4764-a80b-ab10def56cbc`
- **Decisions Log DB**: `df90e737-9ce3-4ebc-bc97-c5bd40de2311`
- **Session Log DB**: `2c93cca0-b432-4c1c-9479-92ade8b8dd2b`

### Session Start (auto)
1. **Pre-flight check**: `git status` (stash if dirty), `pnpm test` (baseline green)
2. **Parallel Notion reads**: Brain status + last 3 Session Logs + Backlog (Status != Done, top 10)
3. **Plan**: Identify highest-ROI tasks. P0-P1 with clear spec → execute directly. Ambiguous → ask Cheng Wen.
4. **Fallback**: If Notion unavailable → use claude-mem memory + git log

### Execution
- Use Claude Code **Task tool** for parallel work (not `claude -p`)
- Cross-session tasks → write to Notion Backlog, don't context-switch
- Architecture decisions → record in Notion Decisions Log
- Test gate: `pnpm test` must pass before moving to next task

### Session End (auto)
1. `pnpm test` — all green before any commit
2. Selective git staging (never `git add -A`) — review `git status` first
3. **Notion updates** (parallel):
   - Session Log: summary, what got done, decisions, actionable next steps
   - Backlog: done items → Done, new discoveries → new items
   - Brain page: update if major changes (version bump, metrics shift)
4. Next Steps must be specific enough to execute directly (file paths, function names)

### Automation Guardrails
- Uncommitted changes at session start → stash + report, don't discard
- Test failure → do NOT commit, report the failure
- Notion API down → fallback to claude-mem + git log, note "Notion unavailable" in commit
- Never `git add -A` — always selective staging to avoid .env/credentials
- Always `pnpm` (never npm) in project root
