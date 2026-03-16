# Phase 13: Activity Feed + Docs Page — Research

**Researched:** 2026-03-16
**Domain:** React polling hook with prepend pattern, SQLite JOIN query for public feed, static TypeScript content data
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FEED-01 | Activity feed page at /hub/#/activity shows public exchange history | Route placeholder already in main.tsx line 63-68 — replace placeholder div with ActivityFeed component |
| FEED-02 | Feed displays 4 event types: exchange_completed, capability_shared, agent_joined, milestone | request_log has action_type column; event type derivation logic documented below |
| FEED-03 | Feed polls backend every 10 seconds with prepend-only updates, no scroll reset | useActivity hook with `since` timestamp + setItems(prev => [...new, ...prev]) pattern; 10s interval (not 30s) |
| FEED-04 | Backend GET /api/activity returns paginated activity from request_log JOIN capability_cards | New route in server.ts + getActivityFeed() function in request-log.ts; JOIN query documented below |
| DOCS-01 | Docs page at /hub/#/docs shows Getting Started guide | Route placeholder already in main.tsx line 69-75 — replace with DocsPage component |
| DOCS-02 | Docs page shows multi-tool install commands (Claude Code, OpenClaw, Antigravity, CLI) with copy buttons | Static TS data in lib/docs-content.ts; copy buttons reuse navigator.clipboard pattern from CardModal |
| DOCS-03 | Docs page shows Capability Card schema reference | Section in lib/docs-content.ts with card schema fields as ReactNode content |
| DOCS-04 | Docs page shows API endpoint reference | Section in lib/docs-content.ts with all public endpoints as ReactNode content |
</phase_requirements>

---

## Summary

Phase 13 replaces two placeholder divs in `main.tsx` (lines 63-75) with the ActivityFeed and DocsPage components. The routing infrastructure from Phase 12 is fully in place — no routing changes are needed. The Vite proxy for `/api` is already configured in `vite.config.ts`. The work is two parallel tracks: (1) a new Fastify route + hook + component for the activity feed, and (2) a static TypeScript data file + component for the docs page.

The activity feed is the only piece with meaningful architecture decisions. The feed must use a `since` timestamp in polling requests and prepend new entries (not replace the list) to preserve scroll position. The poll interval is 10 seconds per FEED-03, not 30 seconds like other hooks. The backend query requires a LEFT JOIN against `capability_cards` to get the provider (card owner) — the `request_log` table already has `card_id` for this purpose. Autonomy audit rows (`action_type IS NOT NULL`) must be filtered from the public feed.

The docs page is deliberately simple: static TypeScript data in `lib/docs-content.ts` with JSX content, no Markdown processing library, no network requests. This design decision is locked (see project STATE.md). Copy buttons reuse the `navigator.clipboard.writeText` pattern that already exists in `GetStartedCTA.tsx`.

**Primary recommendation:** Build the backend endpoint first (verify the JOIN query and action_type filter produce correct data), then build the hook with prepend pattern, then the components. DocsPage can be built in complete parallel with the feed work.

---

## Standard Stack

### Core (already installed — no new dependencies for this phase)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| react-router | 7.13.1 | Hash routing — routes already registered | Already in use |
| React 18 | 18.3.1 | Component rendering | Already in use |
| TypeScript | 5.7.3 | Type safety | Already in use |
| Tailwind CSS | 3.4.17 | Styling | Already in use |
| Vitest | latest | Test framework | Already in use |
| Fastify | 5.x | Backend routes | Already in use |
| better-sqlite3 | latest | SQLite queries | Already in use |

**No new npm dependencies required for Phase 13.** The docs page uses static TypeScript JSX data (not react-markdown). The activity feed uses native `setInterval` (not a library).

### What NOT to add

- `react-markdown` — locked decision: docs page uses static TS data (STATE.md line 76)
- `@tailwindcss/typography` / `prose` — fights dark theme, locked out
- `framer-motion` — defer; Tailwind transitions sufficient for this phase
- Any SSE/WebSocket library — v2.3 concern; polling is sufficient (REQUIREMENTS.md line 76-77)

---

## Architecture Patterns

### Pattern 1: Replace Placeholder Routes

