# Phase 3: UX Layer - Research

**Researched:** 2026-03-15
**Domain:** React SPA auth, Fastify auth middleware, SQLite request history, SPA routing
**Confidence:** HIGH

## Summary

Phase 3 extends the existing Hub SPA with owner-facing authenticated features. The Hub is already a React 18 + Tailwind 3 + Vite 6 SPA with a 30s polling pattern in `useCards()`. The backend is a Fastify registry server at port 7701 that already serves the hub as a static build at `/hub/`. All new frontend pages plug into the same SPA under new routes; all new backend endpoints plug into the same Fastify instance.

The key design insight from CONTEXT.md is that authentication is intentionally minimal: the API key IS the identity. No OAuth, no sessions, no JWTs. The Hub SPA stores the API key in `localStorage`, sends it as a `Bearer` token, and the registry server validates it against the owner's token stored in `config.json`. The existing `auth.ts` gateway plugin (token set validation) is the canonical pattern to replicate.

The largest implementation gap is request history: the gateway currently tracks no request log table. The gateway does have all the data needed (escrow records, card lookups, latency via the `startMs` timer, success/fail outcome via `settleEscrow`/`releaseEscrow`), but no `request_log` table exists in either SQLite database. The planner must include creating this table and writing to it in the gateway's `/rpc` handler as a Wave 0 or early task.

**Primary recommendation:** Add a `request_log` table to the registry database (not the credit database, since the registry server reads from it for `GET /requests`). Wire gateway to INSERT a row after each settle/release. Add auth middleware to the registry server for owner-only routes using the same hook pattern as the gateway. Build Hub pages as tab-based views within the existing single-page App.tsx using client-side tab state (no router needed given the small number of tabs).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Owner dashboard scope:**
- "My Agent" tab in the existing Hub — visible only when authenticated
- Read-only visualization of CLI-managed state: published cards, request history, credit balance, reputation stats
- Quick actions: publish/unpublish cards, edit pricing from the dashboard (requires write endpoints)
- Essential metrics per capability: request count (24h/7d/30d), success rate, avg latency, credit earned, online status
- No rich analytics (timeline charts, per-requester breakdown) — keep it minimal for Phase 3

**Authentication flow:**
- API key from CLI: `agentbnb init` generates a local API key stored in `~/.agentbnb/config.json`
- Dashboard login: single input field to paste the API key. No OAuth, no magic links, no passwords
- Public Hub browsing requires zero auth — only dashboard actions require the API key
- Backend validates API key on auth-protected endpoints (GET /me, GET /requests, POST /cards/:id/toggle, PATCH /cards/:id)

**One-click sharing UX:**
- `/hub/share` page: detects a running `agentbnb serve` on localhost:7701
- If local server found: pulls draft card (from auto-detect in Phase 2.1), shows editable preview (name, description, pricing)
- Owner edits fields and clicks "Publish" → published to local SQLite registry
- If no local server detected: show "Run `agentbnb serve` first" with copy-paste command block
- Publish to local registry only — remote discovery happens via Phase 2.3's `--registry` mechanism

**Notification and monitoring:**
- `/hub/status` page (or tab): credit balance, last 10 requests, agent online/offline status
- Polling every 30s (same pattern as Hub card polling)
- No Web Push notifications in Phase 3 — defer to future phase
- Events to surface: request received, execution complete (success/fail), credit low (< 10 credits)
- Inline red badges for critical alerts (credit low, execution failures) — no popups or sounds
- New auth-protected `GET /requests` endpoint: returns last N requests with status, latency, credit amount

**Backend additions:**
- Auth-protected endpoints on the registry server:
  - `GET /me` — returns owner identity (validates API key)
  - `GET /requests` — last N requests with status, latency, credit
  - `POST /cards/:id/toggle-online` — toggle availability
  - `PATCH /cards/:id` — update pricing, description
- API key validation middleware on protected routes
- Existing public endpoints (GET /cards, GET /health) remain unauthenticated

**Visual pipeline builder:** SKIP — target users are developers, CLI is sufficient

**Mobile:** Responsive web design for all Hub pages — no native app. Web Push deferred.

