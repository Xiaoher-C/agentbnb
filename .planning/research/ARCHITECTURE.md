# Architecture Research

**Domain:** Hub feature expansion + multi-platform distribution for P2P agent capability sharing
**Researched:** 2026-03-16
**Confidence:** HIGH — based on direct codebase inspection and official Claude Code docs (code.claude.com)

---

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                        React Hub SPA (hub/src/)                        │
│                         base: /hub/, Vite + Tailwind                   │
├──────────────────────────────────────────────────────────────────────┤
│  App.tsx (tab router — currently 3 tabs, extending to 5)               │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ Discover  │ │ Agents   │ │ Activity │ │  Docs    │ │  My Agent  │ │
│  │ (exists)  │ │  (NEW)   │ │  (NEW)   │ │  (NEW)   │ │  (modify)  │ │
│  └───────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘ │
│                                                                        │
│  hooks/                components/              lib/                   │
│  useCards (exists)     CapabilityCard (exists)  categories.ts (exists) │
│  useRequests (exists)  CardModal (modify)       utils.ts (exists)     │
│  useAuth (exists)      OwnerDashboard (modify)  docs-content.ts (NEW) │
│  useOwnerCards (exists)NavBar (NEW)                                    │
│  useAgents (NEW)       NavCreditBadge (NEW)                           │
│  useActivity (NEW)     GetStartedCTA (NEW)                            │
│  useCredit (NEW)       AgentList (NEW)                                │
│                        ProfilePage (NEW)                               │
│                        ActivityFeed (NEW)                              │
│                        ActivityEvent (NEW)                             │
│                        DocsPage (NEW)                                  │
│                        CreditDashboard (NEW)                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Vite dev proxy → localhost:7777                                       │
│  /cards, /health, /me, /requests, /draft (existing)                   │
│  /api (NEW — covers /api/agents, /api/activity)                       │
│                                                                        │
├──────────────────────────────────────────────────────────────────────┤
│                        Fastify Server                                  │
│                   src/registry/server.ts (modify)                     │
│                                                                        │
│  Public routes (no auth):          Owner routes (Bearer auth):        │
│  GET /health (exists)              GET /me (exists)                   │
│  GET /cards (exists)               GET /requests (exists)             │
│  GET /cards/:id (exists)           GET /draft (exists)                │
│  GET /api/agents (NEW)             GET /me/pending-requests (exists)  │
│  GET /api/agents/:owner (NEW)      POST /cards/:id/toggle-online      │
│  GET /api/activity (NEW)           PATCH /cards/:id (exists)          │
│                                    POST /me/pending-requests/:id/     │
│                                      approve|reject (exists)          │
│                                    GET /me/transactions (NEW)         │
│                                                                        │
├──────────────────────────────────────────────────────────────────────┤
│                       SQLite Databases (unchanged tables)              │
│  registryDb (registry.db)          creditDb (credit.db)               │
│  ┌─────────────────────────┐       ┌──────────────────────────────┐  │
│  │ capability_cards        │       │ credit_balances              │  │
│  │ cards_fts (FTS5)        │       │ credit_transactions          │  │
│  │ request_log             │       │ credit_escrow                │  │
│  │ pending_requests        │       └──────────────────────────────┘  │
│  └─────────────────────────┘                                         │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│               Claude Code Plugin Distribution (NEW)                    │
│                                                                        │
│  .claude-plugin/marketplace.json  (marketplace catalog)               │
│  plugins/agentbnb-network/        (plugin package)                    │
│    .claude-plugin/plugin.json     (plugin manifest)                   │
│    skills/agentbnb/SKILL.md       (copy or symlink)                   │
│                                                                        │
│  Install: /plugin marketplace add Xiaoher-C/agentbnb                  │
│           /plugin install agentbnb-network@agentbnb                   │
└───────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location | Status |
|-----------|---------------|----------|--------|
| App.tsx | Tab routing, modal state, auth state wiring | hub/src/App.tsx | MODIFY |
| NavBar | Top nav with 5 tabs + credit badge + Get Started CTA | hub/src/components/ | NEW |
| NavCreditBadge | "cr 100" accent display, click for credit dropdown | hub/src/components/ | NEW |
| GetStartedCTA | Unauthenticated banner: install command + 50 free credits | hub/src/components/ | NEW |
| AgentList | Ranked agent table with identicons + reputation stats | hub/src/components/ | NEW |
| ProfilePage | Single agent: identicon, all skills grid, recent activity | hub/src/components/ | NEW |
| ActivityFeed | Paginated public network event feed | hub/src/components/ | NEW |
| ActivityEvent | Single event row with type-specific formatting | hub/src/components/ | NEW |
| DocsPage | Multi-section doc viewer, static TS data, copy buttons | hub/src/components/ | NEW |
| CreditDashboard | Balance, reserve, earning history, transaction list | hub/src/components/ | NEW |
| CardModal | Enhanced: request button, owner profile link, related skills | hub/src/components/CardModal.tsx | MODIFY |
| OwnerDashboard | Add CreditDashboard section, share functionality absorbed | hub/src/components/OwnerDashboard.tsx | MODIFY |
| useAgents | Fetch + 30s poll /api/agents | hub/src/hooks/ | NEW |
| useActivity | Fetch + 30s poll /api/activity with offset pagination | hub/src/hooks/ | NEW |
| useCredit | Fetch /me + /me/transactions, 30s poll | hub/src/hooks/ | NEW |
| GET /api/agents | List all agents ranked by reputation | src/registry/server.ts | NEW route |
| GET /api/agents/:owner | Single agent profile + skills + recent activity | src/registry/server.ts | NEW route |
| GET /api/activity | Public paginated feed from request_log JOIN capability_cards | src/registry/server.ts | NEW route |
| GET /me/transactions | Auth: credit transaction history from creditDb | src/registry/server.ts | NEW route |
| marketplace.json | Claude Code marketplace catalog listing the plugin | .claude-plugin/marketplace.json | NEW file |
| plugin.json | Plugin manifest for agentbnb-network plugin | plugins/agentbnb-network/.claude-plugin/ | NEW file |

