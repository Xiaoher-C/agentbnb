# AGENTS.md — AgentBnB

## Project Overview

AgentBnB is a P2P agent capability sharing protocol. Agent owners publish what their agents can do (Capability Cards) and request capabilities from others, with a lightweight credit-based exchange system. Think Airbnb for AI agent pipelines.

**Core Insight: The user of AgentBnB is not the human. The user is the agent.** (See [AGENT-NATIVE-PROTOCOL.md](AGENT-NATIVE-PROTOCOL.md) for the full design philosophy.)

**Founder**: Cheng Wen Chen
**Domain**: agentbnb.dev
**IP**: © 2026 Cheng Wen Chen, MIT License
**Primary Language**: TypeScript (Node.js)
**Package Manager**: pnpm

## Current State

- **v1.1 Milestone**: 8/8 phases complete, 24 plans, 302+ tests — shipped 2026-03-15
- **v2.0 Milestone**: 5/5 phases complete (Phases 4-8), 12 plans — shipped 2026-03-15
- **v2.1 Milestone**: 3/3 phases complete (Phases 9-11), ~10 plans — shipped 2026-03-16
- **v2.2 Milestone**: Hub multi-tab UI, Agent profiles, Activity feed, Credits, Docs — shipped 2026-03-17
- **v2.3 Milestone**: Hub landing page polish, Magic UI components, SPA routing fix — shipped 2026-03-17
- **v3.0 Milestone**: SkillExecutor (5 modes), Conductor, Signed Escrow — shipped 2026-03-17
- **Hub v2 Trust Signals**: execution-backed performance_tier + authority_source wired to /cards API — shipped 2026-03-20
- **Current phase**: v3.0 complete. Hub v2 trust layer live. Repo ready for public launch.

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

## Architecture

```
src/
├── registry/        # Capability Card storage and search (SQLite + FTS5)
│   ├── store.ts     # SQLite-backed card storage with v1→v2 migration
│   ├── matcher.ts   # FTS5 capability matching algorithm
│   ├── request-log.ts # Request history and audit events
│   └── server.ts    # Public registry API (Fastify)
├── gateway/         # Agent-to-agent communication
│   ├── server.ts    # HTTP server for incoming requests
│   ├── client.ts    # Outbound request client
│   └── auth.ts      # Simple token-based auth
├── credit/          # Credit tracking and escrow
│   ├── ledger.ts    # Credit balance management
│   ├── escrow.ts    # Hold credits during capability execution
│   ├── budget.ts    # BudgetManager (reserve floor enforcement)
│   ├── signing.ts   # Ed25519 key generation + escrow receipt signing/verification
│   └── settlement.ts # P2P credit settlement (requester ↔ provider)
├── runtime/         # Agent runtime lifecycle
│   └── agent-runtime.ts  # Centralized DB ownership, SIGTERM, background jobs
├── autonomy/        # Agent autonomous behavior
│   ├── tiers.ts     # Autonomy tier logic (Tier 1/2/3)
│   ├── idle-monitor.ts   # Per-skill idle rate tracking + auto-share
│   ├── auto-request.ts   # Peer scoring + capability gap requests
│   └── pending-requests.ts # Tier 3 approval queue
├── openclaw/        # OpenClaw integration
│   ├── soul-sync.ts     # Parse SOUL.md → multi-skill Capability Card
│   ├── heartbeat-writer.ts # Generate HEARTBEAT.md autonomy rules
│   └── skill.ts         # OpenClaw status info
├── skills/          # Capability execution handlers + SkillExecutor
│   ├── executor.ts         # SkillExecutor: dispatch to registered modes
│   ├── skill-config.ts     # skills.yaml schema (Zod) + YAML parser
│   ├── api-executor.ts     # ApiExecutor: HTTP API mode
│   ├── pipeline-executor.ts # PipelineExecutor: sequential step mode
│   ├── openclaw-bridge.ts  # OpenClawBridge: OpenClaw skill mode
│   ├── command-executor.ts # CommandExecutor: local subprocess mode
│   ├── handle-request.ts   # Request handler routing
│   └── publish-capability.ts
├── conductor/       # Conductor: orchestrate multi-agent pipelines
│   ├── types.ts            # SubTask, MatchResult, ExecutionBudget, OrchestrationResult
│   ├── task-decomposer.ts  # decompose(): NLP task → SubTask[] (template matching)
│   ├── capability-matcher.ts # matchSubTasks(): match SubTasks to registry cards
│   ├── budget-controller.ts # BudgetController: per-task budget enforcement
│   ├── pipeline-orchestrator.ts # PipelineOrchestrator: execute DAG of sub-tasks
│   ├── conductor-mode.ts   # ConductorMode: SkillExecutor mode for orchestration
│   └── card.ts             # buildConductorCard/registerConductorCard
├── utils/           # Shared utilities
│   └── interpolation.ts    # interpolate/interpolateObject: {{variable}} substitution
├── discovery/       # mDNS peer discovery
│   └── mdns.ts
├── cli/             # CLI interface
│   ├── index.ts     # Commander-based CLI (init, publish, discover, request, serve, config, openclaw)
│   ├── onboarding.ts # Auto-detect API keys, draft card generation
│   ├── peers.ts     # Peer management
│   ├── config.ts    # Config management (tier thresholds, reserve)
│   └── remote-registry.ts
└── types/           # Shared TypeScript types
    └── index.ts     # Core type definitions + Zod schemas

hub/                 # React SPA served at /hub
├── src/
│   ├── components/  # CapabilityCard, CardGrid, CardModal, StatsBar, SearchFilter, etc.
│   ├── hooks/       # useCards, useAuth, useOwnerCards, useRequests
│   └── lib/         # categories, utils

skills/agentbnb/     # OpenClaw installable skill package
├── SKILL.md         # Skill manifest (agent-executable instructions)
├── bootstrap.ts     # activate()/deactivate() entry point
├── install.sh       # Post-install automation
├── HEARTBEAT.rules.md # Autonomy rules template
├── bootstrap.test.ts # Integration tests for full lifecycle
├── gateway.ts       # Gateway adapter
├── auto-share.ts    # Auto-share adapter
├── auto-request.ts  # Auto-request adapter
└── credit-mgr.ts    # Credit manager adapter
```

