# Phase 0: Dogfood — Research

**Researched:** 2026-03-13
**Domain:** P2P Agent Capability Sharing — TypeScript/Node.js, SQLite, Fastify, Commander, Zod
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| R-001 | Capability Card TypeScript schema + Zod validation | CapabilityCardSchema already partially exists in `src/types/index.ts`; research confirms Zod 3.24 patterns and what is missing (tags field, test coverage for L3 cards) |
| R-002 | SQLite-backed local registry with CRUD, FTS search, filter by level/availability/api, owner isolation | FTS5 virtual table pattern verified from official SQLite docs; better-sqlite3 11.6 WAL + synchronous API confirmed |
| R-003 | Commander CLI: init, publish, discover, request, status, serve with --help, JSON+table output, config in ~/.agentbnb/ | Commander 12 stub exists in `src/cli/index.ts`; all commands are stubs needing real implementations |
| R-004 | Fastify gateway: incoming requests, validate against cards, route to local agent, return results, credit tracking, health check, timeouts | Fastify 5 TypeScript typed routes and plugin pattern confirmed; JSON-RPC over HTTP hand-rolled POST route is the right approach for Phase 0 |
| R-005 | Credit ledger: balance per agent, transaction log, escrow hold, settlement on success/refund on failure, bootstrap grant | Double-entry SQLite pattern researched; simple two-table design (balances + transactions) is sufficient for Phase 0 |
| R-006 | OpenClaw integration: auto-generate Capability Card from SOUL.md, handle incoming requests as tasks, end-to-end test | Architecture pattern identified; OpenClaw skills are TypeScript modules following project conventions |
</phase_requirements>

---

## Summary

Phase 0 is a greenfield implementation with a scaffold already in place. The TypeScript project, Zod schema, and Commander CLI stub exist, but all business logic layers — registry, gateway, and credit system — are unimplemented stubs. The work is well-scoped: six requirements map cleanly to five distinct modules (`registry/`, `gateway/`, `credit/`, CLI wire-up, and OpenClaw skills).

The stack is fully decided and installed: better-sqlite3 for SQLite, Fastify 5 for the HTTP gateway, Commander 12 for the CLI, Zod 3 for validation. No new dependencies are needed. The ESM module system (`"type": "module"`) is already configured; all imports use `.js` extensions. The `CapabilityCardSchema` and `AgentBnBError` base class exist and are tested — the planner should treat these as foundation, not as things to implement.

The highest-risk items are (1) FTS5 virtual table setup requiring SQLite triggers for content-table sync, (2) Fastify 5's strict TypeScript generics requiring careful route type definitions, and (3) the credit escrow atomicity requirement which must use SQLite transactions to be safe.

**Primary recommendation:** Implement in dependency order — types (done) → registry → credit → gateway → CLI → OpenClaw. Each layer depends on the one before it. Keep the gateway's JSON-RPC surface minimal: a single `/rpc` POST endpoint is sufficient for Phase 0.

---

## Standard Stack

### Core (all already in package.json — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 3.24.0 | Runtime Capability Card validation | Already used, schema partially implemented |
| better-sqlite3 | 11.6.0 | SQLite storage for registry and credit ledger | Synchronous API simplifies Node.js code; WAL mode gives read concurrency |
| fastify | 5.1.0 | HTTP gateway server | Already in dependencies; TypeScript generics for typed routes |
| commander | 12.1.0 | CLI argument parsing | Already scaffolded in `src/cli/index.ts` |
| vitest | 2.1.0 | Test runner | Already used in `src/types/index.test.ts` |

### Supporting (no additional installs needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/better-sqlite3 | ^7.6.12 | Type declarations for better-sqlite3 | Already in devDependencies |
| crypto (Node built-in) | built-in | UUID generation via `randomUUID()` | Already used in tests |
| node:fs/promises | built-in | Read card JSON files in CLI `publish` | For CLI file I/O |
| node:path | built-in | Resolve config paths (~/.agentbnb/) | For CLI `init` config dir |
| node:os | built-in | `homedir()` for config path | For `~/.agentbnb/config.json` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 (sync) | node:sqlite (Node 22 built-in) | Node 22 required, project targets Node 20+; skip |
| Hand-rolled JSON-RPC | json-rpc2-fastify package | Extra dependency not worth it for Phase 0's single endpoint |
| FTS5 virtual table | Manual LIKE search | FTS5 is built into SQLite, faster, supports ranking; use FTS5 |
| cli-table package | console.table() built-in | console.table() has poor column alignment; use JSON.stringify for `--json` flag, manual string formatting for table mode |

