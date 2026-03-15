# Phase 6: Idle Rate Monitoring + Auto-Share — Research

**Researched:** 2026-03-15
**Domain:** Sliding-window rate computation, croner scheduling, SQLite JSON update patterns
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IDLE-01 | Sliding window idle rate detection per skill — `idle_rate = 1 - (calls_in_60min / capacity_per_hour)` | request_log has skill_id + created_at; SQL COUNT with ISO cutoff is the query |
| IDLE-02 | `capacity.calls_per_hour` field on skill schema, owner-declared with default 60 | SkillSchema already has `metadata.capacity.calls_per_hour` with `.default(60)` — no schema change needed |
| IDLE-03 | Auto-share trigger flips `availability.online` when idle_rate crosses configurable threshold (default 70%) | store.ts has updateCard(); new updateSkillAvailability() wraps it; autonomy tier gates the flip |
| IDLE-04 | Per-skill idle rate stored in `_internal` (never transmitted), independently tracked per skill | SkillSchema already has `_internal: z.record(z.unknown()).optional()` — store idle_rate there |
| IDLE-05 | IdleMonitor runs as croner-scheduled background loop (60s interval) in AgentRuntime | AgentRuntime.registerJob(Cron) pattern already established in Phase 4 |
</phase_requirements>

---

## Summary

Phase 6 builds the first active autonomous behavior: IdleMonitor polls `request_log` every 60 seconds, computes idle rate per skill from real data, and flips `availability.online` when the agent is underutilized. Every component this phase needs already exists in the codebase — the work is connecting them with new query and update functions, then wrapping the whole thing in a `Cron` job registered via `AgentRuntime.registerJob()`.

The key insight is that `capacity.calls_per_hour` is already in the `SkillSchema` at `metadata.capacity.calls_per_hour` with a `.default(60)`. No schema change is needed for IDLE-02 — only the `getSkillRequestCount()` query function and `updateSkillAvailability()` store function are missing. The idle rate formula is `1 - (count_in_60min / capacity)`. If the formula yields a value above the threshold (default 0.70), the skill is idle enough to share, and autonomy tier determines whether the flip happens silently (Tier 1), with a log entry (Tier 2), or is blocked (Tier 3).

Per-skill `idle_rate` must be stored in the skill's `_internal` field inside the JSON blob — this field already exists in `SkillSchema` and is documented as "never transmitted." The auto-share flip updates the skill's `availability.online` to `true` inside the card's `skills[]` array in the `capability_cards` JSON blob. One new function in `store.ts` handles this surgical JSON update.

**Primary recommendation:** Build IdleMonitor as a class in `src/autonomy/idle-monitor.ts` that receives `runtime.registryDb`, `config.owner`, and `config.autonomy`, registers itself via `runtime.registerJob(new Cron(...))`, and uses only two new helper functions: `getSkillRequestCount()` in `request-log.ts` and `updateSkillAvailability()` in `store.ts`.

---

## Standard Stack

### Core (all already installed — no new dependencies)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| croner | 10.0.1 | 60s Cron job for IdleMonitor polling loop | Installed (Phase 4) |
| better-sqlite3 | existing | `request_log` query + card JSON update | Installed |
| Vitest | existing | Unit tests for IdleMonitor + helpers | Installed |

**No new production dependencies.** The research summary confirmed croner and typed-emitter are the only new dependencies for all of v2.0. Both are already installed.

### Key Existing Functions That Phase 6 Consumes

