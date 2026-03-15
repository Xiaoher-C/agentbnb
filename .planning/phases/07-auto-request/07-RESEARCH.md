# Phase 7: Auto-Request — Research

**Researched:** 2026-03-15
**Domain:** Autonomous capability gap detection, peer selection, budget-gated escrow execution
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REQ-01 | Capability gap detection triggers auto-request flow via structured event when agent lacks required skill | Gap signal design: CapabilityNeed interface + AutoRequestor.requestWithAutonomy() as the trigger entry point; FTS search confirms gap before initiating |
| REQ-02 | Peer selection scores candidates by `success_rate * (1/credits_per_call) * idle_rate` with min-max normalization | Normalization required because 1/credits_per_call is unbounded; all three variables exist on v2.0 Skill objects (success_rate in metadata, credits_per_call in pricing, idle_rate in _internal) |
| REQ-03 | Self-exclusion guard filters `candidate.owner !== self.owner` before ranking peers | owner field on CapabilityCard is the correct comparison key; config.owner is the self identity; must happen before scoring, not after |
| REQ-04 | Budget-gated escrow execution: BudgetManager.canSpend() → holdEscrow → JSON-RPC execute → settle/release | BudgetManager.canSpend() and holdEscrow/settleEscrow/releaseEscrow all exist; AutoRequestor wraps gateway/client.ts requestCapability(); must settle on success, release on failure |
| REQ-05 | Tier 3 approval queue: `pending_requests` table + `GET /me/pending-requests` endpoint for owner approval | No pending_requests table exists yet — must be created; registry/server.ts owner routes plugin is the correct insertion point for the new endpoint |
| REQ-06 | Auto-request failures written to request_log even when no escrow is initiated | insertAuditEvent() exists and writes to request_log; failure events need a new AutonomyEvent variant or use action_type='auto_request_failed' with status='failure' in request_log |
</phase_requirements>

---

## Summary

Phase 7 completes the earn/spend loop for Agent Autonomy. Phases 4-6 built the foundation — AgentRuntime, multi-skill schema v2.0, autonomy tiers, budget enforcement, and idle monitoring. Phase 7 adds the spending half: `src/autonomy/auto-request.ts` with an `AutoRequestor` class that detects capability gaps, selects the best peer via scored ranking, gates execution through the existing `BudgetManager` and tier system, and executes the capability through the existing `gateway/client.ts`. The implementation follows the same pattern established by `IdleMonitor` in Phase 6: a class registered with `AgentRuntime`, using the centralized DB handles, calling `getAutonomyTier()` and `insertAuditEvent()` from the existing tiers module.

The primary design challenge is the capability gap signal — how does the agent know it lacks a skill? The research conclusion is to make `AutoRequestor.requestWithAutonomy()` the explicit trigger: callers (OpenClaw agents, CLI, or programmatic code) call it with a `CapabilityNeed` describing the required skill, and `AutoRequestor` handles the rest. This is simpler than implicit gap detection (monitoring failed handler dispatches) and is the correct model for Phase 7 scope. The Tier 3 pending-requests approval queue is the only new infrastructure that requires both a new SQLite table and a new HTTP endpoint.

The peer scoring normalization problem (1/credits_per_call is unbounded for free-tier cards) is resolved with min-max normalization per search result set. All three scoring variables (`success_rate`, `credits_per_call`, `idle_rate`) are available on v2.0 `Skill` objects. The `idle_rate` for peer skills lives in their `_internal` field — this is private metadata on each agent's own card; when a peer's card is fetched via FTS search from the registry, `_internal` may not be present on remote cards. Research shows `idle_rate` should be treated as 1.0 (fully idle, best score) when absent, making new/remote peers with no idle data rank as available.

