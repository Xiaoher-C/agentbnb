# Phase 12: Foundation + Agent Directory - Research

**Researched:** 2026-03-16
**Domain:** React SPA hash-based routing, agent directory backend aggregation, NavBar with credit badge
**Confidence:** HIGH — all findings grounded in direct codebase inspection and project research docs

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NAV-01 | Hub uses hash-based SPA routing for all 7 pages with browser back/forward support | react-router ^7.13.1 createHashRouter; routes wired in main.tsx; install confirmed in STACK.md |
| NAV-02 | Nav bar shows 5 tabs: Discover, Agents, Activity, Docs, My Agent | Replace existing 3-tab TABS array in App.tsx with NavBar component; NavLink from react-router |
| NAV-03 | Nav bar displays credit balance badge (monospace, accent green) for authenticated users | NavCreditBadge component; useAuth apiKey drives authenticated state; /me endpoint already exists |
| NAV-04 | Nav bar shows "Get Started — 50 free credits" CTA button for unauthenticated users | GetStartedCTA component; conditional on apiKey === null from useAuth |
| NAV-05 | My Agent is a dropdown menu: Dashboard / Share / Settings | Dropdown state (useState<boolean>) in NavBar; NavLink to /#/myagent, /#/share sub-routes |
| AGENT-01 | Agent ranking page at /hub/#/agents lists all agents sorted by reputation | AgentList component at route /agents; useAgents hook; GET /api/agents backend route |
| AGENT-02 | Each agent row shows identicon, name, success rate, skill count, credits earned | boring-avatars (already installed); aggregated data from GET /api/agents TS groupBy on listCards() |
| AGENT-03 | Individual agent profile at /hub/#/agents/:owner shows skills grid + recent activity | ProfilePage component at route /agents/:owner; GET /api/agents/:owner backend route |
| AGENT-04 | Backend GET /api/agents returns aggregated agent list from capability_cards | New Fastify public route; listCards(db) + TS aggregation; +/api proxy entry in vite.config.ts |
| AGENT-05 | Backend GET /api/agents/:owner returns agent profile with skills and activity | New Fastify public route; listCards(db, owner) + getRequestLog(db, 10) filtered by owner |

</phase_requirements>

---

## Summary

Phase 12 establishes the SPA routing foundation before any new page can be built and simultaneously delivers the Agent Directory — the most data-intensive new feature in v2.2. The existing Hub is a 3-tab React app using `useState<ActiveTab>` in `App.tsx` with no URL history. This phase replaces that with `react-router ^7.13.1` using `createHashRouter`, which works with the existing Fastify static file mount at `/hub/` without any server configuration changes (hash URLs are transparent to the server).

The agent directory requires two new Fastify routes (`GET /api/agents`, `GET /api/agents/:owner`) and two new frontend pieces (`useAgents` hook, `AgentList` + `ProfilePage` components). All backend data already exists: `listCards(db)` returns all cards, `getRequestLog(db, limit)` returns request history, and `boring-avatars` is already installed for identicons. The critical implementation detail is that `credits_earned` is a computed value derived via `SUM(credits_charged) WHERE status='success'` — it does not exist in any table and must never be added as a stored column.

The key architectural decision is routing strategy. The project research has already resolved this: use `createHashRouter` (not `createBrowserRouter`) because hash mode requires zero Fastify server changes — the `@fastify/static` catch-all for `/hub/*` that serves `index.html` is still required but already exists in the codebase. All existing tab state (`'discover' | 'share' | 'myagent'`) is replaced with router URLs; the `selectedCard` modal overlay pattern is unchanged.

**Primary recommendation:** Install react-router, wire `createHashRouter` in `hub/src/main.tsx`, add `/api` proxy entry to `vite.config.ts`, add two public Fastify routes to `server.ts`, build `useAgents` hook following the established 30s polling pattern from `useCards`, then build `AgentList` + `ProfilePage` + `NavBar` + `GetStartedCTA` components in order.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-router | ^7.13.1 | SPA client-side routing for 7 Hub pages, browser back/forward | v7 is current release; `createHashRouter` needs zero server config; import from `react-router` only (v7 merged react-router-dom) |
| boring-avatars | ^1.11.2 | Agent identicons in AgentList and ProfilePage | Already installed in hub/package.json; used in CardModal.tsx |
| React | ^18.3.1 | Hub SPA framework | Locked; no change |
| Tailwind CSS | ^3.4.17 | All new component styling | Locked; no change |
| lucide-react | ^0.469.0 | Tab icons in NavBar, action icons | Locked; already installed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Native fetch | built-in | `useAgents` hook — calls GET /api/agents | Same pattern as all existing hooks (useCards, useRequests, useAuth) |
| Native setInterval | built-in | Polling in useAgents | Same 30s poll pattern already in useCards |