### Claude's Discretion
- State management approach (React context, zustand, or hooks-only)
- API key generation algorithm (UUID v4, crypto.randomBytes, etc.)
- Request history storage (extend existing SQLite tables or new table)
- Exact responsive breakpoints and mobile layout
- Error states for auth failures and network issues

### Deferred Ideas (OUT OF SCOPE)
- Web Push notifications — future phase after basic monitoring works
- Rich analytics (timeline charts, per-requester breakdown) — future phase
- User accounts / registration — not needed while API key auth is sufficient
- Remote publish (push card to remote registry) — requires write API on remote
- Visual pipeline builder — skipped permanently for developer audience
</user_constraints>

## Standard Stack

### Core (all already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI framework | Already in hub/ |
| Tailwind CSS | 3.4.17 | Styling | Already in hub/ |
| Vite | 6.0.7 | Build + dev server | Already in hub/ |
| Fastify | existing | Registry server | Already handles /cards, /health, /hub static |
| better-sqlite3 | existing | SQLite backend | Already in use for registry + credit |
| lucide-react | 0.469.0 | Icons | Already in hub/ |
| Vitest | 3.0.4 | Tests | Already configured in hub/ and src/ |
| @testing-library/react | 16.1.0 | Component tests | Already in hub/ devDeps |

### New Additions Needed
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `crypto.randomBytes` (Node built-in) | N/A | API key generation | No new dep; 32-byte hex is cryptographically sound |
| None for routing | N/A | Tab-based nav via state | Three tabs is insufficient to need react-router |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tab state in App.tsx | react-router-dom | Router adds bundle + config for 3 tabs — overkill |
| localStorage for API key | sessionStorage | sessionStorage clears on tab close — worse UX for dev workflow |
| New `request_log` table | Re-use `credit_escrow` | Escrow doesn't capture card name, requester identity per request cleanly |

**Installation:** No new dependencies required for hub or backend.

## Architecture Patterns

### Recommended Project Structure (additions)

```
hub/src/
├── hooks/
│   ├── useCards.ts          # existing — public card polling
│   ├── useAuth.ts           # NEW — localStorage key, login/logout
│   ├── useOwnerCards.ts     # NEW — auth-protected GET /me + owned cards
│   └── useRequests.ts       # NEW — auth-protected GET /requests, 30s poll
├── components/
│   ├── [existing 10 components]
│   ├── AuthGate.tsx         # NEW — wraps owner-only UI, shows login form if no key
│   ├── LoginForm.tsx        # NEW — single API key input + paste button
│   ├── OwnerDashboard.tsx   # NEW — "My Agent" tab content
│   ├── SharePage.tsx        # NEW — /hub/share tab content
│   └── RequestHistory.tsx   # NEW — last 10 requests table
└── App.tsx                  # MODIFIED — add tab nav + conditional tab rendering

src/
├── registry/
│   ├── server.ts            # MODIFIED — add auth middleware + 4 new endpoints
│   └── request-log.ts       # NEW — insertRequestLog(), getRequestLog() queries
└── cli/
    └── config.ts            # MODIFIED — add api_key field to AgentBnBConfig
```

### Pattern 1: Tab-Based Navigation (no router)

**What:** App.tsx holds a `activeTab` state (`'browse' | 'share' | 'status'`). Each tab renders its component. No URL routing — keep it simple.

**When to use:** When page count is small (3) and URL-based navigation is not required by users.

**Example:**
```tsx
// Source: existing App.tsx pattern + extension
type Tab = 'browse' | 'share' | 'status';
const [activeTab, setActiveTab] = useState<Tab>('browse');

// Tab nav
<nav className="flex gap-4 border-b border-slate-700 mb-6">
  {(['browse', 'share', 'status'] as Tab[]).map((tab) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={activeTab === tab ? 'border-b-2 border-emerald-400 text-emerald-400' : 'text-slate-400'}
    >
      {tab === 'browse' ? 'Discover' : tab === 'share' ? 'Share' : 'My Agent'}
    </button>
  ))}
</nav>

{activeTab === 'browse' && <BrowseTab />}
{activeTab === 'share' && <ShareTab />}
{activeTab === 'status' && <AuthGate><OwnerDashboard /></AuthGate>}
```

### Pattern 2: useAuth Hook — localStorage-Backed API Key

