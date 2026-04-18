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

- **Version**: 1.0.0 (V1.0 conceptual restart — see [docs/V1.0-RESET.md](docs/V1.0-RESET.md))
- **Internal lineage** (preserved for context): v1.1 → v2.x → v3.0 (SkillExecutor, Conductor, Signed Escrow) → v3.1 (WebSocket Relay) → v4.0 (Agent Economy Platform) → v5.0 (Genesis Flywheel) → v5.1 (OpenClaw Hardening) → v6.0 (Team Formation Protocol) → v7.0 (Agent Economy Infrastructure) → v8.x (V8 Identity Convergence) → v9.x (Agent Identity Protocol). V1.0 reframes this as one coherent product.
- **V1.0 capabilities**: Three-layer identity stack (DID + UCAN + Verifiable Credentials) operational
  - DID Envelope (did:key + did:agentbnb, rotation, revocation, EVM bridge) ✅
  - UCAN Token Engine (create/verify/delegate, escrow binding, gateway/relay/conductor integration) ✅
  - Verifiable Credentials (reputation/skill/team VCs, weekly scheduler, selective disclosure) ✅
  - Cross-Platform Federation (DID rotation, VC presentation, EVM bridge) ✅
  - BLS Team Proofs → roadmap (post-V1.0)
- **Tests**: 1,800+

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

