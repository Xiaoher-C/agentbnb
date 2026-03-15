# Phase 4: Agent Runtime + Multi-Skill Foundation - Research

**Researched:** 2026-03-15
**Domain:** AgentRuntime scaffold, multi-skill CapabilityCard schema v2.0, SQLite migration, FTS5 trigger update, gateway skill routing
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RUN-01 | AgentRuntime class owns all DB handles, background timers, and SIGTERM shutdown with orphaned escrow recovery | AgentRuntime class pattern, SIGTERM handler, startup escrow scan |
| RUN-02 | Multi-skill CapabilityCard schema v2.0 with `skills[]` array — one card per agent, multiple independently-priced skills | New `Skill` Zod schema, extend `CapabilityCardSchema` to `spec_version: '2.0'` |
| RUN-03 | SQLite v1→v2 card migration preserving existing cards, with FTS5 trigger update to index nested skill names/descriptions | `PRAGMA user_version`, `json_each` FTS trigger syntax, migration script pattern |
| RUN-04 | Gateway routing accepts `skill_id` for per-skill execution on multi-skill cards | Gateway `POST /rpc` param change, `HandlerMap` key becomes `skill_id` |
</phase_requirements>

---

## Summary

Phase 4 is the architectural foundation for the entire v2.0 Agent Autonomy milestone. Every subsequent phase (5 through 8) depends on two deliverables built here: (1) the `AgentRuntime` class that centralizes DB handle ownership and shutdown coordination, and (2) the multi-skill `CapabilityCard` v2.0 schema with the SQLite migration that safely transitions existing v1.x cards. Nothing autonomous can safely run until these exist.

The existing v1.1 codebase is a clean synchronous request-response system: every module opens its own database handle (or receives one at construction time), and there is no centralized ownership of background lifecycle. The `AgentRuntime` class closes this gap by holding both database instances (`registryDb` and `creditDb`), owning all `croner` timer references, exposing a single `start()` / `shutdown()` pair, and scanning for orphaned escrows at startup before any background loop begins. The `agentbnb serve` CLI command becomes a thin wrapper that calls `runtime.start()` and registers `SIGTERM` / `SIGINT` to call `runtime.shutdown()`.

The multi-skill schema change requires careful migration discipline. The existing `CapabilityCard` Zod schema (spec_version 1.0) places all skill fields at the top level (`name`, `description`, `level`, `inputs`, `outputs`, `pricing`). The v2.0 schema wraps these into a `skills[]` array and introduces `agent_name` at the card level. Every SQLite row stores the card as a JSON blob in the `data` column — existing rows will not automatically conform to the new schema. The migration must run inside a single SQLite transaction guarded by `PRAGMA user_version`, and the three FTS5 triggers (`cards_ai`, `cards_au`, `cards_ad`) must be replaced in the same transaction so search results do not go silent.

**Primary recommendation:** Build `AgentRuntime` first (it has zero downstream dependencies), then schema + migration + FTS trigger update as a single atomic commit, then gateway `skill_id` routing. These are the three plans for this phase, in that order.

---

## Standard Stack

### Core (Existing — Do Not Re-Add)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^11.6.0 | All SQLite access | Synchronous API, WAL mode, transactions |
| Zod | ^3.24.0 | Schema validation | Already used for CapabilityCardSchema |
| Fastify | ^5.1.0 | HTTP gateway | Already used in gateway/server.ts |
| TypeScript | ^5.7.0 strict | Language | Project standard |
| Vitest | ^2.1.0 | Testing | Project standard |

### New Additions (Phase 4 Only)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| croner | ^10.0.1 | Background task scheduling in AgentRuntime | ESM-native, pause/resume, zero dependencies — needed for graceful shutdown coordination. Chosen over `node-cron` (no pause/resume) and plain `setInterval` (no cron syntax, drift). |
| typed-emitter | ^2.1.0 | Type-safe event bus for runtime events | Zero runtime bytes — pure TypeScript types over Node.js EventEmitter. Needed because AgentRuntime will emit lifecycle events (startup, shutdown, escrow-recovered) consumed by future phases. |

### Installation

```bash
pnpm add croner typed-emitter
```

No new dev dependencies.

---

## Architecture Patterns

### Recommended Project Structure (New for Phase 4)