### Not Adding in This Phase

| Excluded | Reason |
|----------|--------|
| recharts | Credit chart — Phase 14 only |
| react-markdown | Docs page — Phase 13 only |
| framer-motion | Not needed for hash routing; Tailwind transitions sufficient |

**Installation (hub/ directory):**
```bash
pnpm add react-router
```

Only one new package for this phase.

---

## Architecture Patterns

### Recommended Project Structure (Phase 12 additions only)

```
hub/src/
├── main.tsx                          # MODIFY: replace ReactDOM.render with RouterProvider
├── App.tsx                           # MODIFY: remove tab state, become layout shell
├── types.ts                          # MODIFY: add AgentProfile interface
├── components/
│   ├── NavBar.tsx                    # NEW: 5-tab nav, credit badge, "My Agent" dropdown
│   ├── GetStartedCTA.tsx             # NEW: unauthenticated CTA button
│   ├── AgentList.tsx                 # NEW: ranked agent table with identicons
│   └── ProfilePage.tsx               # NEW: single agent profile — skills grid + activity
└── hooks/
    └── useAgents.ts                  # NEW: fetches /api/agents and /api/agents/:owner

hub/vite.config.ts                    # MODIFY: add '/api' proxy entry
src/registry/server.ts                # MODIFY: add GET /api/agents and GET /api/agents/:owner
```

### Pattern 1: Hash Router Setup

**What:** Replace the current `ReactDOM.createRoot(...).render(<App />)` in `main.tsx` with `RouterProvider` backed by `createHashRouter`. `App.tsx` becomes the layout shell (NavBar + `<Outlet />`), not the tab controller.

**When to use:** Required before any route-specific page component is built.

**Example:**
```tsx
// hub/src/main.tsx
import { createHashRouter, RouterProvider } from 'react-router';
import App from './App.js';
import DiscoverPage from './pages/DiscoverPage.js';
import AgentListPage from './pages/AgentListPage.js';
import ProfilePage from './pages/ProfilePage.js';

const router = createHashRouter([
  {
    path: '/',
    element: <App />,        // layout shell with NavBar + <Outlet />
    children: [
      { index: true, element: <DiscoverPage /> },
      { path: 'agents', element: <AgentListPage /> },
      { path: 'agents/:owner', element: <ProfilePage /> },
      { path: 'activity', element: <div>Activity (Phase 13)</div> },
      { path: 'docs', element: <div>Docs (Phase 13)</div> },
      { path: 'share', element: <SharePage /> },
      { path: 'myagent', element: <AuthGate apiKey={...}><OwnerDashboard /></AuthGate> },
    ]
  }
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
```

**Notes:**
- Import only from `react-router` — do NOT import from `react-router-dom` (merged in v7, causes version conflicts)
- Do NOT use `@react-router/dev` Vite plugin — that is for SSR. This project uses library mode only.
- Hash URLs (`/hub/#/agents`) are invisible to Fastify; the existing `/hub/` static mount handles them correctly.

### Pattern 2: NavBar with NavLink (replace existing tab nav)

**What:** The current tab `<button>` elements in `App.tsx` become `<NavLink>` elements in a new `NavBar.tsx` component. `NavLink` from react-router automatically applies an active class when the URL matches.

**When to use:** All top-level navigation tabs.

**Example:**
```tsx
// hub/src/components/NavBar.tsx
import { NavLink } from 'react-router';

const NAV_TABS = [
  { to: '/', label: 'Discover', end: true },
  { to: '/agents', label: 'Agents' },
  { to: '/activity', label: 'Activity' },
  { to: '/docs', label: 'Docs' },
];

export default function NavBar({ apiKey, balance }: NavBarProps) {
  return (
    <header className="max-w-7xl mx-auto px-4 pt-8 pb-0">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold text-hub-text-primary">AgentBnB</h1>
        {/* Right side: credit badge OR get started CTA */}
        {apiKey
          ? <NavCreditBadge balance={balance} />
          : <GetStartedCTA />}
      </div>
      <nav className="mt-6 flex gap-1 bg-white/[0.04] rounded-lg p-1 w-fit">
        {NAV_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => [
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-white/[0.08] text-hub-text-primary'
                : 'bg-transparent text-hub-text-muted hover:text-hub-text-secondary',
            ].join(' ')}
          >
            {tab.label}
          </NavLink>
        ))}
        {/* My Agent — dropdown, not a single NavLink */}
        <MyAgentDropdown />
      </nav>
    </header>
  );
}
```

