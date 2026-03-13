# Phase 2: Cold Start — Research

**Researched:** 2026-03-14
**Domain:** Web-based REST API registry, reputation scoring, marketplace browse/filter, Fastify public API patterns
**Confidence:** HIGH (core stack); HIGH (architecture); MEDIUM (reputation scoring algorithm)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| R-013 | Web-based registry (searchable) — public HTTP REST API that exposes the SQLite registry over the network so external agent owners can search and discover capabilities via browser or HTTP client | Existing Fastify server (gateway/server.ts) plus registry/matcher.ts provide all the building blocks; need a second Fastify instance or plugin route group dedicated to the public read API with CORS enabled |
| R-014 | Reputation system (success rate, response time) — tracked per card, updated after each request execution, surfaced via the registry API | metadata.success_rate and metadata.avg_latency_ms fields already exist on CapabilityCard; need a write path to update them after settlement and an EWA (exponentially weighted average) update formula |
| R-015 | Capability Card marketplace (browse and filter) — paginated list endpoint with multi-facet filtering (level, online, tags, api, min_success_rate, max_latency_ms, sort) | filterCards() and searchCards() in registry/matcher.ts cover most filters; need pagination (cursor or limit/offset), tag filtering, sort-by-reputation, and a GET /cards endpoint |
</phase_requirements>

---

## Summary

Phase 2 turns AgentBnB's local SQLite registry into a shared, searchable web service that 10+ agent owners can query. The Phase 1 foundation is solid: 107 tests passing, Fastify already in use for the gateway, FTS5 full-text search working, and the CapabilityCard schema has `metadata.success_rate` and `metadata.avg_latency_ms` fields already defined.

The three deliverables map cleanly onto the existing stack. The web registry is a new Fastify route group (or separate server instance) with `@fastify/cors` enabled — it reuses the existing SQLite `registry.db` and exposes read-only GET endpoints. No new database needed. The reputation system is a write path: after each successful/failed `capability.execute` RPC call in the existing gateway, update the card's `success_rate` and `avg_latency_ms` using exponentially weighted averages (EWA). The marketplace is the GET `/cards` endpoint with pagination and facet parameters — the `filterCards()` and `searchCards()` functions already exist and need only minor additions (cursor pagination, sort, tag filter).

The main architectural decision is whether the web registry runs as a **separate Fastify instance** (on a different port, e.g. 7701) or as an additional **route plugin** registered on the existing gateway server. A separate instance is cleanly isolated: the existing gateway stays authenticated, the new registry API is public/read-only. This is the recommended approach.

**Primary recommendation:** Add a `createRegistryServer()` function in `src/registry/server.ts` (new file) that creates a public read-only Fastify instance with CORS. Extend `gateway/server.ts` to record reputation metrics after each settlement. Wire both into the CLI `agentbnb serve` command.

---

## Standard Stack

### Core (existing — no new installs for most)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | ^5.1.0 | Public registry HTTP server | Already in use for gateway; add second instance for public API |
| better-sqlite3 | ^11.6.0 | Registry and credit SQLite storage | Already in use; share the same registry.db |
| zod | ^3.24.0 | Schema validation | Already in use; extend for query param validation |
| commander | ^12.1.0 | CLI integration | Already in use; `serve` command gains `--registry-port` flag |

### New Dependencies

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @fastify/cors | ^11.2.0 | CORS headers for public browser-accessible registry API | Official Fastify ecosystem plugin; 11.2.0 released Dec 2024 with route-level CORS; required for any web client to query the registry |

