# Architecture Research

**Domain:** P2P agent capability sharing — v2.0 Agent Autonomy milestone
**Researched:** 2026-03-15
**Confidence:** HIGH (analysis of actual source code, not speculation)

---

## Current Architecture (v1.1 Baseline)

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Hub (React SPA)                              │
│  CardGrid  OwnerDashboard  SharePage  RequestHistory  AuthGate      │
│                        Vite + Tailwind                               │
└────────────────────────┬────────────────────────────────────────────┘
                         │ HTTP REST
┌────────────────────────▼────────────────────────────────────────────┐
│                    Registry Server (Fastify)                         │
│   GET /cards  GET /cards/:id  GET /me  PATCH /me/cards  GET /me/log │
│            src/registry/server.ts  + owner-routes.ts                │
└───────┬──────────────────────┬──────────────────────────────────────┘
        │                      │
        │ SQLite               │ module calls
┌───────▼──────────┐  ┌────────▼────────────────────────────────────┐
│  registry DB     │  │            Core Modules                      │
│  capability_     │  │  src/registry/store.ts   (CRUD + FTS5)       │
│  cards + FTS5    │  │  src/registry/matcher.ts  (search/filter)     │
│  request_log     │  │  src/credit/ledger.ts     (balances + txns)   │
└──────────────────┘  │  src/credit/escrow.ts     (hold/settle/refund)│
                      │  src/discovery/mdns.ts    (mDNS announce)      │
┌──────────────────┐  │  src/gateway/server.ts   (JSON-RPC inbound)   │
│  credit DB       │  │  src/gateway/client.ts   (outbound requests)  │
│  credit_         │  │  src/gateway/auth.ts      (token auth)         │
│  balances +      │  │  src/skills/handle-request.ts (HandlerMap)    │
│  transactions +  │  │  src/skills/publish-capability.ts             │
│  escrow          │  │  src/cli/onboarding.ts   (detectApiKeys)       │
└──────────────────┘  │  src/cli/config.ts        (AgentBnBConfig)     │
                      │  src/cli/peers.ts         (peer management)     │
                      └─────────────────────────────────────────────────┘
```

### What Exists and What Each Module Does

| Module | File | Responsibility | Used By |
|--------|------|----------------|---------|
| CapabilityCard schema | `src/types/index.ts` | Zod validation, type exports | Everything |
| Registry store | `src/registry/store.ts` | SQLite CRUD + FTS5 search + EWA reputation | Gateway, registry-server, CLI |
| Matcher | `src/registry/matcher.ts` | Full-text search + filter by level/online/apis_used | Registry server, CLI |
| Gateway server | `src/gateway/server.ts` | Fastify JSON-RPC inbound: auth, escrow, execute, settle | `agentbnb serve` |
| Gateway client | `src/gateway/client.ts` | Outbound `capability.execute` JSON-RPC calls | CLI `request`, auto-request |
| Escrow | `src/credit/escrow.ts` | holdEscrow / settleEscrow / releaseEscrow (atomic SQLite tx) | Gateway server |
| Ledger | `src/credit/ledger.ts` | getBalance, getTransactions, bootstrapAgent | Gateway, registry server |
| mDNS | `src/discovery/mdns.ts` | announceGateway / discoverLocalAgents (bonjour-service) | CLI `serve`, peers |
| Config | `src/cli/config.ts` | Read/write `~/.agentbnb/config.json` (AgentBnBConfig) | CLI, serve startup |
| Onboarding | `src/cli/onboarding.ts` | detectApiKeys + buildDraftCard | CLI `init` |
| Peers | `src/cli/peers.ts` | Peer registry (in-memory + SQLite) | CLI `peers` |
| Handler map | `src/skills/handle-request.ts` | Dispatches card_id to local handler function | `agentbnb serve` |
| Registry server | `src/registry/server.ts` | Public HTTP API + Hub static serving + owner routes | `agentbnb serve` |

---

## v2.0 Feature Integration Analysis

### Feature 1: Multi-Skill Cards

**What it is:** One CapabilityCard per agent with a `skills[]` array instead of one card = one skill. Each skill has its own `idle_rate`, `shareable` flag, `inputs`, `outputs`, `pricing`.

**Current state:** `CapabilityCard` in `src/types/index.ts` is a flat single-skill model. The schema must be extended.

**New schema shape:**
```typescript
// Replaces flat CapabilityCard — skill becomes the unit inside the card
interface Skill {
  id: string;                       // e.g. "tts-elevenlabs"
  name: string;
  description: string;
  level: 1 | 2 | 3;
  category: string;                 // "tts" | "video_gen" | "code_review" etc.
  inputs: IOSchema[];
  outputs: IOSchema[];
  pricing: { credits_per_call: number; credits_per_minute?: number; free_tier?: number; };
  idle_rate: number;                // 0.0 – 1.0, detected by idle-monitor
  shareable: boolean;               // agent-controlled based on idle_rate threshold
  shareable_steps?: string[];       // for Level 2: which pipeline steps are shareable
  powered_by?: PoweredBy[];
  metadata?: { apis_used?: string[]; avg_latency_ms?: number; success_rate?: number; tags?: string[]; };
}