### Pattern 3: 30-Second Polling Hook (established pattern)

**What:** `useAgents` follows the exact same structure as `useCards` — `useCallback` for fetch, two `useEffect` calls (initial fetch + interval), `isFirstFetch` ref for loading state.

**When to use:** Every new server-fetched data source in the Hub. Do not deviate.

**Example:**
```tsx
// hub/src/hooks/useAgents.ts
export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFirstFetch = useRef(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json() as { items: AgentProfile[]; total: number };
      setAgents(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isFirstFetch.current = true;
    setLoading(true);
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const id = setInterval(() => void fetchAgents(), 30_000);
    return () => clearInterval(id);
  }, [fetchAgents]);

  return { agents, loading, error };
}
```

### Pattern 4: Agent Aggregation in TypeScript (not complex SQL)

**What:** `GET /api/agents` calls `listCards(db)` (existing function), then aggregates by owner in TypeScript. Given the expected agent count (tens, not thousands), TypeScript groupBy is simpler and more maintainable than complex SQL JOINs.

**When to use:** `/api/agents` route handler.

**Note:** `credits_earned` requires a separate SQL query via `request_log` — this part cannot be computed from `listCards()` alone. See Don't Hand-Roll section and Pitfall 5.

**Example:**
```typescript
// Inside GET /api/agents route handler in server.ts
const allCards = listCards(db);

// Group cards by owner
const ownerMap = new Map<string, CapabilityCard[]>();
for (const card of allCards) {
  const existing = ownerMap.get(card.owner) ?? [];
  existing.push(card);
  ownerMap.set(card.owner, existing);
}

// Compute credits_earned per owner via aggregate SQL (one query, not N queries)
const creditsStmt = db.prepare(`
  SELECT cc.owner, SUM(CASE WHEN rl.status = 'success' THEN rl.credits_charged ELSE 0 END) as credits_earned
  FROM capability_cards cc
  LEFT JOIN request_log rl ON rl.card_id = cc.id
  GROUP BY cc.owner
`);
const creditsRows = creditsStmt.all() as Array<{ owner: string; credits_earned: number }>;
const creditsMap = new Map(creditsRows.map((r) => [r.owner, r.credits_earned ?? 0]));

// Build AgentProfile array
const agents: AgentProfile[] = Array.from(ownerMap.entries()).map(([owner, cards]) => {
  const skillCount = cards.reduce((sum, card) => sum + (card.skills?.length ?? 1), 0);
  const successRates = cards
    .map((c) => c.metadata?.success_rate)
    .filter((r): r is number => r != null);
  const avgSuccessRate = successRates.length > 0
    ? successRates.reduce((a, b) => a + b, 0) / successRates.length
    : null;
  return {
    owner,
    skill_count: skillCount,
    success_rate: avgSuccessRate,
    total_earned: creditsMap.get(owner) ?? 0,
    member_since: Math.min(...cards.map((c) => new Date(c.created_at ?? Date.now()).getTime())).toString(),
  };
});

// Sort by reputation: success_rate DESC, then total_earned DESC
agents.sort((a, b) => {
  const aRate = a.success_rate ?? -1;
  const bRate = b.success_rate ?? -1;
  if (bRate !== aRate) return bRate - aRate;
  return b.total_earned - a.total_earned;
});
```

### Pattern 5: Scoped vs. Public Fastify Routes (existing pattern)

**What:** New `/api/agents` and `/api/agents/:owner` routes are PUBLIC (no auth). They go at the top-level server scope, NOT inside the `ownerRoutes.register(...)` block that has the Bearer token auth hook.

**When to use:** Any public endpoint. The `ownerRoutes` scope is for authenticated owner-only endpoints.