---

## Recommended Project Structure

New files and directories to add (existing structure is not moved or renamed):

```
agentbnb/
├── .claude-plugin/
│   └── marketplace.json              # NEW: Claude Code marketplace catalog
│
├── plugins/
│   └── agentbnb-network/             # NEW: Claude Code plugin package
│       ├── .claude-plugin/
│       │   └── plugin.json           # NEW: plugin manifest
│       └── skills/
│           └── agentbnb/
│               └── SKILL.md          # NEW: copy of skills/agentbnb/SKILL.md
│
├── hub/src/
│   ├── components/
│   │   ├── NavBar.tsx                # NEW: top nav with tabs + credit badge
│   │   ├── NavCreditBadge.tsx        # NEW: "cr 100" display + dropdown
│   │   ├── GetStartedCTA.tsx         # NEW: unauthenticated install CTA
│   │   ├── AgentList.tsx             # NEW: ranked agent table
│   │   ├── ProfilePage.tsx           # NEW: single-agent profile view
│   │   ├── ActivityFeed.tsx          # NEW: paginated network event feed
│   │   ├── ActivityEvent.tsx         # NEW: single event row
│   │   ├── DocsPage.tsx              # NEW: multi-section docs viewer
│   │   ├── CreditDashboard.tsx       # NEW: earning history + transactions
│   │   ├── CardModal.tsx             # MODIFY: request button, owner link
│   │   └── OwnerDashboard.tsx        # MODIFY: add CreditDashboard section
│   │
│   ├── hooks/
│   │   ├── useAgents.ts              # NEW: fetches /api/agents
│   │   ├── useActivity.ts            # NEW: fetches /api/activity
│   │   └── useCredit.ts              # NEW: fetches /me + /me/transactions
│   │
│   ├── lib/
│   │   └── docs-content.ts           # NEW: static docs content as TS data
│   │
│   ├── types.ts                      # MODIFY: add AgentProfile, ActivityEvent
│   └── App.tsx                       # MODIFY: 5-tab nav, credit in header
│
└── src/registry/server.ts            # MODIFY: add 4 new routes
```

### Structure Rationale