**Installation:**
```bash
pnpm add @fastify/cors
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @fastify/cors | Manual CORS headers in hooks | @fastify/cors handles preflight, wildcard, credentials, route-level config correctly; hand-rolling misses edge cases |
| Separate registry server | Route plugin on existing gateway | Plugin approach makes it harder to keep public routes unauthenticated while keeping RPC authenticated; separate instance is cleaner |
| EWA for reputation | Simple rolling average | EWA weights recent calls more heavily and converges quickly with small N; no extra storage needed |
| Cursor pagination | Offset pagination | Cursor pagination is stable when cards are inserted between requests; offset pagination can skip or duplicate items; for 10+ owners cursor is overkill but offset is fine given this scale |

---

## Architecture Patterns

### Recommended Project Structure Additions

```
src/
├── registry/
│   ├── card.ts          # Existing: Capability Card schema (unchanged)
│   ├── store.ts         # Existing: SQLite CRUD — add updateReputation()
│   ├── matcher.ts       # Existing: FTS5 search + filter — extend for pagination + sort
│   └── server.ts        # NEW: public read-only Fastify registry server
├── gateway/
│   ├── server.ts        # Existing: extend to record reputation after settle
│   ├── client.ts        # Existing (unchanged)
│   └── auth.ts          # Existing (unchanged)
├── credit/              # Existing (unchanged)
├── cli/
│   └── index.ts         # Existing: add --registry-port to serve command
└── types/
    └── index.ts         # Existing: add ReputationUpdate type
```

### Pattern 1: Public Registry Server with CORS

**What:** A separate read-only Fastify instance with CORS enabled. Exposes GET /cards and GET /cards/:id. No auth required. Shares the registry SQLite database with the gateway.
**When to use:** Any time an external browser or agent wants to browse the marketplace.

```typescript
// src/registry/server.ts
// Source: @fastify/cors npm package, Fastify official docs

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type Database from 'better-sqlite3';
import { listCards, getCard } from './store.js';
import { filterCards, searchCards } from './matcher.js';

export interface RegistryServerOptions {
  port?: number;
  registryDb: Database.Database;
  silent?: boolean;
}

export function createRegistryServer(opts: RegistryServerOptions): FastifyInstance {
  const { registryDb, silent = false } = opts;
  const fastify = Fastify({ logger: !silent });

  // Allow all origins for public registry browsing
  fastify.register(cors, { origin: true });

  // GET /health
  fastify.get('/health', async () => ({ status: 'ok' }));

  // GET /cards — browse with optional filters + search
  fastify.get<{
    Querystring: {
      q?: string;
      level?: string;
      online?: string;
      tag?: string;
      min_success_rate?: string;
      max_latency_ms?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    };
  }>('/cards', async (request) => {
    const { q, level, online, tag, min_success_rate, max_latency_ms, sort, limit, offset } =
      request.query;

    // Parse params (validate inline for simplicity; extract to Zod if growing)
    const parsedLevel = level ? (parseInt(level) as 1 | 2 | 3) : undefined;
    const parsedOnline = online !== undefined ? online === 'true' : undefined;
    const parsedLimit = Math.min(parseInt(limit ?? '20'), 100);
    const parsedOffset = parseInt(offset ?? '0');

    let cards = q
      ? searchCards(registryDb, q, { level: parsedLevel, online: parsedOnline })
      : filterCards(registryDb, { level: parsedLevel, online: parsedOnline });

    // Tag filter (post-filter — same pattern as apis_used in matcher.ts)
    if (tag) {
      cards = cards.filter((c) => c.metadata?.tags?.includes(tag));
    }

    // Reputation filters
    if (min_success_rate) {
      const threshold = parseFloat(min_success_rate);
      cards = cards.filter((c) => (c.metadata?.success_rate ?? 0) >= threshold);
    }
    if (max_latency_ms) {
      const threshold = parseInt(max_latency_ms);
      cards = cards.filter((c) => (c.metadata?.avg_latency_ms ?? Infinity) <= threshold);
    }

    // Sort
    if (sort === 'success_rate') {
      cards = cards.sort((a, b) =>
        (b.metadata?.success_rate ?? 0) - (a.metadata?.success_rate ?? 0)
      );
    } else if (sort === 'latency') {
      cards = cards.sort((a, b) =>
        (a.metadata?.avg_latency_ms ?? Infinity) - (b.metadata?.avg_latency_ms ?? Infinity)
      );
    }

    // Pagination
    const total = cards.length;
    const page = cards.slice(parsedOffset, parsedOffset + parsedLimit);

    return {
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      items: page,
    };
  });

  // GET /cards/:id
  fastify.get<{ Params: { id: string } }>('/cards/:id', async (request, reply) => {
    const card = getCard(registryDb, request.params.id);
    if (!card) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return card;
  });

  return fastify;
}
```

### Pattern 2: EWA Reputation Update After Settlement

**What:** After each successful or failed capability execution in the gateway, update the card's `success_rate` and `avg_latency_ms` using exponentially weighted averages.
**When to use:** In `gateway/server.ts` after `settleEscrow()` (success) and after `releaseEscrow()` (failure).

```typescript
// src/registry/store.ts — add this function