The `/activity` and `/docs` routes in `main.tsx` already exist as placeholder divs (lines 63-75). Phase 13 replaces those placeholder elements with real component imports. No new router entries needed.

**Current state (main.tsx lines 62-75):**
```typescript
{
  path: 'activity',
  element: (
    <div className="text-hub-text-muted py-12 text-center">
      Activity — Phase 13
    </div>
  ),
},
{
  path: 'docs',
  element: (
    <div className="text-hub-text-muted py-12 text-center">
      Docs — Phase 13
    </div>
  ),
},
```

**Phase 13 target:**
```typescript
import ActivityFeed from './components/ActivityFeed.js';
import DocsPage from './components/DocsPage.js';

// Replace placeholder elements:
{ path: 'activity', element: <ActivityFeed /> },
{ path: 'docs', element: <DocsPage /> },
```

### Pattern 2: Activity Feed Hook with Prepend-Only Updates (10s Poll)

The hook follows the established `isFirstFetch` pattern from `useCards.ts` and `useAgents.ts`, with two critical differences:
1. Poll interval is 10 seconds (not 30), per FEED-03
2. Uses `since` timestamp and prepends new entries (not replaces), per FEED-03 + Pitfall 10

```typescript
// hub/src/hooks/useActivity.ts
export function useActivity(): UseActivityResult {
  const [items, setItems] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastSeenAt = useRef<string | null>(null);
  const isFirstFetch = useRef(true);

  const fetchActivity = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (lastSeenAt.current) {
        params.set('since', lastSeenAt.current);
      }
      const res = await fetch(`/api/activity?${params.toString()}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json() as { items: ActivityEvent[]; total: number };
      if (data.items.length > 0) {
        // Track newest item for next poll
        lastSeenAt.current = data.items[0].created_at;
        if (isFirstFetch.current) {
          // First fetch: set items directly
          setItems(data.items);
        } else {
          // Subsequent polls: prepend new items only
          setItems(prev => [...data.items, ...prev]);
        }
      }
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load activity: ${msg}`);
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isFirstFetch.current = true;
    lastSeenAt.current = null;
    setLoading(true);
    void fetchActivity();
  }, [fetchActivity]);

  // 10s poll — NOT 30s (per FEED-03 spec)
  useEffect(() => {
    const id = setInterval(() => void fetchActivity(), 10_000);
    return () => clearInterval(id);
  }, [fetchActivity]);

  return { items, loading, error };
}
```

### Pattern 3: Backend GET /api/activity — JOIN Query, Not N+1

Add a new `getActivityFeed()` function to `src/registry/request-log.ts` and a new Fastify route to `src/registry/server.ts`.

**Key constraints:**
- Filter `action_type IS NULL` to exclude autonomy audit rows from public feed (confirmed in request-log.ts)
- LEFT JOIN `capability_cards` to get `provider` (card owner) — `request_log` has `card_id` for this
- Support `?since=ISO_TIMESTAMP` for prepend-only polling
- Support `?limit` (default 20, max 100) for initial load pagination
- Public route (no auth) — goes at top-level scope in server.ts, not inside `ownerRoutes`

**Function to add to request-log.ts:**
```typescript
export interface ActivityFeedEntry {
  id: string;
  card_name: string;
  requester: string;
  provider: string | null;   // from capability_cards.owner via JOIN
  status: 'success' | 'failure' | 'timeout';
  credits_charged: number;
  latency_ms: number;
  created_at: string;
}

export function getActivityFeed(
  db: Database.Database,
  limit = 20,
  since?: string   // ISO timestamp string (not SincePeriod enum)
): ActivityFeedEntry[] {
  const params: unknown[] = [];
  let whereClause = 'WHERE r.action_type IS NULL';
  if (since) {
    whereClause += ' AND r.created_at > ?';
    params.push(since);
  }
  params.push(Math.min(limit, 100));

  const stmt = db.prepare(`
    SELECT r.id, r.card_name, r.requester, r.status,
           r.credits_charged, r.latency_ms, r.created_at,
           c.owner AS provider
    FROM request_log r
    LEFT JOIN capability_cards c ON r.card_id = c.id
    ${whereClause}
    ORDER BY r.created_at DESC
    LIMIT ?
  `);
  return stmt.all(...params) as ActivityFeedEntry[];
}
```