- **All new API routes go into src/registry/server.ts:** The existing server already owns all Hub-serving REST routes and the static SPA serving. Adding routes to a separate file would require registering a new Fastify plugin with its own lifecycle — unnecessary complexity for 4 new endpoints. The established pattern is one file, one server.
- **hub/src/components/ stays flat (no feature subfolders):** The existing directory is flat. All 11 existing components live at the same level. Maintain consistency — new components follow the same convention.
- **plugins/ at repo root:** Claude Code's `git-subdir` source type and relative path source both work when the marketplace is added via GitHub. The `plugins/agentbnb-network/` path lets marketplace.json use `"./plugins/agentbnb-network"` as the source, and the rest of the repo stays untouched.
- **lib/docs-content.ts as TypeScript data:** DocsPage is explicitly static per the milestone spec ("no backend needed"). TS data objects are type-safe, support ReactNode content, and avoid adding a Markdown processing dependency. Copy buttons use the existing `navigator.clipboard` pattern from CardModal.

---

## Architectural Patterns

### Pattern 1: Tab-Based Page Switching (extend existing)

**What:** App.tsx owns `activeTab` state and conditionally renders page components. Currently `'discover' | 'share' | 'myagent'`. Extending to `'discover' | 'agents' | 'activity' | 'docs' | 'myagent'`. The `'share'` tab merges into My Agent (it is an owner action, not a browse action).

**When to use:** The existing pattern works for the Hub use case. No routing library (react-router) is installed or needed. Tab state is local to App.tsx and trivial to extend.

**Trade-offs:** No deep-linkable URLs per tab. Acceptable — the Hub is a local tool, not a public website that external users link into.

**Integration point:** The Agents tab needs a profile sub-page. Use `selectedAgentOwner: string | null` state in App.tsx, same as `selectedCard: HubCard | null` drives the CardModal. Clicking an agent row sets `selectedAgentOwner`; ProfilePage renders in-place; back button sets it to null.

### Pattern 2: 30-Second Polling Hook (established pattern)

**What:** Every async data domain has a hook that fetches on mount, re-fetches on filter param change via useCallback deps, and polls via setInterval every 30s. useCards and useRequests both implement this pattern. New hooks (useAgents, useActivity, useCredit) follow it exactly.

**When to use:** Every new server-fetched data source in the Hub. Do not deviate.

**Example (useAgents):**
```typescript
export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const isFirstFetch = useRef(true);

  const fetchAgents = useCallback(async () => {
    const res = await fetch('/api/agents');
    const data = await res.json() as { items: AgentProfile[] };
    setAgents(data.items);
    setError(null);
    if (isFirstFetch.current) { isFirstFetch.current = false; setLoading(false); }
  }, []);

  useEffect(() => { isFirstFetch.current = true; setLoading(true); void fetchAgents(); }, [fetchAgents]);
  useEffect(() => {
    const id = setInterval(() => void fetchAgents(), 30_000);
    return () => clearInterval(id);
  }, [fetchAgents]);

  return { agents, loading };
}
```

### Pattern 3: Scoped Fastify Plugin for Auth Routes (existing pattern)

**What:** Owner routes are registered inside `server.register(async (ownerRoutes) => { ... })` in server.ts. The `addHook('onRequest')` Bearer check is scoped to that plugin only — it does NOT affect public routes like `/cards` or the new `/api/agents`.

**When to use:** Any new authenticated endpoint (e.g. `GET /me/transactions`) must be added inside the existing `ownerRoutes` scope block. Public endpoints (`/api/agents`, `/api/activity`) go at top-level server scope.

**Trade-offs:** The existing scoped plugin has no path prefix — all auth routes live at root path level. This is the established pattern; new routes maintain it.

### Pattern 4: Derive Activity Feed from request_log (no new table)

**What:** The `request_log` table already captures every capability exchange with `card_name`, `requester`, `status`, `latency_ms`, `credits_charged`, `created_at`, `action_type`. The `GET /api/activity` endpoint queries it directly with a JOIN to `capability_cards` to get the card owner as `provider`.

**When to use:** Always preferred over creating a separate `activity_events` table. A second table would require a write-path insertion on every exchange and could drift from the source of truth.

**Required query:**
```sql
SELECT
  r.id,
  r.card_name,
  r.requester,
  r.status,
  r.latency_ms,
  r.credits_charged,
  r.created_at,
  r.action_type,
  c.owner AS provider
FROM request_log r
LEFT JOIN capability_cards c ON r.card_id = c.id
ORDER BY r.created_at DESC
LIMIT ? OFFSET ?
```