/**
 * Updates a card's reputation metrics using exponentially weighted averages (EWA).
 * Alpha = 0.1 means recent calls have 10% weight; stable after ~20 calls.
 *
 * @param db - Open database instance.
 * @param cardId - UUID of the card to update.
 * @param success - Whether this execution succeeded.
 * @param latencyMs - Observed latency in milliseconds.
 */
export function updateReputation(
  db: Database.Database,
  cardId: string,
  success: boolean,
  latencyMs: number
): void {
  const card = getCard(db, cardId);
  if (!card) return; // Card may have been deleted; skip silently

  const ALPHA = 0.1; // EWA smoothing factor

  const prevSuccessRate = card.metadata?.success_rate ?? (success ? 1.0 : 0.0);
  const prevLatency = card.metadata?.avg_latency_ms ?? latencyMs;

  const newSuccessRate = ALPHA * (success ? 1.0 : 0.0) + (1 - ALPHA) * prevSuccessRate;
  const newLatency = ALPHA * latencyMs + (1 - ALPHA) * prevLatency;

  const now = new Date().toISOString();
  const updated = {
    ...card,
    metadata: {
      ...card.metadata,
      success_rate: Math.round(newSuccessRate * 1000) / 1000, // 3 decimal places
      avg_latency_ms: Math.round(newLatency),
    },
    updated_at: now,
  };

  const stmt = db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?');
  stmt.run(JSON.stringify(updated), now, cardId);
}
```

### Pattern 3: Gateway Reputation Instrumentation

**What:** Capture latency and call outcome in the gateway after each execution, then call `updateReputation()`.
**When to use:** After `settleEscrow()` (success path) and after `releaseEscrow()` (failure/timeout path) in `gateway/server.ts`.

```typescript
// In gateway/server.ts — modification to the /rpc handler
// Start timer before fetch:
const startMs = Date.now();

// Success path — after settleEscrow():
const latencyMs = Date.now() - startMs;
updateReputation(registryDb, cardId, true, latencyMs);

// Failure/timeout path — after releaseEscrow():
const latencyMs = Date.now() - startMs;
updateReputation(registryDb, cardId, false, latencyMs);
```

### Pattern 4: CLI Integration for `serve --registry-port`

**What:** Extend the existing `agentbnb serve` command to also start the public registry server.
**When to use:** Agent owners run one command to start both their gateway (authenticated) and the public registry (open).

```typescript
// In src/cli/index.ts — extend serve command
program
  .command('serve')
  .description('Start the gateway and registry servers')
  .option('--announce', 'Announce on local network via mDNS')
  .option('--port <port>', 'Gateway port', '7700')
  .option('--registry-port <port>', 'Public registry port (0 to disable)', '7701')
  // ...
  .action(async (opts) => {
    const registryPort = parseInt(opts.registryPort);
    if (registryPort > 0) {
      const registryServer = createRegistryServer({ port: registryPort, registryDb, silent: false });
      await registryServer.listen({ port: registryPort, host: '0.0.0.0' });
      console.log(`Registry API: http://0.0.0.0:${registryPort}/cards`);
    }
    // ... existing gateway server start ...
  });