**Fastify route to add to server.ts (public, not inside ownerRoutes):**
```typescript
server.get('/api/activity', async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
  const since = query.since;  // ISO timestamp or undefined
  const items = getActivityFeed(db, limit, since);
  return reply.send({ items, total: items.length, limit });
});
```

### Pattern 4: Event Type Derivation (FEED-02)

FEED-02 requires 4 event types: `exchange_completed`, `capability_shared`, `agent_joined`, `milestone`. The `request_log` table records only actual requests — it does not have native event types. Derivation logic:

| Event Type | How to Derive | Source Data |
|------------|--------------|-------------|
| `exchange_completed` | `action_type IS NULL AND status = 'success'` | Standard capability request, completed |
| `capability_shared` | `action_type = 'auto_share'` | Autonomy auto-share audit event — BUT these are filtered from the public feed (action_type IS NULL filter) |
| `agent_joined` | Synthetic: first `created_at` per owner | Derived client-side or as a special backend event |
| `milestone` | Manual/synthetic data | Not naturally in request_log |

**Resolution:** The `action_type IS NULL` filter means only `exchange_completed` events come from request_log directly. For `capability_shared`, `agent_joined`, and `milestone`, there are two approaches:

**Option A (Simpler, recommended):** Only show `exchange_completed` events from request_log. Display them with type-based icons/badges. Mark other event types as future enhancements. This matches FEED-02 literally if we interpret "displays 4 event types" as "supports rendering 4 types when they exist."

**Option B (Complete):** Add a separate query for auto_share events (action_type = 'auto_share') with a limit, combine with exchange events, and derive `agent_joined` client-side from agent join dates via a separate `/api/agents` call.

**Recommendation: Option A for this phase.** FEED-02 says "displays 4 event types" — the frontend component can render all 4 types from its `ActivityEvent` interface. The backend feeds primarily exchange_completed events. The `ActivityEvent` type already exists in `hub/src/types.ts` (as `ActivityEntry`) with `status` field — add `event_type` field derived client-side based on request context.

**Practical event_type assignment in useActivity:**
```typescript
function deriveEventType(item: RawActivityEntry): ActivityEvent['event_type'] {
  if (item.status === 'success') return 'exchange_completed';
  return 'exchange_completed';  // all request_log items are exchange events
}
```

The ActivityEvent interface needs a `type` field and `provider` field (from JOIN). Update `hub/src/types.ts`:
```typescript
export interface ActivityEvent {
  id: string;
  type: 'exchange_completed' | 'capability_shared' | 'agent_joined' | 'milestone';
  card_name: string;
  requester: string;
  provider: string | null;
  status: 'success' | 'failure' | 'timeout';
  credits_charged: number;
  latency_ms: number;
  created_at: string;
}
```

Note: The existing `ActivityEntry` interface in types.ts (used by ProfilePage) does NOT have `provider` or `type` fields. Phase 13 adds a new `ActivityEvent` interface. The existing `ActivityEntry` stays unchanged (ProfilePage uses it).

### Pattern 5: Docs Page — Static TypeScript Data

`lib/docs-content.ts` exports an array of doc sections. Each section has a title and JSX content. `DocsPage.tsx` maps over sections and renders them. Copy buttons use `navigator.clipboard.writeText`.

**Structure of lib/docs-content.ts:**
```typescript
// hub/src/lib/docs-content.ts
export interface DocSection {
  id: string;
  title: string;
  content: React.ReactNode;  // JSX with styled elements
}

export const DOCS_SECTIONS: DocSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    content: (
      // JSX with headings, paragraphs, code blocks, copy buttons
    ),
  },
  {
    id: 'install',
    title: 'Install Commands',
    content: (
      // DOCS-02: Claude Code, OpenClaw, Antigravity, CLI install commands
    ),
  },
  {
    id: 'card-schema',
    title: 'Capability Card Schema',
    content: (
      // DOCS-03: Card schema reference
    ),
  },
  {
    id: 'api-reference',
    title: 'API Reference',
    content: (
      // DOCS-04: All public API endpoints
    ),
  },
];
```

