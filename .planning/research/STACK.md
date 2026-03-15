# Stack Research

**Domain:** Agent autonomy features — idle rate monitoring, background scheduling, event-driven autonomy, peer selection scoring, credit budgeting, OpenClaw deep integration
**Researched:** 2026-03-15
**Confidence:** HIGH (versions verified via npm registry; OpenClaw skill structure verified via official docs)

---

## Existing Stack (Do Not Re-Research)

These are validated and must not change:

| Technology | Version | Role |
|------------|---------|------|
| TypeScript strict | ^5.7.0 | Language |
| Node.js | >=20.0.0 | Runtime |
| better-sqlite3 | ^11.6.0 | Registry, ledger, escrow, request_log, reputation |
| Fastify | ^5.1.0 | HTTP gateway + registry server |
| Zod | ^3.24.0 | Schema validation |
| Commander | ^12.1.0 | CLI |
| Vitest | ^2.1.0 | Testing |
| bonjour-service | ^1.3.0 | mDNS peer discovery |
| tsup | ^8.3.0 | Build |

---

## New Stack Additions

### Core New Libraries

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| croner | ^10.0.1 | Background task scheduling for idle-rate polling, auto-share/auto-request cycles | Zero dependencies, native TypeScript, ships types, works in ESM (the project uses `"type": "module"`), supports seconds field and pause/resume — needed for fine-grained polling intervals. node-cron v4.2.1 is an alternative but lacks pause/resume and has historically had ESM issues. croner 10 is OCPS 1.4 compliant. |
| typed-emitter | ^2.1.0 | Type-safe event bus for idle-rate events, autonomy decisions, credit alerts | Zero bytes of runtime — it's only typings layered over Node.js's built-in EventEmitter. No new dependency weight. Gives strict types for event names and payloads (e.g., `idle-rate-changed`, `credit-surplus`, `auto-share-triggered`). Required because the autonomy system is event-driven and raw `EventEmitter` strings are error-prone at the scale of 6+ event types. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| systeminformation | ^5.31.4 | Read CPU utilization, memory, process stats for idle rate detection | Use only if API-call-count-based idle_rate is insufficient; most idle rate detection should use internal call counters + `process.cpuUsage()` (built-in). Add systeminformation only if per-API-key utilization tracking is needed and can't be inferred from call logs. |

### Development Tools

No new dev tools needed. Existing tsup, tsx, vitest, eslint, prettier cover all new modules.

---

## What Existing Stack Already Covers (No New Libraries Needed)

This section is the most important part. Resist the urge to add packages.

| Feature | How Existing Stack Handles It | Notes |
|---------|------------------------------|-------|
| Idle rate storage | better-sqlite3 — add `idle_rate` column to existing cards table | Single ALTER TABLE, no migration library needed |
| Idle rate calculation | Node.js built-in `process.cpuUsage()` + internal call counters tracked in-memory | Avoid systeminformation unless specifically needed |
| Autonomy tier config | Add `autonomy` table to existing SQLite DB via better-sqlite3 | JSON column for tier thresholds works fine |
| Credit budget reserves/limits | Extend existing `credit_balances` table with `reserve_amount`, `spend_limit` columns | Already in better-sqlite3, just schema extension |
| Credit surplus alerts | Typed event on internal EventEmitter + existing Fastify SSE or notification log in SQLite | No new queue library |
| Peer selection scoring | Pure TypeScript — `score = reputation * idle_rate * (1 / cost)` | Plain math in a utility function; no ML library |
| Multi-skill cards | Extend existing CapabilityCard schema — add `skills[]` array, update Zod schema | Schema-only change |
| Auto-request detection | Parse agent's current task context (passed via JSON-RPC) against registry FTS5 search | Already have FTS5 in registry store |
| OpenClaw SKILL.md | Static markdown file in `skills/agentbnb/` directory — no npm package needed | OpenClaw loads from filesystem, not npm |
| OpenClaw HEARTBEAT.md rules | Static markdown file — append AgentBnB protocol block | Text file, no library |
| WAL mode for concurrent background reads | `db.pragma('journal_mode = WAL')` — already supported in better-sqlite3 | Call once at DB init; needed for background tasks writing while gateway serves reads |
| Background task cancellation | croner's built-in `stop()` method | No separate AbortController needed |
| HTTP notification to owner | Existing Fastify routes + SSE or webhook endpoint | Already have Fastify |

---

## Installation

```bash
# New production dependencies
pnpm add croner typed-emitter

# systeminformation — only if per-API utilization tracking is required
# pnpm add systeminformation
```