```

### Anti-Patterns to Avoid

- **Exposing the gateway /rpc endpoint without auth:** The existing gateway is token-authenticated and handles credit debit. The new registry server is separate and read-only. Never mix them.
- **Opening the registry SQLite database with WAL in multiple processes:** SQLite WAL supports one writer + multiple readers in the same process, but multiple Node.js processes opening the same file concurrently can cause lock errors. The registry server must run in the same process as the gateway (sharing the `Database` instance), not as a separate process.
- **Initializing success_rate at 0 for new cards:** New cards have no data. A reputation of 0 would incorrectly sort them below failed cards. Initialize to `undefined` (no data) and treat `undefined` as "unrated" in the marketplace UI and API.
- **Not adding CORS to the registry server:** Without CORS, browser-based clients will be blocked by the same-origin policy. The gateway does not need CORS (agent-to-agent, not browser), but the registry server does.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CORS headers | Manual `Access-Control-Allow-*` hooks | `@fastify/cors` | Handles OPTIONS preflight, credentials, wildcard origins, route-level overrides correctly |
| Reputation smoothing | Custom average with stored call count | EWA (exponential weighted average) | EWA requires storing only current value; no call_count column needed; naturally discounts stale data |
| Search + filter | New SQL queries | Extend `filterCards()` + `searchCards()` in matcher.ts | FTS5 BM25 ranking already working; don't duplicate SQL |
| Pagination | Custom cursor implementation | Limit/offset on the in-memory post-filter result | At 10–100 agents, limit/offset is sufficient; cursor is over-engineering for this scale |

**Key insight:** The SQLite registry and Fastify server are already built. Phase 2 is largely plumbing: add a public server, add a write path for reputation, and extend query params.

---

## Common Pitfalls

### Pitfall 1: SQLite WAL Lock with Two Processes

**What goes wrong:** Developer tries to run `agentbnb serve` (gateway process) and a separate `agentbnb registry serve` (registry process) pointing to the same SQLite file. Both processes try to write; lock errors occur.
**Why it happens:** SQLite WAL mode supports multiple readers but only one writer. Two separate Node.js processes = two SQLite writers.
**How to avoid:** Run the gateway and registry servers in the **same process**. Both receive the same `Database` instance passed by reference. The registry server is read-only, so it never writes directly — updates go through `updateReputation()` called from the gateway's settlement path.
**Warning signs:** `SQLITE_BUSY: database is locked` errors in logs.

### Pitfall 2: success_rate=0 for New (Unrated) Cards

**What goes wrong:** Sorting by `success_rate DESC` puts unrated cards at the bottom instead of showing them neutrally.
**Why it happens:** The Zod schema defines `success_rate` as `z.number().min(0).max(1).optional()`. New cards have `undefined`. Post-filter uses `?? 0` fallback.
**How to avoid:** In sort logic, treat `undefined` as a neutral middle value (e.g. 0.5) or sort unrated cards after rated cards separately. Document this behavior clearly in the API.
**Warning signs:** New cards never appear in reputation-sorted results.

### Pitfall 3: CORS Origin Leaking to Gateway

**What goes wrong:** `@fastify/cors` registered on the root Fastify instance also applies to the `/rpc` endpoint, enabling CSRF-style attacks from browsers.
**Why it happens:** Registering a plugin on the root instance applies it globally.
**How to avoid:** The registry server is a **separate Fastify instance** from the gateway. Never register `@fastify/cors` on the gateway server. The separation eliminates this risk.
**Warning signs:** Browser DevTools shows `Access-Control-Allow-Origin: *` on the `/rpc` endpoint.

### Pitfall 4: FTS5 Returning Stale Reputation Data

**What goes wrong:** `searchCards()` returns cards with old `success_rate` values even after `updateReputation()` ran.
**Why it happens:** FTS5 stores name/description/tags in the virtual table. Reputation data is in the `data` JSON blob in `capability_cards`. `updateReputation()` writes directly to `capability_cards.data`, bypassing FTS5 triggers. This is fine — FTS5 triggers only index text fields for search relevance, not JSON metadata.
**How to avoid:** No action needed. Just document that FTS5 search result ranking uses BM25 (text relevance), and post-sort by reputation happens in application code after FTS5 returns results.
**Warning signs:** None — this is expected behavior. Worth documenting.

### Pitfall 5: `/cards` Returns Too Many Cards in One Response

**What goes wrong:** Registry has 500+ cards. `GET /cards` returns all of them, slowing down the browser client.
**Why it happens:** `filterCards()` returns unbounded results. `searchCards()` caps at 50 via `LIMIT 50`.
**How to avoid:** Always paginate in `GET /cards`. Default `limit=20`, max `limit=100`. Apply `slice(offset, offset+limit)` after in-memory post-filter. At Phase 2 scale (10+ owners), this is a non-issue, but build pagination from day one.
**Warning signs:** Response payloads over 100KB for a single page request.

---

## Code Examples

Verified patterns from the existing codebase:

### Extend filterCards() for Tag Filtering

```typescript
// src/registry/matcher.ts — extend SearchFilters
export interface SearchFilters {
  level?: 1 | 2 | 3;
  online?: boolean;
  apis_used?: string[];
  tags?: string[];            // NEW: filter by tag
}