| Function | Location | What Phase 6 Uses It For |
|----------|----------|--------------------------|
| `AgentRuntime.registerJob(job)` | `src/runtime/agent-runtime.ts` | Register the croner Cron job for auto-stopping on shutdown |
| `getAutonomyTier(amount, config)` | `src/autonomy/tiers.ts` | Gate whether idle_rate crossing threshold triggers flip (cost=0 for sharing) |
| `insertAuditEvent(db, event)` | `src/autonomy/tiers.ts` | Write `auto_share` / `auto_share_notify` / `auto_share_pending` audit rows |
| `AutonomyEvent` discriminated union | `src/autonomy/tiers.ts` | Type-safe event payload for all three share tier variants |
| `SkillSchema._internal` | `src/types/index.ts` | Already exists: `z.record(z.unknown()).optional()` — write idle_rate here |
| `SkillSchema.metadata.capacity.calls_per_hour` | `src/types/index.ts` | Already exists with `.default(60)` — IDLE-02 is done |
| `updateCard()` | `src/registry/store.ts` | NOT used directly — only works on flat v1 fields; need skill-level function |

### Key Existing Schema Facts (HIGH confidence — verified from source)

- `SkillSchema.metadata.capacity.calls_per_hour` exists with `.default(60)` (IDLE-02 complete)
- `SkillSchema._internal` exists as `z.record(z.unknown()).optional()` (IDLE-04 storage location)
- `SkillSchema.availability` exists as `z.object({ online: z.boolean() }).optional()` — the field to flip
- `request_log` has `skill_id TEXT` (nullable), `created_at TEXT NOT NULL`, and an index on `created_at DESC`
- Cards are stored as JSON blobs in `capability_cards.data` — updates require JSON parse, mutate, re-serialize
- `CapabilityCardV2Schema.availability.online` at the card level controls overall card availability
- The skill-level `availability.online` independently gates per-skill routing in the gateway

---

## Architecture Patterns

### Recommended File Layout for Phase 6

```
src/
├── autonomy/
│   ├── tiers.ts              (existing — Phase 5)
│   └── idle-monitor.ts       (NEW — Phase 6 primary deliverable)
├── registry/
│   ├── store.ts              (MODIFY — add updateSkillAvailability, getCardsByOwner variant)
│   └── request-log.ts        (MODIFY — add getSkillRequestCount)
└── cli/
    └── index.ts              (MODIFY — start IdleMonitor on serve, add idle_threshold to config handling)
```

### Pattern 1: IdleMonitor Class Interface

**What:** A class instantiated once in `agentbnb serve`, registered via `AgentRuntime.registerJob()`, polls every 60s.
**When to use:** All background polling in this codebase follows AgentRuntime.registerJob pattern.