**DocsPage.tsx structure:**
```typescript
// hub/src/components/DocsPage.tsx
import { DOCS_SECTIONS } from '../lib/docs-content.js';

export default function DocsPage(): JSX.Element {
  const [activeSection, setActiveSection] = useState('getting-started');

  return (
    <div className="flex gap-8">
      {/* Sidebar nav */}
      <nav className="w-48 shrink-0">
        {DOCS_SECTIONS.map(section => (
          <button key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={/* active/inactive styles */}
          >
            {section.title}
          </button>
        ))}
      </nav>
      {/* Content */}
      <main className="flex-1 min-w-0">
        {DOCS_SECTIONS.filter(s => s.id === activeSection).map(s => (
          <div key={s.id}>{s.content}</div>
        ))}
      </main>
    </div>
  );
}
```

### Pattern 6: Copy Button (reuse GetStartedCTA pattern)

`GetStartedCTA.tsx` already has a working copy button with checkmark feedback:
```typescript
// From GetStartedCTA.tsx — reuse this exact pattern
const [copied, setCopied] = useState(false);
const handleCopy = () => {
  void navigator.clipboard.writeText(text);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
};
```

Create a shared `CopyButton` component in `hub/src/components/CopyButton.tsx` to avoid duplicating this in every docs section.

### Recommended Project Structure (new files only)

```
hub/src/
├── components/
│   ├── ActivityFeed.tsx       NEW: page-level feed container with polling
│   ├── ActivityEvent.tsx      NEW: single event row renderer
│   ├── DocsPage.tsx           NEW: sidebar + content layout
│   └── CopyButton.tsx         NEW: reusable copy-to-clipboard button
├── hooks/
│   └── useActivity.ts         NEW: 10s polling hook with prepend pattern
├── lib/
│   └── docs-content.ts        NEW: static doc sections as TS data
└── types.ts                   MODIFY: add ActivityEvent interface

src/registry/
├── request-log.ts             MODIFY: add getActivityFeed() function
└── server.ts                  MODIFY: add GET /api/activity route

hub/src/main.tsx               MODIFY: replace 2 placeholder elements
```

### Anti-Patterns to Avoid

- **Full list replacement on poll:** `setItems(newItems)` resets scroll position every 10 seconds. Must use `setItems(prev => [...newItems, ...prev])` for subsequent polls.
- **No `since` timestamp:** Fetching without `since` re-downloads all items on every poll tick. Track `lastSeenAt` ref and pass it as query param.
- **Including autonomy audit rows:** Failing to filter `WHERE action_type IS NULL` includes auto_share/auto_request events in the public feed. These are internal events, not user-facing activity.
- **Inline docs content:** Writing all documentation directly in DocsPage.tsx creates a 500-line JSX blob. Separate data (docs-content.ts) from rendering (DocsPage.tsx).
- **Using react-markdown:** Decision is locked. Use static TypeScript JSX data. No Markdown processing dependency.
- **Duplicating copy button:** GetStartedCTA already has the copy pattern. Extract to CopyButton component.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Copy to clipboard | Custom clipboard API wrapper | Reuse GetStartedCTA pattern, extract to CopyButton.tsx | Pattern already tested in existing code |
| Polling interval | Custom polling class | Native `setInterval` in useCallback | Already the pattern in useCards.ts, useAgents.ts |
| Event type derivation | Separate `activity_events` table | Derive from `request_log` at query time | Avoids two-write-path drift |
| Docs styling | @tailwindcss/typography prose | Inline Tailwind classes on each element | prose assumes light background; dark theme requires full override |

---

## Common Pitfalls

### Pitfall 1: Scroll Position Resets Every 10 Seconds
**What goes wrong:** `setItems(data.items)` (replace) causes the feed to scroll to top on every poll tick.
**Why it happens:** Full replacement re-renders the list from scratch.
**How to avoid:** On subsequent polls (not first fetch), prepend: `setItems(prev => [...data.items, ...prev])`. Use `isFirstFetch` ref to distinguish.
**Warning signs:** User scrolls down in feed, waits 10s, view jumps to top.

### Pitfall 2: Autonomy Audit Rows in Public Feed
**What goes wrong:** `action_type = 'auto_share'` / `action_type = 'auto_request'` rows appear in the public feed.
**Why it happens:** Missing `WHERE action_type IS NULL` in the SQL query.
**How to avoid:** `getActivityFeed()` must always include `AND action_type IS NULL`. Verified in `request-log.ts` — the `getSkillRequestCount()` function at line 146 uses the same pattern for reference.
**Warning signs:** Feed shows "auto_share" entries mixed with capability exchange events.