**What:** A simple custom hook that reads/writes the API key from `localStorage`. No React context needed — hooks-only is sufficient for 3 tabs.

**When to use:** Single-user local tool where context sharing across many components is not needed.

**Example:**
```tsx
// hub/src/hooks/useAuth.ts
const STORAGE_KEY = 'agentbnb_api_key';

export function useAuth() {
  const [apiKey, setApiKeyState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY)
  );

  const login = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKeyState(key);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKeyState(null);
  }, []);

  return { apiKey, login, logout, isAuthenticated: apiKey !== null };
}
```

### Pattern 3: Auth-Protected Fastify Routes

**What:** Add an `onRequest` hook scoped to owner-only routes. The existing gateway pattern (lines 54–76 of `src/gateway/server.ts`) is the established pattern.

**Key difference from gateway:** Registry server's auth validates the API key against the owner's config, not a token set. The API key stored in config IS the bearer token.

**Example:**
```typescript
// src/registry/server.ts — scoped auth hook for owner routes
// Register protected routes in a scoped plugin (fastify-plugin NOT used — we want scoping)
server.register(async (ownerRoutes) => {
  // Auth hook applies only to routes in this scope
  ownerRoutes.addHook('onRequest', async (request, reply) => {
    const auth = request.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token || token !== ownerApiKey) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  ownerRoutes.get('/me', async () => ({ owner: ownerName }));
  ownerRoutes.get('/requests', async (req) => { /* ... */ });
  ownerRoutes.post('/cards/:id/toggle-online', async (req, reply) => { /* ... */ });
  ownerRoutes.patch('/cards/:id', async (req, reply) => { /* ... */ });
});
```

### Pattern 4: Request Log — New SQLite Table

**What:** A `request_log` table in the **registry** database (not credit db) so the registry server can JOIN-free query it.