```typescript
// src/autonomy/idle-monitor.ts
import { Cron } from 'croner';
import type Database from 'better-sqlite3';
import { getAutonomyTier, insertAuditEvent } from './tiers.js';
import type { AutonomyConfig } from './tiers.js';
import { getSkillRequestCount } from '../registry/request-log.js';
import { updateSkillAvailability, updateSkillIdleRate } from '../registry/store.js';
import { listCardsByOwner } from '../registry/store.js';

export interface IdleMonitorOptions {
  owner: string;
  db: Database.Database;
  pollIntervalMs?: number;      // default: 60_000
  idleThreshold?: number;       // default: 0.70
  autonomyConfig: AutonomyConfig;
}

export class IdleMonitor {
  private readonly job: Cron;

  constructor(private readonly opts: IdleMonitorOptions) {
    const intervalMs = opts.pollIntervalMs ?? 60_000;
    const intervalSec = Math.max(1, Math.round(intervalMs / 1000));
    // croner cron expression for every N seconds
    this.job = new Cron(`*/${intervalSec} * * * * *`, { paused: true }, () => {
      void this.poll();
    });
  }

  /** Start polling. Call runtime.registerJob(monitor.getJob()) after this. */
  start(): Cron {
    this.job.resume();
    return this.job;
  }

  /** Returns the Cron job instance for registration with AgentRuntime. */
  getJob(): Cron {
    return this.job;
  }

  /** Manual trigger for testing. */
  async poll(): Promise<void> {
    const { owner, db, autonomyConfig } = this.opts;
    const threshold = this.opts.idleThreshold ?? 0.70;
    const windowMs = 60 * 60 * 1000; // 60-minute sliding window

    // Get all v2.0 cards owned by this agent
    const cards = listCardsByOwner(db, owner);

    for (const card of cards) {
      const cardV2 = card as unknown as { skills?: Array<{ id: string; metadata?: { capacity?: { calls_per_hour?: number } }; availability?: { online?: boolean }; _internal?: Record<string, unknown> }> };
      if (!cardV2.skills) continue;

      for (const skill of cardV2.skills) {
        const capacity = skill.metadata?.capacity?.calls_per_hour ?? 60;
        const count = getSkillRequestCount(db, skill.id, windowMs);
        const idleRate = 1 - (count / capacity);

        // Persist idle_rate to _internal (IDLE-04)
        updateSkillIdleRate(db, card.id, skill.id, idleRate);

        // Auto-share flip only when currently offline and idle enough
        const isCurrentlyOnline = skill.availability?.online ?? false;
        if (idleRate >= threshold && !isCurrentlyOnline) {
          // Auto-share costs 0 credits (we are the provider, not the buyer)
          const tier = getAutonomyTier(0, autonomyConfig);

          if (tier === 1) {
            updateSkillAvailability(db, card.id, skill.id, true);
            insertAuditEvent(db, { type: 'auto_share', skill_id: skill.id, tier_invoked: 1, idle_rate: idleRate });
          } else if (tier === 2) {
            updateSkillAvailability(db, card.id, skill.id, true);
            insertAuditEvent(db, { type: 'auto_share_notify', skill_id: skill.id, tier_invoked: 2, idle_rate: idleRate });
          } else {
            // Tier 3: log but do NOT flip availability
            insertAuditEvent(db, { type: 'auto_share_pending', skill_id: skill.id, tier_invoked: 3, idle_rate: idleRate });
          }
        }
      }
    }
  }
}
```

### Pattern 2: getSkillRequestCount() Query

**What:** COUNT query on `request_log` with a time cutoff. The sliding window is computed as `Date.now() - windowMs` converted to ISO 8601.
**Key SQLite fact:** `created_at` is stored as ISO 8601 string. SQLite string comparison works correctly for ISO 8601 (lexicographic order == chronological order) — no UNIXEPOCH conversion needed, but it works either way.

```typescript
// Add to src/registry/request-log.ts
/**
 * Counts successful request_log entries for a specific skill within a sliding window.
 * Used by IdleMonitor to compute idle_rate = 1 - (count / capacity).
 *
 * Excludes autonomy audit rows (action_type IS NOT NULL) — we count real inbound requests only.
 *
 * @param db - Open database instance.
 * @param skillId - The skill ID to count requests for.
 * @param windowMs - Sliding window duration in milliseconds (e.g. 3_600_000 for 60 min).
 * @returns Number of successful requests in the window.
 */
export function getSkillRequestCount(
  db: Database.Database,
  skillId: string,
  windowMs: number
): number {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM request_log
       WHERE skill_id = ?
         AND created_at >= ?
         AND status = 'success'
         AND action_type IS NULL`
    )
    .get(skillId, cutoff) as { cnt: number };
  return row.cnt;
}
```

**Why `action_type IS NULL`:** Autonomy audit events (auto_share, auto_request) are also written to `request_log` with `status = 'success'`. Counting them would inflate the request count, making the agent appear busier than it is, preventing it from self-sharing. This filter is critical for IDLE-01 accuracy.

### Pattern 3: updateSkillAvailability() Store Function

**What:** Mutates a specific skill's `availability.online` inside the JSON blob. Must read the full card, find the skill by ID, mutate, and re-serialize. This triggers the FTS5 UPDATE trigger (cards_au), which is fine — the trigger reads names/descriptions, not availability.

```typescript
// Add to src/registry/store.ts
/**
 * Flips the availability.online flag for a specific skill within a v2.0 card.
 * Reads the full card JSON, mutates the target skill, and writes back.
 * No-ops if card or skill is not found.
 *
 * @param db - Open database instance.
 * @param cardId - UUID of the card.
 * @param skillId - ID of the skill to update.
 * @param online - New online state.
 */