### Pitfall 3: `since` Timestamp Not Threaded Through
**What goes wrong:** `lastSeenAt.current` is updated but never passed as a query param, so every poll re-downloads the full 20-item list.
**Why it happens:** Easy to forget to include the param in the URLSearchParams build.
**How to avoid:** Set `params.set('since', lastSeenAt.current)` before each non-first-fetch call. Backend endpoint must parse `?since` as ISO string and add `AND r.created_at > ?` to the WHERE clause.

### Pitfall 4: ActivityEvent vs ActivityEntry Type Collision
**What goes wrong:** `hub/src/types.ts` already has `ActivityEntry` (used by ProfilePage for `/api/agents/:owner` recent_activity). Adding a new `ActivityEvent` type for the public feed is correct — but using the wrong type in either component causes TypeScript errors.
**How to avoid:** `ActivityEntry` (existing, no `provider`, no `type` field) stays for ProfilePage. Add new `ActivityEvent` (with `provider` and `type`) for the activity feed. Name them distinctly.

### Pitfall 5: docs-content.ts Not Using .js Extension in Imports
**What goes wrong:** TypeScript ESM imports in this project require explicit `.js` extension (e.g., `import { DOCS_SECTIONS } from '../lib/docs-content.js'`). Omitting the `.js` causes runtime import failures in the Vite build.
**Why it happens:** Standard TypeScript habit from CommonJS environments.
**How to avoid:** Follow the existing pattern — all imports in hub/src use `.js` extension (see App.tsx, NavBar.tsx, etc.).

### Pitfall 6: DocsPage Copy Buttons Failing in Test Environment
**What goes wrong:** `navigator.clipboard` is not available in jsdom test environment. Copy button throws errors.
**How to avoid:** Check `if (navigator.clipboard)` before calling, or mock in tests. The existing `GetStartedCTA.tsx` doesn't test the copy action — same approach is acceptable for CopyButton.

---

## Code Examples

### GET /api/activity — Full Handler

```typescript
// Source: pattern from server.ts /api/agents handler (lines 235-292)
// Add to src/registry/server.ts after the /api/agents/:owner route

server.get('/api/activity', async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
  const since = query.since;  // ISO timestamp string, or undefined
  const items = getActivityFeed(db, limit, since);
  return reply.send({ items, total: items.length, limit });
});
```

### ActivityFeed Component Skeleton

```typescript
// hub/src/components/ActivityFeed.tsx
import { useActivity } from '../hooks/useActivity.js';
import ActivityEventRow from './ActivityEvent.js';

export default function ActivityFeed(): JSX.Element {
  const { items, loading, error } = useActivity();

  if (loading) return <ActivityFeedSkeleton />;
  if (error) return <ActivityFeedError message={error} />;
  if (items.length === 0) return <ActivityFeedEmpty />;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-hub-text-primary">Activity</h1>
        <span className="text-sm text-hub-text-muted">Updates every 10s</span>
      </div>
      <div className="space-y-1">
        {items.map(item => (
          <ActivityEventRow key={item.id} event={item} />
        ))}
      </div>
    </div>
  );
}
```

### ActivityEvent Row

```typescript
// hub/src/components/ActivityEvent.tsx
import type { ActivityEvent } from '../types.js';

const EVENT_LABELS: Record<ActivityEvent['type'], string> = {
  exchange_completed: 'Exchange',
  capability_shared: 'Shared',
  agent_joined: 'Joined',
  milestone: 'Milestone',
};

const STATUS_COLORS: Record<string, string> = {
  success: 'text-emerald-400',
  failure: 'text-red-400',
  timeout: 'text-yellow-400',
};

export default function ActivityEventRow({ event }: { event: ActivityEvent }): JSX.Element {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.03] hover:bg-white/[0.05] transition-colors">
      <span className={`text-xs font-mono uppercase ${STATUS_COLORS[event.status] ?? 'text-hub-text-muted'}`}>
        {EVENT_LABELS[event.type]}
      </span>
      <span className="text-hub-text-primary text-sm flex-1 truncate">
        <span className="font-medium">{event.requester}</span>
        {' → '}
        <span className="text-hub-text-muted">{event.card_name}</span>
      </span>
      {event.credits_charged > 0 && (
        <span className="text-emerald-400 font-mono text-xs">cr {event.credits_charged}</span>
      )}
      <span className="text-hub-text-muted text-xs shrink-0">{timeAgo(event.created_at)}</span>
    </div>
  );
}
```