**Installation:** No additional packages needed. All dependencies already declared.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── types/
│   ├── index.ts          # CapabilityCardSchema, IOSchema, AgentBnBError (EXISTS)
│   └── index.test.ts     # Schema validation tests (EXISTS)
├── registry/
│   ├── store.ts          # SQLite CRUD for Capability Cards + FTS5
│   ├── matcher.ts        # Search/filter logic using FTS5
│   └── store.test.ts     # Registry unit tests
├── credit/
│   ├── ledger.ts         # Balance management, transaction log
│   ├── escrow.ts         # Hold/release/settle logic
│   └── ledger.test.ts    # Credit unit tests
├── gateway/
│   ├── server.ts         # Fastify HTTP server, /rpc POST endpoint
│   ├── client.ts         # Outbound HTTP client for capability requests
│   ├── auth.ts           # Token validation middleware
│   └── server.test.ts    # Gateway integration tests
├── cli/
│   └── index.ts          # Commander commands wired to real implementations (EXISTS as stub)
├── skills/               # OpenClaw integration skills
│   ├── publish-capability.ts
│   └── handle-request.ts
└── index.ts              # Public API re-exports (EXISTS)
```

### Pattern 1: better-sqlite3 Database Initialization

**What:** Singleton database instance with WAL mode and schema migration
**When to use:** Module-level initialization in `registry/store.ts` and `credit/ledger.ts`

```typescript
// Source: https://github.com/WiseLibs/better-sqlite3
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DB_PATH = join(process.env['HOME'] ?? '.', '.agentbnb', 'registry.db');

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
      data TEXT NOT NULL,  -- Full JSON blob
      online INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      name, description,
      content='capability_cards',
      content_rowid='rowid'
    );
  `);
}
```

### Pattern 2: FTS5 Content Table with Triggers

**What:** FTS5 virtual table backed by `capability_cards`, synced via triggers
**When to use:** `registry/store.ts` INSERT/UPDATE/DELETE operations need to maintain the FTS index

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

### Pattern 3: FTS5 Search Query

**What:** Search cards by text query using FTS5 MATCH with BM25 ranking
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

### Pattern 4: Credit Ledger Schema (Double-Entry Inspired)

**What:** Two-table design: `credit_balances` (current state) + `credit_transactions` (immutable log)
**When to use:** `credit/ledger.ts` for all balance operations

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
    amount INTEGER NOT NULL,  -- positive = credit, negative = debit
    reason TEXT NOT NULL,     -- 'bootstrap', 'escrow_hold', 'escrow_release', 'settlement', 'refund'
    reference_id TEXT,        -- card ID or request ID
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credit_escrow (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    amount INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'held',  -- 'held', 'settled', 'released'
    created_at TEXT NOT NULL,
    settled_at TEXT
  );
`;
```

### Pattern 5: Fastify Gateway with JSON-RPC POST Route

**What:** Single `/rpc` POST endpoint handling JSON-RPC 2.0 method calls
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

  server.get('/health', async () => ({ status: 'ok' }));

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

### Pattern 6: better-sqlite3 Transaction for Atomic Escrow

**What:** Use `db.transaction()` to atomically deduct escrow and log transaction
**When to use:** `credit/escrow.ts` — any operation that modifies both `credit_balances` and `credit_transactions`

```typescript
// Source: https://github.com/WiseLibs/better-sqlite3 (Transactions docs)
export function holdEscrow(
  db: Database.Database,
  owner: string,
  amount: number,
  cardId: string
): string {
  const holdId = randomUUID();
  const now = new Date().toISOString();

  const hold = db.transaction(() => {
    const balance = db
      .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
      .get(owner) as { balance: number } | undefined;

    if (!balance || balance.balance < amount) {
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

### Pattern 7: CLI Config File (~/.agentbnb/config.json)

**What:** Config stored at `~/.agentbnb/config.json` with agent identity and gateway endpoint
**When to use:** `agentbnb init` writes it; all other commands read it

```typescript
// Source: Node.js built-ins pattern
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const CONFIG_DIR = join(homedir(), '.agentbnb');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

