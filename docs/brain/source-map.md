---
title: Source Map
domain: all
status: complete
tags: [source-map, files, reference]
last_verified: 2026-03-17
---

# Source Map

> [!summary]
> Key files grouped by domain. One-line description each.

## Root

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project context for Claude Code sessions |
| `AGENT-NATIVE-PROTOCOL.md` | Design philosophy bible ("agent is the user") |
| `README.md` | Public-facing project description with badges |
| `package.json` | pnpm monorepo config, scripts, dependencies |

## Gateway (`src/gateway/`)

| File | Purpose |
|------|---------|
| `server.ts` | Fastify JSON-RPC server, auth middleware, static file serving for Hub |
| `client.ts` | Outbound HTTP client for requesting capabilities from peers |
| `auth.ts` | Token-based authentication for gateway requests |

## Credit (`src/credit/`)

| File | Purpose |
|------|---------|
| `ledger.ts` | Credit balance CRUD, transaction history, bootstrap grant |
| `escrow.ts` | Hold/settle/release escrow for in-flight requests |
| `budget.ts` | BudgetManager — reserve floor, canSpend() gate |

## Registry (`src/registry/`)

| File | Purpose |
|------|---------|
| `store.ts` | SQLite card storage, FTS5 search, v1→v2 migration |
| `matcher.ts` | Capability matching algorithm |
| `server.ts` | Public registry API endpoints (Fastify) |
| `request-log.ts` | Request history + autonomy audit events |

## Runtime (`src/runtime/`)

| File | Purpose |
|------|---------|
| `agent-runtime.ts` | Centralized DB ownership, background job lifecycle, SIGTERM handler |

## Autonomy (`src/autonomy/`)

| File | Purpose |
|------|---------|
| `tiers.ts` | getAutonomyTier() — Tier 1/2/3 logic |
| `idle-monitor.ts` | Per-skill idle rate tracking, auto-share trigger, croner scheduled |
| `auto-request.ts` | Capability gap detection, peer scoring, budget-gated escrow |
| `pending-requests.ts` | Tier 3 approval queue (pending_requests table) |

## OpenClaw (`src/openclaw/`)

| File | Purpose |
|------|---------|
| `soul-sync.ts` | Parse SOUL.md → multi-skill Capability Card |
| `heartbeat-writer.ts` | Generate HEARTBEAT.md autonomy rules block |
| `skill.ts` | OpenClaw status info |

## Skills Package (`skills/agentbnb/`)

| File | Purpose |
|------|---------|
| `SKILL.md` | OpenClaw/Claude Code skill manifest |
| `bootstrap.ts` | activate()/deactivate() entry points |
| `gateway.ts` | Gateway adapter (thin re-export) |
| `auto-share.ts` | Auto-share adapter |
| `auto-request.ts` | Auto-request adapter |
| `credit-mgr.ts` | Credit manager adapter |

## CLI (`src/cli/`)

| File | Purpose |
|------|---------|
| `index.ts` | Commander CLI — init, publish, discover, request, serve, config, openclaw |
| `onboarding.ts` | Auto-detect API keys, draft card generation |
| `peers.ts` | Peer management (connect, list, remove) |
| `config.ts` | Config management (tier thresholds, reserve) |
| `remote-registry.ts` | Remote registry fetch |

## Hub (`hub/src/`)

| Dir/File | Purpose |
|----------|---------|
| `components/` | CapabilityCard, CardGrid, CardModal, NavBar, OwnerDashboard, etc. |
| `hooks/` | useCards, useAuth, useOwnerCards, useRequests |
| `lib/` | Categories mapping, utilities, design tokens |
| `pages/` | Discover, Agents, Activity, Docs, MyAgent (404) |

## Plugins (`plugins/agentbnb-network/`)

| File | Purpose |
|------|---------|
| `.claude-plugin/manifest.json` | Claude Code plugin manifest |
| `skills/agentbnb/SKILL.md` | Skill for Claude Code marketplace |

## Planning (`.planning/`)

| File | Purpose |
|------|---------|
| `STATE.md` | GSD state machine — current phase, progress, decisions |
| `PROJECT.md` | Project description for GSD |
| `REQUIREMENTS.md` | Requirement specs (updated per milestone) |
| `ROADMAP.md` | Phase roadmap |
| `phases/` | Individual phase plans + completion docs |
