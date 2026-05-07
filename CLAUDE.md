# CLAUDE.md — AgentBnB

## ⚡ v10 Pivot — Agent Maturity Rental (2026-05-04)

> **READ THIS FIRST when starting any new session on this repo.**
>
> AgentBnB has pivoted from "skill marketplace" to **Agent Maturity Rental**.
> The unit of trade is no longer an atomic skill — it is **a session of access
> to a long-tuned agent** (a renter borrows another user's mature Hermes /
> OpenClaw agent for a fixed time window).

**One-line product**: 「租一個別人調校了半年的 AI 員工 60 分鐘」.

**Three primitives** (replaced the old "Capability Card" centric model):
1. **Agent Profile** — public page for a rentable agent: Maturity Evidence + past outcomes + tools + price
2. **Rental Session** — time-boxed shared workspace with threads, files, mode toggle
3. **Outcome Page** — auto-generated shareable artifact at `/o/:share_token` (virality + portfolio)

**Canonical integrations** (v1):
- **Web room** at `/s/{id}` is the canonical UI (NOT Discord/Telegram/Liveblocks/Next.js — all v2)
- **Hermes plugin** (`hermes-plugin/` — Python, contributed to `nousresearch/hermes-agent`) is the canonical supply integration. Two-command onboarding: `hermes plugin install agentbnb && hermes agentbnb publish`. OpenClaw skill (`skills/agentbnb/`) preserved for backward compat but not actively pushed.

**Privacy contract** (ADR-024 — three-layer enforcement, MUST be honoured by all new code):
> 「租用執行能力，不租用 agent 的腦與鑰匙」
- Tools execute on owner machine, renter only sees results
- Session conversation per-sessionId isolated, NEVER pollutes owner agent's main memory
- `request_log` skips persistence when `session_mode=true` (verified by `src/session/privacy.test.ts`)
- Curated Rental Runner spawns isolated subagent loaded with owner-curated `RENTAL.md` (NOT main SOUL/SPIRIT)

**Maturity Evidence > Maturity Score**: never collapse maturity into a single number (would be gamed and lossy). Show evidence categories: platform-observed sessions / completed tasks / repeat renters / artifact examples / verified tools / response reliability / renter rating.