**Example:**
```typescript
// src/registry/server.ts — add BEFORE the ownerRoutes.register() block
server.get('/api/agents', async (_request, reply) => {
  // ... aggregation logic
  return reply.send({ items: agents, total: agents.length });
});

server.get('/api/agents/:owner', async (request, reply) => {
  const { owner } = request.params as { owner: string };
  // ... profile logic
  return reply.send({ profile, skills, recent_activity });
});
```

### Pattern 6: My Agent Dropdown (local React state)

**What:** The "My Agent" nav item is a dropdown (not a NavLink tab), implemented with a `useState<boolean>` for open/close. Clicking outside closes it via a `useEffect` click listener on `document`.

**When to use:** NAV-05 requirement — Dashboard/Share/Settings sub-items.

**Example:**
```tsx
// Inside NavBar.tsx — MyAgentDropdown sub-component
function MyAgentDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="...">
        My Agent <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-hub-surface border border-white/[0.08] rounded-lg py-1 z-50">
          <NavLink to="/myagent" onClick={() => setOpen(false)} className="...">Dashboard</NavLink>
          <NavLink to="/share" onClick={() => setOpen(false)} className="...">Share</NavLink>
          <NavLink to="/settings" onClick={() => setOpen(false)} className="...">Settings</NavLink>
        </div>
      )}
    </div>
  );
}
```

### Anti-Patterns to Avoid

- **Building new pages with `useState<ActiveTab>` instead of react-router:** Tab state cannot support back-button history for nested views. The routing library must be installed before any new page component is written. (PITFALLS.md Pitfall 1)
- **Using `createBrowserRouter` instead of `createHashRouter`:** Browser router requires Fastify to serve the SPA shell at all `/hub/*` paths. Hash router avoids this entirely. (STACK.md)
- **Importing from `react-router-dom`:** In v7 these are merged into `react-router`. Installing both creates version conflicts. Import everything from `react-router`.
- **Computing `credits_earned` in a loop per agent:** See Pitfall 5 — one GROUP BY query, not N queries.
- **Adding `/api` prefix to new routes but leaving old routes at root:** Creates two base paths in vite.config.ts proxy. All new routes use `/api/*`. Update proxy in the same commit. (PITFALLS.md Pitfall 3 mitigation)
- **Calling `useAgents` in both AgentList and ProfilePage independently:** Causes double polling. Call once in the parent and pass data as props, or use route-level data loading.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL-based navigation with browser history | Custom history stack, tab state | `createHashRouter` from react-router | History API edge cases, serialization, back/forward button handling |
| Agent identicons | Custom SVG avatar generator | `boring-avatars` (already installed) | Already in hub/package.json; consistent with CardModal |
| Agent sorting by reputation | Complex SQL ORDER BY | TypeScript `.sort()` after aggregation | Simpler at current cardinality; easier to test; avoids SQLite JSON extraction complexity |

**Key insight:** The agent directory's complexity is entirely in the aggregation query for `credits_earned` and the routing setup, not in building custom primitives. Both have clear solutions.

---

## Common Pitfalls

### Pitfall 1: Installing react-router after pages are built
**What goes wrong:** Building `AgentList` and `ProfilePage` as tab-state components first, then trying to add URL routing later. The profile sub-view has no URL, back button does not work, deep-linking is impossible.
**Why it happens:** The existing 3-tab pattern works and seems easy to extend.
**How to avoid:** Install react-router and wire `createHashRouter` as the FIRST task. No new page component before routing is in place.
**Warning signs:** `selectedAgentOwner: string | null` state in App.tsx instead of `useParams()` in ProfilePage.

### Pitfall 2: SPA deep routes returning 404 on direct access (ALREADY NEEDS VERIFICATION)
**What goes wrong:** `@fastify/static` returns 404 for `/hub/agents/chengwen-openclaw` on direct browser access or refresh.
**Why it happens:** The current server.ts has `server.get('/hub', ...)` redirect but no wildcard catch-all for sub-paths.
**How to avoid:** Verify the current server.ts — add `server.get('/hub/*', ...)` catch-all if missing.
**Current server.ts state:** Lines 98-101 show only `/hub` (no slash) redirect. The wildcard catch-all is NOT yet present. This must be added.
**Warning signs:** Routes work in Vite dev server (`vite dev` handles SPA fallback automatically) but 404 after production build.