export function updateSkillAvailability(
  db: Database.Database,
  cardId: string,
  skillId: string,
  online: boolean
): void {
  const row = db
    .prepare('SELECT data FROM capability_cards WHERE id = ?')
    .get(cardId) as { data: string } | undefined;
  if (!row) return;

  const card = JSON.parse(row.data) as Record<string, unknown>;
  const skills = card['skills'] as Array<Record<string, unknown>> | undefined;
  if (!skills) return;

  const skill = skills.find((s) => s['id'] === skillId);
  if (!skill) return;

  const availability = (skill['availability'] ?? {}) as Record<string, unknown>;
  availability['online'] = online;
  skill['availability'] = availability;

  const now = new Date().toISOString();
  db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(card),
    now,
    cardId
  );
}

/**
 * Writes idle_rate into skill._internal for internal tracking.
 * _internal is never transmitted in API responses — safe for opaque storage.
 *
 * @param db - Open database instance.
 * @param cardId - UUID of the card.
 * @param skillId - ID of the skill to update.
 * @param idleRate - Computed idle rate (0.0–1.0).
 */
export function updateSkillIdleRate(
  db: Database.Database,
  cardId: string,
  skillId: string,
  idleRate: number
): void {
  const row = db
    .prepare('SELECT data FROM capability_cards WHERE id = ?')
    .get(cardId) as { data: string } | undefined;
  if (!row) return;

  const card = JSON.parse(row.data) as Record<string, unknown>;
  const skills = card['skills'] as Array<Record<string, unknown>> | undefined;
  if (!skills) return;

  const skill = skills.find((s) => s['id'] === skillId);
  if (!skill) return;

  const internal = (skill['_internal'] ?? {}) as Record<string, unknown>;
  internal['idle_rate'] = idleRate;
  internal['idle_rate_computed_at'] = new Date().toISOString();
  skill['_internal'] = internal;

  const now = new Date().toISOString();
  db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(card),
    now,
    cardId
  );
}
```

### Pattern 4: Wiring IdleMonitor into `agentbnb serve`

**What:** After `await runtime.start()`, instantiate IdleMonitor, call `start()`, then `runtime.registerJob(monitor.getJob())`.

```typescript
// In src/cli/index.ts serve action, after runtime.start()
import { IdleMonitor } from '../autonomy/idle-monitor.js';