// Extended CapabilityCard becomes agent identity
interface CapabilityCard {
  spec_version: '2.0';
  id: string;                       // agent UUID, stable
  owner: string;
  agent_name: string;
  skills: Skill[];                  // multi-skill array
  environment?: {                   // Level 3 info
    runtime: string;
    region?: string;
  };
  availability: { online: boolean; schedule?: string; };
  _internal?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}
```

**Modules modified:**
- `src/types/index.ts` — Extend `CapabilityCardSchema` with `skills[]`, add `SkillSchema`
- `src/registry/store.ts` — FTS5 triggers must index skill names/descriptions within the skills array (JSON path changes)
- `src/registry/matcher.ts` — `searchCards` + `filterCards` must traverse `skills[]` for level/api filters
- `src/registry/server.ts` — `/cards` response shape changes; skill-level endpoints may be needed
- Hub components — `CapabilityCard.tsx`, `CardGrid.tsx` must render multi-skill layout

**New module needed:** None for schema only; schema change ripples through all existing modules.

**Build order position:** Build FIRST. Everything else depends on the new schema shape.

---

### Feature 2: Idle Rate Monitoring + Auto-Share

**What it is:** Background process per skill that measures actual API/resource utilization. When `idle_rate` exceeds the configured threshold (default 70%), skill `shareable` is flipped to `true` and the card is (re)published.

**Current state:** Nothing. No polling, no metrics, no auto-publish logic.

**New module needed:** `src/autonomy/idle-monitor.ts`

```typescript
// src/autonomy/idle-monitor.ts
export interface IdleMonitorOptions {
  owner: string;
  db: Database.Database;
  creditDb: Database.Database;
  pollIntervalMs: number;           // default: 60_000 (1 min)
  idleThreshold: number;            // default: 0.70
  autonomyTier: AutonomyTier;       // controls notification behavior
  onShareableChange?: (skillId: string, shareable: boolean) => void;
}

export class IdleMonitor {
  start(): void                     // begin polling loop (setInterval)
  stop(): void                      // clear interval
  getIdleRate(skillId: string): number   // current computed idle_rate
  forceCheck(): Promise<void>       // manual trigger
}
```

**Idle rate computation:** No external metrics daemon exists. The monitor reads `request_log` to count actual executions per skill in a rolling window and computes idle_rate as `1 - (requests_in_window / capacity_in_window)`. The `request_log` table already exists in `src/registry/request-log.ts`.

**Auto-publish path:**
```
IdleMonitor polls (every N seconds)
  → reads request_log for each skill in the last window
  → computes idle_rate per skill
  → if idle_rate > threshold AND skill.shareable === false:
      → update skill.shareable = true in DB
      → if Tier 1: auto-update card, no notification
      → if Tier 2: update card + emit notification event
      → if Tier 3: emit "pending_approval" event, wait for human confirm
  → write new idle_rate into skill metadata in DB