### Pitfall 3: New /api proxy entry missing from vite.config.ts
**What goes wrong:** `GET /api/agents` calls from the Hub return 404 in dev mode because Vite doesn't proxy `/api/*`.
**Why it happens:** The current proxy only has `/cards`, `/health`, `/me`, `/requests`, `/draft`.
**How to avoid:** Add `'/api': 'http://localhost:7777'` to vite.config.ts proxy in the SAME commit as the Fastify route.
**Current vite.config.ts state (lines 13-18):** The `/api` entry is MISSING. Must be added in the first task.

### Pitfall 4: credits_earned computed wrong (stored vs. computed)
**What goes wrong:** Adding a `credits_earned` column to `capability_cards`, or computing it per-agent in a loop (N+1 queries).
**Why it happens:** The UI shows a number; developers assume it's stored.
**How to avoid:** Compute via a single `GROUP BY owner` aggregate SQL query joining `request_log`. Always filter `WHERE status = 'success'`. See Pattern 4 above.

### Pitfall 5: React Router Vite plugin installed accidentally
**What goes wrong:** Installing `@react-router/dev` (the SSR/prerendering plugin) causes build failures and conflicts.
**Why it happens:** The react-router v7 docs show two modes — framework (SSR) and library. This project needs library mode only.
**How to avoid:** Only install `react-router`. Do not install `@react-router/dev`. Use `RouterProvider` component pattern, not file-based routing.

### Pitfall 6: "My Agent" nav item blocks all URL navigation
**What goes wrong:** Making "My Agent" a regular `<NavLink>` instead of a dropdown loses the Dashboard/Share/Settings sub-structure required by NAV-05.
**Why it happens:** NavLink is the easiest pattern; dropdown requires extra state.
**How to avoid:** Implement MyAgentDropdown as a separate sub-component with `useState<boolean>` for open state. Close on outside click and on sub-item click.

---

## Code Examples

Verified patterns from codebase inspection:

### Existing App.tsx Tab Pattern (to be replaced by router)
```tsx
// Current pattern — 3 tabs, no URL history
const [activeTab, setActiveTab] = useState<ActiveTab>('discover');
// ...
{TABS.map((tab) => (
  <button key={tab.id} onClick={() => { setActiveTab(tab.id); }} ...>
    {tab.label}
  </button>
))}
```

### New main.tsx with RouterProvider
```tsx
// hub/src/main.tsx — replaces current ReactDOM.createRoot pattern
import { createHashRouter, RouterProvider } from 'react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
// ... page imports

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DiscoverPage /> },
      { path: 'agents', element: <AgentListPage /> },
      { path: 'agents/:owner', element: <ProfilePage /> },
      { path: 'activity', element: <ActivityPlaceholder /> },
      { path: 'docs', element: <DocsPlaceholder /> },
      { path: 'share', element: <SharePage /> },
      { path: 'myagent', element: <MyAgentPage /> },
    ]
  }
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
```

### App.tsx as Layout Shell
```tsx
// hub/src/App.tsx — becomes layout wrapper, no more tab state
import { Outlet } from 'react-router';
import { useAuth } from './hooks/useAuth.js';
import NavBar from './components/NavBar.js';
import CardModal from './components/CardModal.js';
import { useState } from 'react';
import type { HubCard } from './types.js';

export default function App() {
  const { apiKey, login, logout } = useAuth();
  const [selectedCard, setSelectedCard] = useState<HubCard | null>(null);

  return (
    <div className="min-h-screen bg-hub-bg text-hub-text-primary">
      <NavBar apiKey={apiKey} onLogout={logout} />
      <main className="max-w-7xl mx-auto px-4 py-8 pb-12">
        <Outlet context={{ apiKey, login, setSelectedCard }} />
      </main>
      <CardModal card={selectedCard} onClose={() => { setSelectedCard(null); }} />
    </div>
  );
}
```

### vite.config.ts proxy update
```typescript
// hub/vite.config.ts — add '/api' entry
proxy: {
  '/cards': 'http://localhost:7777',
  '/health': 'http://localhost:7777',
  '/me': 'http://localhost:7777',
  '/requests': 'http://localhost:7777',
  '/draft': 'http://localhost:7777',
  '/api': 'http://localhost:7777',   // NEW — covers /api/agents and /api/activity (Phase 13)
},
```