**When to use:** The gateway must INSERT after settle/release. The registry server queries for `GET /requests`.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS request_log (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  requester TEXT NOT NULL,
  status TEXT NOT NULL,      -- 'success' | 'failure' | 'timeout'
  latency_ms INTEGER,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log(created_at DESC);
```

**Why in registry db:** The registry server (`createRegistryServer`) owns the `/requests` endpoint. It already holds `registryDb`. Passing a second database reference (creditDb) into the registry server creates coupling. Logging to registryDb keeps the server self-contained.

**Gateway write pattern:**
```typescript
// After settleEscrow() succeeds:
insertRequestLog(registryDb, {
  id: randomUUID(),
  card_id: cardId,
  card_name: card.name,
  requester,
  status: 'success',
  latency_ms: Date.now() - startMs,
  credits_charged: creditsNeeded,
  created_at: new Date().toISOString(),
});
```

### Pattern 5: useRequests Hook — 30s Polling (mirrors useCards)

**What:** Clone of `useCards()` pattern for auth-protected data.

**Example:**
```tsx
// hub/src/hooks/useRequests.ts
export function useRequests(apiKey: string | null) {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    if (!apiKey) return;
    try {
      const res = await fetch('/requests?limit=10', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401) { setError('Invalid API key'); return; }
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as { items: RequestRecord[] };
      setRequests(data.items);
      setError(null);
    } catch (err) {
      setError('Monitoring unavailable');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { void fetchRequests(); }, [fetchRequests]);
  useEffect(() => {
    const t = setInterval(() => void fetchRequests(), 30_000);
    return () => clearInterval(t);
  }, [fetchRequests]);

  return { requests, loading, error };
}
```

### Pattern 6: Share Page — Local Server Detection

**What:** The share page probes `GET /health` on localhost:7701. This is the same pattern as Phase 2.1's `isPortOpen()`, but from the browser (not Node.js).

**From browser:** Use `fetch` with a short timeout. Browser will succeed on CORS-enabled `/health`; fail fast on `net::ERR_CONNECTION_REFUSED`.

```tsx
// hub/src/components/SharePage.tsx
async function detectLocalServer(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://localhost:7701/health', { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
```

**Note:** The Vite dev proxy (`/health` → `http://localhost:7701`) already handles this in dev. In production, the hub is served by the same registry server at 7701, so relative paths work. The share page should use relative paths (`/health`, `/cards`) not absolute `http://localhost:7701` in production.

### Anti-Patterns to Avoid

- **Zustand or React Context for API key:** Three tabs sharing one piece of state doesn't justify a state manager. Pass `apiKey` as a prop from App.tsx or use the `useAuth()` hook directly in each tab.
- **Registering auth hook on the root Fastify instance:** This would break the public `/cards` and `/health` endpoints. Use scoped plugin registration (without `fastify-plugin`) so the hook only applies to owner routes.
- **Storing request log in credit database:** The registry server doesn't receive the credit db instance — adding it creates coupling and risks the WAL writer contention the existing architecture avoids (decision 2026-03-14: "Registry server shares gateway's Database instance — single WAL writer").
- **Using `fetch('http://localhost:7701/...')` in the hub SPA:** This causes CORS issues in production where the hub IS served from 7701. Use relative URLs (`/health`, `/cards`, `/me`, `/requests`) — the Vite dev proxy forwards them.
- **Generating API key as a simple UUID:** `randomUUID()` is fine — UUID v4 has 122 bits of entropy, which is sufficient for a local single-user tool. `crypto.randomBytes(32).toString('hex')` is also acceptable if stronger entropy is desired.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token auth on Fastify routes | Custom middleware chain | Fastify scoped `addHook('onRequest', ...)` | Already used in gateway; established pattern |
| Responsive CSS grid | Custom breakpoint CSS | Tailwind `sm:`, `md:` prefixes | Already using Tailwind everywhere |
| Credit balance queries | New SQL wrappers | `getBalance(db, owner)` from `src/credit/ledger.ts` | Function already exists |
| Owner card listing | New query | `listCards(db, owner)` from `src/registry/store.ts` | Function already exists |
| Card update | Custom SQL | `updateCard(db, id, owner, updates)` from `src/registry/store.ts` | Function already exists with owner validation |
| 30s polling loop | `setInterval` recreation per component | Mirror `useCards()` hook pattern exactly | Already battle-tested in Phase 2.2 |

**Key insight:** Roughly 80% of the needed functionality already exists in the codebase. The work is wiring existing pieces together (auth hook, existing queries, hook pattern), creating the missing `request_log` table, and building the Hub UI pages.

## Common Pitfalls

### Pitfall 1: CORS on Auth-Protected Endpoints

**What goes wrong:** Browser `fetch` with `Authorization` header triggers CORS preflight. If the registry server doesn't respond correctly to `OPTIONS /me`, the browser blocks the request.

**Why it happens:** The existing `@fastify/cors` is registered with `origin: true` (all origins). This covers `GET /cards` and `GET /health`. But the new `PATCH /cards/:id` and `POST /cards/:id/toggle-online` methods may not be included in `allowedHeaders` or `methods`.

**How to avoid:** Ensure `@fastify/cors` config includes `methods: ['GET', 'POST', 'PATCH', 'OPTIONS']` and `allowedHeaders: ['Content-Type', 'Authorization']`. Verify this in the existing CORS registration before adding endpoints.

**Warning signs:** Browser console shows `CORS policy: request header 'authorization' is not allowed`.

### Pitfall 2: Fastify Plugin Encapsulation — Auth Scope Leaks

**What goes wrong:** If the owner auth `addHook` is accidentally registered on the root Fastify instance, `GET /cards` starts returning 401.

**Why it happens:** Fastify's plugin encapsulation only applies if you use `async` plugin functions without `fastify-plugin`. The gateway auth (lines 54–76) is registered directly on root — that's intentional there (all routes need auth). For the registry, only owner routes need auth.

**How to avoid:** Wrap owner routes in `server.register(async (ownerScope) => { ownerScope.addHook(...); ownerScope.get('/me', ...) })` — no `fastify-plugin` import. The hook stays scoped to `ownerScope`.

**Warning signs:** Existing `/cards` tests start failing with 401 after adding auth.

### Pitfall 3: Request Log DB Choice

**What goes wrong:** Writing request logs to the credit database (where escrow data lives) and then trying to read them from the registry server, which only has `registryDb`.

**Why it happens:** The credit database holds escrow records which conceptually map to requests. It's tempting to query escrow records for `GET /requests`. But `createRegistryServer()` only receives `registryDb` (established by the single WAL writer decision).

**How to avoid:** Create `request_log` table in `registryDb`. The gateway already receives both `registryDb` and `creditDb` — it can write to either. Write to `registryDb` so the registry server can read it without a new dependency.

**Warning signs:** `GET /requests` query runs against a table that doesn't exist in registryDb.

### Pitfall 4: Vite Dev Proxy Missing New Endpoints

**What goes wrong:** Hub SPA dev (`pnpm dev` in hub/) uses the Vite proxy config to forward API calls to localhost:7701. Currently only `/cards` and `/health` are proxied. New endpoints (`/me`, `/requests`) will 404 in dev.

**Why it happens:** `vite.config.ts` has `server.proxy` listing only the paths known at Phase 2.2.

**How to avoid:** Update `hub/vite.config.ts` proxy to add `/me`, `/requests`, `/cards` (already there, covers `PATCH /cards/:id` since it matches the prefix).

**Warning signs:** `fetch('/me')` returns Vite's dev server 404 page instead of a JSON response during local dev.

### Pitfall 5: toggleOnline Ignores Owner Validation

**What goes wrong:** `POST /cards/:id/toggle-online` reads the card, flips `availability.online`, and writes it back without checking that the authenticated owner owns this card.

**Why it happens:** Auth middleware confirms the request is authenticated but doesn't confirm card ownership — a different owner's API key could toggle another owner's card.

**How to avoid:** Use the existing `updateCard(db, id, owner, updates)` function — it already enforces `FORBIDDEN` if `existing.owner !== owner`. Extract `owner` from the validated API key's associated config (the `GET /me` pattern).

**Warning signs:** One agent can toggle another agent's card online/offline.

### Pitfall 6: API Key Not Yet in config.json

**What goes wrong:** `agentbnb init` doesn't currently generate an `api_key` field. `AgentBnBConfig` interface has no `api_key` field. The registry server can't validate the key because it's not stored anywhere.

**Why it happens:** API key auth is new in Phase 3 — it doesn't exist in Phase 0–2 CLI setup.

**How to avoid:** Wave 0 task: add `api_key?: string` to `AgentBnBConfig`, update `agentbnb init` to generate a key using `crypto.randomBytes(32).toString('hex')` and store it. Existing configs without `api_key` should regenerate on next `agentbnb init`.

**Warning signs:** `GET /me` returns 401 even with the correct config path.

## Code Examples

### GET /me Endpoint
```typescript
// src/registry/server.ts — inside scoped owner plugin
ownerRoutes.get('/me', async (_request, reply) => {
  // ownerApiKey and ownerName come from config passed to createRegistryServer()
  return reply.send({ owner: ownerName, api_key_prefix: ownerApiKey.slice(0, 8) + '...' });
});
```

### GET /requests Endpoint
```typescript
// src/registry/server.ts — inside scoped owner plugin
ownerRoutes.get('/requests', async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 10;
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 10 : rawLimit, 100);

  const rows = db.prepare(
    'SELECT id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at FROM request_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit);

  return reply.send({ items: rows, limit });
});
```

### PATCH /cards/:id Endpoint
```typescript
// src/registry/server.ts — inside scoped owner plugin
ownerRoutes.patch('/cards/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const updates = request.body as { description?: string; pricing?: { credits_per_call: number } };

  try {
    updateCard(db, id, ownerName, updates);
    return reply.send({ ok: true });
  } catch (err) {
    if (err instanceof AgentBnBError && err.code === 'FORBIDDEN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (err instanceof AgentBnBError && err.code === 'NOT_FOUND') {
      return reply.status(404).send({ error: 'Not found' });
    }
    throw err;
  }
});
```

### insertRequestLog() in gateway
```typescript
// src/registry/request-log.ts
export interface RequestLogEntry {
  id: string;
  card_id: string;
  card_name: string;
  requester: string;
  status: 'success' | 'failure' | 'timeout';
  latency_ms: number;
  credits_charged: number;
  created_at: string;
}

export function createRequestLogTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_log (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      card_name TEXT NOT NULL,
      requester TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      credits_charged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log(created_at DESC);
  `);
}