**Authoritative documents**:
- [`docs/adr/022-agent-maturity-rental.md`](docs/adr/022-agent-maturity-rental.md) — pivot rationale + Maturity Evidence
- [`docs/adr/023-session-as-protocol-primitive.md`](docs/adr/023-session-as-protocol-primitive.md) — Session primitive + Web room canonical UI + Hermes canonical supply
- [`docs/adr/024-privacy-boundary.md`](docs/adr/024-privacy-boundary.md) — three-layer privacy enforcement
- [`docs/hermes-plugin-spec.md`](docs/hermes-plugin-spec.md) — implementation spec for `hermes-plugin/`
- [`docs/session-smoke-test.md`](docs/session-smoke-test.md) — end-to-end manual verification
- Plan file (Cheng Wen's local): `~/.claude/plans/memoized-roaming-finch.md`

**Code surface added in v10** (Phase 0+1+2 substrate now on `main` as of 2026-05-05):
- `src/session/session-types.ts` — extended schema (participants, threads, files, mode, outcome, isolated_memory invariant). Backward compat preserved.
- `src/session/privacy.test.ts` — privacy contract regression guard (8 tests)
- `src/sdk/consumer.ts` — `session_mode?: boolean` on ConsumerRequestOptions
- `src/gateway/server.ts` — `sessionMode?: boolean` on GatewayOptions
- `src/registry/request-log.ts` — `InsertRequestLogOptions.sessionMode` skip path
- `src/session/openclaw-session-executor.ts` — three privacy violations marked `@deprecated` (recallMemory / writeSessionSummary / SOUL.md injection). Do NOT extend; new path is Hermes plugin.
- `src/registry/session-routes.ts` — REST surface (POST /api/sessions, threads, end, rating, GET /o/:share_token public)
- `src/registry/agent-routes.ts` — `GET /api/agents/:id/maturity-evidence` (PR #69), agent_id canonicalisation (PR #78), `/me/*` and `/requests` scoping (PR #79)
- `src/migrations/registry-migrations.ts` — `rental_sessions`, `rental_threads`, `rental_ratings` tables
- `hermes-plugin/` — Python plugin shipped with self-distribute install path + RENTAL.md archetypes (PRs #74, #76, #77)
- `hub/src/pages/SessionRoom.tsx`, `OutcomePage.tsx`, `DiscoverPage.tsx` rewrite, `AgentProfileCard.tsx`, `useSessionWebSocket.ts`, `useMaturityEvidence.ts` — Hub Session UI + Discovery reframe + nav reframe (PRs #67, #68)

**Phase 3 launch prep in progress** (substrate complete, going public):
- First Cheng Wen × Hannah dogfood outcome page at `/o/:share_token` (gates discovery surface readiness)
- Founding Provider supply onboarding kickoff (≥ 5 mature agents on `/discover` per launch checklist §1)
- Hermes upstream PR submission against `nousresearch/hermes-agent` (per launch checklist §6)
- See [`docs/v10-launch-checklist.md`](docs/v10-launch-checklist.md) for the full pre-launch gate

**Code conventions added in v10**:
- New rental code paths MUST set `session_mode: true` / `sessionMode: true` so privacy contract is enforced
- New code that touches the rental flow MUST NOT extend `OpenClawSessionExecutor` privacy-violating methods
- New supply integrations MUST use the Curated Rental Runner pattern (RENTAL.md persona, tool whitelist, memory write hook)
- Hub UI mode toggle MUST use human copy ("透過我的 agent" / "直接和出租 agent 對話"), never expose `direct/proxy` to users

---

## Project Overview

AgentBnB is a P2P agent capability sharing protocol. Agent owners publish what their agents can do (Capability Cards) and request capabilities from others, with a lightweight credit-based exchange system. Think Airbnb for AI agent pipelines.

**v10 reframe**: the marketing surface is now Agent Maturity Rental (above). The underlying P2P protocol, DID/UCAN/VC identity stack, escrow, and relay all remain — they are now framed as the substrate for rental sessions rather than skill calls.

**Core Insight: The user of AgentBnB is not the human. The user is the agent.** (See [AGENT-NATIVE-PROTOCOL.md](AGENT-NATIVE-PROTOCOL.md) for the full design philosophy.)

**Founder**: Cheng Wen Chen
**Domain**: agentbnb.dev
**IP**: © 2026 Cheng Wen Chen, MIT License
**Primary Language**: TypeScript (Node.js) for core; Python 3.11+ for `hermes-plugin/`
**Package Managers**: pnpm (TS), uv or pip (Python plugin)

## Current State

- **Version**: 1.0.0 (V1.0 conceptual restart — see [docs/V1.0-RESET.md](docs/V1.0-RESET.md)). v10 pivot is layered on top of V1.0 capability stack — does not bump version, treats the existing identity / escrow / relay as substrate for the new rental product.
- **Active branch**: `main` — v10 substrate landed via PRs #67-#80 (merged 2026-05-05). Per-feature branches now cut from `main` (e.g. `feat/v10-e2-*`, `fix/v10-*`).
- **Internal lineage** (preserved for context): v1.1 → v2.x → v3.0 (SkillExecutor, Conductor, Signed Escrow) → v3.1 (WebSocket Relay) → v4.0 (Agent Economy Platform) → v5.0 (Genesis Flywheel) → v5.1 (OpenClaw Hardening) → v6.0 (Team Formation Protocol) → v7.0 (Agent Economy Infrastructure) → v8.x (V8 Identity Convergence) → v9.x (Agent Identity Protocol) → **v10 (Agent Maturity Rental, 2026-05-04)**.
- **V1.0 capabilities**: Three-layer identity stack (DID + UCAN + Verifiable Credentials) operational — repurposed as the trust substrate for v10 rentals.
  - DID Envelope (did:key + did:agentbnb, rotation, revocation, EVM bridge) ✅
  - UCAN Token Engine (create/verify/delegate, escrow binding, gateway/relay/conductor integration) ✅
  - Verifiable Credentials (reputation/skill/team VCs, weekly scheduler, selective disclosure) ✅
  - Cross-Platform Federation (DID rotation, VC presentation, EVM bridge) ✅
  - BLS Team Proofs → roadmap (post-V1.0)
- **v10 Phase 0+1+2 substrate complete** (merged to `main` 2026-05-05): ADRs signed; session schema extended; privacy contract wired; REST surface live; Hermes plugin shipped; Hub SessionRoom + OutcomePage + Discovery reframe live; Maturity Evidence backend (`/api/agents/:id/maturity-evidence`) live; DID identity canonicalisation + owner dashboard scoping (audit P0 #1, #3-5) shipped.
- **v10 Phase 3 launch prep in progress**: first dogfood outcome page, supply onboarding (Founding Providers cohort), Hermes upstream PR. Gate is [`docs/v10-launch-checklist.md`](docs/v10-launch-checklist.md).
- **Tests**: 2,067 passing across 154 files (verified `pnpm vitest run` on `main`; +267 v10 additions including 8 privacy + 8 session-routes lifecycle + maturity evidence + agent-id canonicalisation + owner scoping coverage)

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
├── auth/        # UCAN tokens, canonical JSON (RFC 8785), resource URI parser (10 files)
├── credentials/ # Verifiable Credentials engine, reputation/skill/team VCs, scheduler (11 files)
├── identity/    # Agent identity, DID (did:key + did:agentbnb), rotation, revocation, EVM bridge, guarantor (15 files)
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
├── cli/         # CLI: init, publish, discover, request, serve, quickstart, conduct, mcp-server, did, vc (19 files)
├── session/     # SessionManager + executors + escrow + v10 rental schema (12 files)
└── types/       # Core TypeScript types + Zod schemas

hub/             # React SPA at /hub (Vite + Tailwind, premium dark theme)
├── pages/       # Discover, Agents, CreateAgent, AgentDashboard, Genesis, CreditPolicy
│                # v10 add: SessionRoom (/s/:id), OutcomePage (/s/:id/outcome) — Phase 2 Track B
├── components/  # 40+ components (cards, charts, hero sections, trust badges)
│                # v10 add: AgentProfileCard, SessionMessage, MessageComposer, ParticipantsPanel, ThreadList, MessageRenderer
└── hooks/       # useCards, useAuth, useOwnerCards, useRequests
                 # v10 add: useSessionWebSocket — Phase 2 Track B

hermes-plugin/   # v10 canonical supply integration (Python 3.11+)
├── plugin.yaml  # Hermes plugin manifest (channel adapter + commands)
├── agentbnb_plugin/
│   ├── adapter.py            # BasePlatformAdapter — channel: agentbnb_session
│   ├── subagent_runner.py    # Curated Rental Runner — isolated subagent per session
│   ├── rental_md_loader.py   # Parse RENTAL.md (persona + tool whitelist)
│   ├── hub_client.py         # HTTP/WS client to AgentBnB Hub
│   ├── memory_hook.py        # Hook into plugins/memory to suppress writes
│   ├── identity.py           # Ed25519 keypair + DID generation
│   ├── commands.py           # CLI: install, publish, status, settle
│   └── plugin_api.py         # FastAPI routes mounted at /api/plugins/agentbnb/*
└── tests/

skills/agentbnb/ # OpenClaw installable skill package — backward compat path (v10 not main supply)
```

## Capability Card Schema

Multi-skill cards — one card per agent, multiple independently-priced skills.

Key fields: `id`, `owner`, `name`, `skills[]`, `pricing`, `availability`, `capability_type`, `performance_tier`, `authority_source`, `gateway_url`

Per-skill fields: `capability_types[]`, `requires_capabilities[]`, `visibility` ('public'|'private'), `capacity.max_concurrent`

Full interfaces: `src/types/index.ts` (CapabilityCard, CapabilityCardV2, Skill)

## Agent Identity Protocol

Three-layer identity stack for autonomous agents:

### Layer 1: Cryptographic Identity (DID)
- **did:key** — Ed25519 pubkey encoded with Multicodec 0xed01 + base58btc (`src/identity/did.ts`)
- **did:agentbnb** — Agent-specific DID method, resolvable via `GET /api/did/:agent_id`
- **Key rotation** — Old key signs rotation proof, 90-day grace period (`src/identity/did-rotation.ts`)
- **Revocation** — Permanent DID revocation with cascade escrow settlement (`src/identity/did-revocation.ts`)
- **EVM bridge** — Ed25519 ↔ secp256k1 cross-sign for ERC-8004 (`src/identity/evm-bridge.ts`)

### Layer 2: Capability Delegation (UCAN)
- **Token format** — JWT-like: base64url(header).base64url(payload).signature, Ed25519 signed
- **Resource URIs** — `agentbnb://kb/*`, `agentbnb://skill/*`, `agentbnb://escrow/*` with glob matching (`src/auth/ucan-resources.ts`)
- **Canonical JSON** — RFC 8785 deterministic serialization (`src/auth/canonical-json.ts`)
- **Delegation chain** — Max depth 3, attenuation-only (narrowing), offline verifiable (`src/auth/ucan-delegation.ts`)
- **Escrow binding** — UCAN lifecycle tied to escrow: settle → expired, refund → revoked (`src/auth/ucan-escrow.ts`)
- **Integration** — Gateway (`Bearer ucan.<token>`), Relay (`ucan_token` field), Conductor (auto sub-delegation)
- **Spec** — `docs/adr/020-ucan-token.md`

### Layer 3: Portable Reputation (Verifiable Credentials)
- **W3C VC format** — Ed25519Signature2020 proof, `@context: [w3.org, agentbnb.dev]` (`src/credentials/vc.ts`)
- **ReputationCredential** — success rate, volume, earnings, peer endorsements (`src/credentials/reputation-vc.ts`)
- **SkillCredential** — milestone badges: bronze (100), silver (500), gold (1000 uses) (`src/credentials/skill-vc.ts`)
- **TeamCredential** — team participation with role + task metadata (`src/credentials/team-vc.ts`)
- **Weekly refresh** — croner scheduler auto-refreshes all agent VCs Sunday 00:00 (`src/credentials/vc-scheduler.ts`)
- **Selective disclosure** — Verifiable Presentation wrapper (`src/credentials/vc-presentation.ts`)
- **Live API** — `GET /api/credentials/:agent_id` returns real VCs from request_log data

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

## Testing

- Run tests with: `pnpm vitest run`
- Never use watch mode

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
- **FailureReason**: `bad_execution` | `overload` | `timeout` | `auth_error` | `not_found` — non-quality failures excluded from reputation
- **Verifiable Credentials**: Portable trust — `AgentReputationCredential`, `AgentSkillCredential`, `AgentTeamCredential` issued from execution data
- **UCAN Authorization**: Scoped, time-bound, delegatable auth tokens bound to escrow lifecycle

See `docs/hub-v2-trust-signals.md` for design rationale and `docs/adr/020-ucan-token.md` for UCAN spec.

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

- V1.0 framing established (2026-04-18); the underlying Agent Identity Protocol shipped 2026-04-03 and is fully operational.
- Agent-first philosophy: every feature must pass "Does this require human intervention? If yes, redesign."
- Hub at `/hub` is the recruiting tool — must be visually polished.
- Founder (Cheng Wen Chen) is the primary developer using vibe coding with Claude Code + GSD.
- Key directories: `src/auth/` (UCAN), `src/credentials/` (VC) — part of the V1.0 identity layer.
- Gateway supports 3 auth methods: Bearer token, Ed25519 identity headers, UCAN tokens.
- v10 planned: BLS signature aggregation, x402 credit bridge, ERC-8004 on-chain identity.

