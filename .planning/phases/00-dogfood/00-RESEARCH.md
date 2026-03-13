# Phase 0: Dogfood — Research

**Researched:** 2026-03-13
**Domain:** P2P Agent Capability Sharing — TypeScript/Node.js, SQLite, Fastify, Commander, Zod
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| R-001 | Capability Card TypeScript schema + Zod validation | `CapabilityCardSchema` already partially exists in `src/types/index.ts`; research confirms Zod 3.24 patterns and what is missing (L3 card test coverage, tags field already present) |
| R-002 | SQLite-backed local registry with CRUD, FTS search, filter by level/availability/api, owner isolation | FTS5 virtual table pattern verified from official SQLite docs; better-sqlite3 11.6 confirmed to enable FTS5 by default; WAL + synchronous API confirmed |
| R-003 | Commander CLI: init, publish, discover, request, status, serve with --help, JSON+table output, config in ~/.agentbnb/ | Commander 12 stub exists in `src/cli/index.ts`; all commands are stubs needing real implementations wired to registry/credit/gateway |
| R-004 | Fastify gateway: incoming requests, validate against cards, route to local agent, return results, credit tracking, health check, timeouts | Fastify 5 TypeScript typed routes confirmed; JSON-RPC over HTTP as single POST `/rpc` endpoint is the right approach for Phase 0 |
| R-005 | Credit ledger: balance per agent, transaction log, escrow hold, settlement on success/refund on failure, bootstrap grant | Double-entry two-table (balances + transactions) + escrow table pattern is sufficient; `db.transaction()` ensures atomicity |
| R-006 | OpenClaw integration: auto-generate Capability Card from SOUL.md, handle incoming requests as tasks, end-to-end test | SOUL.md is a structured Markdown file describing agent persona/capabilities; OpenClaw skills are TypeScript modules following project conventions |
</phase_requirements>

---

## Summary

Phase 0 is a greenfield implementation with a scaffold already in place. The TypeScript project, Zod schema, and Commander CLI stub exist, but all business logic layers — registry, gateway, and credit system — are unimplemented stubs. The work is well-scoped: six requirements map cleanly to five distinct modules (`registry/`, `gateway/`, `credit/`, CLI wire-up, and OpenClaw skills).

The stack is fully decided and already installed: better-sqlite3 for SQLite, Fastify 5 for the HTTP gateway, Commander 12 for the CLI, Zod 3 for validation. No new dependencies are needed. The ESM module system (`"type": "module"`) is configured; all imports use `.js` extensions at the source level. The `CapabilityCardSchema`, `IOSchemaSchema`, and `AgentBnBError` base class exist in `src/types/index.ts` and have basic tests — the planner must treat these as foundation, not as things to implement.

The highest-risk implementation areas are: (1) FTS5 virtual table setup requiring three SQLite triggers for content-table sync, (2) Fastify 5's strict TypeScript generics requiring careful route type definitions, and (3) credit escrow atomicity which must use `db.transaction()` to prevent partial writes. For OpenClaw integration, SOUL.md format is only partially documented externally — the planner should default to L2 (Pipeline) cards and flag for manual review.

**Primary recommendation:** Implement in dependency order — types (done) → registry → credit → gateway → CLI wire-up → OpenClaw skills. Each layer depends on the one before it. Keep the gateway's JSON-RPC surface minimal: a single `/rpc` POST endpoint is sufficient for Phase 0.

---

## Standard Stack

### Core (all already in package.json — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 3.24.0 | Runtime Capability Card validation | Already used; `CapabilityCardSchema` partially implemented |
| better-sqlite3 | 11.6.0 | SQLite storage for registry and credit ledger | Synchronous API simplifies Node.js; WAL mode gives read concurrency; FTS5 enabled by default |
| fastify | 5.1.0 | HTTP gateway server | Already in dependencies; TypeScript generics for typed routes; Node 20+ required (project already targets Node 20+) |
| commander | 12.1.0 | CLI argument parsing | Already scaffolded in `src/cli/index.ts` |
| vitest | 2.1.0 | Test runner | Already used in `src/types/index.test.ts` |