export function insertRequestLog(db: Database.Database, entry: RequestLogEntry): void {
  db.prepare(
    'INSERT INTO request_log (id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(entry.id, entry.card_id, entry.card_name, entry.requester, entry.status, entry.latency_ms, entry.credits_charged, entry.created_at);
}
```

### AuthGate Component
```tsx
// hub/src/components/AuthGate.tsx
import { useAuth } from '../hooks/useAuth.js';
import LoginForm from './LoginForm.js';

interface Props { children: React.ReactNode }

export default function AuthGate({ children }: Props) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <LoginForm />;
  return <>{children}</>;
}
```

### Credit Low Badge
```tsx
// hub/src/components/OwnerDashboard.tsx — inline badge pattern
{balance < 10 && (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-rose-900/50 text-rose-400 border border-rose-700">
    Low credits — {balance} remaining
  </span>
)}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| React Router for SPA | Tab state via useState | Phase 2.2 established no-router pattern | No react-router needed for 3 tabs |
| Global auth state (Context) | Hooks-only localStorage | Design decision in CONTEXT.md | Simpler, no Context provider boilerplate |
| Cookie-based sessions | API key in localStorage + Bearer header | Design decision in CONTEXT.md | Stateless server, no session store |

**No deprecated patterns detected** for this phase's scope.