// Inside serve action, after `await runtime.start()`:
const autonomyConfig = config.autonomy ?? DEFAULT_AUTONOMY_CONFIG;
const idleMonitor = new IdleMonitor({
  owner: config.owner,
  db: runtime.registryDb,
  autonomyConfig,
  // pollIntervalMs: 60_000 (default)
  // idleThreshold: 0.70 (default)
});
const idleJob = idleMonitor.start();
runtime.registerJob(idleJob);
console.log('IdleMonitor started (60s poll interval, 70% idle threshold)');
```

**Why this wiring order matters:** `registerJob()` ensures the croner Cron job is stopped when `runtime.shutdown()` is called, which happens on SIGTERM/SIGINT. If the job isn't registered, it continues polling after the DB is closed, producing `SQLITE_BUSY` or use-after-close errors.

### Pattern 5: croner Cron Expression for Second-Level Intervals

**What:** croner supports second-level cron expressions with 6 fields (not 5). A 60-second interval is `*/60 * * * * *` (every 60 seconds). The default `paused: true` option in the constructor prevents the job from firing until `resume()` is called.

**Verified from croner docs (HIGH confidence):** croner uses 6-field expressions: `second minute hour day month weekday`. `*/60 * * * * *` fires every 60 seconds. Alternatively, `0 * * * * *` fires at second 0 of every minute — also acceptable for the 60s requirement.

```typescript
// 6-field croner expression — fires every 60 seconds
const job = new Cron('*/60 * * * * *', { paused: true }, handler);
// Equivalent: fire at second 0 of every minute
const job = new Cron('0 * * * * *', { paused: true }, handler);
```

**Recommended:** `0 * * * * *` (fires at minute boundaries, slightly more predictable for testing).

### Anti-Patterns to Avoid

- **Using `updateCard()` for skill mutations:** `updateCard()` only handles flat v1.0 `CapabilityCard` and calls `CapabilityCardSchema.safeParse()` (v1.0 Zod), which will reject v2.0 cards. Use direct SQL read/mutate/write instead.
- **Counting all request_log rows for a skill:** Autonomy audit events are also written to `request_log` with `skill_id` set. Not filtering `action_type IS NULL` inflates the count.
- **Computing idle rate as `calls / capacity` (inverted):** The formula is `1 - (calls / capacity)`. A result of 0.0 means fully busy; 1.0 means completely idle. Threshold 0.70 means "at least 70% idle capacity available."
- **Starting the Cron job without `paused: true`:** If the job fires before the DB is ready, it will run against an uninitialized handle. Always start paused, resume after `runtime.start()`.
- **Calling `idleMonitor.poll()` synchronously in the Cron callback:** The croner callback must be `void this.poll()` — never `await this.poll()` inline, as croner callbacks are not async-aware in all edge cases. Use `void` to fire-and-forget the async poll.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idle rate metric data | Separate metrics daemon, Prometheus, custom counters | `request_log` COUNT query with `created_at >= ?` | Table already exists, has skill_id + timestamps |
| Background scheduling | `setInterval` directly | croner `Cron` + `AgentRuntime.registerJob()` | registerJob ensures stop on SIGTERM; raw setInterval leaks |
| Tier enforcement | Inline `if (tier1 > X)` in idle-monitor.ts | `getAutonomyTier(0, config)` from tiers.ts | Single policy, tested in isolation, consistent with all autonomous actions |
| Audit logging | `console.log` or custom log file | `insertAuditEvent(db, event)` from tiers.ts | Co-located with request history, queryable, tier_invoked field already in schema |
| JSON skill update | Zod parse + re-validate with updateCard() | Direct SQL read/mutate/write | updateCard() uses v1.0 Zod schema — rejects v2.0 cards |

---

## Common Pitfalls

### Pitfall 1: Counting Autonomy Audit Rows as Real Requests

**What goes wrong:** `insertAuditEvent()` writes to `request_log` with the skill's `skill_id` and `status = 'success'`. If `getSkillRequestCount()` doesn't filter on `action_type IS NULL`, every auto_share event itself counts as a "real" request — the skill appears busier, idle_rate stays low, and the monitor never self-triggers again.
**Why it happens:** Natural — both real requests and audit events live in the same table.
**How to avoid:** Add `AND action_type IS NULL` to the `getSkillRequestCount()` SQL.
**Warning signs:** idle_rate always reads lower than expected after the first auto_share event; test by inserting an audit event and verifying count returns 0 for it.

### Pitfall 2: Using `updateCard()` for Skill-Level JSON Mutations

**What goes wrong:** `updateCard(db, cardId, owner, { ... })` calls `CapabilityCardSchema.safeParse()`, which is the v1.0 Zod schema. Passing a v2.0 card shape (with `skills[]`) will fail Zod validation and throw `VALIDATION_ERROR`.
**Why it happens:** `store.ts` was written for v1.0; the v1.0 updateCard() is preserved unchanged per Phase 4 decisions.
**How to avoid:** Write new `updateSkillAvailability()` and `updateSkillIdleRate()` functions that do direct SQL read/mutate/write without re-validating via Zod.

### Pitfall 3: idle_rate > 1.0 When capacity Is Under-Estimated

**What goes wrong:** If `capacity.calls_per_hour` is 60 but the agent serves 80 calls in 60 minutes, `idle_rate = 1 - (80/60) = -0.33`. Negative idle_rate never crosses the threshold — correct behavior. But if you invert the formula, you get a value > 1.0, which always exceeds the threshold and triggers permanent auto-share.
**How to avoid:** Formula must be `1 - (count / capacity)`. Clamp the result to `Math.max(0, 1 - count / capacity)` to handle overflow gracefully.

### Pitfall 4: Tier 3 Silently Doing Nothing

**What goes wrong:** When DEFAULT_AUTONOMY_CONFIG is in effect (both thresholds = 0), `getAutonomyTier(0, config)` returns Tier 3 for all amounts including 0. The idle monitor logs `auto_share_pending` but never flips availability. This is correct behavior, but owners may interpret it as a bug ("monitor is running but nothing is being shared").
**Why it happens:** Design intent (OWASP Least-Agency). Tier 3 is the default.
**How to avoid:** Log a clear message during `agentbnb serve` startup: "IdleMonitor running — autonomy tier is Tier 3 (ask-before). Run `agentbnb config set tier1 10` to enable auto-share." Also log when `auto_share_pending` is emitted.

### Pitfall 5: Card-Level vs Skill-Level `availability.online`

**What goes wrong:** `CapabilityCardV2Schema` has `availability.online` at the card level AND `SkillSchema.availability.online` at the skill level. If you flip the card-level flag, all skills on that card become available — not just the idle one. If a multi-skill agent has one idle skill and one busy skill, only the idle skill's flag should flip.
**How to avoid:** `updateSkillAvailability()` must mutate `card.skills[i].availability.online`, not `card.availability.online`. The gateway routing logic already reads per-skill availability in Phase 4 (Plan 03).

### Pitfall 6: Croner Job Firing After DB Close

**What goes wrong:** If `runtime.shutdown()` is called but the Cron job is not registered via `registerJob()`, the job fires on its next tick after the DB handles are closed. `better-sqlite3` throws `SQLITE_MISUSE` or similar on closed-handle access.
**How to avoid:** Always `runtime.registerJob(monitor.getJob())` immediately after `monitor.start()`. The `shutdown()` method iterates `this.jobs` and calls `.stop()` on each.

---

## Code Examples

### Verified: croner 6-field Second-Level Cron Syntax

```typescript
// Source: croner README / npm page — 6-field expressions include seconds as first field
// Fires every 60 seconds (at second 0 of every minute)
const job = new Cron('0 * * * * *', { paused: true }, async () => {
  await monitor.poll();
});
// Resume after DB is ready
job.resume();
runtime.registerJob(job);
```

### Verified: SQLite ISO 8601 String Comparison for Sliding Window

```typescript
// ISO 8601 strings compare correctly as strings (lexicographic == chronological)
// No need for strftime() or UNIXEPOCH() — plain >= comparison works
const cutoff = new Date(Date.now() - windowMs).toISOString();
// e.g. "2026-03-15T11:00:00.000Z"
db.prepare('SELECT COUNT(*) as cnt FROM request_log WHERE skill_id = ? AND created_at >= ?')
  .get(skillId, cutoff);