interface AgentBnBConfig {
  owner: string;
  gateway_url: string;
  gateway_port: number;
  db_path: string;
  token: string;
}
```

### Anti-Patterns to Avoid

- **Raw Promises in CLI actions:** All actions must use `async/await`. Commander `.action()` supports async handlers when `.parseAsync()` is called instead of `.parse()`.
- **No WAL mode:** Omitting `db.pragma('journal_mode = WAL')` causes write lock contention. Set it at DB open time.
- **FTS5 without triggers:** Creating the virtual table but forgetting the `AFTER INSERT/UPDATE/DELETE` triggers causes FTS to go stale immediately.
- **Escrow without transactions:** Updating balance and inserting escrow record in separate statements risks partial writes. Always use `db.transaction()`.
- **Importing `.ts` extensions:** ESM requires `.js` extensions in relative imports even in TypeScript. Use `from './store.js'` not `from './store.ts'`.
- **`any` types:** Convention and tsconfig both forbid `any`. Use `unknown` with narrowing or Zod-inferred types.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema validation | Custom JSON validator | Zod 3.24 (already installed) | Edge cases in optional/nested fields; Zod handles TypeScript inference |
| Full-text search | `LIKE '%query%'` scanning | SQLite FTS5 virtual table | FTS5 is built-in, BM25-ranked, handles partial words |
| Atomic credit operations | Sequential SQL statements | `db.transaction()` | better-sqlite3 transactions roll back on error automatically |
| UUID generation | Third-party UUID library | `crypto.randomUUID()` (Node built-in) | Already used in tests; no extra dependency |
| HTTP server | Raw `node:http` | Fastify 5 (already installed) | Type safety, schema validation, lifecycle hooks |
| CLI parsing | `process.argv` | Commander 12 (already installed) | `--help`, subcommands, option types handled |

**Key insight:** Every dependency is already installed. The risk is re-implementing what the existing packages already provide.

---

## Common Pitfalls

### Pitfall 1: Commander `.parse()` Drops Async Errors

**What goes wrong:** Async action handlers throw but Commander swallows the error when using `.parse()`.
**Why it happens:** `.parse()` is synchronous; Promise rejections are unhandled.
**How to avoid:** Use `program.parseAsync(process.argv)` as the CLI entry point.
**Warning signs:** Errors in `publish` or `request` commands silently fail with no output.

### Pitfall 2: FTS5 Content Table Desync

**What goes wrong:** Cards appear in main table but not in FTS search results.
**Why it happens:** FTS5 content tables require explicit trigger maintenance — inserting into the main table does not auto-update the FTS index.
**How to avoid:** Create `AFTER INSERT`, `AFTER UPDATE`, `AFTER DELETE` triggers in the schema migration. Run `INSERT INTO cards_fts(cards_fts) VALUES('integrity-check')` in tests.
**Warning signs:** `discover` returns no results even when cards exist.

### Pitfall 3: ESM Import Extensions in TypeScript

**What goes wrong:** `Cannot find module './store'` at runtime even though TypeScript compiles fine.
**Why it happens:** ESM Node.js requires `.js` extension in relative imports. TypeScript resolves `.ts` files when authoring but the compiled output needs `.js`.
**How to avoid:** Always write `from './store.js'` in source files (TypeScript resolves to the `.ts` file at compile time, emits `.js` at runtime).
**Warning signs:** Works with `tsx` but fails after `pnpm build`.

### Pitfall 4: better-sqlite3 Synchronous API in Fastify Async Context

**What goes wrong:** Fastify warns about blocking the event loop; long queries stall other requests.
**Why it happens:** better-sqlite3 is synchronous by design; Fastify is async.
**How to avoid:** For Phase 0 (single-agent local use), this is acceptable. Keep queries fast: use prepared statements, indexes on `owner` and `level`, FTS5 for text search.
**Warning signs:** Gateway latency spikes when multiple requests arrive simultaneously.

### Pitfall 5: Credit Bootstrap Race Condition

**What goes wrong:** Two simultaneous requests from a new agent both read zero balance and both succeed, creating negative balance.
**Why it happens:** Read-then-write pattern without locking.
**How to avoid:** Use `INSERT OR IGNORE` for initial balance row, then use `UPDATE ... WHERE balance >= amount` with a row count check. Wrap in `db.transaction()`.
**Warning signs:** Balance goes negative in test scenarios.

### Pitfall 6: Fastify 5 Breaking Changes from v4

**What goes wrong:** Code copied from Fastify v4 examples fails to compile or run.
**Why it happens:** Fastify 5 requires Node.js 20+, changed some plugin APIs, and has stricter TypeScript generics.
**How to avoid:** Refer to the official Fastify 5 docs at `fastify.dev`. The project already has Fastify 5.1.0 installed.
**Warning signs:** `FastifyInstance` type errors, plugin registration failures.

---

## Code Examples

### Zod Schema — What Already Exists

```typescript
// Source: src/types/index.ts (already implemented)
// CapabilityCardSchema, IOSchemaSchema, AgentBnBError are DONE.
// Do NOT re-implement. Build on top.
import { CapabilityCardSchema, type CapabilityCard } from '../types/index.js';
```

### Card Store — Insert Pattern

```typescript
// Source: https://github.com/WiseLibs/better-sqlite3 (pattern: prepared statements)
export function insertCard(db: Database.Database, card: CapabilityCard): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO capability_cards (id, owner, name, description, level, data, online, created_at, updated_at)
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
    now
  );
}
```

### CLI Command — Wired Publish

```typescript
// Source: Commander 12 docs — async parseAsync pattern
program
  .command('publish <card>')
  .description('Publish a Capability Card to the registry')
  .option('--json', 'Output as JSON')
  .action(async (cardPath: string, opts: { json?: boolean }) => {
    const raw = await readFile(cardPath, 'utf-8');
    const parsed = CapabilityCardSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error(opts.json
        ? JSON.stringify({ error: parsed.error.format() })
        : 'Invalid card: ' + parsed.error.message);
      process.exit(1);
    }
    // ... insert to registry
  });