**Trade-offs:** Adds one LEFT JOIN per query. At dogfood scale (< 1K requests) this is negligible. SQLite JOIN on integer rowid is fast.

### Pattern 5: Derive Agent Profiles from Aggregated Queries (no new table)

**What:** `GET /api/agents` aggregates `capability_cards` GROUP BY owner plus a LEFT JOIN to `request_log` for total credits earned. No `agents` table needed.

**Data derivation:**
- `owner` — from `capability_cards.owner`
- `skill_count` — count of skills[] items via JSON aggregation or post-processing
- `success_rate` — pulled from `json_extract(data, '$.metadata.success_rate')` or skill-level aggregation
- `total_earned` — `SUM(credits_charged)` from `request_log WHERE status='success'`
- `member_since` — `MIN(created_at)` from `capability_cards`

**Simpler approach:** Call `listCards(db)` (existing function in store.ts), then aggregate in TypeScript rather than complex SQL. Given the small cardinality (tens of agents), TypeScript aggregation is cleaner and easier to test.

---

## Data Flow

### New: Agent List Flow

```
User clicks "Agents" tab
    |
App.tsx renders <AgentList />
    |
useAgents() hook → fetch GET /api/agents
    |
Fastify handler → listCards(db) (existing) → aggregate by owner in TS
    |
Returns: [{ owner, skill_count, success_rate, total_earned, member_since }]
    |
<AgentList> renders ranked rows with boring-avatars identicons + stats

User clicks agent row → selectedAgentOwner set in App.tsx
    |
App.tsx renders <ProfilePage owner={selectedAgentOwner} />
    |
useAgents(owner) → fetch GET /api/agents/:owner
    |
Returns: { profile, skills: HubCard[], recent_activity: ActivityEvent[] }
    |
<ProfilePage> renders identicon + skill cards grid + recent activity list
```

### New: Activity Feed Flow

```
User clicks "Activity" tab
    |
App.tsx renders <ActivityFeed />
    |
useActivity() → fetch GET /api/activity?limit=20&offset=0
    |
Fastify handler → SQL: SELECT request_log JOIN capability_cards
    |
Returns: { items: ActivityEvent[], total, limit, offset }
    |
<ActivityFeed> renders event rows
    |
User clicks "Load more" → offset += 20 → fetch next page
    (offset state inside ActivityFeed or useActivity hook)
```

### New: Credit Display + Dashboard Flow

```
App.tsx owns: const { balance, transactions } = useCredit(apiKey)
    |
useCredit → fetch /me (existing, returns balance)
           → fetch /me/transactions (NEW, returns CreditTransaction[])
    |
<NavCreditBadge balance={balance} /> → renders "cr 247" in header
User clicks badge → shows <CreditDashboard transactions={transactions} />
    |
CreditDashboard shows: balance, reserve floor, earned/spent this week
    (computed from transactions.filter by reason + created_at)
    + list of recent transactions
    |
OwnerDashboard also receives balance + transactions as props
(avoids double-fetching — single useCredit call in App.tsx)
```

### Vite Dev Proxy — What Changes

Current `hub/vite.config.ts` proxy entries:
```
'/cards', '/health', '/me', '/requests', '/draft' → http://localhost:7777
```

The `/me` prefix already covers `/me/transactions` (Vite proxy uses prefix matching).

Add only:
```
'/api' → 'http://localhost:7777'   // covers /api/agents and /api/activity
```

---

## New API Endpoints — Complete Specification

### GET /api/agents
- Auth: none (public)
- Query params: none initially; `?sort=reputation|earned` optional
- Response: `{ items: AgentProfile[], total: number }`
- Implementation: `listCards(db)` → TS aggregation + request_log sum
- New code: one Fastify route handler in server.ts, one SQL query

### GET /api/agents/:owner
- Auth: none (public)
- Response: `{ profile: AgentProfile, skills: HubCard[], recent_activity: ActivityEvent[] }`
- Implementation: `listCards(db, owner)` + `getRequestLog(db, 10)` filtered by owner's cards
- New code: one Fastify route handler

### GET /api/activity
- Auth: none (public)
- Query params: `limit` (default 20, max 100), `offset` (default 0)
- Response: `{ items: ActivityEvent[], total: number, limit: number, offset: number }`
- Implementation: SQL with JOIN (see Pattern 4 above)
- New code: one Fastify route handler + one new SQL query function in request-log.ts