```

### Verified: `_internal` Field Already Exists in SkillSchema

```typescript
// From src/types/index.ts line 107 (verified from source):
_internal: z.record(z.unknown()).optional(),

// Writing to _internal without breaking Zod validation:
// (updateSkillIdleRate bypasses Zod — writes raw JSON, so no validation issue)
skill['_internal'] = { idle_rate: 0.82, idle_rate_computed_at: '2026-03-15T11:00:00.000Z' };
```

### Verified: `capacity.calls_per_hour` Already in SkillSchema

```typescript
// From src/types/index.ts lines 99-101 (verified from source):
metadata: z.object({
  // ...
  capacity: z.object({
    calls_per_hour: z.number().positive().default(60),
  }).optional(),
}).optional(),

// Reading capacity in IdleMonitor:
const capacity = skill.metadata?.capacity?.calls_per_hour ?? 60;
// The ?? 60 is defensive — Zod .default(60) only runs during parse, not runtime access
```

### Verified: listCards() for Owner-Scoped Iteration

```typescript
// From src/registry/store.ts line 501 (verified from source):
export function listCards(db: Database.Database, owner?: string): CapabilityCard[]

// Usage in IdleMonitor — filter by owner to only monitor own cards:
const cards = listCards(db, owner);
// Returns all cards (v1 and v2 JSON blobs). Cast to unknown to access skills[]:
const cardData = card as unknown as Record<string, unknown>;
if (cardData['spec_version'] !== '2.0') continue;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| v1.0 flat CapabilityCard (one card = one skill) | v2.0 `skills[]` array (one card = N skills) | Phase 4 Plan 02 | Idle rate must be tracked per skill, not per card |
| No autonomy gate | `getAutonomyTier()` gates all autonomous actions | Phase 5 Plan 01 | Auto-share must call `getAutonomyTier(0, config)` before flipping |
| No audit trail | `insertAuditEvent()` writes to `request_log` | Phase 5 Plan 01 | Phase 6 uses `auto_share` / `auto_share_notify` / `auto_share_pending` variants |
| No background jobs | `AgentRuntime.registerJob(Cron)` pattern | Phase 4 Plan 01 | IdleMonitor must register its Cron job for clean shutdown |
| `request_log` without `skill_id` | `request_log.skill_id` column added | Phase 4 Plan 02 | Enables per-skill COUNT query in sliding window |