// Entry point must use parseAsync:
await program.parseAsync(process.argv);
```

### Fastify Health Check

```typescript
// Source: https://fastify.dev/docs/latest/Guides/Getting-Started/
server.get('/health', async (_request, _reply) => ({
  status: 'ok',
  version: '0.0.1',
  uptime: process.uptime(),
}));
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-sqlite3` (async callbacks) | `better-sqlite3` (sync) | ~2018, popular since 2021 | Simpler code, no callback/Promise pyramid |
| Fastify v4 (Node 14+) | Fastify v5 (Node 20+) | 2024 | Better TypeScript generics, no `FastifyInstance` namespace collisions |
| `uuid` npm package | `crypto.randomUUID()` (Node built-in) | Node 14.17+ | No dependency needed |
| Commander `.parse()` | Commander `.parseAsync()` | Commander 8+ | Required for async CLI actions |
| FTS3/FTS4 | FTS5 | SQLite 3.9.0 (2015) | BM25 ranking built-in, better performance |

**Deprecated/outdated:**
- `node-sqlite3`: Async wrapper with callback hell; `better-sqlite3` is the current standard
- `uuid` npm package: Unnecessary — `crypto.randomUUID()` is in Node.js core

---

## Open Questions

1. **OpenClaw SOUL.md format**
   - What we know: OpenClaw agents have a `SOUL.md` that describes their capabilities
   - What's unclear: Exact structure of SOUL.md — what fields map to CapabilityCard inputs/outputs/level
   - Recommendation: In R-006, auto-generate cards defensively — use L2 (Pipeline) as default level, parse SOUL.md with regex/structured sections, flag for manual review

2. **Config file location and structure**
   - What we know: CLI should store config in `~/.agentbnb/config.json` per R-003
   - What's unclear: Whether to support per-project config (`.agentbnb.json` in CWD) in addition to global config
   - Recommendation: Phase 0 global-only is sufficient; plan for `init` to write `~/.agentbnb/config.json`

3. **Request execution model for the gateway**
   - What we know: Gateway receives JSON-RPC requests and "routes to local agent for execution"
   - What's unclear: Does execution mean spawning a subprocess, calling a local HTTP endpoint, or just triggering a configured callback?
   - Recommendation: For Phase 0, treat execution as a configurable HTTP callback URL in the agent config. Gateway POSTs to local handler URL, waits for response with timeout.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.0 |
| Config file | none — uses package.json `"test": "vitest"` script |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R-001 | Zod validates/rejects all three card levels | unit | `pnpm test:run src/types/index.test.ts` | Yes |
| R-001 | Zod rejects malformed cards (missing required fields, bad UUID, level > 3) | unit | `pnpm test:run src/types/index.test.ts` | Partial (3 of needed cases) |
| R-002 | Insert card and retrieve by ID | unit | `pnpm test:run src/registry/store.test.ts` | No — Wave 0 |
| R-002 | FTS search returns relevant results in <50ms | unit | `pnpm test:run src/registry/store.test.ts` | No — Wave 0 |
| R-002 | Owner isolation: non-owner cannot delete | unit | `pnpm test:run src/registry/store.test.ts` | No — Wave 0 |
| R-003 | CLI `publish` validates and stores card | integration | `pnpm test:run src/cli/index.test.ts` | No — Wave 0 |
| R-003 | CLI `discover` returns formatted results | integration | `pnpm test:run src/cli/index.test.ts` | No — Wave 0 |
| R-004 | Gateway health check responds 200 | integration | `pnpm test:run src/gateway/server.test.ts` | No — Wave 0 |
| R-004 | Gateway handles timeout and returns error | integration | `pnpm test:run src/gateway/server.test.ts` | No — Wave 0 |
| R-005 | Escrow hold deducts balance atomically | unit | `pnpm test:run src/credit/ledger.test.ts` | No — Wave 0 |
| R-005 | Double-spend prevented by insufficient balance check | unit | `pnpm test:run src/credit/ledger.test.ts` | No — Wave 0 |
| R-005 | Settlement transfers credits to owner | unit | `pnpm test:run src/credit/ledger.test.ts` | No — Wave 0 |
| R-006 | End-to-end: Agent A request → Agent B execute → result returns | e2e | `pnpm test:run src/skills/integration.test.ts` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/registry/store.test.ts` — covers R-002 registry CRUD and FTS
- [ ] `src/credit/ledger.test.ts` — covers R-005 ledger, escrow, settlement
- [ ] `src/gateway/server.test.ts` — covers R-004 health, timeout, routing
- [ ] `src/cli/index.test.ts` — covers R-003 CLI wiring (can use `vitest` with process mock)
- [ ] `src/skills/integration.test.ts` — covers R-006 end-to-end scenario