```

**Modules modified:**
- `src/registry/store.ts` — New function `updateSkillIdleRate(db, cardId, skillId, idleRate)` + `setSkillShareable(db, cardId, skillId, shareable)`
- `src/registry/request-log.ts` — New function `getSkillRequestCount(db, skillId, sinceMs): number` for idle computation
- `src/cli/config.ts` — `AgentBnBConfig` needs `idle_threshold`, `poll_interval_ms` fields
- `src/cli/index.ts` — `agentbnb serve` must start IdleMonitor

**New modules needed:**
- `src/autonomy/idle-monitor.ts` — Core polling logic

**Build order position:** Depends on Multi-Skill Cards schema (Feature 1). Build SECOND.

---

### Feature 3: Autonomy Tiers

**What it is:** Owner-configurable thresholds that determine whether the agent acts silently (Tier 1), notifies after acting (Tier 2), or asks before acting (Tier 3). Tiers apply to both sharing decisions and spend decisions.

```
Tier 1 — Full autonomy: transaction < T1_limit AND known peers
Tier 2 — Notify after: T1_limit ≤ transaction < T2_limit OR new peer
Tier 3 — Ask before: transaction ≥ T2_limit OR unverified peer (reputation < threshold)
```

**Current state:** Nothing. No tier concept exists.

**New module needed:** `src/autonomy/tiers.ts`

```typescript
// src/autonomy/tiers.ts
export interface AutonomyConfig {
  tier1_max_credits: number;        // default: 10  — silent auto-execute
  tier2_max_credits: number;        // default: 50  — execute + notify after
  // anything above tier2_max = Tier 3: must ask
  min_peer_reputation: number;      // default: 0.5 — below this = Tier 3 always
  notify_fn?: (event: AutonomyEvent) => Promise<void>;  // e.g. write to HEARTBEAT log
}

export type AutonomyTier = 1 | 2 | 3;

export type AutonomyEvent =
  | { type: 'share_auto'; skillId: string; idleRate: number }
  | { type: 'share_notify'; skillId: string; idleRate: number }
  | { type: 'share_pending'; skillId: string; idleRate: number }
  | { type: 'request_auto'; cardId: string; credits: number; peer: string }
  | { type: 'request_notify'; cardId: string; credits: number; peer: string }
  | { type: 'request_pending'; cardId: string; credits: number; peer: string };

export function getAutonomyTier(
  credits: number,
  peer: { reputation: number; isNew: boolean },
  config: AutonomyConfig,
): AutonomyTier
```

**Modules modified:**
- `src/cli/config.ts` — `AgentBnBConfig` needs `autonomy: AutonomyConfig` field
- `src/autonomy/idle-monitor.ts` — Calls `getAutonomyTier` before acting on idle_rate
- `src/autonomy/auto-request.ts` (new, Feature 4) — Calls `getAutonomyTier` before spending
- Hub `OwnerDashboard.tsx` — UI to view/change tier thresholds

**New modules needed:**
- `src/autonomy/tiers.ts` — Tier classification logic + event types

**Build order position:** Depends on nothing new; can be built alongside Multi-Skill Cards. Build SECOND (parallel with idle monitor).

---

### Feature 4: Auto-Request

**What it is:** When the agent detects a task it cannot complete with local skills, it automatically queries the network for matching capabilities, selects the best peer by scoring (reputation × inverse_latency × cost_efficiency), and executes via the existing escrow flow.

**Current state:** `requestCapability()` in `src/gateway/client.ts` does outbound requests but requires explicit cardId. No capability gap detection, no peer selection scoring, no autonomous trigger.

**New module needed:** `src/autonomy/auto-request.ts`

```typescript
// src/autonomy/auto-request.ts
export interface AutoRequestOptions {
  owner: string;
  registryDb: Database.Database;
  creditDb: Database.Database;
  autonomyConfig: AutonomyConfig;
  peerStore: PeerStore;             // from src/cli/peers.ts
  maxSearchResults?: number;        // default: 10
}