### Supporting (Node built-ins — no additional installs)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/better-sqlite3 | ^7.6.12 | Type declarations for better-sqlite3 | Already in devDependencies |
| `node:crypto` | built-in | `randomUUID()` for ID generation | Already used in tests; replaces `uuid` package |
| `node:fs/promises` | built-in | Read card JSON files in CLI `publish` | CLI file I/O |
| `node:path` | built-in | Resolve config paths | CLI `init` config directory |
| `node:os` | built-in | `homedir()` for `~/.agentbnb/` | Config path construction |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 (sync) | node:sqlite (Node 22 built-in) | Node 22 required; project targets Node 20+ — skip |
| Hand-rolled JSON-RPC route | json-rpc2 npm package | Extra dependency not justified for Phase 0's single endpoint |
| FTS5 virtual table | `LIKE '%query%'` scanning | FTS5 is built-in SQLite, BM25-ranked, handles partial words — always prefer FTS5 |
| Manual string formatting (table output) | cli-table package | `console.table()` has poor column alignment; manual format for table mode, `JSON.stringify` for `--json` flag |

**Installation:** No additional packages needed. All dependencies already declared in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── types/
│   ├── index.ts          # CapabilityCardSchema, IOSchema, AgentBnBError (EXISTS)
│   └── index.test.ts     # Schema validation tests (EXISTS — partial coverage)
├── registry/
│   ├── store.ts          # SQLite CRUD for Capability Cards + FTS5 setup
│   ├── matcher.ts        # Search/filter logic using FTS5 MATCH
│   └── store.test.ts     # Registry unit tests (WAVE 0 GAP)
├── credit/
│   ├── ledger.ts         # Balance management, transaction log, bootstrap grant
│   ├── escrow.ts         # Hold/release/settle logic using db.transaction()
│   └── ledger.test.ts    # Credit unit tests (WAVE 0 GAP)
├── gateway/
│   ├── server.ts         # Fastify HTTP server — /health + /rpc POST endpoint
│   ├── client.ts         # Outbound HTTP client for capability requests
│   ├── auth.ts           # Token validation middleware (simple Bearer token)
│   └── server.test.ts    # Gateway integration tests (WAVE 0 GAP)
├── cli/
│   └── index.ts          # Commander commands wired to real implementations (EXISTS as stubs)
├── skills/               # OpenClaw integration
│   ├── publish-capability.ts   # Auto-generate card from SOUL.md
│   ├── handle-request.ts       # Handle incoming requests as tasks
│   └── integration.test.ts     # End-to-end test (WAVE 0 GAP)
└── index.ts              # Public API re-exports (EXISTS)
```

### Pattern 1: better-sqlite3 Database Initialization with WAL + FTS5

**What:** Singleton database instance with WAL mode, foreign keys, and schema migration
**When to use:** Module-level initialization in `registry/store.ts` and `credit/ledger.ts`

```typescript
// Source: https://github.com/WiseLibs/better-sqlite3
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = join(homedir(), '.agentbnb', 'registry.db');

export function openDatabase(path = DB_PATH): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_cards (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      level INTEGER NOT NULL CHECK (level IN (1,2,3)),
      data TEXT NOT NULL,        -- Full JSON blob
      online INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cards_owner ON capability_cards(owner);
    CREATE INDEX IF NOT EXISTS idx_cards_level  ON capability_cards(level);
    CREATE INDEX IF NOT EXISTS idx_cards_online ON capability_cards(online);

    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      name, description,
      content='capability_cards',
      content_rowid='rowid'
    );
  `);
  createFTSTriggers(db);
}
```

### Pattern 2: FTS5 Content Table Triggers (Required — Not Optional)

**What:** Three triggers that keep the FTS5 virtual table in sync with the main table
**When to use:** Must be created during schema migration in `registry/store.ts`