// Add to filterCards() post-filter:
if (filters.tags && filters.tags.length > 0) {
  const requiredTags = filters.tags;
  return results.filter((card) => {
    const cardTags = card.metadata?.tags ?? [];
    return requiredTags.some((t) => cardTags.includes(t));
  });
}
```

### Register @fastify/cors on Registry Server

```typescript
// Source: https://www.npmjs.com/package/@fastify/cors v11.2.0
import cors from '@fastify/cors';

// Allow all origins (public read-only registry)
fastify.register(cors, { origin: true });

// Or restrict to specific origins for production:
// fastify.register(cors, { origin: ['https://agentbnb.io', 'http://localhost:3000'] });
```

### EWA Update Formula

```typescript
// Exponentially weighted average — no call count storage needed
const ALPHA = 0.1;
const newRate = ALPHA * newSample + (1 - ALPHA) * prevRate;

// Bootstrap: first call sets the value directly
const prevRate = card.metadata?.success_rate;
const bootstrapped = prevRate === undefined ? (success ? 1.0 : 0.0) : prevRate;
const newRate = ALPHA * (success ? 1.0 : 0.0) + (1 - ALPHA) * bootstrapped;
```

### Pagination Response Shape

```typescript
// Standard paginated list response shape
interface PaginatedCards {
  total: number;    // total matching cards (before pagination)
  limit: number;    // items per page
  offset: number;   // current offset
  items: CapabilityCard[];
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Simple rolling average (requires stored call count) | EWA (exponentially weighted average) | Adopted widely in distributed systems | No schema migration; just store the current value |
| `fastify-cors` (legacy package) | `@fastify/cors` v11.2.0 (official) | ~2022 | Old package deprecated; official plugin has better TypeScript support and route-level CORS |
| Offset pagination (page number) | Limit/offset with explicit offset integer | Standard for REST APIs | More predictable behavior; direct compatibility with SQLite LIMIT/OFFSET |

**Deprecated/outdated:**
- `fastify-cors` (without `@fastify/` scope): deprecated since 2022. Use `@fastify/cors`.
- Storing `call_count` + `total_success` to compute success_rate: requires a schema migration and the two-column approach can drift under race conditions. EWA requires only the current value.

---

## Open Questions

1. **Shared vs. hosted registry**
   - What we know: Phase 2 says "grow to 10+ active agent owners." Each owner runs their own `agentbnb serve` on their own machine with their own `registry.db`. There is no central server.
   - What's unclear: Does "web-based registry" mean (a) each agent exposes their own public registry endpoint, or (b) there is a shared central registry that all agents publish to? Option (b) requires a hosted server with a different persistence model.
   - Recommendation: Implement option (a) first — each agent exposes a public registry endpoint. This preserves the P2P architecture and requires no infrastructure. Option (b) can be considered in Phase 3 when a "web dashboard" is planned.

2. **Reputation data persistence across restarts**
   - What we know: `updateReputation()` writes to the `capability_cards.data` JSON blob in SQLite. This is durable across restarts.
   - What's unclear: When an agent republishes a card (via `agentbnb publish`), does it overwrite the reputation data?
   - Recommendation: In `insertCard()` and `updateCard()`, preserve existing `metadata.success_rate` and `metadata.avg_latency_ms` if not explicitly provided in the new card JSON. This prevents reputation loss on re-publish.

3. **REQUIREMENTS.md Phase 2 IDs (R-013 to R-015)**
   - What we know: REQUIREMENTS.md currently only defines R-001 through R-008 (Phase 0 and Phase 1). Phase 2 requirements have not been formally written.
   - What's unclear: The phase description in ROADMAP.md describes three deliverables. These should be formalized as R-013, R-014, R-015 before planning begins.
   - Recommendation: The planner should create R-013/R-014/R-015 entries in REQUIREMENTS.md as part of the first plan's Wave 0.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.0 |
| Config file | None — uses package.json vitest defaults |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run && pnpm typecheck` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R-013 | `GET /cards` returns cards with correct shape; `GET /cards/:id` returns specific card; `GET /health` returns ok | unit | `pnpm test:run -- src/registry/server.test.ts` | ❌ Wave 0 |
| R-013 | CORS header present on `/cards` response | unit | `pnpm test:run -- src/registry/server.test.ts` | ❌ Wave 0 |
| R-014 | `updateReputation()` updates success_rate and avg_latency_ms using EWA; first call bootstraps correctly; missing card is no-op | unit | `pnpm test:run -- src/registry/store.test.ts` | Partial (extend existing store.test.ts) |
| R-014 | Gateway records reputation after settlement (success) and release (failure) | integration | `pnpm test:run -- src/gateway/server.test.ts` | Partial (extend existing) |
| R-015 | `GET /cards?level=1&online=true` returns filtered results; `?sort=success_rate` returns sorted results; `?limit=5&offset=5` paginates correctly; `?tag=tts` filters by tag | unit | `pnpm test:run -- src/registry/server.test.ts` | ❌ Wave 0 |
| R-015 | `GET /cards?q=voice` returns FTS5 search results | unit | `pnpm test:run -- src/registry/server.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run && pnpm typecheck`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/registry/server.ts` — new public registry Fastify server
- [ ] `src/registry/server.test.ts` — covers R-013 (GET /cards, GET /cards/:id, CORS) and R-015 (filters, sort, pagination)
- [ ] Extend `src/registry/store.ts` with `updateReputation()` function
- [ ] Extend `src/registry/store.test.ts` with reputation update tests (R-014)
- [ ] Extend `src/gateway/server.ts` with `updateReputation()` calls after settle/release
- [ ] Extend `src/gateway/server.test.ts` with reputation instrumentation tests (R-014)
- [ ] Framework install: `pnpm add @fastify/cors` — if not already installed

---

## Sources

### Primary (HIGH confidence)
- Current codebase: `src/gateway/server.ts`, `src/registry/store.ts`, `src/registry/matcher.ts`, `src/types/index.ts` — confirms existing capabilities and extension points
- [@fastify/cors npm](https://www.npmjs.com/package/@fastify/cors) — v11.2.0 latest; official Fastify ecosystem plugin; CORS configuration confirmed
- [Fastify official docs](https://fastify.dev/) — plugin registration, separate instances, TypeScript patterns
- [Fastify CORS GitHub](https://github.com/fastify/fastify-cors) — confirmed v11.2.0 features including route-level CORS

### Secondary (MEDIUM confidence)
- [AI Agent Performance Metrics — Microsoft Dynamics](https://www.microsoft.com/en-us/dynamics-365/blog/it-professional/2026/02/04/ai-agent-performance-measurement/) — success rate and latency as standard agent metrics
- [How to Design Search Endpoints — OneUptime 2026](https://oneuptime.com/blog/post/2026-02-02-search-endpoints-design/view) — pagination, filtering, faceted search REST API patterns
- [Fastify Pagination Plugin](https://github.com/francisbrito/fastify-pagination) — limit/offset pagination pattern; chose in-memory approach over plugin given post-filter requirement

### Tertiary (LOW confidence)
- EWA alpha=0.1 selection: based on general distributed systems convention (10% weight for recent observations converges in ~20 calls); no authoritative source specific to capability marketplace reputation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — @fastify/cors is official ecosystem, version confirmed; rest of stack is unchanged from Phase 1
- Architecture (separate server instances): HIGH — confirmed pattern from existing gateway codebase; SQLite WAL single-writer constraint documented
- Reputation EWA formula: MEDIUM — standard algorithm, alpha selection is a convention not a requirement
- Pitfalls: HIGH for SQLite WAL and CORS isolation; MEDIUM for success_rate bootstrap edge case

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (30 days — stable domain; verify @fastify/cors version before install)