### Install Commands Content (DOCS-02)

The install commands for DOCS-02 need to be exact. Based on STATE.md and REQUIREMENTS.md:

```typescript
// Section content for DOCS-02 in lib/docs-content.ts
const installCommands = [
  { tool: 'Claude Code', command: 'npx agentbnb init', description: 'Bootstrap via Claude Code skill' },
  { tool: 'CLI (direct)', command: 'npm install -g agentbnb && agentbnb init', description: 'Global CLI install' },
  { tool: 'OpenClaw', command: 'openclaw install agentbnb', description: 'OpenClaw skill registry' },
  { tool: 'Antigravity', command: 'ag skill add agentbnb', description: 'Antigravity skill manager' },
];
```

Note: Exact Antigravity and OpenClaw install command syntax should be verified against the existing SKILL.md file in `skills/agentbnb/SKILL.md` before writing the content. The CLI command is confirmed from STATE.md (`agentbnb init`).

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Tab-state navigation with activeTab useState | react-router 7.13.1 createHashRouter | Already done in Phase 12; no work for Phase 13 |
| Polling replaces full list | Prepend-only with `since` timestamp | Must implement in useActivity — not done yet |
| SSE for real-time feeds | setInterval polling at 10s | Correct for v2.2; SSE deferred to v2.3 per REQUIREMENTS.md |
| react-markdown for docs | Static TS JSX data | Locked decision; no new deps needed |

---

## Open Questions

1. **Exact OpenClaw and Antigravity install command syntax**
   - What we know: `openclaw install agentbnb` from CLAUDE.md; Antigravity command is uncertain
   - What's unclear: Whether `ag skill add agentbnb` is the correct Antigravity command
   - Recommendation: Read `skills/agentbnb/SKILL.md` during plan execution to confirm exact install commands before writing docs-content.ts

2. **`agent_joined` event source**
   - What we know: request_log does not have agent join events; they'd have to come from `capability_cards.created_at` MIN per owner
   - What's unclear: Whether Phase 13 should synthesize these or simply not include them in initial feed
   - Recommendation: For Phase 13, show only `exchange_completed` events from request_log. Document the other types in the ActivityEvent interface for future use. The ActivityEvent interface supports all 4 types.

3. **`capability_shared` events visibility**
   - What we know: `action_type = 'auto_share'` rows exist in request_log but are filtered out of public feed
   - What's unclear: Whether auto_share events should be shown in the feed with a different visual treatment
   - Recommendation: Include auto_share events in the feed with a distinct visual badge (purple/blue) — remove the blanket `action_type IS NULL` filter and instead map `action_type` values to event types. This satisfies FEED-02 more completely.

   **Revised SQL for Option B:**
   ```sql
   -- Include both exchange events AND auto_share events
   WHERE r.action_type IS NULL OR r.action_type = 'auto_share'
   ```
   And in frontend: `action_type === 'auto_share' ? 'capability_shared' : 'exchange_completed'`

4. **`milestone` event type**
   - What we know: There is no milestone source in the database
   - What's unclear: Whether milestones should be hardcoded (e.g., "100 exchanges achieved") or deferred
   - Recommendation: Defer milestone events to v2.3. The interface supports the type; the backend simply never returns it.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (backend: root vitest.config; hub: hub/vite.config.ts test block) |