---

## Sources

### Primary (HIGH confidence)

- SQLite official FTS5 docs — https://www.sqlite.org/fts5.html — virtual table creation, triggers, MATCH, BM25 ranking
- Fastify TypeScript docs — https://fastify.dev/docs/latest/Reference/TypeScript/ — typed route generics, plugin pattern
- better-sqlite3 GitHub — https://github.com/WiseLibs/better-sqlite3 — WAL mode, prepared statements, transaction API
- Project codebase — `src/types/index.ts`, `src/cli/index.ts`, `src/types/index.test.ts` — existing foundation

### Secondary (MEDIUM confidence)

- WebSearch for better-sqlite3 ESM pattern — verified: `import Database from 'better-sqlite3'` works with `"type": "module"`
- WebSearch for Commander async — verified: `.parseAsync()` is the correct pattern for async actions
- Double-entry bookkeeping pattern — https://dev.to/rwillians/double-entry-bookkeeping-101-for-software-engineers-bk4 — schema design principles

### Tertiary (LOW confidence)

- OpenClaw SOUL.md structure — not publicly documented; inferred from project description only

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All packages already installed; versions confirmed from `package.json`
- Architecture: HIGH — Based on existing code structure and ARCHITECTURE.md; patterns verified against official docs
- Registry/FTS5: HIGH — Official SQLite FTS5 docs are authoritative and comprehensive
- Fastify patterns: HIGH — Official Fastify TypeScript docs confirmed
- Credit escrow: MEDIUM — Double-entry pattern principles verified; exact SQL schema is a design choice not researched from authoritative source
- OpenClaw integration: LOW — Internal project; no external docs to reference

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable ecosystem; Zod/Fastify/better-sqlite3 APIs unlikely to change)