### GET /me/transactions
- Auth: Bearer token (inside ownerRoutes scope)
- Query params: `limit` (default 20, max 100)
- Response: `{ items: CreditTransaction[], limit: number }`
- Implementation: `getTransactions(db, ownerName, limit)` — this function already exists in `src/credit/ledger.ts`
- New code: one Fastify route handler (the underlying function is already written)

---

## New Frontend Types

Add to `hub/src/types.ts`:

```typescript
export interface AgentProfile {
  owner: string;
  skill_count: number;
  success_rate: number | null;   // null if no requests yet
  total_earned: number;          // credits earned from sharing
  member_since: string;          // ISO timestamp of first card
  // Only present in /api/agents/:owner response:
  skills?: HubCard[];
  recent_activity?: ActivityEvent[];
}

export interface ActivityEvent {
  id: string;
  type: 'exchange_completed' | 'capability_shared' | 'agent_joined';
  requester: string;
  provider: string;
  card_name: string;
  credits: number;
  latency_ms: number | null;
  action_type: string | null;    // 'auto_share' | 'auto_request' | null
  created_at: string;
}

// CreditTransaction already exported from src/credit/ledger.ts
// Re-export here so hub components don't cross module boundaries:
export interface CreditTransaction {
  id: string;
  owner: string;
  amount: number;                // positive = credit, negative = debit
  reason: 'bootstrap' | 'escrow_hold' | 'escrow_release' | 'settlement' | 'refund';
  reference_id: string | null;
  created_at: string;
}
```

---

## Claude Code Plugin Structure

**Confidence: HIGH** — verified against official Claude Code docs at code.claude.com/docs/en/plugin-marketplaces.

The marketplace catalog and plugin manifest are separate files at different directory levels:

### .claude-plugin/marketplace.json (repo root level)
```json
{
  "name": "agentbnb",
  "owner": {
    "name": "Cheng Wen Chen",
    "email": "chengwen@agentbnb.dev"
  },
  "metadata": {
    "description": "P2P capability sharing for AI agents"
  },
  "plugins": [
    {
      "name": "agentbnb-network",
      "source": "./plugins/agentbnb-network",
      "description": "Join the AgentBnB P2P capability sharing network",
      "version": "2.0.0",
      "category": "productivity",
      "tags": ["agents", "p2p", "capabilities", "credits", "ai-agent-skill"]
    }
  ]
}
```

### plugins/agentbnb-network/.claude-plugin/plugin.json
```json
{
  "name": "agentbnb-network",
  "description": "P2P capability sharing — earn credits by sharing idle APIs",
  "version": "2.0.0"
}
```

### Directory Layout
```
plugins/agentbnb-network/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── agentbnb/
        └── SKILL.md         # copy of skills/agentbnb/SKILL.md content
```

**Install path for users:**
```
/plugin marketplace add Xiaoher-C/agentbnb
/plugin install agentbnb-network@agentbnb
```

**Why relative path source works:** When users add via `/plugin marketplace add Xiaoher-C/agentbnb` (GitHub), Claude Code clones the entire repo. Relative path `"./plugins/agentbnb-network"` resolves correctly within the cloned repo. This is the recommended approach per official docs.

**SKILL.md handling:** Copy (not symlink) the SKILL.md content into `plugins/agentbnb-network/skills/agentbnb/SKILL.md`. Symlinks are supported by Claude Code plugin copy, but copying avoids any platform-specific symlink issues and keeps the plugin self-contained.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 agents | Current SQLite + TS aggregation for /api/agents is fine. All queries < 5ms. |
| 100-1K agents | Add index on `request_log(card_id, status)` for credits_earned JOIN. Already has `created_at DESC` index. |
| 1K+ agents | Materialize agent stats into an `agent_stats` table updated by the existing insert trigger pattern. /api/agents GROUP BY across a large request_log becomes slow without it. Not needed at v2.2 scope. |

### Scaling Priorities

1. **First bottleneck:** `/api/agents` TS aggregation across all cards. Fix: add `agent_stats` table, updated by trigger on request_log insert. Not needed until > 1K requests.
2. **Second bottleneck:** 30s polling from multiple browser tabs open simultaneously. Fix: replace polling with SSE stream on `/api/activity/stream`. Not needed at dogfood scale.