### Fastify SPA Catch-All (missing from current server.ts)
```typescript
// src/registry/server.ts — add AFTER fastifyStatic registration (around line 102)
if (hubDistDir) {
  void server.register(fastifyStatic, {
    root: hubDistDir,
    prefix: '/hub/',
    decorateReply: false,
  });

  // Redirect /hub (no slash) to /hub/
  server.get('/hub', async (_request, reply) => {
    return reply.redirect('/hub/');
  });

  // SPA catch-all: serve index.html for all /hub/* paths
  // MUST be registered AFTER fastifyStatic so real assets (JS, CSS) are served first
  server.get('/hub/*', async (_request, reply) => {
    return reply.sendFile('index.html');
  });
}
```

### New AgentProfile type (hub/src/types.ts)
```typescript
// Add to hub/src/types.ts
export interface AgentProfile {
  owner: string;
  skill_count: number;
  success_rate: number | null;   // null if no requests yet
  total_earned: number;          // credits earned from sharing (computed from request_log)
  member_since: string;          // ISO timestamp or numeric ms of first card
  // Only present in /api/agents/:owner response:
  skills?: HubCard[];
  recent_activity?: ActivityEntry[];
}

// Minimal activity entry (full ActivityEvent in Phase 13)
export interface ActivityEntry {
  id: string;
  card_name: string;
  requester: string;
  status: 'success' | 'failure' | 'timeout';
  credits_charged: number;
  created_at: string;
}
```

### boring-avatars usage (already in codebase — verified in CardModal)
```tsx
// Already installed; see hub/src/components/CardModal.tsx for existing usage
import Avatar from 'boring-avatars';

// In AgentList row:
<Avatar
  size={32}
  name={agent.owner}
  variant="marble"
  colors={['#10B981', '#059669', '#047857', '#065F46', '#064E3B']}
/>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-router-dom` as separate package | Merged into `react-router` in v7 | v7.0 release | Import from `react-router` only; do not install `react-router-dom` |
| `useHistory()` hook | `useNavigate()` hook | React Router v6+ | `useHistory` does not exist in v7; use `useNavigate` |
| `<Switch>` component | `<Routes>` / `createHashRouter` | React Router v6+ | `<Switch>` removed; declarative config via `createHashRouter` |
| Class-based Router config | Object-based route config | React Router v6.4+ | Use `createHashRouter([{ path, element, children }])` data router |

**Deprecated/outdated:**
- `react-router-dom` (v5 and earlier): separate package no longer needed in v7
- `useHistory()`: removed — use `useNavigate()`
- `<Switch>`: removed — use `<Routes>` or data router config
- `<Redirect>`: removed — use `<Navigate>` or `redirect()`

---

## Open Questions

1. **`hub/src/main.tsx` current content**
   - What we know: `hub/src/App.tsx` is the root component; `ReactDOM.createRoot` must be in `main.tsx`
   - What's unclear: Whether `main.tsx` imports and wraps anything that needs to change alongside RouterProvider
   - Recommendation: Read `hub/src/main.tsx` at plan execution time to confirm the exact replacement needed

2. **`boring-avatars` exact import pattern in this codebase**
   - What we know: The package is installed at `^1.11.2`; used in CardModal.tsx
   - What's unclear: The exact import path used (`boring-avatars` vs `boring-avatars/lib/index.js`)
   - Recommendation: Read CardModal.tsx at plan time to copy the exact import pattern

3. **`capability_cards.created_at` column availability**
   - What we know: The schema in store.ts shows `created_at TEXT NOT NULL` in `capability_cards`
   - What's unclear: Whether `listCards()` returns the `created_at` field (it returns parsed JSON `data`, not the table column)
   - Recommendation: The `member_since` field in `AgentProfile` may need to use `MIN(created_at)` directly via SQL rather than from the parsed card data. Verify at plan time by reading the full `listCards()` return value.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.0.4 |
| Config file | hub/vite.config.ts (test section, `globals: true`, `environment: 'jsdom'`) |
| Quick run command | `cd hub && pnpm vitest run --reporter=verbose src/hooks/useAgents.test.ts` |
| Full suite command | `cd hub && pnpm vitest run` |