## Capability Card Schema v2.0

Multi-skill cards — one card per agent, multiple independently-priced skills:

```typescript
interface CapabilityCard {
  spec_version: '1.0';
  id: string;
  owner: string;
  name: string;
  description: string;
  level: 1 | 2 | 3;       // Atomic | Pipeline | Environment
  skills?: Skill[];         // v2.0: multi-skill array
  inputs: IOSchema[];
  outputs: IOSchema[];
  pricing: {
    credits_per_call: number;
    credits_per_minute?: number;
    free_tier?: number;
  };
  availability: {
    online: boolean;
    schedule?: string;     // cron expression
  };
  powered_by?: PoweredBy[];
  _internal?: Record<string, unknown>;  // Stripped from API
  metadata?: {
    apis_used?: string[];
    avg_latency_ms?: number;
    success_rate?: number;
    tags?: string[];
  };
  // Hub v2 trust fields — computed by /cards API from request_log (owner-level, Phase 1)
  performance_tier?: 0 | 1 | 2;   // 0=Listed, 1=Active (>10 exec), 2=Trusted (>85% success + >50 exec)
  authority_source?: 'self' | 'platform' | 'org';  // self=self-declared, platform=AgentBnB observed, org=org-issued
}

interface Skill {
  id: string;
  name: string;
  description: string;
  level: 1 | 2 | 3;
  category?: string;
  inputs: IOSchema[];
  outputs: IOSchema[];
  pricing: { credits_per_call: number; /* ... */ };
  metadata?: { idle_rate?: number; capacity?: { calls_per_hour: number }; /* ... */ };
}
```

## Agent Autonomy Model

- **Tier 1** — Full autonomy (no notification): < configured threshold (default 0 = disabled)
- **Tier 2** — Notify after action: between tier1 and tier2 thresholds
- **Tier 3** — Ask before action: above tier2 threshold (DEFAULT for fresh installs)
- **IdleMonitor**: Per-skill idle rate tracking via sliding 60-min window, auto-shares when idle_rate > 70%
- **AutoRequestor**: Peer scoring (success_rate × cost_efficiency × idle_rate), self-exclusion, budget-gated
- **BudgetManager**: Reserve floor (default 20 credits), blocks auto-request when balance ≤ reserve

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

## v3.0 Architecture — Key Additions

### SkillExecutor
Executes agent capabilities defined in `skills.yaml`. Five modes:
- **ApiExecutor** — HTTP REST calls with auth, input/output mapping
- **PipelineExecutor** — Sequential multi-step skill chains
- **OpenClawBridge** — Delegates to another OpenClaw skill
- **CommandExecutor** — Local subprocess execution (allowlisted commands)
- **ConductorMode** — Orchestrates multi-agent pipelines via Conductor

### Conductor
Decomposes natural-language tasks into sub-tasks, matches them to registry cards, enforces budget, and executes as a DAG via PipelineOrchestrator. Access via `agentbnb conduct "<task>"`.

### Signed Escrow (Ed25519)
Every credit transfer generates a signed escrow receipt (Ed25519 + canonical JSON). Providers verify receipts on settlement. Zero external crypto dependencies — uses Node.js built-in `crypto`.

## Hub v2 Trust Architecture

The Hub is not just a listing — it is a **trust network**. Every card shows not only what an agent can do, but how trusted it is.

### Two-axis trust model (keep these separate)
- **`performance_tier`** (0/1/2 = Listed/Active/Trusted) — computed purely from execution metrics. Never conflated with "verified".
- **`verification_badges`** (`platform_verified` | `org_authorized` | `real_world_authorized`) — external grants only. Phase 1: always `[]`. Phase 2: filled by verification engine.

### Authority semantics
- **`authority_source`** (`self` | `platform` | `org`) — where the authority claim comes from
- **`verification_status`** (`none` | `observed` | `verified` | `revoked`) — separated from source so "Platform observed" ≠ "Platform verified"

### Phase 1 known limitations
- Trust is **owner-level**, not card-level. All cards from the same owner share the same `performance_tier`.
- `verification_badges` is always `[]` — no verification engine yet.
- `success_rate` denominator is `terminal_exec` only (success + failure + timeout + refunded), excludes audit/autonomy log entries.
- Cards from owners with zero terminal executions are **excluded** (not "unknown") when `min_success_rate` filter is active.

See `docs/hub-v2-trust-signals.md` for full design rationale.

## Important Context

- v1.1 + v2.0 + v2.1 + v2.2 + v2.3 + v3.0 complete. Hub v2 trust signals live. Deployment infrastructure ready.
- v3.0 added: SkillExecutor (5 executor modes), Conductor orchestration, Ed25519 signed escrow, `agentbnb conduct` CLI command.
- Hub v2 added: execution-backed trust signals on every Discover card (performance_tier + authority_source from batch SQL over request_log).
- Founder (Cheng Wen Chen) is the primary developer using vibe coding with Codex + GSD.
- Agent-first philosophy: every feature must pass "Does this require human intervention? If yes, redesign."
- Hub at `/hub` is the recruiting tool — must be visually polished.
- The name "AgentBnB" reflects the Airbnb-like model: list your agent's idle capabilities, others book and use them.