---

## Anti-Patterns

### Anti-Pattern 1: Installing react-router for Agent Profile URLs

**What people do:** Add react-router-dom to make `/hub/agents/chengwen` a bookmarkable URL.

**Why it's wrong:** The Hub is a local tool. No external user links to agent profiles. react-router requires changes to vite.config.ts (history fallback), Fastify (SPA fallback route), App.tsx restructuring, and adds 50KB bundle weight. Zero user benefit.

**Do this instead:** `selectedAgentOwner: string | null` state in App.tsx. Same pattern as `selectedCard` for the CardModal. Back = set to null. Already the established pattern.

### Anti-Pattern 2: Creating a Separate activity_events Table

**What people do:** Create an `activity_events` table and INSERT on every exchange, auto-share, and agent join.

**Why it's wrong:** `request_log` already captures every exchange with `action_type` distinguishing autonomous events. A second table means two-write paths, potential sync drift, and duplicate data. The "agent_joined" event type can be derived from MIN(created_at) per owner on capability_cards.

**Do this instead:** JOIN `request_log` with `capability_cards` at query time. The query is simple and data is always consistent.

### Anti-Pattern 3: Calling useCredit in Both NavCreditBadge and CreditDashboard

**What people do:** Both components independently call `useCredit(apiKey)` for their own data.

**Why it's wrong:** Doubles API calls to `/me` and `/me/transactions`. Creates two independent 30s polling intervals. Can show stale/different data between the nav badge and the dashboard.

**Do this instead:** Call `useCredit(apiKey)` once in App.tsx (alongside `useAuth`). Pass `balance` and `transactions` as props to both NavCreditBadge and CreditDashboard. Single source of truth, single polling interval.

### Anti-Pattern 4: Building DocsPage with Dynamic Markdown Fetching

**What people do:** Store docs as `.md` files in `hub/public/docs/`, fetch at runtime, use remark or react-markdown to render.

**Why it's wrong:** Adds a Markdown processing dependency (remark is 150KB+ of plugins). Content flashes on load. Code blocks with copy buttons require extra configuration. No type safety.

**Do this instead:** Static TypeScript data object in `lib/docs-content.ts`. Each section is `{ id: string, title: string, content: ReactNode }`. Content is JSX with inline copy buttons using the same `navigator.clipboard` pattern from CardModal. Zero new dependencies.

### Anti-Pattern 5: Placing marketplace.json at the Wrong Level

**What people do:** Create `marketplace.json` at the repo root (not inside `.claude-plugin/`).

**Why it's wrong:** Claude Code requires the marketplace catalog at `.claude-plugin/marketplace.json` specifically. The `.claude-plugin/` directory is the convention for all Claude Code metadata files. A file at the repo root is invisible to Claude Code's marketplace discovery.

**Do this instead:** `.claude-plugin/marketplace.json` is the marketplace catalog. `plugins/agentbnb-network/.claude-plugin/plugin.json` is the individual plugin manifest. These are two separate files at two separate directory levels — do not conflate them.

### Anti-Pattern 6: Storing Docs as a Single Monolithic Component

**What people do:** Write all documentation directly in DocsPage.tsx as one 500-line JSX component.

**Why it's wrong:** Hard to update doc content without touching JSX. The content and the rendering are tangled.

**Do this instead:** `lib/docs-content.ts` exports `DOCS_SECTIONS: DocSection[]`. DocsPage.tsx imports this data and renders it. Content updates require only editing the data file. The component itself is a simple mapper over the sections array.

---

## Integration Points

### New vs Existing — Complete Map