export class AutoRequestor {
  /** Find best peer card for a capability need (FTS query on skill descriptions). */
  async findBestPeer(query: string, maxCost: number): Promise<ScoredCard | null>

  /** Execute capability with full autonomy tier gate. */
  async requestWithAutonomy(
    need: CapabilityNeed,
    context: AgentContext,
  ): Promise<AutoRequestResult>
}

// Peer scoring: reputation * (1 / normalized_latency) * (1 / normalized_cost)
function scorePeer(card: CapabilityCard, skill: Skill): number
```

**Peer selection scoring uses existing reputation data** (`metadata.success_rate`, `metadata.avg_latency_ms`) stored on cards by `updateReputation()` in `src/registry/store.ts`.

**Modules modified:**
- `src/gateway/client.ts` — `requestCapability` already handles the mechanics; `AutoRequestor` wraps it
- `src/cli/peers.ts` — Needs `getPeerGatewayUrl(owner): string | null` for resolving peer endpoints
- `src/registry/server.ts` — Potential new endpoint `GET /me/pending-requests` for Tier 3 human approval queue
- Hub `OwnerDashboard.tsx` — Pending approval queue display

**New modules needed:**
- `src/autonomy/auto-request.ts` — Peer search, scoring, autonomy-gated execution

**Build order position:** Depends on Tiers (Feature 3). Build THIRD.

---

### Feature 5: Credit Budgeting

**What it is:** Reserve balance (minimum credit floor), spending limits per period, surplus alerts, and budget allocation across skill categories.

**Current state:** `getBalance()` + `holdEscrow()` exist but there is no minimum reserve enforcement, no spending caps, no surplus detection.

**New module needed:** `src/credit/budget.ts`

```typescript
// src/credit/budget.ts
export interface BudgetConfig {
  reserve_credits: number;          // default: 20 — floor, never spend below this
  daily_spend_limit?: number;       // optional cap on outbound spend per 24h
  surplus_alert_threshold?: number; // default: 500 — notify owner above this
  notify_fn?: (event: BudgetEvent) => Promise<void>;
}

export type BudgetEvent =
  | { type: 'surplus_alert'; balance: number; threshold: number }
  | { type: 'low_balance'; balance: number; reserve: number }
  | { type: 'spend_limit_hit'; daily_spent: number; limit: number };

export class BudgetManager {
  /** Returns true if spending `amount` credits is allowed by budget rules. */
  canSpend(amount: number): boolean

  /** Records a spend event for daily limit tracking. */
  recordSpend(amount: number, reason: string): void

  /** Checks surplus and emits alert if above threshold. */
  checkSurplus(): void