No new dev dependencies.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| croner ^10.0.1 | node-cron ^4.2.1 | node-cron lacks pause/resume, historically had ESM module issues, smaller feature set for fine-grained scheduling |
| croner ^10.0.1 | node-schedule ^2.x | node-schedule is ESM-unfriendly, heavier, no TypeScript-native |
| croner ^10.0.1 | setInterval (plain) | Setinterval has no cron syntax, drift accumulates, harder to reason about in tests |
| typed-emitter ^2.1.0 | eventemitter3 ^5.0.4 | eventemitter3 cannot declare typed event arguments per TypeScript; also adds runtime weight. typed-emitter is zero bytes runtime — just types |
| typed-emitter ^2.1.0 | mitt | mitt is good but doesn't extend Node.js EventEmitter; would break any code that listens via `.on()` on existing Fastify/Node patterns |
| process.cpuUsage() (built-in) | systeminformation ^5.31.4 | systeminformation is 300KB+ with native bindings; overkill for per-agent idle rate which is just call counts over time |
| SQLite columns for budget | Redis / external queue | Project constraint: "no external DB dependencies." SQLite is the right answer for a local-first protocol. |
| Pure TS peer scoring | ML scoring library | Scoring is three variables multiplied: `reputation × idle_rate × (1/cost)`. No library justified. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| BullMQ / Agenda / bee-queue | Job queue databases require Redis or MongoDB — violates project constraint of zero external DB dependencies | croner + SQLite for persistence if job retry is needed |
| winston / pino (logging) | Already not in the stack; don't add for autonomy logging | Use Fastify's built-in logger (already present) for structured logs |
| rxjs | Reactive streams are over-engineered for 6 event types in an autonomous agent | typed-emitter over Node.js EventEmitter |
| zod-event | No real adoption, maintenance unclear | typed-emitter with manually typed event map |
| @anthropic-ai/sdk or openai | Agent intelligence is not AgentBnB's job — it's OpenClaw's job | Keep AgentBnB as protocol only; no LLM calls in the core |
| Docker SDK / containerization | Out of scope for this milestone; local-first | Plain Node.js process |

---

## OpenClaw Integration: No New npm Package Required

The OpenClaw skill system loads skills from a directory on disk (`~/.openclaw/skills/agentbnb/`). The structure is:

```
skills/agentbnb/
├── SKILL.md           # YAML frontmatter + instructions (plain markdown)
├── gateway.ts         # Starts AgentBnB gateway as part of agent lifecycle
├── auto-share.ts      # Idle rate monitor + auto-publish logic
├── auto-request.ts    # Capability gap detection + auto-request logic
└── credit-mgr.ts      # Credit wallet management
```

The `SKILL.md` frontmatter gates on required env vars:
```yaml
---
name: agentbnb
description: P2P capability sharing protocol — auto-share idle capabilities, auto-request missing ones
metadata: '{"requires": {"bins": [], "env": [], "config": []}}'
user-invocable: false
---
```

This is file-based, not npm-package-based. No OpenClaw SDK dependency needed in AgentBnB.

The message bus for OpenClaw uses WebSocket sessions (`sessions_send`) — AgentBnB's existing HTTP JSON-RPC gateway can serve as an alternative transport without any new library.

---

## SQLite Schema Extensions (No New Library — Pure better-sqlite3)

New columns/tables needed for autonomy features:

```sql
-- Idle rate tracking on capability cards
ALTER TABLE capability_cards ADD COLUMN idle_rate REAL DEFAULT 0.0;
ALTER TABLE capability_cards ADD COLUMN last_call_at TEXT;
ALTER TABLE capability_cards ADD COLUMN call_count_24h INTEGER DEFAULT 0;

-- Autonomy configuration per agent owner
CREATE TABLE IF NOT EXISTS autonomy_config (
  owner TEXT PRIMARY KEY,
  tier INTEGER NOT NULL DEFAULT 2,            -- 1=full, 2=notify-after, 3=ask-before
  idle_threshold REAL NOT NULL DEFAULT 0.7,   -- auto-share above this
  auto_share BOOLEAN NOT NULL DEFAULT 0,
  auto_request BOOLEAN NOT NULL DEFAULT 0,
  tier1_max_credits INTEGER NOT NULL DEFAULT 10,
  tier2_max_credits INTEGER NOT NULL DEFAULT 50,
  updated_at TEXT NOT NULL
);

-- Credit budget configuration
ALTER TABLE credit_balances ADD COLUMN reserve_amount INTEGER DEFAULT 20;
ALTER TABLE credit_balances ADD COLUMN spend_limit_per_tx INTEGER DEFAULT 50;
ALTER TABLE credit_balances ADD COLUMN surplus_threshold INTEGER DEFAULT 500;
```

WAL mode activation (call once at startup):
```typescript
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000'); // prevents SQLITE_BUSY during concurrent background writes
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| croner ^10.0.1 | Node.js >=18.0 | Project requires >=20, so no conflict |
| typed-emitter ^2.1.0 | TypeScript >=4.5, Node.js >=12 | No conflict with TS ^5.7 |
| croner ^10.0.1 | ESM (`"type": "module"`) | Croner ships ESM natively — no CJS/ESM conflict |
| typed-emitter ^2.1.0 | ESM (`"type": "module"`) | Type-only import, no runtime conflict |

---

## Sources

- croner npm registry — version 10.0.1 confirmed (HIGH confidence, npm info)
- node-cron npm registry — version 4.2.1 confirmed (HIGH confidence, npm info)
- typed-emitter npm registry — version 2.1.0 confirmed (HIGH confidence, npm info)
- systeminformation npm registry — version 5.31.4 confirmed (HIGH confidence, npm info)
- OpenClaw official docs (https://docs.openclaw.ai/tools/skills) — SKILL.md format, metadata gates, filesystem-based loading (HIGH confidence)
- OpenClaw npm release notes — version 2026.3.2 current as of 2026-03-15 (MEDIUM confidence, WebSearch)
- better-sqlite3 WAL mode docs (https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — WAL recommended for concurrent read/write (HIGH confidence)
- Node.js process.cpuUsage() official docs — built-in idle detection without external library (HIGH confidence)
- croner GitHub (https://github.com/Hexagon/croner) — pause/resume, ESM native, zero dependencies (HIGH confidence)

---

*Stack research for: AgentBnB v2.0 Agent Autonomy milestone*
*Researched: 2026-03-15*