```typescript
// Source: https://www.sqlite.org/fts5.html (External Content Tables section)
function createFTSTriggers(db: Database.Database): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON capability_cards BEGIN
      INSERT INTO cards_fts(rowid, name, description)
      VALUES (new.rowid, new.name, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON capability_cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, name, description)
      VALUES ('delete', old.rowid, old.name, old.description);
    END;

    CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON capability_cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, name, description)
      VALUES ('delete', old.rowid, old.name, old.description);
      INSERT INTO cards_fts(rowid, name, description)
      VALUES (new.rowid, new.name, new.description);
    END;
  `);
}
```

### Pattern 3: FTS5 Search with BM25 Ranking

**What:** Search cards by text using FTS5 MATCH with BM25 ranking + additional filters
**When to use:** `registry/matcher.ts` for the `discover` command

```typescript
// Source: https://www.sqlite.org/fts5.html
export function searchCards(
  db: Database.Database,
  query: string,
  filters: { level?: 1 | 2 | 3; online?: boolean } = {}
): CapabilityCard[] {
  let sql = `
    SELECT c.data
    FROM capability_cards c
    JOIN cards_fts f ON c.rowid = f.rowid
    WHERE cards_fts MATCH ?
  `;
  const params: unknown[] = [query];

  if (filters.level !== undefined) {
    sql += ' AND c.level = ?';
    params.push(filters.level);
  }
  if (filters.online !== undefined) {
    sql += ' AND c.online = ?';
    params.push(filters.online ? 1 : 0);
  }
  sql += ' ORDER BY rank LIMIT 50';

  const rows = db.prepare(sql).all(...params) as Array<{ data: string }>;
  return rows.map((r) => JSON.parse(r.data) as CapabilityCard);
}
```

### Pattern 4: Credit Ledger Schema (Two-Table + Escrow)

**What:** `credit_balances` (current state) + `credit_transactions` (immutable log) + `credit_escrow` (holds)
**When to use:** `credit/ledger.ts` initialization

```typescript
// Schema for credit/ledger.ts
const CREDIT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS credit_balances (
    owner TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credit_transactions (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    amount INTEGER NOT NULL,   -- positive = credit, negative = debit
    reason TEXT NOT NULL,      -- 'bootstrap' | 'escrow_hold' | 'escrow_release' | 'settlement' | 'refund'
    reference_id TEXT,         -- card ID or escrow ID
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credit_escrow (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    amount INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'held',  -- 'held' | 'settled' | 'released'
    created_at TEXT NOT NULL,
    settled_at TEXT
  );
`;
```

### Pattern 5: Atomic Escrow Hold via db.transaction()

**What:** Use `db.transaction()` to atomically deduct balance and create escrow record
**When to use:** `credit/escrow.ts` — any operation modifying both `credit_balances` and `credit_escrow`

```typescript
// Source: https://github.com/WiseLibs/better-sqlite3 (Transactions section)
import { randomUUID } from 'node:crypto';

export function holdEscrow(
  db: Database.Database,
  owner: string,
  amount: number,
  cardId: string
): string {
  const holdId = randomUUID();
  const now = new Date().toISOString();

  const hold = db.transaction(() => {
    const row = db
      .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
      .get(owner) as { balance: number } | undefined;

    if (!row || row.balance < amount) {
      throw new AgentBnBError('Insufficient credits', 'INSUFFICIENT_CREDITS');
    }

    db.prepare(
      'UPDATE credit_balances SET balance = balance - ?, updated_at = ? WHERE owner = ?'
    ).run(amount, now, owner);

    db.prepare(
      'INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(holdId, owner, amount, cardId, 'held', now);

    db.prepare(
      'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), owner, -amount, 'escrow_hold', holdId, now);
  });

  hold();
  return holdId;
}
```

### Pattern 6: Fastify 5 Gateway with Typed JSON-RPC Route

**What:** Single `/rpc` POST endpoint + `/health` GET, typed with Fastify generics
**When to use:** `gateway/server.ts`

```typescript
// Source: https://fastify.dev/docs/latest/Reference/TypeScript/
import Fastify from 'fastify';

interface RpcRequest {
  Body: {
    jsonrpc: '2.0';
    method: string;
    params: Record<string, unknown>;
    id: string | number;
  };
}

export async function createGatewayServer(port = 7700) {
  const server = Fastify({ logger: true });

  server.get('/health', async () => ({
    status: 'ok',
    version: '0.0.1',
    uptime: process.uptime(),
  }));

  server.post<RpcRequest>('/rpc', {
    schema: {
      body: {
        type: 'object',
        required: ['jsonrpc', 'method', 'id'],
        properties: {
          jsonrpc: { type: 'string', const: '2.0' },
          method: { type: 'string' },
          params: { type: 'object' },
          id: {},
        },
      },
    },
  }, async (request, reply) => {
    const { method, params, id } = request.body;
    try {
      const result = await dispatch(method, params);
      return reply.send({ jsonrpc: '2.0', result, id });
    } catch (err) {
      return reply.send({
        jsonrpc: '2.0',
        error: { code: -32603, message: (err as Error).message },
        id,
      });
    }
  });

  await server.listen({ port, host: '0.0.0.0' });
  return server;
}
```

### Pattern 7: CLI Config File at ~/.agentbnb/config.json

**What:** Config stored at `~/.agentbnb/config.json` with agent identity and gateway endpoint
**When to use:** `agentbnb init` writes it; all other commands read it

```typescript
// Source: Node.js built-ins
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const CONFIG_DIR = join(homedir(), '.agentbnb');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

interface AgentBnBConfig {
  owner: string;          // agent identifier (e.g., 'chengwen@leyang')
  gateway_url: string;    // URL where this agent's gateway listens
  gateway_port: number;   // default 7700
  db_path: string;        // path to SQLite file
  token: string;          // auth token for incoming requests
}
```

### Pattern 8: Commander Async Entry Point

**What:** `parseAsync` replaces `parse` when any action handlers are async
**When to use:** Bottom of `src/cli/index.ts` — the entry point call

```typescript
// Source: Commander 12 docs
// WRONG — swallows async errors:
// program.parse();

// CORRECT — awaits async actions:
await program.parseAsync(process.argv);
```

### Anti-Patterns to Avoid

- **`program.parse()` with async actions:** Swallows Promise rejections silently. Always use `program.parseAsync(process.argv)`.
- **FTS5 without triggers:** Creating the virtual table but skipping the three `AFTER INSERT/UPDATE/DELETE` triggers causes the FTS index to go immediately stale.
- **Escrow without db.transaction():** Updating balance and inserting escrow record in separate statements risks partial writes on crash. Always use `db.transaction()`.
- **No WAL mode:** Omitting `db.pragma('journal_mode = WAL')` causes write lock contention. Set at DB open time.
- **Importing `.ts` extensions:** ESM requires `.js` in relative imports. Write `from './store.js'` not `from './store.ts'`.
- **`any` types:** tsconfig and conventions both forbid `any`. Use `unknown` with type narrowing or Zod-inferred types.
- **Re-implementing existing types:** `CapabilityCardSchema`, `IOSchemaSchema`, and `AgentBnBError` already exist. Import them; do not redefine.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema validation | Custom JSON validator | Zod 3.24 (already installed) | Optional/nested fields, TypeScript inference, `.safeParse()` return type |
| Full-text search | `LIKE '%query%'` table scan | SQLite FTS5 virtual table | Built-in, BM25-ranked, handles partial words, <50ms at scale |
| Atomic credit operations | Sequential SQL statements | `db.transaction()` (better-sqlite3) | Automatic rollback on error; prevents partial writes |
| UUID generation | Third-party `uuid` package | `crypto.randomUUID()` (Node built-in) | Already used in tests; zero dependencies |
| HTTP server | Raw `node:http` | Fastify 5 (already installed) | Type safety, schema validation, lifecycle hooks, logger |
| CLI parsing | `process.argv` slicing | Commander 12 (already installed) | `--help`, subcommands, option coercion, error handling |
| Config directory | Custom dotfile logic | `node:os homedir()` + `node:fs/promises mkdir` | Standard Node.js built-ins, no extra dependency |

**Key insight:** Every dependency is already installed. The risk is re-implementing what existing packages already provide.

---

## Common Pitfalls

### Pitfall 1: Commander `.parse()` Drops Async Errors

**What goes wrong:** Async action handlers throw but Commander swallows the error when using `.parse()`.
**Why it happens:** `.parse()` is synchronous; Promise rejections become unhandled.
**How to avoid:** Use `await program.parseAsync(process.argv)` as the CLI entry point.
**Warning signs:** Errors in `publish` or `request` commands produce no output and exit 0.

### Pitfall 2: FTS5 Content Table Desync

**What goes wrong:** Cards appear in main table but FTS search returns zero results.
**Why it happens:** FTS5 external content tables do not auto-update — the three triggers are required.
**How to avoid:** Create `AFTER INSERT`, `AFTER UPDATE`, `AFTER DELETE` triggers in schema migration. Add a test: insert a card, then verify FTS MATCH finds it.
**Warning signs:** `discover` returns empty results even when `capability_cards` has rows.

### Pitfall 3: ESM Import Extensions in TypeScript

**What goes wrong:** `Cannot find module './store'` at runtime even though TypeScript compiles.
**Why it happens:** ESM Node.js requires `.js` extension in relative imports. TypeScript resolves `.ts` at compile time but emits `.js` references at runtime.
**How to avoid:** Always write `from './store.js'` in source files.
**Warning signs:** Works with `tsx` (development) but fails after `pnpm build` (production).

### Pitfall 4: Credit Bootstrap Race Condition

**What goes wrong:** Two simultaneous requests from a new agent both read zero balance and both succeed, creating negative balance.
**Why it happens:** Read-then-write pattern without locking.
**How to avoid:** Use `INSERT OR IGNORE` for initial balance row, then `UPDATE ... WHERE balance >= amount` and check affected row count inside `db.transaction()`.
**Warning signs:** Balance goes negative in concurrent test scenarios.

### Pitfall 5: better-sqlite3 Blocking Event Loop in Fastify

**What goes wrong:** Long SQLite queries stall Fastify's event loop; other requests queue up.
**Why it happens:** better-sqlite3 is synchronous by design; Fastify is async/non-blocking.
**How to avoid:** For Phase 0 (single-agent local use), this is acceptable. Mitigate with prepared statements, indexes on `owner`/`level`/`online`, and FTS5 for text queries.
**Warning signs:** Gateway latency spikes when multiple requests arrive simultaneously.

### Pitfall 6: Fastify 5 Breaking Changes from v4

**What goes wrong:** Code copied from Fastify v4 examples fails to compile or run.
**Why it happens:** Fastify 5 requires Node.js 20+, changed plugin APIs, and has stricter TypeScript generics.
**How to avoid:** Refer only to `fastify.dev` docs. The project already has Fastify 5.1.0 installed — do not reference v4 examples.
**Warning signs:** `FastifyInstance` type errors, plugin registration failures, deprecation warnings about `target` in tsconfig.

### Pitfall 7: OpenClaw SOUL.md Format Assumptions

**What goes wrong:** Card auto-generation produces invalid or malformed Capability Cards.
**Why it happens:** SOUL.md format is not formally specified externally; structure varies by agent.
**How to avoid:** Parse conservatively — extract what's clearly present, default to L2 for level, mark `availability.online: false` until explicitly set. Always run Zod validation on the generated card before saving.
**Warning signs:** `CapabilityCardSchema.safeParse()` returns `success: false` on generated cards.

---

## Code Examples

### Foundation That Already Exists — Do Not Re-implement

```typescript
// Source: src/types/index.ts (already implemented and tested)
// These are DONE — import them, don't rewrite them.
import {
  CapabilityCardSchema,
  IOSchemaSchema,
  type CapabilityCard,
  type IOSchema,
  AgentBnBError,
} from '../types/index.js';
```

### Card Store — Insert Pattern

```typescript
// Source: https://github.com/WiseLibs/better-sqlite3
export function insertCard(db: Database.Database, card: CapabilityCard): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO capability_cards
      (id, owner, name, description, level, data, online, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    card.id,
    card.owner,
    card.name,
    card.description,
    card.level,
    JSON.stringify(card),
    card.availability.online ? 1 : 0,
    now,
    now,
  );
}
```

### CLI Publish — Wired Implementation Pattern

```typescript
// Source: Commander 12 docs — async action with --json flag
program
  .command('publish <card>')
  .description('Publish a Capability Card to the registry')
  .option('--json', 'Output as JSON')
  .action(async (cardPath: string, opts: { json?: boolean }) => {
    const raw = await readFile(cardPath, 'utf-8');
    const parsed = CapabilityCardSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      const msg = opts.json
        ? JSON.stringify({ error: parsed.error.format() })
        : `Invalid card: ${parsed.error.message}`;
      console.error(msg);
      process.exit(1);
    }
    const store = new CardStore();
    store.insert(parsed.data);
    console.log(opts.json
      ? JSON.stringify({ id: parsed.data.id })
      : `Published: ${parsed.data.name} (${parsed.data.id})`);
  });
```

### Credit Bootstrap Grant

```typescript
// Pattern: INSERT OR IGNORE ensures idempotent initial grant
export function bootstrapAgent(
  db: Database.Database,
  owner: string,
  credits = 100
): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      'INSERT OR IGNORE INTO credit_balances (owner, balance, updated_at) VALUES (?, ?, ?)'
    ).run(owner, credits, now);
    db.prepare(
      'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), owner, credits, 'bootstrap', null, now);
  })();
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-sqlite3` (async callbacks) | `better-sqlite3` (synchronous) | ~2018, mainstream since 2021 | No callback/Promise pyramid; simpler code |
| Fastify v4 (Node 14+) | Fastify v5 (Node 20+) | October 2024 | Better TypeScript generics, no namespace collisions |
| `uuid` npm package | `crypto.randomUUID()` Node built-in | Node 14.17+ | Zero external dependency |
| `program.parse()` | `program.parseAsync()` | Commander 8+ | Required for async action handlers |
| FTS3/FTS4 | FTS5 | SQLite 3.9.0 (2015) | BM25 ranking built-in, faster, better Unicode |

**Deprecated/outdated:**
- `node-sqlite3`: Async wrapper with callback hell; `better-sqlite3` is the current community standard
- `uuid` npm package: Unnecessary — `crypto.randomUUID()` is in Node.js core since v14.17

---

## Open Questions

1. **OpenClaw SOUL.md exact structure**
   - What we know: SOUL.md describes agent persona, expertise, capabilities; it is Markdown with structured sections
   - What is unclear: Exact sections that map to CapabilityCard `inputs`/`outputs`/`level`; whether a TOOLS.md is separate
   - Recommendation: Parse SOUL.md defensively — extract agent name (→ `owner`), expertise sections (→ `description`), default to L2, require human review before marking `availability.online: true`

2. **Gateway execution model**
   - What we know: Gateway receives JSON-RPC and "routes to local agent for execution" per R-004
   - What is unclear: Does execution mean spawning a subprocess, calling a local HTTP callback, or triggering a registered handler function?
   - Recommendation: For Phase 0, use a configurable HTTP callback URL in `~/.agentbnb/config.json`. Gateway POSTs to `handler_url` with the request payload and awaits response with configurable timeout (default 30s).

3. **Per-project vs. global config**
   - What we know: R-003 specifies config in `~/.agentbnb/config.json`
   - What is unclear: Whether per-project `.agentbnb.json` is useful for dogfood testing
   - Recommendation: Phase 0 global-only is sufficient. `agentbnb init` writes `~/.agentbnb/config.json` only.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.0 |
| Config file | None — `"test": "vitest"` in `package.json` scripts |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R-001 | Zod validates correct L1/L2/L3 cards | unit | `pnpm test:run src/types/index.test.ts` | Yes (partial — L3 missing) |
| R-001 | Zod rejects malformed cards (empty owner, bad UUID, level 4) | unit | `pnpm test:run src/types/index.test.ts` | Yes (partial) |
| R-002 | Insert card and retrieve by ID | unit | `pnpm test:run src/registry/store.test.ts` | No — Wave 0 |
| R-002 | FTS search returns results in <50ms | unit | `pnpm test:run src/registry/store.test.ts` | No — Wave 0 |
| R-002 | Owner isolation: non-owner cannot delete | unit | `pnpm test:run src/registry/store.test.ts` | No — Wave 0 |
| R-002 | FTS triggers keep index in sync | unit | `pnpm test:run src/registry/store.test.ts` | No — Wave 0 |
| R-003 | CLI `publish` validates and stores card | integration | `pnpm test:run src/cli/index.test.ts` | No — Wave 0 |
| R-003 | CLI `discover` returns formatted results | integration | `pnpm test:run src/cli/index.test.ts` | No — Wave 0 |
| R-003 | CLI `--help` shows usage for all commands | integration | `pnpm test:run src/cli/index.test.ts` | No — Wave 0 |
| R-004 | Gateway `/health` responds 200 with status | integration | `pnpm test:run src/gateway/server.test.ts` | No — Wave 0 |
| R-004 | Gateway rejects requests without valid token | integration | `pnpm test:run src/gateway/server.test.ts` | No — Wave 0 |
| R-004 | Gateway timeout handling returns error response | integration | `pnpm test:run src/gateway/server.test.ts` | No — Wave 0 |
| R-005 | Bootstrap grant sets initial balance | unit | `pnpm test:run src/credit/ledger.test.ts` | No — Wave 0 |
| R-005 | Escrow hold deducts balance atomically | unit | `pnpm test:run src/credit/ledger.test.ts` | No — Wave 0 |
| R-005 | Double-spend prevented when balance insufficient | unit | `pnpm test:run src/credit/ledger.test.ts` | No — Wave 0 |
| R-005 | Settlement transfers credits to capability owner | unit | `pnpm test:run src/credit/ledger.test.ts` | No — Wave 0 |
| R-005 | Refund releases escrow on failure | unit | `pnpm test:run src/credit/ledger.test.ts` | No — Wave 0 |
| R-006 | Card auto-generation produces valid Zod-passing card | unit | `pnpm test:run src/skills/integration.test.ts` | No — Wave 0 |
| R-006 | End-to-end: Agent A request → Agent B execute → result returns | e2e | `pnpm test:run src/skills/integration.test.ts` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/registry/store.test.ts` — covers R-002 registry CRUD, FTS search, owner isolation, trigger sync
- [ ] `src/credit/ledger.test.ts` — covers R-005 bootstrap, escrow hold/settle/refund, double-spend prevention
- [ ] `src/gateway/server.test.ts` — covers R-004 health check, auth rejection, timeout, routing
- [ ] `src/cli/index.test.ts` — covers R-003 CLI wiring (use Vitest with process mock or child_process exec)
- [ ] `src/skills/integration.test.ts` — covers R-006 card generation and end-to-end flow
- [ ] Additional test cases in `src/types/index.test.ts` — L3 card validation, tags field, datetime fields

---

## Sources

### Primary (HIGH confidence)

- SQLite official FTS5 docs — https://www.sqlite.org/fts5.html — virtual table creation, content tables, trigger pattern, MATCH, BM25 ranking
- Fastify TypeScript docs — https://fastify.dev/docs/latest/Reference/TypeScript/ — typed route generics, RouteGenericInterface, server setup
- better-sqlite3 GitHub issue #1253 — confirms FTS5 is enabled by default; no additional setup required
- Project codebase — `src/types/index.ts`, `src/cli/index.ts`, `src/types/index.test.ts`, `package.json` — existing foundation confirmed live

### Secondary (MEDIUM confidence)

- WebSearch for better-sqlite3 FTS5 patterns — confirmed `CREATE VIRTUAL TABLE ... USING fts5(content='...')` pattern works with better-sqlite3
- WebSearch for Commander async — confirmed `.parseAsync()` is correct for async action handlers
- Fastify release notes (https://github.com/fastify/fastify/releases) — Fastify 5.8.0 current as of early 2026; 5.1.0 installed is stable
- Double-entry bookkeeping schema — https://blog.journalize.io/posts/an-elegant-db-schema-for-double-entry-accounting/ — schema design principles

### Tertiary (LOW confidence)

- OpenClaw SOUL.md structure — https://github.com/aaronjmars/soul.md — format inferred from public repos; Cheng Wen's specific SOUL.md structure is internal

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All packages already installed; versions confirmed from `package.json`; no new dependencies needed
- Architecture: HIGH — Based on existing code structure, ARCHITECTURE.md, and official docs; dependency order verified
- Registry/FTS5: HIGH — Official SQLite FTS5 docs are authoritative; better-sqlite3 FTS5 support confirmed from GitHub issue
- Fastify patterns: HIGH — Official Fastify 5 TypeScript docs confirmed; typed route examples verified
- Credit escrow: MEDIUM — Schema design principles verified from multiple sources; exact SQL implementation is a design choice
- OpenClaw integration: LOW — Internal project format; SOUL.md structure inferred, not formally documented

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable ecosystem; SQLite/Fastify/better-sqlite3/Zod APIs unlikely to change within 30 days)