```
src/
├── runtime/                  NEW
│   └── agent-runtime.ts      AgentRuntime class — DB ownership, lifecycle, SIGTERM
├── types/
│   └── index.ts              MODIFY: add Skill schema, update CapabilityCard to v2.0
├── registry/
│   ├── store.ts              MODIFY: migration function, FTS trigger replacement
│   └── request-log.ts        MODIFY: add skill_id column for future idle monitoring
├── gateway/
│   └── server.ts             MODIFY: accept skill_id param, route to skill handler
└── skills/
    └── handle-request.ts     MODIFY: HandlerMap key = skill_id (not card_id)
```

### Pattern 1: AgentRuntime — Centralized Lifecycle Owner

**What:** A class that holds both database handles, owns all timer references (via croner), handles OS signals, and recovers orphaned escrows on startup.

**When to use:** Always — `agentbnb serve` must ONLY start the runtime via this class, never open databases or start timers ad hoc.

**Implementation:**

```typescript
// src/runtime/agent-runtime.ts
import Database from 'better-sqlite3';
import { Cron } from 'croner';
import { releaseEscrow } from '../credit/escrow.js';

export interface RuntimeOptions {
  registryDbPath: string;
  creditDbPath: string;
  owner: string;
  /** Orphaned escrow age threshold in minutes. Default: 10. */
  orphanedEscrowAgeMinutes?: number;
}

export class AgentRuntime {
  public readonly registryDb: Database.Database;
  public readonly creditDb: Database.Database;
  private readonly owner: string;
  private readonly orphanedEscrowAgeMinutes: number;
  private jobs: Cron[] = [];
  private draining = false;

  constructor(opts: RuntimeOptions) {
    this.owner = opts.owner;
    this.orphanedEscrowAgeMinutes = opts.orphanedEscrowAgeMinutes ?? 10;

    this.registryDb = new Database(opts.registryDbPath);
    this.registryDb.pragma('journal_mode = WAL');
    this.registryDb.pragma('foreign_keys = ON');
    this.registryDb.pragma('busy_timeout = 5000');

    this.creditDb = new Database(opts.creditDbPath);
    this.creditDb.pragma('journal_mode = WAL');
    this.creditDb.pragma('foreign_keys = ON');
    this.creditDb.pragma('busy_timeout = 5000');
  }

  /** Register a croner job managed by this runtime. */
  registerJob(job: Cron): void {
    this.jobs.push(job);
  }

  /** Start runtime: recover orphaned escrows, then allow background jobs. */
  async start(): Promise<void> {
    this.recoverOrphanedEscrows();
  }

  /** Graceful shutdown: stop new jobs, await in-flight, close DBs. */
  async shutdown(): Promise<void> {
    this.draining = true;
    for (const job of this.jobs) {
      job.stop();
    }
    // Future phases: await in-flight requests here
    this.registryDb.close();
    this.creditDb.close();
  }

  /** Scan credit_escrow for rows held beyond threshold; release them. */
  private recoverOrphanedEscrows(): void {
    const cutoff = new Date(
      Date.now() - this.orphanedEscrowAgeMinutes * 60_000
    ).toISOString();

    const orphaned = this.creditDb
      .prepare(
        `SELECT id FROM credit_escrow
         WHERE status = 'held' AND created_at < ?`
      )
      .all(cutoff) as Array<{ id: string }>;

    for (const row of orphaned) {
      try {
        releaseEscrow(this.creditDb, row.id);
        // Future: log warning
      } catch {
        // Silent: escrow may have settled between query and release
      }
    }
  }
}
```

**CLI integration (agentbnb serve):**

```typescript
// In src/cli/index.ts — serve command
const runtime = new AgentRuntime({
  registryDbPath: config.db_path,
  creditDbPath: config.credit_db_path,
  owner: config.owner,
});

await runtime.start();

const shutdown = async () => {
  await runtime.shutdown();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

### Pattern 2: Multi-Skill Card Schema v2.0

**What:** A `Skill` Zod schema for the per-skill unit, and an updated `CapabilityCard` schema with `spec_version: '2.0'` and `skills[]` array.

**When to use:** All new cards created after Phase 4. Old cards are migrated to this shape.

**Schema extension:**

```typescript
// src/types/index.ts — additions