**Primary recommendation:** Build `AutoRequestor` as a single class in `src/autonomy/auto-request.ts`, following the IdleMonitor pattern. Implement in two plans: Plan 1 creates the `AutoRequestor` class with peer search, scoring, self-exclusion, budget gate, and escrow execution (REQ-01 through REQ-04, REQ-06). Plan 2 adds the Tier 3 pending-requests table and HTTP endpoint (REQ-05) plus human-verify checkpoint.

---

## Standard Stack

### Core (No New Dependencies)

All required functionality is covered by already-installed packages. No new production dependencies for Phase 7.

| Library | Already In | Purpose | Usage in Phase 7 |
|---------|-----------|---------|-----------------|
| `better-sqlite3` | Yes | SQLite reads/writes | pending_requests table; failure log writes |
| `src/gateway/client.ts` | Yes | Outbound JSON-RPC | `requestCapability()` called by AutoRequestor |
| `src/credit/escrow.ts` | Yes | Escrow hold/settle/release | Wrapped by AutoRequestor after canSpend() passes |
| `src/credit/budget.ts` | Yes | Reserve floor enforcement | `BudgetManager.canSpend()` before every escrow |
| `src/autonomy/tiers.ts` | Yes | Tier gate + audit log | `getAutonomyTier()`, `insertAuditEvent()` |
| `src/registry/matcher.ts` | Yes | FTS peer search | `searchCards()` to find candidates matching the need |
| `src/cli/peers.ts` | Yes | Peer gateway URL lookup | `loadPeers()` to get gateway URL + token for selected peer |
| `fastify` | Yes | Registry server | `GET /me/pending-requests` endpoint added to owner routes |

### No New Dependencies

Do not add: job queues (BullMQ, Agenda — require Redis), scoring libraries (overkill for a 3-variable formula), HTTP client libraries (Node.js built-in `fetch` via `gateway/client.ts` is sufficient), any ML library.

---

## Architecture Patterns

### Recommended Project Structure — New Files

```
src/
└── autonomy/
    ├── tiers.ts              (EXISTS — getAutonomyTier, insertAuditEvent)
    ├── idle-monitor.ts       (EXISTS — polling loop)
    └── auto-request.ts       (NEW — AutoRequestor class)
```

```
src/registry/
└── server.ts                 (MODIFY — add GET /me/pending-requests to ownerRoutes)
```

SQLite schema change (new table in registry DB):
```
pending_requests              (NEW TABLE — Tier 3 approval queue)
```

### Pattern 1: AutoRequestor Class (Mirrors IdleMonitor)

**What:** A class instantiated in `agentbnb serve` command, passed the same `AgentRuntime` DB handles, with a public `requestWithAutonomy()` method as the trigger point.

**When to use:** Every time a caller identifies a capability gap and needs a peer to fill it.

```typescript
// src/autonomy/auto-request.ts

export interface CapabilityNeed {
  /** Free-text description of the required skill (used as FTS query). */
  query: string;
  /** Maximum credits the caller is willing to spend. */
  maxCostCredits: number;
  /** Input parameters forwarded to the peer capability. */
  params?: Record<string, unknown>;
}

export interface AutoRequestOptions {
  owner: string;               // Self identity — used for self-exclusion
  registryDb: Database.Database;
  creditDb: Database.Database;
  autonomyConfig: AutonomyConfig;
  budgetConfig: BudgetConfig;
  maxSearchResults?: number;   // default 10
}

export class AutoRequestor {
  constructor(opts: AutoRequestOptions) { ... }

  /**
   * Full auto-request flow: search → score → self-exclude → tier gate
   * → budget check → escrow → execute → settle/release → audit log.
   */
  async requestWithAutonomy(need: CapabilityNeed): Promise<AutoRequestResult>
}

export interface AutoRequestResult {
  status: 'success' | 'budget_blocked' | 'tier_blocked' | 'no_peer' | 'failed';
  result?: unknown;           // returned by peer on success
  escrowId?: string;
  peer?: string;
  creditsSpent?: number;
  reason?: string;            // failure description for audit log
}
```