  /** Returns available spending power (balance - reserve). */
  availableCredits(): number
}
```

**Where budget is enforced:** The auto-request flow (Feature 4) calls `budgetManager.canSpend()` before calling `holdEscrow()`. The gateway server's existing `getBalance` check also needs the reserve offset.

**Modules modified:**
- `src/credit/ledger.ts` — New function `getDailySpend(db, owner, since): number`
- `src/credit/escrow.ts` — `holdEscrow` needs optional `reserveFloor` parameter or caller pre-checks
- `src/cli/config.ts` — `AgentBnBConfig` needs `budget: BudgetConfig`
- `src/gateway/server.ts` — Inbound requests: check that accepting the request won't violate any budget (minor, the server is the provider side — mainly auto-request side)
- Hub `OwnerDashboard.tsx` — Budget settings panel, balance with reserve visualization

**New modules needed:**
- `src/credit/budget.ts` — Budget enforcement + alerting

**Build order position:** Depends on Tiers (Feature 3) for notification events. Build alongside Auto-Request (Feature 4).

---

### Feature 6: OpenClaw Deep Integration

**What it is:** AgentBnB as an installable OpenClaw skill. Includes: SOUL.md → auto-generate CapabilityCard, HEARTBEAT.md → inject autonomy rules, Message Bus as alternative Gateway transport, skill lifecycle hooks (start/stop/health).

**Current state:** `src/skills/` exists but contains `handle-request.ts` (HandlerMap dispatcher) and `publish-capability.ts`. No OpenClaw-specific integration layer.

**New modules needed:**

```
src/openclaw/
├── skill.ts              # OpenClaw SKILL.md protocol adapter
├── soul-sync.ts          # Parse SOUL.md → CapabilityCard draft
├── heartbeat-writer.ts   # Write AgentBnB rules to HEARTBEAT.md
└── message-bus.ts        # Optional: message-bus transport for gateway
```

```typescript
// src/openclaw/soul-sync.ts
export function parseSoulMd(soulMdContent: string): Partial<CapabilityCard>
export function generateSoulMdSection(card: CapabilityCard): string

// src/openclaw/heartbeat-writer.ts
export function generateHeartbeatSection(autonomyConfig: AutonomyConfig): string
export function injectHeartbeatSection(heartbeatPath: string, section: string): void

// src/openclaw/skill.ts
export interface OpenClawSkillLifecycle {
  onStart(agentContext: OpenClawAgentContext): Promise<void>
  onStop(): Promise<void>
  onHeartbeat(): Promise<{ status: 'ok'; credits: number; sharing: number }>
}
```

**SOUL.md sync flow:**
```
agentbnb openclaw sync
  → reads SOUL.md from OpenClaw agent directory
  → parseSoulMd() extracts: agent_name, skills list, tool declarations
  → buildDraftCard() (existing in src/cli/onboarding.ts) merges with detected APIs
  → writes/updates card in local registry
  → writes AgentBnB section to HEARTBEAT.md
```

**Modules modified:**
- `src/cli/onboarding.ts` — `buildDraftCard` extended to accept parsed SOUL.md data
- `src/cli/index.ts` — New command group `agentbnb openclaw [sync|status|rules]`
- `src/skills/publish-capability.ts` — Used by SOUL.md sync after card generation

**Build order position:** Depends on Multi-Skill Cards (Feature 1) since SOUL.md maps to the multi-skill schema. Build LAST.

---

## New Module Map

```
src/
├── autonomy/                       NEW
│   ├── idle-monitor.ts             Polling idle_rate per skill, triggers auto-share
│   ├── auto-request.ts             Peer search, scoring, autonomy-gated execution
│   └── tiers.ts                    Tier classification logic + AutonomyEvent types
├── credit/
│   ├── ledger.ts                   MODIFY: add getDailySpend()
│   ├── escrow.ts                   MODIFY: reserve-aware spend check
│   └── budget.ts                   NEW: BudgetManager, BudgetConfig, surplus alerts
├── openclaw/                       NEW
│   ├── skill.ts                    OpenClaw SKILL.md protocol adapter
│   ├── soul-sync.ts                SOUL.md → CapabilityCard parser
│   ├── heartbeat-writer.ts         HEARTBEAT.md rule injector
│   └── message-bus.ts              Message bus transport (optional)
├── registry/
│   ├── store.ts                    MODIFY: updateSkillIdleRate, setSkillShareable
│   ├── matcher.ts                  MODIFY: traverse skills[] for search/filter
│   ├── request-log.ts              MODIFY: getSkillRequestCount()
│   └── server.ts                   MODIFY: pending-requests endpoint, skill-level routes
├── gateway/
│   ├── server.ts                   MODIFY: skill_id routing (not just card_id)
│   └── client.ts                   UNCHANGED (AutoRequestor wraps it)
├── types/
│   └── index.ts                    MODIFY: Skill type, multi-skill CapabilityCard schema
└── cli/
    ├── config.ts                   MODIFY: add autonomy, budget, idle fields
    └── index.ts                    MODIFY: start IdleMonitor + BudgetManager on serve