export const SkillSchema = z.object({
  id: z.string().min(1),                      // e.g. 'tts-elevenlabs'
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  category: z.string().optional(),            // 'tts' | 'video_gen' | 'code_review'
  inputs: z.array(IOSchemaSchema),
  outputs: z.array(IOSchemaSchema),
  pricing: z.object({
    credits_per_call: z.number().nonnegative(),
    credits_per_minute: z.number().nonnegative().optional(),
    free_tier: z.number().nonnegative().optional(),
  }),
  availability: z.object({
    online: z.boolean(),
  }).optional(),                              // per-skill online flag
  powered_by: z.array(PoweredBySchema).optional(),
  metadata: z.object({
    apis_used: z.array(z.string()).optional(),
    avg_latency_ms: z.number().nonnegative().optional(),
    success_rate: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(),
    capacity: z.object({
      calls_per_hour: z.number().positive().default(60),
    }).optional(),
  }).optional(),
  _internal: z.record(z.unknown()).optional(),  // never transmitted
});

export const CapabilityCardV2Schema = z.object({
  spec_version: z.literal('2.0'),
  id: z.string().uuid(),
  owner: z.string().min(1),
  agent_name: z.string().min(1).max(100),     // was 'name' in v1.0
  skills: z.array(SkillSchema).min(1),
  availability: z.object({
    online: z.boolean(),
    schedule: z.string().optional(),
  }),
  environment: z.object({
    runtime: z.string(),
    region: z.string().optional(),
  }).optional(),
  _internal: z.record(z.unknown()).optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type Skill = z.infer<typeof SkillSchema>;
export type CapabilityCardV2 = z.infer<typeof CapabilityCardV2Schema>;
```

**Backward compatibility:** Keep `CapabilityCardSchema` (v1.0) exported. Add a discriminated union:

```typescript
export const AnyCardSchema = z.discriminatedUnion('spec_version', [
  CapabilityCardSchema,    // spec_version: '1.0'
  CapabilityCardV2Schema,  // spec_version: '2.0'
]);
export type AnyCard = z.infer<typeof AnyCardSchema>;
```

### Pattern 3: SQLite v1→v2 Migration with PRAGMA user_version Guard

**What:** A single migration function that reads all v1.0 cards from SQLite, wraps each in a `skills[]` array, writes them back as v2.0, drops and recreates FTS5 triggers for nested skill indexing, and sets `PRAGMA user_version = 2` to prevent double-run.

**When to use:** Called once from `openDatabase()` when `PRAGMA user_version < 2`.

**Critical: FTS5 trigger syntax for json_each over skills[]**

The current triggers use:
```sql
json_extract(new.data, '$.name')        -- returns NULL after v2.0 migration
json_extract(new.data, '$.description') -- returns NULL after v2.0 migration
```

The updated triggers must aggregate across `skills[]`:
```sql
-- name field: concatenate all skill names
(SELECT group_concat(json_extract(value, '$.name'), ' ')
 FROM json_each(json_extract(new.data, '$.skills')))

-- description field: concatenate all skill descriptions
(SELECT group_concat(json_extract(value, '$.description'), ' ')
 FROM json_each(json_extract(new.data, '$.skills')))

-- tags field: concatenate tags from all skill metadata objects
(SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
 FROM json_each(json_extract(new.data, '$.skills')))
```

**STATE.md blocker confirmed:** "FTS5 trigger syntax for json_each() over skills[] arrays needs verification before implementation." The syntax above uses SQLite's `json_each()` table-valued function which is supported in SQLite 3.38+ (Node.js ships SQLite 3.39+ in recent versions). Verify with `SELECT sqlite_version()` — needs 3.38.0 minimum.

**Migration function structure:**

```typescript
// src/registry/store.ts — addition

export function runMigrations(db: Database.Database): void {
  const version = (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version ?? 0;

  if (version < 2) {
    migrateV1toV2(db);
  }
}

function migrateV1toV2(db: Database.Database): void {
  // Run in single transaction: card data migration + trigger replacement
  const migrate = db.transaction(() => {
    // 1. Read all existing v1.0 cards
    const rows = db.prepare('SELECT id, data FROM capability_cards').all() as Array<{
      id: string;
      data: string;
    }>;

    // 2. Convert each card to v2.0 shape
    for (const row of rows) {
      const v1 = JSON.parse(row.data) as CapabilityCard;
      const v2: CapabilityCardV2 = {
        spec_version: '2.0',
        id: v1.id,
        owner: v1.owner,
        agent_name: v1.name,
        skills: [{
          id: `skill-${v1.id}`,
          name: v1.name,
          description: v1.description,
          level: v1.level,
          inputs: v1.inputs,
          outputs: v1.outputs,
          pricing: v1.pricing,
          availability: { online: v1.availability.online },
          powered_by: v1.powered_by,
          metadata: v1.metadata,
          _internal: v1._internal,
        }],
        availability: v1.availability,
        created_at: v1.created_at,
        updated_at: new Date().toISOString(),
      };
      db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(v2), v2.updated_at!, v2.id);
    }

    // 3. Drop and recreate FTS triggers with json_each syntax
    db.exec(`
      DROP TRIGGER IF EXISTS cards_ai;
      DROP TRIGGER IF EXISTS cards_au;
      DROP TRIGGER IF EXISTS cards_ad;

      CREATE TRIGGER cards_ai AFTER INSERT ON capability_cards BEGIN
        INSERT INTO cards_fts(rowid, id, owner, name, description, tags)
        VALUES (
          new.rowid,
          new.id,
          new.owner,
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.name'), ' ')
             FROM json_each(json_extract(new.data, '$.skills'))),
            json_extract(new.data, '$.name'),
            ''
          ),
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.description'), ' ')
             FROM json_each(json_extract(new.data, '$.skills'))),
            json_extract(new.data, '$.description'),
            ''
          ),
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
             FROM json_each(json_extract(new.data, '$.skills'))),
            (SELECT group_concat(value, ' ')
             FROM json_each(json_extract(new.data, '$.metadata.tags'))),
            ''
          )
        );
      END;

      CREATE TRIGGER cards_au AFTER UPDATE ON capability_cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, id, owner, name, description, tags)
        VALUES (
          'delete', old.rowid, old.id, old.owner,
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.name'), ' ')
             FROM json_each(json_extract(old.data, '$.skills'))),
            json_extract(old.data, '$.name'), ''
          ),
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.description'), ' ')
             FROM json_each(json_extract(old.data, '$.skills'))),
            json_extract(old.data, '$.description'), ''
          ),
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
             FROM json_each(json_extract(old.data, '$.skills'))),
            (SELECT group_concat(value, ' ')
             FROM json_each(json_extract(old.data, '$.metadata.tags'))),
            ''
          )
        );
        INSERT INTO cards_fts(rowid, id, owner, name, description, tags)
        VALUES (
          new.rowid, new.id, new.owner,
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.name'), ' ')
             FROM json_each(json_extract(new.data, '$.skills'))),
            json_extract(new.data, '$.name'), ''
          ),
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.description'), ' ')
             FROM json_each(json_extract(new.data, '$.skills'))),
            json_extract(new.data, '$.description'), ''
          ),
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
             FROM json_each(json_extract(new.data, '$.skills'))),
            (SELECT group_concat(value, ' ')
             FROM json_each(json_extract(new.data, '$.metadata.tags'))),
            ''
          )
        );
      END;

      CREATE TRIGGER cards_ad AFTER DELETE ON capability_cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, id, owner, name, description, tags)
        VALUES (
          'delete', old.rowid, old.id, old.owner,
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.name'), ' ')
             FROM json_each(json_extract(old.data, '$.skills'))),
            json_extract(old.data, '$.name'), ''
          ),
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.description'), ' ')
             FROM json_each(json_extract(old.data, '$.skills'))),
            json_extract(old.data, '$.description'), ''
          ),
          COALESCE(
            (SELECT group_concat(json_extract(value, '$.metadata.tags'), ' ')
             FROM json_each(json_extract(old.data, '$.skills'))),
            (SELECT group_concat(value, ' ')
             FROM json_each(json_extract(old.data, '$.metadata.tags'))),
            ''
          )
        );
      END;
    `);

    // 4. Rebuild FTS index from scratch after trigger change
    db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`);

    // 5. Mark migration complete
    db.pragma('user_version = 2');
  });

  migrate();
}
```

**Why `COALESCE` with fallback to v1 path:** The FTS triggers must work for both v2.0 cards (have `$.skills` array) and any v1.0 cards inserted before migration runs. The `COALESCE` falls through to `json_extract(new.data, '$.name')` when `$.skills` is absent, maintaining backward compatibility.

### Pattern 4: Gateway skill_id Routing

**What:** The gateway's `POST /rpc` endpoint currently takes `{ card_id, params }`. After Phase 4, it must also accept `{ card_id, skill_id, params }`. When `skill_id` is present, the gateway looks up `card.skills.find(s => s.id === skill_id)` for pricing and routing. The `HandlerMap` key in `handle-request.ts` changes from `card_id` to `skill_id`.

**Current gateway flow:**
```
POST /rpc { card_id, params }
  → getCard(card_id) → card.pricing.credits_per_call
  → holdEscrow
  → POST handlerUrl { card_id, params }
```

**New gateway flow (after Phase 4):**
```
POST /rpc { card_id, skill_id?, params }
  → getCard(card_id)
  → if skill_id: find skill in card.skills, else use card (v1.0 backward compat)
  → pricing = skill?.pricing ?? card.pricing
  → holdEscrow with skill-level price
  → POST handlerUrl { card_id, skill_id, params }
```

**Handler map key change:**
```typescript
// Before:
type HandlerMap = { [cardId: string]: (params: unknown) => Promise<unknown> }

// After (Phase 4):
type HandlerMap = { [skillId: string]: (params: unknown) => Promise<unknown> }
// Also accept card_id as fallback for v1.0 compatibility
```

### Anti-Patterns to Avoid

- **Opening a second Database connection inside a module:** Any module that calls `new Database(path)` independently of `AgentRuntime` will produce `SQLITE_BUSY` under concurrent background writes. All code must receive the `AgentRuntime`'s db handles via constructor injection.
- **Starting timers before `AgentRuntime.start()`:** Background loops started in `bin/agentbnb.js` or CLI setup code cannot be cleanly shut down. Only code called after `runtime.start()` should start timers, and only via `runtime.registerJob()`.
- **Updating FTS triggers in a separate transaction from card data:** If the trigger is updated but the `user_version` is not incremented in the same transaction, a restart will re-run the migration, corrupting cards. The migration, trigger drop/recreate, FTS rebuild, and user_version set MUST be one transaction.
- **Using `INSERT` instead of `UPSERT` for card updates:** The existing `insertCard()` function uses `INSERT`. After migration, updating a card that now has v2.0 shape must use `INSERT OR REPLACE` or `UPDATE` — never insert a duplicate card_id.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Background scheduler with pause/resume | Custom setInterval manager with interval tracking | croner `Cron` class | croner handles drift, pause/resume for graceful shutdown, ESM-native |
| Type-safe event bus | String-keyed EventEmitter with manual type casts | typed-emitter | Zero bytes runtime; catches event name typos and payload mismatches at compile time |
| SQLite migration versioning | Custom migration table | `PRAGMA user_version` | Built into SQLite; atomic with transactions; no extra table needed |
| FTS index rebuild | Manual DELETE + INSERT of all FTS rows | `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')` | FTS5 built-in rebuild command; handles content table sync correctly |

**Key insight:** All tools needed for Phase 4 are already in the project stack or SQLite built-ins. No new infrastructure.

---

## Common Pitfalls

### Pitfall 1: FTS Triggers Updated After Card Data Migration (Not Atomically)

**What goes wrong:** Cards are migrated to v2.0 in one transaction. Triggers are updated in a second transaction. Between the two transactions, an INSERT or UPDATE fires the old trigger, which does `json_extract(data, '$.name')` — returns NULL for a v2.0 card. The FTS row is written with NULL name. FTS search returns no results for that card forever (even after triggers are fixed), because the FTS row is already corrupted.

**Why it happens:** Developers test migration in isolation before updating triggers.

**How to avoid:** Card data migration + trigger DROP/recreate + FTS rebuild + `user_version` increment must be a single `db.transaction()` call. Never split them.

**Warning signs:** `searchCards('tts')` returns 0 results after migration even though a TTS skill exists.

### Pitfall 2: Migration Runs Twice — PRAGMA user_version Not Set Atomically

**What goes wrong:** Migration runs on startup. If the process crashes after card data is updated but before `PRAGMA user_version = 2` is set (even with a transaction, `PRAGMA` calls are not always transactional in SQLite), the migration re-runs on next boot. Cards are double-wrapped: `skills: [{ skills: [originalCard] }]`.

**How to avoid:** In better-sqlite3, `db.pragma()` calls WITHIN a transaction are in fact transactional. Set `user_version = 2` as the last step inside the `db.transaction()` callback. Verify with a test that injects a crash between steps.

**Alternative approach:** Use `db.exec('PRAGMA user_version = 2')` as the very last line of the transaction callback — this is executed atomically in better-sqlite3 since the callback is synchronous.

### Pitfall 3: AgentRuntime Shutdown Closes DB Before In-Flight Requests Complete

**What goes wrong:** `runtime.shutdown()` closes `registryDb` and `creditDb`. A concurrent HTTP request (served by Fastify) is in the middle of `holdEscrow()` — it accesses a closed database and throws `SQLITE_MISUSE`.

**Why it happens:** SIGTERM arrives while a gateway request is being handled.

**How to avoid:** Phase 4 must set `draining = true` before closing DBs. The gateway server's `POST /rpc` handler checks `draining` at the start and returns a 503 if true. In Phase 4, `agentbnb serve` has no concurrent background writes yet, so this is low risk. But the `draining` flag must be in place so Phase 5+ background loops can honor it.

**Warning signs:** `SQLITE_MISUSE: database connection is closed` in test logs.

### Pitfall 4: skill_id Required on All Requests After Phase 4 (Breaks v1.0 Clients)

**What goes wrong:** The new gateway requires `skill_id` for all requests. Existing v1.0 clients (which only send `card_id`) start getting errors.

**How to avoid:** `skill_id` must be OPTIONAL in the Phase 4 gateway. When absent, the gateway falls back to v1.0 behavior: use the first skill in `skills[]` (after migration, v1.0 cards have exactly one skill). The `HandlerMap` should accept both `card_id` and `skill_id` as keys during the transition.

### Pitfall 5: Orphaned Escrow Recovery Releases a Legitimately Held Escrow

**What goes wrong:** The startup scan releases escrows older than 10 minutes. A slow capability execution (e.g., video generation) legitimately takes 15 minutes. On restart, that escrow is released even though the peer is still executing.

**How to avoid:** 10-minute threshold is correct for the current use cases (all v1.1 capabilities complete within seconds). Document the threshold. For Phase 4, the default 10-minute cutoff is safe. If long-running capabilities are added in future, the threshold becomes configurable.

---

## Code Examples

Verified against actual source code in `src/`:

### Current FTS Trigger (src/registry/store.ts — BEFORE Migration)

```typescript
// Actual trigger in store.ts lines 41-55
CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON capability_cards BEGIN
  INSERT INTO cards_fts(rowid, id, owner, name, description, tags)
  VALUES (
    new.rowid,
    new.id,
    new.owner,
    json_extract(new.data, '$.name'),           -- TARGET: must change to skills[] path
    json_extract(new.data, '$.description'),    -- TARGET: must change to skills[] path
    COALESCE(
      (SELECT group_concat(value, ' ')
       FROM json_each(json_extract(new.data, '$.metadata.tags'))),
      ''
    )
  );
END;
```

### Current Gateway Routing (src/gateway/server.ts — BEFORE Phase 4)

```typescript
// Lines 109-117 of src/gateway/server.ts
const params = (body.params ?? {}) as Record<string, unknown>;
const cardId = params.card_id as string | undefined;

if (!cardId) { /* 400 */ }

const card = getCard(registryDb, cardId);  // card is v1.0 flat
const creditsNeeded = card.pricing.credits_per_call;  // TARGET: must become skill-level lookup
```

### Current HandlerMap key (src/skills/handle-request.ts — BEFORE Phase 4)

```typescript
// Lines 41-50 of handle-request.ts
const cardId = body.card_id as string | undefined;  // TARGET: add skill_id support
const handler = handlers[cardId];                   // TARGET: handlers[skillId] after Phase 4
```

### Current request_log Schema (src/registry/request-log.ts — Missing skill_id)

```sql
-- Current schema (createRequestLogTable lines 45-59)
CREATE TABLE IF NOT EXISTS request_log (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  requester TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'timeout')),
  latency_ms INTEGER NOT NULL,
  credits_charged INTEGER NOT NULL,
  created_at TEXT NOT NULL
  -- MISSING: skill_id TEXT -- needed for Phase 6 idle rate per-skill tracking
);
```

Phase 4 should add `skill_id TEXT` to `request_log` so Phase 6's `getSkillRequestCount()` has the data. Do this in a schema migration (ALTER TABLE or in the same migration function, guarded by `PRAGMA user_version`).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One card per skill (spec_version 1.0) | One card per agent with skills[] (spec_version 2.0) | Phase 4 migration | All registry queries, FTS triggers, gateway routing must be updated |
| Flat `name`/`description` at card level | `agent_name` at card level; `name`/`description` per skill | Phase 4 schema change | FTS must index skill-level fields, not card-level fields |
| `HandlerMap[card_id]` dispatch | `HandlerMap[skill_id]` dispatch | Phase 4 gateway change | Handler registration changes for all capability implementations |
| No centralized lifecycle | `AgentRuntime` owns all DB handles and timer refs | Phase 4 new class | All future phases plug into AgentRuntime, not ad-hoc |

**Deprecated/outdated after Phase 4:**
- `CapabilityCardSchema` (spec_version '1.0'): kept for backward compat in `AnyCardSchema` union, but no new cards should be created in v1.0 format
- `card.name` / `card.description` at top level: replaced by `card.agent_name` and `card.skills[].name`
- `card.pricing.credits_per_call` at top level: replaced by `card.skills[].pricing.credits_per_call`

---

## Open Questions

1. **SQLite version on target machines**
   - What we know: `json_each()` table-valued function requires SQLite >= 3.38.0; Node.js 20+ ships SQLite 3.43.2
   - What's unclear: Are any OpenClaw agents running on older Node.js versions with older bundled SQLite?
   - Recommendation: Add a startup check `SELECT sqlite_version()` and throw a clear error if < 3.38.0. Log it prominently so the owner knows to upgrade Node.js.

2. **skill_id generation strategy for migrated v1.0 cards**
   - What we know: Migrated v1.0 cards need a `skill_id` for their single skill in the new `skills[]` array
   - What's unclear: Should it be `skill-${card.id}` (stable, derived from card ID) or a new UUID?
   - Recommendation: Use `skill-${v1card.id}` — derived, stable, readable. A new UUID would break any existing clients that have cached a skill reference.

3. **FTS5 content table sync after trigger replacement**
   - What we know: FTS5 `content=capability_cards` tables use triggers to stay in sync; when triggers are replaced, the FTS index may be stale
   - What's unclear: Whether `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')` is always safe to run mid-migration on a live database (in tests, yes; in prod with concurrent writers, maybe not)
   - Recommendation: Run FTS rebuild inside the migration transaction. better-sqlite3's transaction callback is synchronous and blocks all other writers via WAL, so this is safe.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0 |
| Config file | none — uses default discovery (`*.test.ts` co-located) |
| Quick run command | `pnpm vitest run src/runtime/ src/registry/store.test.ts src/gateway/server.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RUN-01 | AgentRuntime starts, recovers orphaned escrows, shuts down cleanly | unit | `pnpm vitest run src/runtime/agent-runtime.test.ts` | Wave 0 |
| RUN-01 | SIGTERM triggers graceful shutdown with no open DB handles after | unit | `pnpm vitest run src/runtime/agent-runtime.test.ts -t "SIGTERM"` | Wave 0 |
| RUN-01 | Orphaned escrows older than 10min released on startup | unit | `pnpm vitest run src/runtime/agent-runtime.test.ts -t "orphaned"` | Wave 0 |
| RUN-02 | v2.0 card with skills[] validates against CapabilityCardV2Schema | unit | `pnpm vitest run src/types/index.test.ts` | Wave 0 |
| RUN-02 | v1.0 card still validates against CapabilityCardSchema | unit | `pnpm vitest run src/types/index.test.ts` | Wave 0 |
| RUN-03 | v1.0 cards migrated to v2.0 with no data loss | unit | `pnpm vitest run src/registry/store.test.ts -t "migration"` | Wave 0 |
| RUN-03 | FTS5 search returns results for skill names nested in skills[] | integration | `pnpm vitest run src/registry/store.test.ts -t "FTS"` | Wave 0 |
| RUN-03 | Migration does not run twice (user_version guard) | unit | `pnpm vitest run src/registry/store.test.ts -t "user_version"` | Wave 0 |
| RUN-04 | Gateway routes `{ card_id, skill_id }` to correct skill handler | integration | `pnpm vitest run src/gateway/server.test.ts -t "skill_id"` | Wave 0 |
| RUN-04 | Gateway without skill_id falls back to first skill (v1.0 compat) | integration | `pnpm vitest run src/gateway/server.test.ts -t "backward"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm vitest run src/runtime/ src/registry/store.test.ts src/gateway/server.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/runtime/agent-runtime.test.ts` — covers RUN-01 (new file, new module)
- [ ] `src/types/index.test.ts` — covers RUN-02 (new file for type tests)
- [ ] Migration tests in `src/registry/store.test.ts` — covers RUN-03 (file exists, need migration test cases)
- [ ] Skill routing tests in `src/gateway/server.test.ts` — covers RUN-04 (file exists, need skill_id test cases)

---

## Sources

### Primary (HIGH confidence)

- `src/types/index.ts` — Current CapabilityCardSchema (spec_version '1.0'), Zod shape, all exported types (direct code analysis)
- `src/registry/store.ts` — Current FTS5 trigger syntax, `openDatabase()`, `insertCard()`, `updateCard()`, `updateReputation()` (direct code analysis)
- `src/gateway/server.ts` — Current routing: `card_id`, `credits_per_call` lookup, `holdEscrow` call site (direct code analysis)
- `src/skills/handle-request.ts` — Current `HandlerMap` type, `card_id` keyed dispatch (direct code analysis)
- `src/credit/escrow.ts` — `holdEscrow`, `releaseEscrow`, `settleEscrow` (direct code analysis)
- `src/registry/request-log.ts` — Current schema, missing `skill_id` column (direct code analysis)
- `.planning/STATE.md` — Confirmed blocker: "FTS5 trigger syntax for json_each() over skills[] arrays needs verification before implementation"
- `.planning/research/ARCHITECTURE.md` — Multi-skill schema design, migration options A/B, build order rationale
- `.planning/research/PITFALLS.md` — Pitfalls 1, 3, 7, 9 directly address Phase 4 concerns
- `.planning/research/SUMMARY.md` — Phase 1 roadmap details, dependency graph
- SQLite FTS5 docs — `json_each()` requires SQLite >= 3.38; `INSERT INTO fts(fts) VALUES('rebuild')` for index rebuild (https://sqlite.org/fts5.html)
- better-sqlite3 docs — WAL mode, `busy_timeout`, transaction semantics (https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)
- croner GitHub — ESM native, `stop()` method for graceful shutdown (https://github.com/Hexagon/croner)

### Secondary (MEDIUM confidence)

- OWASP Top 10 for Agentic Applications 2026 — Least-Agency principle (Tier 3 default) — confirmed in research docs
- `PRAGMA user_version` migration pattern — standard SQLite versioning pattern; multiple community sources confirm it works as described

### Tertiary (LOW confidence)

- FTS5 `json_each` aggregate trigger exact syntax — derived from SQLite docs; needs a passing test to confirm (this is the confirmed blocker from STATE.md). The `COALESCE` fallback pattern is a reasonable mitigation but must be verified in the test suite.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing stack verified against source code; croner and typed-emitter versions confirmed from prior milestone research
- Architecture (AgentRuntime): HIGH — directly derived from actual source code analysis of all existing modules; no new infrastructure speculated
- Migration pattern: MEDIUM-HIGH — PRAGMA user_version + json_each trigger pattern is well-documented but exact FTS5 trigger syntax needs test validation (confirmed blocker in STATE.md)
- Gateway routing change: HIGH — exact code lines identified in server.ts; change is straightforward extension of existing pattern

**Research date:** 2026-03-15
**Valid until:** 2026-06-15 (stable ecosystem; SQLite, better-sqlite3, croner are not fast-moving)