| What Changes | Type | Touches |
|-------------|------|---------|
| hub/src/App.tsx | MODIFY | Add 2 new tabs, credit badge, selectedAgentOwner state |
| hub/src/types.ts | MODIFY | Add AgentProfile, ActivityEvent, CreditTransaction interfaces |
| hub/vite.config.ts | MODIFY | Add '/api' proxy entry |
| hub/src/components/CardModal.tsx | MODIFY | Add request button, owner profile link |
| hub/src/components/OwnerDashboard.tsx | MODIFY | Add CreditDashboard section, absorb Share functionality |
| src/registry/server.ts | MODIFY | Add 4 new routes (/api/agents, /api/agents/:owner, /api/activity, /me/transactions) |
| src/registry/request-log.ts | MODIFY | Add getActivityFeed() function with the JOIN query |
| hub/src/components/NavBar.tsx | NEW | — |
| hub/src/components/NavCreditBadge.tsx | NEW | — |
| hub/src/components/GetStartedCTA.tsx | NEW | — |
| hub/src/components/AgentList.tsx | NEW | — |
| hub/src/components/ProfilePage.tsx | NEW | — |
| hub/src/components/ActivityFeed.tsx | NEW | — |
| hub/src/components/ActivityEvent.tsx | NEW | — |
| hub/src/components/DocsPage.tsx | NEW | — |
| hub/src/components/CreditDashboard.tsx | NEW | — |
| hub/src/hooks/useAgents.ts | NEW | — |
| hub/src/hooks/useActivity.ts | NEW | — |
| hub/src/hooks/useCredit.ts | NEW | — |
| hub/src/lib/docs-content.ts | NEW | — |
| .claude-plugin/marketplace.json | NEW | — |
| plugins/agentbnb-network/.claude-plugin/plugin.json | NEW | — |
| plugins/agentbnb-network/skills/agentbnb/SKILL.md | NEW | — |

### Existing Functions Already Available (no new code in these files)

| New Feature | Existing Function | Already In |
|-------------|------------------|-----------|
| /api/agents list | `listCards(db)` | src/registry/store.ts |
| /api/agents/:owner skills | `listCards(db, owner)` | src/registry/store.ts |
| /api/activity base data | `getRequestLog(db, limit, since)` | src/registry/request-log.ts |
| /me/transactions | `getTransactions(db, owner, limit)` | src/credit/ledger.ts |
| Agent identicons | `boring-avatars` (already installed) | hub/src/components/CardModal.tsx |

### Build Order Recommendations

Based on dependency analysis:

1. **New types + vite.config proxy** — Zero risk, unblocks all other work. `hub/src/types.ts` and `hub/vite.config.ts` changes first.

2. **Backend endpoints** — `src/registry/server.ts` new routes + `src/registry/request-log.ts` activity query function. No frontend dependency.

3. **New hooks** — useAgents, useActivity, useCredit. Depend on backend endpoints being live (or mockable in tests).

4. **New pages (parallel)** — AgentList + ProfilePage, ActivityFeed, DocsPage, CreditDashboard can all be built in parallel once hooks exist.

5. **App.tsx navigation wiring** — Extend tab system, add NavBar, wire credit state. Integrates all new pages.

6. **Modifications to existing components** — CardModal enhancements, OwnerDashboard credit section. Can be done any time after types are updated.

7. **Claude Code plugin files** — marketplace.json + plugin.json + SKILL.md copy. Zero code dependency, can be done any time.

---

## Sources

- Direct inspection: `hub/src/App.tsx`, `hub/src/hooks/useCards.ts`, `hub/src/hooks/useRequests.ts`, `hub/src/hooks/useAuth.ts` — confirmed tab routing pattern and hook structure — HIGH confidence
- Direct inspection: `src/registry/server.ts` — confirmed all existing routes, auth pattern, scoped plugin scope — HIGH confidence
- Direct inspection: `src/registry/store.ts` — confirmed `listCards()`, `getCard()` signatures — HIGH confidence
- Direct inspection: `src/registry/request-log.ts` — confirmed table schema, `getRequestLog()` function — HIGH confidence
- Direct inspection: `src/credit/ledger.ts` — confirmed `getTransactions()` already exists, confirmed credit table schema — HIGH confidence
- Direct inspection: `hub/vite.config.ts` — confirmed proxy config and existing entries — HIGH confidence
- Direct inspection: `hub/src/types.ts` — confirmed HubCard type and existing interfaces — HIGH confidence
- Official Claude Code docs: https://code.claude.com/docs/en/plugin-marketplaces — `.claude-plugin/marketplace.json` schema, `plugin.json` placement, relative path source mechanics, install commands — HIGH confidence
- `v2.2-milestone.md` — confirmed feature requirements, UI wireframes, and implementation priority order — HIGH confidence

---

*Architecture research for: AgentBnB v2.2 Hub Feature Expansion + Multi-Platform Distribution*
*Researched: 2026-03-16*