```

---

## Recommended Build Order

The 6 features have hard dependencies. Build order must respect them:

```
Phase A (Foundation — blocks everything else):
  [1] Multi-Skill Cards (src/types, src/registry/store, src/registry/matcher)
      → Schema change propagates to all modules
      → Must be done first; everything else uses new schema

Phase B (Autonomy Core — parallel, both depend on Phase A):
  [2a] Autonomy Tiers (src/autonomy/tiers.ts)
       → No dependencies on 2b, 3, 4
       → Defines AutonomyConfig + event types used by everything else
  [2b] Credit Budgeting (src/credit/budget.ts + modify ledger/escrow)
       → Depends on Phase A (multi-skill card identifies which skill is spending)
       → Independent of 2a internally, but shares AutonomyEvent notification pattern

Phase C (Active Behaviors — sequential within phase):
  [3] Idle Rate Monitor (src/autonomy/idle-monitor.ts)
      → Depends on Phase A (skill schema), 2a (tiers), 2b (budget)
      → First active autonomy behavior
  [4] Auto-Request (src/autonomy/auto-request.ts)
      → Depends on Phase A (skill search), 2a (tiers), 2b (budget), 3 (monitor)
      → Uses existing gateway/client.ts + credit/escrow.ts

Phase D (Integration Layer — depends on all prior):
  [5] OpenClaw Deep Integration (src/openclaw/)
      → Depends on Phase A (multi-skill schema), Phase C (autonomy behaviors)
      → SOUL.md sync, HEARTBEAT.md rules, skill lifecycle
```

**Dependency graph:**

```
Multi-Skill Cards (1)
    ├──► Autonomy Tiers (2a) ──────────────────────────────┐
    ├──► Credit Budgeting (2b) ────────────────────────────┤
    └──► Idle Monitor (3) ◄── (2a) + (2b) ───────────────►│
              └──► Auto-Request (4) ◄── (2a) + (2b) ──────►│
                        └──► OpenClaw Integration (5) ◄────┘
```

---

## Data Flow Changes

### Auto-Share Flow (new)

```
IdleMonitor (setInterval every 60s)
  → reads request_log WHERE skill_id = X AND created_at > (now - window)
  → computes idle_rate = 1 - (actual_requests / capacity)
  → writes idle_rate to skills[X].metadata.idle_rate in DB
  → if idle_rate > threshold:
      → getAutonomyTier(0, peer={}, config) → Tier 1/2/3
      → Tier 1: setSkillShareable(db, cardId, skillId, true) immediately
      → Tier 2: setSkillShareable + emit AutonomyEvent (log to HEARTBEAT)
      → Tier 3: emit "pending_approval", wait for CLI/Hub confirm
```

### Auto-Request Flow (new)

```
External trigger: OpenClaw agent encounters task gap
  → calls AutoRequestor.requestWithAutonomy({ query: "need TTS", maxCost: 15 })
  → FTS search on skills[] across known peers
  → score results: reputation × (1/latency) × (1/cost)
  → pick top scorer
  → getAutonomyTier(cost, peerReputation, config) → tier
  → BudgetManager.canSpend(cost) → bool (reserve check + daily limit)
  → Tier 1: holdEscrow → requestCapability → settleEscrow (silent)
  → Tier 2: same flow + emit AutonomyEvent (notify after)
  → Tier 3: emit "pending_approval" → human approves via CLI/Hub → execute
```

### Credit Budget Flow (new)

```
Auto-Request or manual request:
  → BudgetManager.canSpend(amount):
      → getBalance(db, owner) - reserve_credits >= amount
      → getDailySpend(db, owner, 24h) + amount <= daily_spend_limit
  → If blocked: return error with reason
  → If allowed: proceed to holdEscrow
  → After settlement: BudgetManager.recordSpend(amount)
  → Periodic (or on-settle): checkSurplus() → if balance > surplus_threshold → emit alert