---

## Open Questions

1. **Should idle-to-busy transition also flip `availability.online` back to false?**
   - What we know: The requirements only define the idle->share flip (IDLE-03). Nothing specifies auto-unsharing when the agent becomes busy again.
   - What's unclear: If the monitor flips a skill online when idle, should it flip it offline when the agent gets busier (idle_rate drops below threshold)?
   - Recommendation: Implement the reverse flip (busy detection) but make it optional in Phase 6. If `availability.online` is true AND `idle_rate < threshold`, flip back to false. This completes the logical loop. If out of scope, document it as a Phase 6.1 concern.

2. **Configurable `idle_threshold` and `poll_interval_ms` storage**
   - What we know: Requirements specify default 70% threshold and 60s interval. `AgentBnBConfig` in `config.ts` doesn't yet have `idle_threshold` or `poll_interval_ms` fields.
   - What's unclear: Should these be configurable via `agentbnb config set` (like tier1/tier2/reserve) or hardcoded defaults?
   - Recommendation: Hardcode defaults (0.70 / 60_000ms) for Phase 6. If configurable threshold is needed, add `idle_threshold` to `AgentBnBConfig` and a `config set idle-threshold <N>` command — but don't block the phase on this. The success criteria only mentions default 70%.

3. **listCards() return type vs v2.0 shape**
   - What we know: `listCards()` returns `CapabilityCard[]` typed as v1.0. Accessing `skills[]` requires a cast via `unknown`.
   - What's unclear: Should we add a typed `listV2Cards()` function or use the existing cast pattern established in Phase 4 Plan 03?
   - Recommendation: Follow the Phase 4 Plan 03 decision: `cast via unknown narrowing`. Do not change `listCards()` return type — add a check for `spec_version === '2.0'` before accessing `skills[]`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (project standard, src/**/*.test.ts) |