### Pattern 2: Peer Scoring with Min-Max Normalization

**What:** Score each candidate skill by `success_rate * (1/credits_per_call) * idle_rate`, then normalize each dimension across the result set before multiplying.

**Why normalization is required:** `1/credits_per_call` approaches infinity as cost approaches 0 (free-tier cards). A single free-tier peer would dominate any result set. Min-max normalization per search result set bounds all three dimensions to [0, 1] before multiplying.

**Algorithm:**

```typescript
// Source: REQUIREMENTS.md REQ-02 + PITFALLS.md peer scoring section

interface ScoredPeer {
  card: AnyCard;
  skill: Skill;
  peerConfig: PeerConfig;  // gateway URL + token from peers.ts
  rawScore: number;
}

function scorePeers(candidates: Array<{ card: AnyCard; skill: Skill; peer: PeerConfig }>): ScoredPeer[] {
  if (candidates.length === 0) return [];

  // Extract raw values — use defaults when field missing
  const successRates = candidates.map(c => c.skill.metadata?.success_rate ?? 0.5);
  const costs = candidates.map(c => c.skill.pricing.credits_per_call);
  // idle_rate from _internal (own card) or default 1.0 for remote cards
  const idleRates = candidates.map(c => (c.skill._internal?.idle_rate as number | undefined) ?? 1.0);

  // Min-max normalize each dimension
  const normSuccessRate = minMaxNormalize(successRates);
  const normCostEff = minMaxNormalize(costs.map(c => c === 0 ? 1 : 1 / c));  // invert cost
  const normIdle = minMaxNormalize(idleRates);

  return candidates.map((c, i) => ({
    ...c,
    rawScore: (normSuccessRate[i] ?? 0) * (normCostEff[i] ?? 0) * (normIdle[i] ?? 0),
  })).sort((a, b) => b.rawScore - a.rawScore);
}

function minMaxNormalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);  // all equal → all score 1
  return values.map(v => (v - min) / (max - min));
}
```

**Zero-cost edge case:** When `credits_per_call === 0`, `1/cost` is `Infinity`. Map to inverse 1 before normalizing (free is maximally cost-efficient).

**Single candidate edge case:** Min-max with one item produces NaN (max === min). Guard: if only one candidate passes self-exclusion and is online, use it directly without scoring.

### Pattern 3: Self-Exclusion Guard

**What:** Before scoring, filter out any candidate whose `card.owner === self.owner`.

**Why:** The agent's own card will score well on its own skills. Selecting itself produces a self-escrow hold and a loop-back HTTP request that can deadlock (PITFALLS.md Pitfall 4).

```typescript
// Self-exclusion is a pre-filter, not a post-filter
const candidates = searchResults.filter(card => card.owner !== this.owner);
```

**When to apply:** Always, before any scoring. Not configurable. Not optional.

### Pattern 4: Budget-Gated Escrow Execution

**What:** The exact sequence for every auto-request attempt.

```typescript
// Source: REQUIREMENTS.md REQ-04, ARCHITECTURE.md Auto-Request Flow

async function executeWithEscrow(
  creditDb: Database.Database,
  budget: BudgetManager,
  peer: ScoredPeer,
  need: CapabilityNeed,
  owner: string,
): Promise<AutoRequestResult> {
  const cost = peer.skill.pricing.credits_per_call;

  // 1. Budget gate — reserve-aware
  if (!budget.canSpend(cost)) {
    return { status: 'budget_blocked', reason: 'Reserve floor would be breached' };
  }

  // 2. Hold escrow
  let escrowId: string;
  try {
    escrowId = holdEscrow(creditDb, owner, cost, peer.card.id);
  } catch (err) {
    return { status: 'failed', reason: `Escrow hold failed: ${String(err)}` };
  }

  // 3. Execute via gateway client
  let result: unknown;
  try {
    result = await requestCapability({
      gatewayUrl: peer.peerConfig.url,
      token: peer.peerConfig.token,
      cardId: peer.card.id,
      params: { skill_id: peer.skill.id, ...need.params },
      timeoutMs: 30_000,
    });
  } catch (err) {
    // Release escrow on any execution failure
    releaseEscrow(creditDb, escrowId);
    return { status: 'failed', reason: String(err), escrowId };
  }

  // 4. Settle escrow on success
  settleEscrow(creditDb, escrowId, peer.card.owner);
  return { status: 'success', result, escrowId, peer: peer.card.owner, creditsSpent: cost };
}
```