## Open Questions

1. **Does `agentbnb serve` pass the API key to `createRegistryServer()`?**
   - What we know: `createRegistryServer()` currently takes only `{ registryDb, silent }`. The config is loaded by the CLI `serve` command.
   - What's unclear: The owner API key and owner name need to be passed into the registry server to validate auth and respond to `/me`.
   - Recommendation: Update `RegistryServerOptions` to add `ownerName?: string` and `ownerApiKey?: string`. When both are provided, register the scoped owner routes. When absent (no config found), owner routes return 503.

2. **Should request_log table be created in `openDatabase()` or lazily?**
   - What we know: `openDatabase()` in `store.ts` runs schema migrations at open time. This is the established pattern.
   - What's unclear: Adding request_log to `openDatabase()` means all existing tests that use `openDatabase(':memory:')` will now have the table — no breaking change, just a schema addition.
   - Recommendation: Add `CREATE TABLE IF NOT EXISTS request_log` to `openDatabase()` migration block. This is the safest path — backward compatible, no new function needed.

3. **How does the Share page get the draft card to show?**
   - What we know: Phase 2.1 built `buildDraftCard()` which generates a card from detected APIs. The draft lives in memory during `agentbnb init` — it's not persisted to disk between sessions.
   - What's unclear: The share page UI needs a draft card to display for editing. If the server is running, it could expose a `GET /draft` endpoint, or the UI could call `GET /cards?owner=<owner>` to fetch already-published cards.
   - Recommendation: Keep it simple — the share page calls `GET /cards?owner=<owner>` (with auth) to show existing cards as editable. For first-time publish, show an empty form pre-filled with sensible defaults. A `GET /draft` endpoint adds complexity for marginal benefit.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.0.4 |
| Config file (backend) | `vitest.config.ts` (root) — `test/` and `src/**/*.test.ts` |
| Config file (hub) | `hub/vite.config.ts` — `/// <reference types="vitest" />`, environment: jsdom |
| Quick run command (backend) | `pnpm test:run` |
| Quick run command (hub) | `cd hub && pnpm test` |
| Full suite command | `pnpm test:run && cd hub && pnpm test` |

### Phase Requirements → Test Map