```

### Gateway Routing Change (multi-skill)

```
Current:  POST /rpc { card_id, params }  →  single card handler
New:      POST /rpc { card_id, skill_id, params }
            → look up card.skills.find(s => s.id === skill_id)
            → hold escrow for skill.pricing.credits_per_call
            → route to skill-specific handler (HandlerMap key = skill_id)
            → settle/release
```

---

## Component Boundary Changes

### Existing Module Modifications — Summary

| Module | Change Type | What Changes |
|--------|-------------|--------------|
| `src/types/index.ts` | Schema extension | Add `Skill` type, extend `CapabilityCard` with `skills[]` |
| `src/registry/store.ts` | New functions | `updateSkillIdleRate`, `setSkillShareable`; FTS triggers index skills array |
| `src/registry/matcher.ts` | Logic change | `searchCards` / `filterCards` traverse `skills[]` not flat fields |
| `src/registry/request-log.ts` | New function | `getSkillRequestCount(db, skillId, sinceMs)` for idle computation |
| `src/registry/server.ts` | New endpoint | `GET /me/pending-requests` for Tier 3 approval queue |
| `src/gateway/server.ts` | Routing change | Accept `skill_id` param, route to skill handler, use skill pricing |
| `src/credit/ledger.ts` | New function | `getDailySpend(db, owner, sinceMs)` for budget enforcement |
| `src/credit/escrow.ts` | Minor change | `holdEscrow` callers now pre-check via BudgetManager |
| `src/cli/config.ts` | Type extension | Add `autonomy: AutonomyConfig`, `budget: BudgetConfig`, `idle_threshold` |
| `src/cli/index.ts` | New behaviors | Start IdleMonitor + BudgetManager on `serve`; add `openclaw` commands |
| `src/cli/onboarding.ts` | Extension | `buildDraftCard` accepts SOUL.md parsed data |
| Hub `OwnerDashboard.tsx` | New panels | Autonomy tier config, budget config, pending approvals |

### New Module Interfaces

| Module | Consumes | Exposes |
|--------|----------|---------|
| `src/autonomy/tiers.ts` | `AutonomyConfig` from config | `getAutonomyTier()`, `AutonomyEvent` type |
| `src/autonomy/idle-monitor.ts` | registry DB, request-log, tiers | `IdleMonitor` class with start/stop/getIdleRate |
| `src/autonomy/auto-request.ts` | gateway/client, matcher, tiers, budget, peers | `AutoRequestor` class |
| `src/credit/budget.ts` | credit/ledger, AutonomyEvent | `BudgetManager` class, `BudgetConfig` |
| `src/openclaw/soul-sync.ts` | onboarding.buildDraftCard | `parseSoulMd()`, `generateSoulMdSection()` |
| `src/openclaw/heartbeat-writer.ts` | tiers.AutonomyConfig | `generateHeartbeatSection()`, `injectHeartbeatSection()` |
| `src/openclaw/skill.ts` | All autonomy modules | `OpenClawSkillLifecycle` (start/stop/heartbeat) |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Polling Without the Existing Request Log

**What people do:** Build a separate metrics system (Prometheus, custom counters) to measure idle_rate.
**Why it's wrong:** `request_log` already exists in `src/registry/request-log.ts` with `created_at` timestamps per skill execution. A rolling window query over this table is sufficient and requires zero new infrastructure.
**Do this instead:** `getSkillRequestCount(db, skillId, sinceMs)` reading from `request_log`. Define capacity as max observed throughput in the window.

### Anti-Pattern 2: Autonomy Logic Scattered Across Modules

**What people do:** Add tier checks inline in gateway/server.ts, cli/index.ts, auto-request.ts separately.
**Why it's wrong:** Inconsistent tier behavior, impossible to test, impossible to adjust thresholds globally.
**Do this instead:** All autonomy decisions route through `getAutonomyTier()` in `src/autonomy/tiers.ts`. Single policy, tested in isolation.

### Anti-Pattern 3: Multi-Skill as Multiple Separate Cards

**What people do:** Publish one card per skill to stay backward compatible with existing flat schema.
**Why it's wrong:** Violates AGENT-NATIVE-PROTOCOL.md design intent; breaks agent identity model (agent = one card); makes idle_rate correlation across skills impossible; creates peer selection complexity (which card to use for an agent?).
**Do this instead:** Extend the schema with `skills[]` and version the spec (`spec_version: '2.0'`). Write a migration for v1.x cards.

### Anti-Pattern 4: Blocking the `agentbnb serve` Process on Autonomy

**What people do:** Autonomy behaviors (idle monitoring, auto-request) run synchronously in the serve loop.
**Why it's wrong:** A slow FTS search or hanging peer request blocks all inbound capability serving.
**Do this instead:** IdleMonitor and AutoRequestor run via `setInterval` on the Node.js event loop — they are non-blocking by design. Escrow/request calls are `async`; never `await` them inline in the serve startup path.

### Anti-Pattern 5: Embedding Budget in Escrow Logic

**What people do:** Add reserve check directly inside `holdEscrow()` in `escrow.ts`.
**Why it's wrong:** `holdEscrow` is a low-level atomic operation used by both inbound serving (where budget doesn't apply — you want to accept payment) and outbound requesting (where budget applies). Mixing them breaks the inbound path.
**Do this instead:** `BudgetManager.canSpend()` is called only by `AutoRequestor` (outbound) before calling `holdEscrow`. Inbound gateway server does not call BudgetManager.

---

## Architecture Implications for Roadmap

### Suggested Phase Structure

Based on the dependency graph:

1. **Schema Foundation** — Multi-skill CapabilityCard, spec_version 2.0, migration for v1.x cards. Until this is done nothing else builds on solid ground.
2. **Autonomy Core** — Tiers module + Budget module. These are pure logic with no UI, fast to build and test in isolation.
3. **Idle Monitor + Auto-Share** — First active behavior. Tests the tiers + budget integration end-to-end.
4. **Auto-Request** — Second active behavior. Validates the full autonomous loop (earn via idle-share, spend via auto-request).
5. **OpenClaw Integration** — The SOUL.md sync and HEARTBEAT.md writer. Requires stable schema and stable autonomy behaviors to generate meaningful output.

### Phases That Will Need Deeper Research

| Phase | Risk Area | Reason |
|-------|-----------|--------|
| Schema migration (Phase 1) | Data compatibility | Existing cards in SQLite use flat schema; v1→v2 migration path needs care |
| Idle rate computation (Phase 3) | Accuracy | "Capacity" is undefined — needs a concrete definition (max observed, or fixed config?) |
| Peer scoring function (Phase 4) | Calibration | Reputation × latency × cost weights are arbitrary; need tuning with real OpenClaw data |
| OpenClaw skill protocol (Phase 5) | External interface | OpenClaw SKILL.md format is community-defined; verify current spec before implementing |

---

## Sources

- Analyzed source: `src/types/index.ts`, `src/registry/store.ts`, `src/registry/matcher.ts`, `src/gateway/server.ts`, `src/gateway/client.ts`, `src/credit/ledger.ts`, `src/credit/escrow.ts`, `src/discovery/mdns.ts`, `src/cli/config.ts`, `src/skills/handle-request.ts`, `src/registry/request-log.ts`
- Design intent: `AGENT-NATIVE-PROTOCOL.md` (project root)
- Project context: `.planning/PROJECT.md`
- Confidence: HIGH — all integration points derived from actual source code, not assumptions

---

*Architecture research for: AgentBnB v2.0 Agent Autonomy milestone*
*Researched: 2026-03-15*