| Config file | None — inferred from package.json scripts |
| Quick run command | `pnpm test --reporter=verbose 2>&1 \| head -60` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IDLE-01 | `getSkillRequestCount()` returns correct count for skill_id in sliding window | unit | `pnpm test src/registry/request-log.test.ts` | Wave 0 — add tests to existing file |
| IDLE-01 | Autonomy audit rows excluded from count | unit | `pnpm test src/registry/request-log.test.ts` | Wave 0 |
| IDLE-01 | idle_rate formula `1 - (count/capacity)` computed correctly | unit | `pnpm test src/autonomy/idle-monitor.test.ts` | Wave 0 |
| IDLE-02 | `capacity.calls_per_hour` default 60 resolved when field absent | unit | `pnpm test src/autonomy/idle-monitor.test.ts` | Wave 0 |
| IDLE-03 | Tier 1: `updateSkillAvailability()` called when idle_rate >= threshold | unit | `pnpm test src/autonomy/idle-monitor.test.ts` | Wave 0 |
| IDLE-03 | Tier 2: availability flipped AND audit event written | unit | `pnpm test src/autonomy/idle-monitor.test.ts` | Wave 0 |
| IDLE-03 | Tier 3: availability NOT flipped, pending audit event written | unit | `pnpm test src/autonomy/idle-monitor.test.ts` | Wave 0 |
| IDLE-04 | `_internal.idle_rate` written per skill, not transmitted in API response | unit | `pnpm test src/registry/store.test.ts` | Wave 0 — add to existing |
| IDLE-05 | IdleMonitor registers Cron job via `AgentRuntime.registerJob()` | unit | `pnpm test src/autonomy/idle-monitor.test.ts` | Wave 0 |
| IDLE-05 | Cron job stops cleanly on `runtime.shutdown()` | unit | `pnpm test src/autonomy/idle-monitor.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test src/autonomy/idle-monitor.test.ts src/registry/request-log.test.ts`
- **Per wave merge:** `pnpm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/autonomy/idle-monitor.test.ts` — NEW file, covers IDLE-01 through IDLE-05
- [ ] `src/registry/request-log.test.ts` — EXISTS; add `getSkillRequestCount` tests (audit exclusion, window boundary)
- [ ] `src/registry/store.test.ts` — EXISTS; add `updateSkillAvailability` and `updateSkillIdleRate` tests

---

## Sources

### Primary (HIGH confidence)

- `src/types/index.ts` (lines 76-108) — SkillSchema with `_internal`, `metadata.capacity.calls_per_hour`, `availability` fields verified from source
- `src/runtime/agent-runtime.ts` — `registerJob(Cron)` pattern, `jobs[]` array, shutdown loop verified from source
- `src/autonomy/tiers.ts` — `getAutonomyTier()`, `insertAuditEvent()`, `AutonomyEvent` discriminated union verified from source
- `src/registry/request-log.ts` — `RequestLogEntry` interface, `skill_id` column, `action_type` column, index on `created_at DESC` verified from source
- `src/registry/store.ts` — `listCards(db, owner?)` signature, `updateCard()` uses v1.0 Zod, V2_FTS_TRIGGERS verified from source
- `src/cli/index.ts` (lines 586-644) — serve command AgentRuntime instantiation pattern verified from source
- `.planning/REQUIREMENTS.md` — IDLE-01 through IDLE-05 requirements text
- `.planning/research/ARCHITECTURE.md` — IdleMonitor interface design, module placement, auto-publish path
- Phase 04-02 SUMMARY.md — FTS5 contentless trigger confirmed, `request_log.skill_id` column confirmed
- Phase 05-01 SUMMARY.md — `insertAuditEvent()` confirmed, `auto_share` event types confirmed
- Phase 05-02 SUMMARY.md — `BudgetManager` confirmed (not used by Phase 6, but available for reference)

### Secondary (MEDIUM confidence)

- croner README — 6-field second-level cron expression syntax (`*/60 * * * * *`, `paused: true`, `.resume()`)
- SQLite ISO 8601 string comparison — standard SQLite behavior, lexicographic = chronological for ISO 8601

### Tertiary (LOW confidence)

- None — all key claims verified from actual source code.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already installed, verified from package.json via Phase 4 SUMMARY
- Architecture: HIGH — all integration points verified from actual source code; no new patterns introduced
- Pitfalls: HIGH — derived from code analysis: `updateCard()` v1.0 Zod limitation confirmed from store.ts; audit row counting trap derived from request-log.ts schema; croner job registration pattern derived from agent-runtime.ts

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable stack; no external APIs; croner/SQLite are stable libraries)