| Config file | Root: vitest.config (implicit), Hub: hub/vite.config.ts lines 21-26 |
| Backend quick run | `pnpm vitest run src/registry/server.test.ts` |
| Backend full suite | `pnpm test` (root) |
| Hub quick run | `cd hub && pnpm vitest run src/hooks/useActivity.test.ts` |
| Hub full suite | `cd hub && pnpm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FEED-04 | GET /api/activity returns items from request_log JOIN capability_cards | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ (add tests to existing file) |
| FEED-04 | action_type IS NULL filter excludes autonomy audit rows | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ (add tests to existing file) |
| FEED-04 | `?since=ISO` parameter returns only newer entries | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ (add tests to existing file) |
| FEED-04 | `provider` field populated from capability_cards JOIN | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ (add tests to existing file) |
| FEED-03 | getActivityFeed() function in request-log.ts returns sorted entries | unit | `pnpm vitest run src/registry/request-log.test.ts` | ✅ (add tests to existing file) |
| FEED-01 | ActivityFeed route renders (not placeholder div) | smoke/manual | Browser navigation to /hub/#/activity | N/A — manual |
| FEED-02 | event_type field present in ActivityEvent objects | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ (add tests to existing file) |
| FEED-03 | useActivity hook: prepend new items on subsequent polls | unit | `cd hub && pnpm vitest run src/hooks/useActivity.test.ts` | ❌ Wave 0 |
| FEED-03 | Scroll position preserved after poll | manual | Browser: scroll down, wait 10s, verify position | N/A — manual |
| DOCS-01..04 | DocsPage renders 4 sections with correct titles | smoke/manual | Browser navigation to /hub/#/docs | N/A — manual |
| DOCS-02 | Install commands for all 4 tools present in content | unit | `cd hub && pnpm vitest run src/lib/docs-content.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/registry/server.test.ts`
- **Per wave merge:** `pnpm test && cd hub && pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `hub/src/hooks/useActivity.test.ts` — covers FEED-03 prepend pattern and `since` timestamp
- [ ] `hub/src/lib/docs-content.test.ts` — covers DOCS-02 install command completeness (4 tools)
- Add new test cases to existing `src/registry/server.test.ts` for FEED-04 (no new file, extend existing)
- Add new test cases to existing `src/registry/request-log.test.ts` for getActivityFeed() (no new file, extend existing)

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection: `hub/src/main.tsx` lines 62-75 — confirmed placeholder divs at `/activity` and `/docs` routes; no routing changes needed
- Direct codebase inspection: `hub/src/hooks/useAgents.ts` — confirmed polling pattern with `isFirstFetch`, 30s interval; Phase 13 uses same pattern at 10s
- Direct codebase inspection: `hub/src/hooks/useCards.ts` — confirmed `setAllCards(data.items)` (replace) pattern; Phase 13 must NOT copy this — use prepend instead
- Direct codebase inspection: `src/registry/request-log.ts` — confirmed `action_type` column exists (lines 88-92, 146, 171, 182); confirmed `getSkillRequestCount()` uses `AND action_type IS NULL` as precedent
- Direct codebase inspection: `src/registry/server.ts` lines 235-363 — confirmed `/api/agents` and `/api/agents/:owner` routes use same JOIN pattern; confirmed public routes go before ownerRoutes
- Direct codebase inspection: `hub/vite.config.ts` line 18 — `/api` proxy already configured; no change needed
- Direct codebase inspection: `hub/src/types.ts` lines 74-88 — confirmed existing `ActivityEntry` interface (no provider, no type); new `ActivityEvent` must be distinct
- Direct codebase inspection: `hub/src/App.tsx` — confirmed layout shell pattern; ActivityFeed and DocsPage render inside `<Outlet>` without App.tsx changes
- Direct codebase inspection: `hub/src/components/GetStartedCTA.tsx` — confirmed copy button pattern available for reuse

### Secondary (MEDIUM confidence)

- `.planning/research/PITFALLS.md` Pitfall 10 — scroll position on poll; verified root cause and fix pattern
- `.planning/research/ARCHITECTURE.md` Pattern 4 — activity feed JOIN query design; verified against actual request-log.ts schema
- `.planning/STATE.md` line 76 — "Docs page uses static TypeScript data in lib/docs-content.ts, not react-markdown fetch" — locked decision

### Tertiary (LOW confidence)

- None — all findings grounded in direct codebase inspection or locked project decisions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all tech already in codebase
- Architecture: HIGH — based on direct inspection of main.tsx, request-log.ts, server.ts, useAgents.ts, useCards.ts
- Pitfalls: HIGH — grounded in codebase analysis + PITFALLS.md precedent + verified SQL patterns

**Research date:** 2026-03-16
**Valid until:** 30 days (stable stack; no external library changes relevant to this phase)