| ID | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| UX-01 | `agentbnb init` adds `api_key` to config.json | unit | `pnpm test:run -- src/cli/init.test.ts` | Wave 0 |
| UX-02 | `insertRequestLog()` inserts row; `getRequestLog()` returns N newest | unit | `pnpm test:run -- src/registry/request-log.test.ts` | Wave 0 |
| UX-03 | Gateway inserts request_log entry after settle/release | unit (gateway mock) | `pnpm test:run -- src/gateway/server.test.ts` | Extend existing |
| UX-04 | `GET /me` returns 200 with valid key, 401 with invalid key | unit | `pnpm test:run -- src/registry/server.test.ts` | Extend existing |
| UX-05 | `GET /requests` returns last 10 rows newest-first with valid key | unit | `pnpm test:run -- src/registry/server.test.ts` | Extend existing |
| UX-06 | `POST /cards/:id/toggle-online` toggles availability; returns 403 for wrong owner | unit | `pnpm test:run -- src/registry/server.test.ts` | Extend existing |
| UX-07 | `PATCH /cards/:id` updates pricing and description; returns 403 for wrong owner | unit | `pnpm test:run -- src/registry/server.test.ts` | Extend existing |
| UX-08 | `GET /cards` still returns 200 without auth after owner routes added | unit (regression) | `pnpm test:run -- src/registry/server.test.ts` | Extend existing |
| UX-09 | `useAuth()` reads/writes localStorage; login sets key; logout clears key | unit | `cd hub && pnpm test -- useAuth` | Wave 0 |
| UX-10 | `AuthGate` renders children when authenticated, LoginForm when not | component | `cd hub && pnpm test -- AuthGate` | Wave 0 |
| UX-11 | `useRequests()` sends Authorization header; handles 401 with error state | unit (fetch mock) | `cd hub && pnpm test -- useRequests` | Wave 0 |
| UX-12 | `OwnerDashboard` shows low-credit badge when balance < 10 | component | `cd hub && pnpm test -- OwnerDashboard` | Wave 0 |
| UX-13 | `SharePage` shows command block when local server unreachable | component (fetch mock) | `cd hub && pnpm test -- SharePage` | Wave 0 |
| UX-14 | Hub `vite.config.ts` proxy includes `/me` and `/requests` | manual | N/A — check config | N/A (config edit) |

### Sampling Rate
- **Per task commit:** `pnpm test:run` (backend) or `cd hub && pnpm test` (hub) depending on what changed
- **Per wave merge:** `pnpm test:run && cd hub && pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/registry/request-log.ts` and `src/registry/request-log.test.ts` — covers UX-02
- [ ] `hub/src/hooks/useAuth.ts` and test — covers UX-09
- [ ] `hub/src/components/AuthGate.tsx` and test — covers UX-10
- [ ] `hub/src/hooks/useRequests.ts` and test — covers UX-11
- [ ] `hub/src/components/OwnerDashboard.tsx` and test — covers UX-12
- [ ] `hub/src/components/SharePage.tsx` and test — covers UX-13
- [ ] Add `api_key` to `AgentBnBConfig` in `src/cli/config.ts` — prerequisite for UX-01 and UX-04

## Sources

### Primary (HIGH confidence)
- Codebase read: `hub/src/hooks/useCards.ts` — polling pattern confirmed, 30s interval with `useRef` guard
- Codebase read: `src/registry/server.ts` — Fastify structure, CORS registration, `stripInternal`, static serving
- Codebase read: `src/gateway/server.ts` — auth hook pattern (lines 54–76), request lifecycle, settlement logic
- Codebase read: `src/cli/config.ts` — `AgentBnBConfig` interface, `loadConfig()`, `saveConfig()`
- Codebase read: `src/credit/ledger.ts` — `getBalance()`, `credit_balances` table schema
- Codebase read: `src/credit/escrow.ts` — `settleEscrow()`, `releaseEscrow()` settlement points
- Codebase read: `src/registry/store.ts` — `openDatabase()` migration pattern, `updateCard()`, `listCards()`
- Codebase read: `hub/package.json` — all installed deps confirmed
- Codebase read: `hub/vite.config.ts` — dev proxy config, base path `/hub/`
- Codebase read: `.planning/config.json` — `nyquist_validation: true` confirmed

### Secondary (MEDIUM confidence)
- Fastify scoped plugin encapsulation: documented behavior confirmed by existing decision log entry 2026-03-13: "Auth hook added to root Fastify instance (not plugin) — plugin scope encapsulation prevents hooks from applying to parent routes"
- Tailwind responsive prefixes (`sm:`, `md:`): established project pattern, same Tailwind version in use

### Tertiary (LOW confidence)
- None — all findings sourced from project codebase or established Fastify/React patterns already in use

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — read directly from package.json files; no new dependencies needed
- Architecture: HIGH — patterns derived from existing codebase, not from external research
- Pitfalls: HIGH — derived from existing decision log entries and code structure analysis
- Request log design: MEDIUM — recommended approach (registry db) is reasoned but not yet implemented; open question about `openDatabase()` vs. separate init

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable stack — React 18, Tailwind 3, Fastify, SQLite; no fast-moving parts)