### Pattern 5: Tier 3 Pending-Requests Table

**What:** A new SQLite table in the registry DB for storing pending Tier 3 auto-requests awaiting owner approval.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS pending_requests (
  id TEXT PRIMARY KEY,
  skill_query TEXT NOT NULL,
  max_cost_credits REAL NOT NULL,
  selected_peer TEXT,         -- owner of the selected peer card
  selected_card_id TEXT,
  selected_skill_id TEXT,
  credits REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
```

**Endpoint:**

```
GET /me/pending-requests
Authorization: Bearer <api_key>

Response: Array<PendingRequest>
```

**When written:** When `getAutonomyTier(cost, config)` returns `3` and a peer has been selected. The request is saved as pending rather than executed. The owner reviews via Hub or `GET /me/pending-requests`.

**Table location:** Registry DB (same as `request_log`). Created in `openDatabase()` migration path or `runMigrations()`.

### Pattern 6: Failure Logging (REQ-06)

**What:** Every auto-request attempt that fails — including pre-escrow failures — must write to `request_log`.

**How:** Use `insertAuditEvent()` from `src/autonomy/tiers.ts`. For failures before escrow, a new event variant is needed or use direct `request_log` INSERT.

The cleanest approach is a dedicated `insertRequestFailure()` helper (or reuse `insertAuditEvent` with a new failure event type):

```typescript
// Option A: Add a failure event type to AutonomyEvent union in tiers.ts
| { type: 'auto_request_failed'; card_id: string; skill_id: string; tier_invoked: AutonomyTier; credits: number; peer: string; reason: string }

// Option B: Direct INSERT into request_log with status='failure' and action_type='auto_request_failed'
// This avoids expanding the AutonomyEvent union which is also consumed by Phase 6.
```

**Recommendation:** Option A — add `auto_request_failed` to `AutonomyEvent` union in `tiers.ts`. This keeps all audit writes going through `insertAuditEvent()` as the single audit write path. The union is already designed as a discriminated union that's easy to extend.

### Anti-Patterns to Avoid

- **Implicit gap detection via failed dispatches:** Monitoring for handler dispatch failures is complex, async-unreliable, and couples auto-request to the gateway server internals. Use explicit `requestWithAutonomy()` calls instead.
- **Calling `holdEscrow` before `canSpend`:** Every escrow must be preceded by `budget.canSpend()`. Never bypass. (PITFALLS.md Pitfall 6, REQUIREMENTS.md BUD-02)
- **Scoring without self-exclusion:** Always filter `candidate.owner !== self.owner` before building the scored list. (PITFALLS.md Pitfall 4)
- **Omitting failure log when no escrow was initiated:** REQ-06 is explicit. Budget blocks, tier blocks, and "no peer found" outcomes all go to request_log.
- **Mixing idle_rate from peers' `_internal` with own skills:** Remote cards fetched from the registry may have their `_internal` stripped (server strips `_internal` on public endpoints — see `stripInternal()` in server.ts). Default to `idle_rate = 1.0` when absent.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Outbound HTTP capability request | Custom fetch wrapper | `requestCapability()` in `gateway/client.ts` | Already handles Bearer auth, JSON-RPC envelope, timeout, error mapping |
| Credit hold/settle/release | Custom DB transaction | `holdEscrow()`, `settleEscrow()`, `releaseEscrow()` in `credit/escrow.ts` | Already atomic, handles insufficient credits, handles double-settle |
| Reserve floor check | Inline balance comparison | `BudgetManager.canSpend()` in `credit/budget.ts` | Already handles zero-cost bypass, floor at 0, correct math |
| Autonomy tier classification | Inline threshold check | `getAutonomyTier()` in `autonomy/tiers.ts` | Already handles DEFAULT_AUTONOMY_CONFIG (Tier 3 default), exact boundary semantics |
| Audit trail write | Direct `INSERT INTO request_log` | `insertAuditEvent()` in `autonomy/tiers.ts` | Consistent schema, UUID generation, correct field mapping |
| FTS peer search | Custom SQL LIKE query | `searchCards()` in `registry/matcher.ts` | Already uses FTS5 BM25 ranking, handles v2.0 skills[] index |
| Peer gateway URL lookup | Parsing peers from config inline | `loadPeers()` from `cli/peers.ts` | Already handles missing file, JSON parse errors, empty array |

**Key insight:** Phase 7 is almost entirely composition. Every primitive operation already exists. `AutoRequestor` orchestrates them — it does not implement any new database primitives.

---

## Common Pitfalls

### Pitfall 1: `_internal.idle_rate` Not Present on Remote Peer Cards

**What goes wrong:** `searchCards()` returns peer cards from the registry. The registry server calls `stripInternal()` before inserting cards into the public index (via the gateway's publish flow), so `_internal` fields are absent on peer cards fetched via FTS search. The scoring formula uses `skill._internal?.idle_rate` which returns `undefined`, and the score collapses to `NaN` or `0`.

**Why it happens:** `idle_rate` is private per-agent metadata (stored in `_internal` precisely because it should not be transmitted). The FTS index contains public card data.

**How to avoid:** Default `idle_rate` to `1.0` (fully idle = best candidate) when `_internal?.idle_rate` is absent. This makes peers without idle data rank as available, which is conservative and correct.

**Warning signs:** All normalized idle scores are 0 or NaN; every peer scores 0 despite valid success_rate and cost data.

### Pitfall 2: Min-Max Normalization Divides by Zero with Single Candidate

**What goes wrong:** `minMaxNormalize([x])` with a single value produces `(x - x) / (x - x)` = `0/0` = `NaN`. If only one peer passes self-exclusion and the online filter, the score is NaN and the peer is not selected despite being valid.

**How to avoid:** Guard: if `max === min` (all values equal OR single candidate), return `values.map(() => 1)` so every candidate gets score 1 and the first is selected.

### Pitfall 3: Free-Tier Cards Dominate Without Normalization

**What goes wrong:** `credits_per_call = 0` → `1/0 = Infinity` → unnormalized product is `Infinity` regardless of success_rate or idle_rate. The free-tier card always wins.

**How to avoid:** Map zero-cost to inverse 1 before normalization: `c === 0 ? 1 : 1 / c`. This makes free-tier cards "maximally cost-efficient" (score 1 in the cost dimension) while still subject to success_rate and idle_rate on the other dimensions.

### Pitfall 4: Tier 3 Pending Request Lost on Process Restart

**What goes wrong:** Tier 3 approval queue stored only in memory — if the agent restarts before the owner approves, the pending request is gone. Owner sees nothing in `GET /me/pending-requests`.

**How to avoid:** Write to `pending_requests` SQLite table immediately when Tier 3 path is taken. Not an in-memory queue.

### Pitfall 5: Failure Not Logged When `loadPeers()` Returns Empty

**What goes wrong:** `searchCards()` returns candidates but none have a registered peer in `peers.json` (owner found the card via FTS but never added the peer). AutoRequestor returns `{ status: 'no_peer' }` silently without writing to `request_log`.

**How to avoid:** Every `AutoRequestResult` status (including `no_peer` and `budget_blocked`) must produce an `insertAuditEvent` call or direct request_log write. REQ-06 is unconditional — failures always get logged.

### Pitfall 6: Missing `skill_id` in `requestCapability` Params

**What goes wrong:** AutoRequestor calls `requestCapability()` with only `cardId`. The gateway receives the request without `skill_id` and falls back to `skills[0]` (v1.0 backward compat path). If the intended skill is not `skills[0]`, the wrong skill executes, wrong pricing is used.

**How to avoid:** Always pass `skill_id: peer.skill.id` in the params forwarded to `requestCapability()`. The gateway's skill resolution (from Phase 4-03) requires `skill_id` in the params object.

---

## Code Examples

### Existing Primitives Used by AutoRequestor

```typescript
// Source: src/gateway/client.ts
import { requestCapability } from '../gateway/client.js';
// Usage:
const result = await requestCapability({
  gatewayUrl: peerConfig.url,
  token: peerConfig.token,
  cardId: peer.card.id,
  params: { skill_id: peer.skill.id, ...need.params },
});
```

```typescript
// Source: src/credit/escrow.ts
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
// Usage (always in this sequence):
const escrowId = holdEscrow(creditDb, owner, cost, cardId);
// on success:
settleEscrow(creditDb, escrowId, recipientOwner);
// on failure:
releaseEscrow(creditDb, escrowId);
```

```typescript
// Source: src/credit/budget.ts
import { BudgetManager } from '../credit/budget.js';
// Constructed in serve command, passed to AutoRequestor:
const budget = new BudgetManager(runtime.creditDb, config.owner, config.budget);
// Usage before every escrow:
if (!budget.canSpend(cost)) {
  // log failure, return budget_blocked
}
```

```typescript
// Source: src/autonomy/tiers.ts
import { getAutonomyTier, insertAuditEvent } from '../autonomy/tiers.js';
// Usage:
const tier = getAutonomyTier(cost, config.autonomy ?? DEFAULT_AUTONOMY_CONFIG);
// tier === 1: execute immediately
// tier === 2: execute + insertAuditEvent({ type: 'auto_request_notify', ... })
// tier === 3: write to pending_requests table, return tier_blocked
```

```typescript
// Source: src/registry/matcher.ts
import { searchCards } from '../registry/matcher.js';
// Usage for peer discovery:
const candidates = searchCards(registryDb, need.query, { online: true });
// Filter self:
const filtered = candidates.filter(card => card.owner !== self.owner);
```

```typescript
// Source: src/cli/peers.ts
import { loadPeers } from '../cli/peers.js';
// Usage to find gateway URL for a peer card:
const peers = loadPeers();
const peerConfig = peers.find(p => p.name === card.owner) ?? null;
// If null: peer not registered — log failure, skip this candidate
```

### New: pending_requests Table Schema

```sql
-- Added in openDatabase() or runMigrations() — registry DB
CREATE TABLE IF NOT EXISTS pending_requests (
  id TEXT PRIMARY KEY,
  skill_query TEXT NOT NULL,
  max_cost_credits REAL NOT NULL,
  selected_peer TEXT,
  selected_card_id TEXT,
  selected_skill_id TEXT,
  credits REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
```

### New: `GET /me/pending-requests` Endpoint

```typescript
// Added to ownerRoutes plugin in src/registry/server.ts
ownerRoutes.get('/me/pending-requests', async (_request, reply) => {
  const rows = db
    .prepare(`SELECT * FROM pending_requests WHERE status = 'pending' ORDER BY created_at DESC`)
    .all() as PendingRequest[];
  return reply.send(rows);
});
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| Manual `agentbnb request` CLI command | AutoRequestor.requestWithAutonomy() triggered programmatically | Completes the autonomous earn/spend loop — no human keystroke required |
| No peer scoring (first result wins) | 3-variable scored ranking with normalization | Best peer selected automatically — success_rate + cost + availability all weighted |
| No Tier 3 queue | pending_requests table + HTTP endpoint | Owner can review and approve/reject pending autonomous requests |

---

## Open Questions

1. **Peer matching: FTS vs owner-name lookup**
   - What we know: `searchCards()` uses FTS5 BM25 to find cards by skill name/description; `loadPeers()` uses peer name from `peers.json` which is keyed by human name (e.g., "alice"), not `card.owner`
   - What's unclear: The peer registry uses `name` as a human-assigned label that may not match `card.owner`. When a card is found via FTS, how do we look up the gateway URL? Is `card.owner` used as the peer lookup key, or the peer's `name`?
   - Recommendation: `PeerConfig` has a `name` field (human label) but no `owner` field. Add an optional `owner` field to `PeerConfig`, or use `name === card.owner` as the match (assuming convention that peer name === card owner). For Phase 7, accept that the FTS-found card's `owner` must exactly match a peer's `name` in `peers.json`. Document this as a convention in the CLI `peers add` help text. No schema change needed for Phase 7.

2. **Who calls `requestWithAutonomy()`?**
   - What we know: The phase description says "capability gap event triggers auto-request flow" but Phase 7 is a standalone TypeScript module, not yet hooked into OpenClaw (that's Phase 8)
   - What's unclear: Is there a CLI command that triggers auto-request? Or is it purely a programmatic API for Phase 8 to consume?
   - Recommendation: Expose a CLI command `agentbnb request --query "text-to-speech" --max-cost 15` that calls `requestWithAutonomy()`. This makes the feature testable from the command line during Phase 7 without waiting for Phase 8 OpenClaw integration. The same method is then re-used by Phase 8.

3. **Tier 3 approval mechanism**
   - What we know: REQ-05 requires `GET /me/pending-requests` endpoint. The table stores pending requests.
   - What's unclear: Is there a `POST /me/pending-requests/:id/approve` endpoint, or does the owner just delete rows? The hub dashboard might also display this — unclear if Hub changes are in scope for Phase 7.
   - Recommendation: Add `POST /me/pending-requests/:id/approve` and `POST /me/pending-requests/:id/reject` endpoints as part of the same plan that creates the table and `GET` endpoint. Hub display of pending requests is out of scope for Phase 7 (Hub changes are a separate concern). The endpoints are sufficient for CLI/API-level approval.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (co-located `*.test.ts` files) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test src/autonomy/auto-request.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-01 | `requestWithAutonomy()` called with CapabilityNeed triggers full flow | integration | `pnpm test src/autonomy/auto-request.test.ts` | Wave 0 |
| REQ-02 | Peer scoring formula with min-max normalization selects highest-scored candidate | unit | `pnpm test src/autonomy/auto-request.test.ts` | Wave 0 |
| REQ-03 | Self-exclusion: own card in FTS results is filtered before scoring | unit | `pnpm test src/autonomy/auto-request.test.ts` | Wave 0 |
| REQ-04 | canSpend() gates escrow — budget block returns `budget_blocked`, success settles escrow | integration | `pnpm test src/autonomy/auto-request.test.ts` | Wave 0 |
| REQ-05 | Tier 3 path writes to pending_requests table; `GET /me/pending-requests` returns rows | integration | `pnpm test src/registry/server.test.ts` | Extends existing |
| REQ-06 | All failure paths (no_peer, budget_blocked, execution_failed) write to request_log | unit | `pnpm test src/autonomy/auto-request.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test src/autonomy/auto-request.test.ts`
- **Per wave merge:** `pnpm test` (all backend tests — currently ~315 tests)
- **Phase gate:** Full suite green before human-verify checkpoint

### Wave 0 Gaps

- [ ] `src/autonomy/auto-request.test.ts` — covers REQ-01, REQ-02, REQ-03, REQ-04, REQ-06
- [ ] `src/registry/server.ts` GET `/me/pending-requests` test — extends `src/registry/server.test.ts`
- [ ] `pending_requests` table migration — added to `openDatabase()` or `runMigrations()` in store.ts

---

## Implementation Sequencing

### Recommended: 2 Plans

**Plan 07-01: AutoRequestor Core**
- Create `src/autonomy/auto-request.ts` with `AutoRequestor` class
- Implement: FTS peer search, self-exclusion, min-max scoring, budget gate, escrow flow, failure logging
- Add `auto_request_failed` event to `AutonomyEvent` union in `tiers.ts`
- Wire `agentbnb request --query <q> --max-cost <n>` CLI command as testable trigger
- Tests: `src/autonomy/auto-request.test.ts` (TDD)
- Addresses: REQ-01, REQ-02, REQ-03, REQ-04, REQ-06

**Plan 07-02: Tier 3 Approval Queue + Human Verify**
- Create `pending_requests` table in registry DB (via `runMigrations()` or `openDatabase()`)
- Wire Tier 3 path in AutoRequestor to write to `pending_requests` instead of executing
- Add `GET /me/pending-requests`, `POST /me/pending-requests/:id/approve`, `POST /me/pending-requests/:id/reject` to ownerRoutes in `registry/server.ts`
- Tests: extend `src/registry/server.test.ts`
- Human-verify checkpoint: run `agentbnb serve`, trigger auto-request in Tier 3 mode, verify pending row appears in `GET /me/pending-requests`
- Addresses: REQ-05

---

## Sources

### Primary (HIGH confidence)

- `src/autonomy/tiers.ts` — `AutonomyEvent` union, `getAutonomyTier()`, `insertAuditEvent()` interfaces (direct code analysis)
- `src/credit/budget.ts` — `BudgetManager.canSpend()`, `availableCredits()` (direct code analysis)
- `src/credit/escrow.ts` — `holdEscrow()`, `settleEscrow()`, `releaseEscrow()` exact signatures (direct code analysis)
- `src/gateway/client.ts` — `requestCapability()` interface, params shape (direct code analysis)
- `src/registry/matcher.ts` — `searchCards()` behavior, FTS5 BM25 ranking (direct code analysis)
- `src/cli/peers.ts` — `PeerConfig`, `loadPeers()`, `findPeer()` (direct code analysis)
- `src/registry/server.ts` — owner routes plugin structure, `stripInternal()` behavior (direct code analysis)
- `.planning/REQUIREMENTS.md` — REQ-01 through REQ-06 exact text (authoritative spec)
- `.planning/research/SUMMARY.md` — Peer scoring formula, normalization flag, self-exclusion pattern
- `.planning/research/ARCHITECTURE.md` — AutoRequestor class interface design, data flow diagrams
- `.planning/research/PITFALLS.md` — Pitfall 4 (self-selection deadlock), Pitfall 6 (reserve not enforced)
- Phase 4-6 SUMMARY.md files — Exact interfaces of all built modules, key decisions

### Secondary (MEDIUM confidence)

- OWASP Top 10 for Agentic Applications 2026 — Least-Agency principle confirming Tier 3 default is correct
- AGENT-NATIVE-PROTOCOL.md — earn/spend loop design intent

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all primitives exist in current codebase; no new dependencies
- Architecture: HIGH — derived from direct source code analysis of all built modules
- Peer scoring: HIGH — formula specified in REQUIREMENTS.md; normalization approach verified against known edge cases (free-tier, single candidate)
- Tier 3 queue: HIGH — table schema and endpoint pattern match existing owner routes structure
- Capability gap signal: MEDIUM — `requestWithAutonomy()` as explicit trigger is clean but requires OpenClaw or CLI caller to identify gaps; implicit detection not pursued in Phase 7

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable — no external API dependencies)