Backend tests (server routes) also exist at `src/registry/server.test.ts` using Vitest with the project root config.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NAV-01 | Hash router changes URL on tab click; back/forward work | integration | `cd hub && pnpm vitest run src/App.test.tsx` | ❌ Wave 0 |
| NAV-02 | NavBar renders 5 tabs with correct labels | unit | `cd hub && pnpm vitest run src/components/NavBar.test.tsx` | ❌ Wave 0 |
| NAV-03 | NavCreditBadge renders balance when apiKey present | unit | included in NavBar.test.tsx | ❌ Wave 0 |
| NAV-04 | GetStartedCTA renders when apiKey null | unit | included in NavBar.test.tsx | ❌ Wave 0 |
| NAV-05 | My Agent dropdown shows 3 items (Dashboard/Share/Settings) | unit | included in NavBar.test.tsx | ❌ Wave 0 |
| AGENT-01 | GET /api/agents returns sorted agent list | unit | `cd /Users/xiaoher/Documents/GitHub/agentbnb && pnpm vitest run src/registry/server.test.ts` | ✅ (extend existing) |
| AGENT-02 | AgentList renders identicon, name, success_rate, skill_count, total_earned | unit | `cd hub && pnpm vitest run src/components/AgentList.test.tsx` | ❌ Wave 0 |
| AGENT-03 | ProfilePage renders skills grid for :owner param | unit | `cd hub && pnpm vitest run src/components/ProfilePage.test.tsx` | ❌ Wave 0 |
| AGENT-04 | GET /api/agents aggregates from capability_cards correctly | unit | existing server.test.ts (extend) | ✅ (extend existing) |
| AGENT-05 | GET /api/agents/:owner returns profile + skills + activity | unit | existing server.test.ts (extend) | ✅ (extend existing) |

### Sampling Rate
- **Per task commit:** `cd hub && pnpm vitest run` (hub unit tests, ~5s) + `pnpm vitest run src/registry/server.test.ts` (server route tests)
- **Per wave merge:** Full suite: `pnpm vitest run` at repo root + `cd hub && pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `hub/src/components/NavBar.test.tsx` — covers NAV-02, NAV-03, NAV-04, NAV-05
- [ ] `hub/src/components/AgentList.test.tsx` — covers AGENT-02
- [ ] `hub/src/components/ProfilePage.test.tsx` — covers AGENT-03
- [ ] `hub/src/App.test.tsx` — covers NAV-01 (routing integration)
- [ ] `hub/src/hooks/useAgents.test.ts` — covers useAgents hook polling behavior
- No new framework install needed — Vitest + @testing-library/react already installed

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `hub/src/App.tsx` — confirmed current 3-tab `useState<ActiveTab>` pattern; lines 25-31, 77-93
- Direct codebase inspection: `hub/vite.config.ts` — confirmed proxy entries (lines 13-18); `/api` entry is missing
- Direct codebase inspection: `src/registry/server.ts` — confirmed existing routes, static plugin, `/hub` redirect (lines 91-101); SPA catch-all is NOT present
- Direct codebase inspection: `src/registry/request-log.ts` — confirmed `request_log` table schema; `action_type` column exists
- Direct codebase inspection: `src/registry/store.ts` — confirmed `listCards(db, owner?)` signature (lines 605-615); `capability_cards` schema
- Direct codebase inspection: `hub/src/types.ts` — confirmed existing interfaces; `AgentProfile` not yet defined
- Direct codebase inspection: `hub/package.json` — confirmed `boring-avatars ^1.11.2` and `react-router` not yet installed
- `.planning/research/STACK.md` — react-router v7 library mode pattern, createHashRouter setup
- `.planning/research/ARCHITECTURE.md` — component responsibilities map, data flow diagrams, API specs
- `.planning/research/PITFALLS.md` — Pitfall 1 (tab navigation dead ends), Pitfall 2 (SPA 404), Pitfall 3 (proxy gap), Pitfall 5 (credits_earned aggregate)

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` — confirmed build order recommendation, phase rationale
- `hub/src/hooks/useCards.ts` — confirmed established 30s polling hook pattern (source of truth for useAgents structure)
- `hub/src/hooks/useAuth.test.ts` — confirmed test style (renderHook, vi.spyOn, describe/it/expect pattern)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — boring-avatars verified installed; react-router install verified absent (must add); all other deps locked
- Architecture: HIGH — based on direct inspection of all files that Phase 12 touches; no speculation
- Pitfalls: HIGH — directly verifiable from current file states (SPA catch-all missing, proxy entry missing)

**Research date:** 2026-03-16
**Valid until:** 2026-04-15 (stable library ecosystem; react-router v7 is stable release)

---

*Research for Phase 12: Foundation + Agent Directory — AgentBnB v2.2*
