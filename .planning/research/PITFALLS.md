# Pitfalls Research

**Domain:** Adding Hub pages, activity feeds, credit charts, docs, plugin marketplace, and mobile responsive layout to an existing TypeScript/React/SQLite application (AgentBnB v2.2)
**Researched:** 2026-03-16
**Confidence:** HIGH (grounded in codebase analysis + Claude Code plugin docs + React/Fastify ecosystem research)

---

## Critical Pitfalls

### Pitfall 1: Tab-Based SPA Navigation vs. URL-Based Routing Creates Dead Ends

**What goes wrong:**
The existing Hub uses tab-state managed by a single `useState<ActiveTab>` in `App.tsx`. This works fine with 3 tabs. Adding Agent Profiles (`/hub/agents`), individual profile pages (`/hub/agents/:owner`), and Activity Feed means you now have pages with nested views and deep-linkable states — something tab-switching cannot express. A user who clicks an agent profile in the Activity Feed needs a URL they can copy and revisit. Tab state lives in React memory: refresh the browser and you're back at "discover". The deeper pitfall: if you start building nested views without routing, you will encounter this after the views are already half-built and face a larger refactor than if you had added routing at the start.

**Why it happens:**
The v2.1 Hub used tabs for three views that were genuinely interchangeable (no back-navigation needed). Developers extend the same pattern to five tabs without recognizing that "Agents" and "Activity" require navigational history — the back button must work on a profile detail view.

**How to avoid:**
Add `react-router-dom` before building the new pages. Wire all existing tabs to URL paths (`/hub/`, `/hub/agents`, `/hub/activity`, `/hub/docs`, `/hub/agents/:owner`). The tab switcher becomes a nav component with `<NavLink>` elements. This is one day of work done upfront vs. two days of refactoring done later. The Fastify static server already serves the Hub at `/hub/` — add `historyApiFallback: true` equivalent by making the Fastify static route serve `index.html` for all `/hub/*` paths that don't match a static file.

**Warning signs:**
- A profile detail page is built as a component that replaces the card grid inside the "Agents" tab, with no URL change
- The back button in the browser has no effect within the Hub
- "Agent Profile" is rendered by setting a `selectedAgent` state variable, not by navigating to a new route

**Phase to address:**
Phase 12 (Hub Feature Expansion) — first task before building any new page component. Routing refactor must precede all new page builds.

---

### Pitfall 2: The Fastify Static Server Breaks SPA Routes on Direct Access

**What goes wrong:**
The existing Fastify server serves the Hub SPA at `/hub/` using `@fastify/static`. It works perfectly when you navigate within the app. But when you add real URL routes (e.g., `/hub/agents/chengwen-openclaw`) and a user directly accesses that URL (by pasting it into the browser or refreshing), Fastify receives an HTTP GET for `/hub/agents/chengwen-openclaw`. The static plugin looks for a file at that path, finds nothing, and returns a 404. The SPA never loads. This is invisible during development (where Vite handles it) and breaks in production immediately.

**Why it happens:**
`@fastify/static` serves files from a directory. It has no concept of "fall back to index.html for unknown paths." It returns 404 for any path it can't map to a real file.

**How to avoid:**
Add a wildcard catch-all route in the Fastify server AFTER the static plugin registration:

```typescript
server.get('/hub/*', async (_request, reply) => {
  return reply.sendFile('index.html');
});
```

The route must be registered after `@fastify/static` so that real static assets (CSS, JS) are served correctly. Register the catch-all last. Verify this works for all planned routes during integration testing, not just in Vite dev server.

**Warning signs:**
- All Hub routes work during `vite dev` but 404 after `pnpm build`
- The production test plan only navigates within the app, never tests direct URL access
- No catch-all route exists in `registry/server.ts`

**Phase to address:**
Phase 12 (Hub Feature Expansion) — Part of the routing setup task. Must be verified before any new page is marked complete.

---

### Pitfall 3: New `/api/*` Routes Conflict With Existing Unnamespaced Routes

**What goes wrong:**
The current registry server exposes `GET /cards`, `GET /health`, `GET /me`, `GET /requests`, etc. — all at the root level with no prefix. Phase 12 needs new endpoints: `GET /api/agents`, `GET /api/agents/:owner`, `GET /api/activity`. If the new endpoints are added under `/api` and the old ones remain at root, the frontend ends up making calls to two different base paths. The Vite proxy config in `vite.config.ts` proxies specific root paths (`/cards`, `/health`, `/me`, `/requests`) — it does not proxy `/api`. In dev mode, all `/api/*` calls will fail with CORS/proxy errors unless the config is updated.

**Why it happens:**
Adding a new namespace seems clean, but the existing frontend hooks (`useCards`, `useRequests`, `useAuth`) are hardcoded to the old paths. The developer adds `/api/agents` without realizing the proxy gap, and the feature appears to work only because they tested it from the production build (where proxy doesn't apply) or missed the dev proxy entirely.

**How to avoid:**
Pick one strategy upfront: either migrate all existing endpoints to `/api/*` (more work, cleaner long-term) or add all new endpoints at the root level without a prefix (less work, consistent with existing). Given the project's local-first, single-server design, root-level routes are fine. Add `/agents` and `/activity` at the root, matching the existing pattern. Update `vite.config.ts` proxy to include the new paths at the same time the new Fastify routes are added.

**Warning signs:**
- `vite.config.ts` proxy block does not include the new endpoint paths
- New endpoints use `/api/` prefix while existing ones do not
- Network tab shows 404 for new endpoints only in dev mode, but not in production build

**Phase to address:**
Phase 12 (Hub Feature Expansion) — Define the API naming convention before writing any new endpoint. Update the proxy config in the same commit as the Fastify route.

---

### Pitfall 4: Activity Feed Queries Produce N+1 SQLite Reads When Building Event Objects

**What goes wrong:**
The activity feed needs to present events like "maya-devops requested TTS from chengwen-openclaw — 5 credits, 1.2s." This data lives in `request_log` (who requested what, status, credits, latency). But `request_log.card_name` and `request_log.requester` are strings — to display the full agent context (how many skills they have, their reputation), you'd need to join against the `capability_cards` table. If the feed endpoint fetches 20 log entries and then loops, calling `getCard(db, entry.card_id)` per entry, that is 21 SQLite queries per request. The symptoms are subtle — SQLite is fast locally, so it doesn't feel slow at first. But it will appear under any load and it's the wrong pattern.

**Why it happens:**
The existing `getRequestLog()` function returns `RequestLogEntry[]` with no joins. It's easy to fetch the array and then enrich each entry in a loop without realizing each enrichment is a separate query.

**How to avoid:**
Write a single JOIN query for the activity feed endpoint from the start:

```sql
SELECT r.*, c.name as agent_name, c.data as card_data
FROM request_log r
LEFT JOIN capability_cards c ON r.card_id = c.id
ORDER BY r.created_at DESC
LIMIT ?
```

Return denormalized data from the API — the frontend should not need to make secondary requests to fill in agent names. The `request_log` table already stores `card_name` for exactly this reason — use it directly without joining if additional card context isn't needed.

**Warning signs:**
- Activity feed API handler loops over `getRequestLog()` results and calls `getCard()` inside the loop
- Activity feed response time grows linearly with `limit` parameter
- The frontend hook makes separate `/cards/:id` calls to get agent names for each feed entry

**Phase to address:**
Phase 12, Plan 12-02 (Activity Feed). The JOIN query must be in the initial implementation, not added when performance problems appear.

---

### Pitfall 5: Agent Profiles Aggregate Query Is Built Wrong — Credits Earned Is Not in the Schema

**What goes wrong:**
The milestone spec shows agent profiles with "cr 1,240 earned." This implies a sum of `credits_charged` from `request_log` WHERE the agent is the *provider* (not the requester). But `request_log.card_id` identifies the capability, not the capability owner. To compute "credits earned by agent X," you must JOIN `request_log` against `capability_cards` to find cards where `owner = X`, then sum `credits_charged` for successful requests on those cards. If this is implemented by fetching all cards for an owner and then looping over each card's request history, it's a cascading N+1 problem. Additionally, the credits earned number is entirely derived — it does not exist as a stored value anywhere.

**Why it happens:**
The spec shows a UI number. Developers assume there is a field for it. There isn't — it must be computed on the fly from two tables. The first implementation attempt is often a loop, not a GROUP BY query.

**How to avoid:**
Write the aggregate query upfront:

```sql
SELECT cc.owner, COUNT(DISTINCT cc.id) as skill_count,
       SUM(CASE WHEN rl.status='success' THEN rl.credits_charged ELSE 0 END) as credits_earned,
       AVG(CASE WHEN cc.data->>'$.metadata.success_rate' IS NOT NULL
                THEN CAST(cc.data->>'$.metadata.success_rate' AS REAL) END) as avg_success_rate
FROM capability_cards cc
LEFT JOIN request_log rl ON rl.card_id = cc.id
GROUP BY cc.owner
ORDER BY credits_earned DESC
```

Accept that `credits_earned` is a computed value and cache it aggressively (recompute at most once per minute). Do not add a new `credits_earned` column to the schema — it would be a denormalization that drifts from reality.

**Warning signs:**
- The `/agents` endpoint loops over cards per owner and queries `request_log` per card
- A new `credits_earned` column is added to `capability_cards` and updated on every request
- The agent list page is slow (> 200ms response) because it does multiple SQLite queries per agent

**Phase to address:**
Phase 12, Plan 12-01 (Agent Profiles). The aggregate query design must be settled before writing the Fastify handler.

---

### Pitfall 6: Recharts Tooltips Break the Dark Theme — Default Styles Override Tailwind

**What goes wrong:**
Recharts is a popular React charting library. Its default tooltip renders a white-background popup with black text. In the AgentBnB dark theme (`#08080C` background, `rgba(255,255,255,0.92)` text), the default tooltip is an eyesore. Attempting to override it with Tailwind classes applied to the tooltip wrapper does not work — Recharts renders the tooltip with inline `backgroundColor: '#fff'` that takes precedence over any class-based styling. Many developers spend time fighting this before discovering that the only working solution is passing a completely custom `content` component to `<Tooltip>`.

**Why it happens:**
Recharts's internal tooltip uses inline styles. Tailwind classes (even with `!important` via `!bg-hub-bg`) cannot override inline styles. The issue is documented in multiple Recharts GitHub issues (e.g., recharts/recharts#1402, recharts/recharts#663) but remains unfixed in the core library.

**How to avoid:**
Always use a custom `content` prop for Recharts `<Tooltip>` in this project. Write `CreditsTooltip` as a custom component from the start:

```tsx
<Tooltip content={<CreditsTooltip />} />
```

The custom component renders with full Tailwind control. Use CSS variables (`var(--color-bg)`, `var(--color-accent)`) for chart colors — they work in Recharts `stroke` and `fill` props and stay in sync with the design system automatically.

**Warning signs:**
- Recharts `<Tooltip>` is used without a `content` prop
- The credit chart is "finished" visually in light mode but looks broken on the dark background
- Any Tailwind class is applied to `<Tooltip wrapperClassName="...">` expecting it to control the background

**Phase to address:**
Phase 12, Plan 12-04 (Credit System UI). The custom tooltip component should be a shared utility used by all charts.

---

### Pitfall 7: `react-markdown` Renders Unstyled HTML That Fights the Design System

**What goes wrong:**
The Docs page will render Markdown content using `react-markdown`. Without configuration, `react-markdown` produces raw HTML elements (`<h1>`, `<p>`, `<code>`, etc.) with no styles. In a Tailwind reset environment, these elements render as bare, unstyled text — the heading `# Getting Started` looks identical to body copy. The code blocks render with default monospace font but no background, border, or syntax highlighting. The result looks like plaintext, not documentation.

**Why it happens:**
Developers add `react-markdown` and render the Markdown content, see that it "works" (text appears), and mark the task done. The visual quality gap is only apparent when looking at the rendered page critically.

**How to avoid:**
Pass a `components` prop to `<ReactMarkdown>` that maps each HTML element to a styled component:

```tsx
<ReactMarkdown components={{
  h1: ({children}) => <h1 className="text-2xl font-semibold text-hub-text-primary mt-8 mb-4">{children}</h1>,
  code: ({inline, className, children}) => inline
    ? <code className="font-mono text-sm bg-white/[0.06] px-1.5 py-0.5 rounded">{children}</code>
    : <CodeBlock className={className}>{children}</CodeBlock>,
  // ... all elements
}}>
```

For syntax highlighting, use `react-syntax-highlighter` with a custom dark theme that matches the design tokens. Do NOT use CSS `prose` classes (Tailwind Typography plugin) — they assume a light background and fight the dark theme without extensive overrides.

**Warning signs:**
- The Docs page uses `<ReactMarkdown>` without a `components` prop
- `@tailwindcss/typography` and the `prose` class are added to fix styling
- Heading sizes in docs are identical to body text size

**Phase to address:**
Phase 12, Plan 12-03 (Docs Page). The component map must be built as part of the initial Docs page, not patched after visual review.

---

### Pitfall 8: Claude Code Plugin — `plugin.json` Version Must Change With Every Release

**What goes wrong:**
The Claude Code plugin marketplace uses `plugin.json` to track versions. When a user has the plugin installed and the repo is updated, Claude Code compares the `version` field in `plugin.json`. If the version has not changed (e.g., it stays at `"1.0.0"` during development), Claude Code skips the update entirely — it treats the plugin as already up-to-date. This means all the SKILL.md improvements and bug fixes go undelivered to users who already installed the plugin. The problem is silent: no error, no warning. Users just don't get updates.

**Why it happens:**
Developers update `SKILL.md` content and push to GitHub without bumping `plugin.json` version. Semantic versioning on an internal file feels like overhead during rapid iteration.

**How to avoid:**
Treat `plugin.json` version as the single source of truth for plugin updates. Bump it with every push that changes SKILL.md, plugin manifests, or any skill content. Use semver: patch bumps (`1.0.1`, `1.0.2`) for content improvements, minor bumps (`1.1.0`) for new skills. Add a check to the contribution workflow: "Did you update plugin.json version?" Also: the `version` field in `marketplace.json` plugin entries must NEVER duplicate the `plugin.json` version — if both are set, `plugin.json` silently wins. Set version only in `plugin.json`, not in the marketplace entry.

**Warning signs:**
- `plugin.json` has been at `"version": "1.0.0"` across multiple commits that changed SKILL.md
- `marketplace.json` plugin entries also have a `version` field (duplicated)
- No test or CI check verifies that skill content changes are accompanied by a version bump

**Phase to address:**
Phase 13, Plan 13-01 (Claude Code Plugin Marketplace). The version bump discipline must be established at initial setup, not learned from a bug report.

---

### Pitfall 9: iOS Safari Breaks the Existing Modal Scroll Lock — and the Hamburger Menu

**What goes wrong:**
`CardModal.tsx` already uses `document.body.style.overflow = 'hidden'` for scroll locking. This works on desktop and Android. On iOS Safari, `overflow: hidden` on `body` is ignored — the background content continues scrolling when the modal is open. Phase 14 adds a hamburger menu that requires the same scroll lock. Both will be broken on iOS from day one unless the scroll lock implementation is replaced with the iOS-compatible approach (negative `margin-top` + `position: fixed` on the body using the saved scroll position).

**Why it happens:**
The current implementation works for all tested environments (Chrome, Firefox, desktop Safari). iOS Safari's scroll behavior is a known long-standing bug that only surfaces on mobile. If mobile testing is deferred to Phase 14, this bug goes undetected through all of Phase 12's development.

**How to avoid:**
Replace the body scroll lock in `CardModal.tsx` before Phase 14 mobile work. Use the scroll position preservation technique:

```typescript
function lockScroll() {
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  document.body.dataset.scrollY = String(scrollY);
}

function unlockScroll() {
  const scrollY = parseInt(document.body.dataset.scrollY ?? '0');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, scrollY);
}
```

Apply the same pattern in the hamburger menu. This is a 30-minute fix that eliminates an entire class of iOS bugs.

**Warning signs:**
- `document.body.style.overflow = 'hidden'` is the only scroll lock mechanism in the codebase
- Mobile testing happens only in Phase 14 (after all modals and menus are built)
- There are no tests or screenshots from an iOS Safari environment

**Phase to address:**
Phase 12, Plan 12-05 (Skill Detail Modal) or any modal work — fix the scroll lock before the hamburger menu is built in Phase 14.

---

### Pitfall 10: Polling the Activity Feed Re-fetches the Entire List on Every Tick

**What goes wrong:**
The Activity Feed needs to feel "live." The natural implementation is a `setInterval` that calls `GET /activity?limit=20` every 10 seconds and replaces the displayed list. This works, but has two problems: (1) every tick re-fetches entries the user has already seen, burning CPU on diff/re-render for items that haven't changed; (2) if the user has scrolled down to see older entries, the list replacement resets their scroll position to the top. Both feel broken.

**Why it happens:**
A simple polling implementation is fast to build. The scroll reset problem is invisible in developer testing (where the list has few entries and no scroll is needed).

**How to avoid:**
Poll only for NEW entries using a `since` timestamp: `GET /activity?since=<last_seen_created_at>`. Prepend new entries to the top of the existing list, don't replace the whole list. The backend endpoint already supports time-based filtering (the `since` parameter on `/requests`). Apply the same pattern to the new `/activity` endpoint. This requires tracking `lastSeenAt` in the hook state and using it in subsequent fetches.

**Warning signs:**
- The `useActivity` hook uses `setItems(newItems)` (replace) instead of `setItems(prev => [...newItems, ...prev])` (prepend)
- The poll interval fetches without any `since` parameter
- Scrolling down in the activity feed and waiting 10 seconds causes the view to jump back to the top

**Phase to address:**
Phase 12, Plan 12-02 (Activity Feed). The prepend-only update pattern must be in the initial hook design.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep `useState<ActiveTab>` instead of adding react-router | No new dependency | Agent profile deep links impossible; back button broken in all nested views | Never — routing must precede page builds |
| Skip custom Recharts tooltip, use `wrapperClassName` | Faster chart implementation | White tooltip on dark background; looks broken; unfixable without component rewrite | Never |
| Use `<ReactMarkdown>` without `components` prop | Markdown renders immediately | Unstyled elements; heading hierarchy lost; code blocks unreadable | Never — always provide component map |
| Hardcode `credits_earned` as 0 until backend ready | Unblocks frontend work | Field is never implemented; ships to production as 0 | Acceptable only behind a feature flag with a tracking issue created |
| Set identical version in both `plugin.json` and `marketplace.json` | Seems explicit | `plugin.json` silently wins; marketplace version is misleading; updates skip | Never |
| Use `overflow: hidden` for modal scroll lock | Works on 90% of browsers | iOS Safari body scrolls behind modal | Never for new modals |
| Poll activity feed replacing full list | Simple implementation | Scroll position resets every poll; re-renders items that haven't changed | Never — use prepend pattern from day one |
| Add new `/api/*` prefix for new routes, leave old ones at root | Namespace isolation | Two base paths; proxy config must be updated; `useCards` hook breaks | Never — pick one convention and apply it everywhere |

---

## Integration Gotchas

Common mistakes when connecting the new features to the existing system.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Vite dev proxy + new Fastify routes | New endpoints work in production build but 404 in dev mode | Update `vite.config.ts` proxy in the same commit as the new Fastify route |
| `@fastify/static` + SPA deep routes | Direct URL access to `/hub/agents/x` returns 404 | Add wildcard Fastify route: `server.get('/hub/*', () => reply.sendFile('index.html'))` after static plugin |
| Recharts + CSS variables | Passing Tailwind class names to `stroke` or `fill` props does nothing | Pass CSS variable values: `stroke="var(--color-accent)"` — Recharts accepts CSS variable strings in color props |
| `react-markdown` + `rehype-highlight` | Installing `rehype-highlight` adds highlight.js CSS that overrides existing code styles | Import only the specific highlight.js theme file; do not import the full CSS bundle |
| `request_log` + activity feed | `action_type IS NOT NULL` rows are autonomy audit events, not user-facing activity | Filter `WHERE action_type IS NULL` for exchange activity; display autonomy events separately if needed |
| Claude Code `plugin.json` + `marketplace.json` version | Setting `version` in both files causes `plugin.json` to silently win | Set version only in `plugin.json`; omit version from `marketplace.json` plugin entries |
| `@fastify/static decorateReply` + multiple registrations | Second `register(fastifyStatic)` call crashes with "already decorated" error | Set `decorateReply: false` on all static plugin registrations after the first (already done in the codebase) |
| SQLite `request_log` + credits earned | `credits_charged` on failure rows is 0 (correct) — forgetting `WHERE status='success'` inflates zero-cost entries | Always filter `WHERE status = 'success'` when summing credits earned |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Agent profiles query: loop over owners, query per owner | `/agents` endpoint takes 2s+ to respond | Write a single GROUP BY query with JOINs | With > 10 agents (immediate) |
| Activity feed polling replaces entire list | Full re-render every 10 seconds; scroll jumps | Use `since` timestamp; prepend only new entries | As soon as the list exceeds 5 items |
| Markdown docs page re-parses content on every render | Docs tab feels sluggish on low-end devices | Wrap `<ReactMarkdown>` in `React.memo`; memoize `components` map with `useMemo` | On mobile devices with large doc content |
| Recharts renders on every parent re-render | Chart animations replay constantly when parent state changes | Isolate chart into its own memoized component; do not pass new object references as props | Whenever credit balance updates (polling) |
| `capability_cards` FTS5 full rebuild on every agent profile page load | Each profile view triggers an expensive index rebuild (if improperly coded) | Never call `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')` in a request handler | Always |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Activity feed exposes `requester` identity for all exchanges | Leaks which agents are transacting with which agents; privacy violation for a public protocol | Hash or truncate requester IDs in public feed (`mayo-d***` not `maya-devops`); or make requester display name opt-in |
| Markdown docs page renders user-supplied content | XSS if any part of the Markdown content comes from user input | `react-markdown` sanitizes by default; never pass `rehype-raw` plugin unless content is fully trusted and server-controlled |
| Claude Code plugin SKILL.md contains API keys or endpoint URLs | Key leaks in public repo | SKILL.md must contain only instructions, never credentials; runtime values injected via environment variables |
| Agent profile page displays raw `owner` field from database | Owner names are user-supplied strings; could contain HTML-like content | React JSX escapes by default; do not use `dangerouslySetInnerHTML` for owner names anywhere |

---

## UX Pitfalls

Common user experience mistakes in this domain. Note: primary "users" are agents; secondary users are human developers browsing the Hub.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Credit balance in nav updates only on page load | Agent owner sees stale balance; earns credits but balance doesn't update | Poll `/me` every 30 seconds when authenticated; use count-up animation for balance changes |
| "Get Started — 50 free credits" CTA doesn't explain what credits are | Visitors don't understand the value proposition | CTA should say: "Your agent earns credits by sharing idle capabilities. Use them to access others." |
| Docs page has no active section indicator | User can't tell which section they're reading when scrolled | Use IntersectionObserver to highlight the current section in the docs sidebar |
| Activity feed shows full agent names in real-time | Makes it easy to infer who is using which capabilities; privacy concern | Show partial identifiers; let agents opt into full public display via card metadata |
| Mobile modal covers entire screen with no close affordance at top | On small screens, users can't reach the X button if it's at the top of a tall modal | On mobile, the X button must be in a fixed header within the modal; or swipe-down to close |
| Skill Detail Modal "Request this skill" button copies CLI command — but agent owner reading the Hub is not running a CLI | Human visitors feel confused about "agentbnb request ..." | Show two options: "Request via CLI" (for agents) and "Share your agent to receive this" (for human owners discovering peers) |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Agent Profiles page:** Ranked list renders — but verify: (1) clicking an agent navigates to a real URL, not just replaces in-tab state; (2) browser back button returns to the ranked list; (3) "credits earned" is computed from request_log JOIN, not hardcoded
- [ ] **Activity Feed:** Entries render — but verify: (1) polling uses `since` timestamp and prepends new entries; (2) scroll position is preserved on update; (3) autonomy audit rows (`action_type IS NOT NULL`) are filtered out of the public feed
- [ ] **Docs page:** Markdown renders — but verify: (1) headings have proper visual hierarchy (not same size as body); (2) code blocks have syntax highlighting and dark background; (3) inline code is visually distinct from body text
- [ ] **Credit System UI:** Balance appears in nav — but verify: (1) balance polls for updates, not just loads once; (2) count-up animation fires when balance changes; (3) the `cr` symbol is used consistently everywhere credits appear (not `credits` or `cr.`)
- [ ] **Claude Code Plugin:** `marketplace.json` exists and `plugin.json` exists — but verify: (1) `plugin.json` has a version set; (2) `marketplace.json` does NOT have a `version` in plugin entries; (3) running `/plugin marketplace add owner/repo` actually works in Claude Code; (4) SKILL.md contains no credentials
- [ ] **Mobile Responsive:** Cards stack on narrow viewport — but verify: (1) modal uses iOS-safe scroll lock (not `overflow: hidden`); (2) hamburger menu closes when clicking outside; (3) touch targets are at least 44px tall; (4) no horizontal scroll occurs at 375px viewport width
- [ ] **Routing:** New pages render — but verify: (1) direct URL access (refresh on `/hub/agents/x`) serves the SPA, not a 404; (2) all new paths are included in the Vite dev proxy config
- [ ] **Recharts charts:** Charts render — but verify: (1) tooltip background matches dark theme (not white); (2) chart colors use design system variables (not hardcoded hex); (3) charts don't animate on every poll update

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Built all new pages without routing; must retrofit react-router | HIGH | Add react-router; convert each tab to a route; move `selectedAgent` state to URL params; 1–2 days |
| `/hub/*` direct access returns 404 in production | LOW | Add wildcard catch-all route to `registry/server.ts`; redeploy; 30 minutes |
| Recharts tooltips are white on dark background | LOW | Replace `<Tooltip>` with custom `content` component per chart; 1 hour |
| `plugin.json` version not bumped; users not receiving updates | LOW | Bump version; users must manually `/plugin update` or reinstall; communicate the fix |
| Markdown docs renders unstyled | MEDIUM | Write component map for all element types; 2–4 hours depending on element count |
| iOS Safari modal scroll bug deployed | LOW | Replace `overflow: hidden` with position-fixed scroll lock; 30 minutes |
| Activity feed scroll reset on poll deployed | LOW | Refactor hook to use `since` timestamp and prepend; 1–2 hours |
| Credits earned shows 0 for all agents | MEDIUM | Write and verify the GROUP BY aggregate query; 2–4 hours |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Tab navigation instead of URL routing | Phase 12, first task | Direct URL access to `/hub/agents/x` loads correctly; back button navigates properly |
| SPA deep routes return 404 | Phase 12, routing setup | Integration test: GET `/hub/agents/unknown-user` returns `index.html` with 200, not 404 |
| New API routes miss Vite proxy | Phase 12, each new endpoint | Verify all new paths are in `vite.config.ts` proxy; dev mode test confirms no 404 |
| Activity feed N+1 query | Phase 12, Plan 12-02 | Code review: activity endpoint handler has no loops calling `getCard()` |
| Agent profiles aggregate query wrong | Phase 12, Plan 12-01 | Unit test: `getAgentList(db)` returns correct `credits_earned` from mock `request_log` data |
| Recharts tooltip breaks dark theme | Phase 12, Plan 12-04 | Visual test: screenshot of credit chart shows tooltip matching dark background |
| `react-markdown` renders unstyled | Phase 12, Plan 12-03 | Visual test: docs page heading is larger than body; code blocks have background |
| `plugin.json` version bump discipline | Phase 13, Plan 13-01 | Version in `plugin.json` is non-zero; CI check or checklist item for version bump on content changes |
| iOS Safari scroll lock bug | Phase 12, Plan 12-05 (or before) | Manual test on iPhone Safari: modal open → background does not scroll |
| Activity feed scroll reset on poll | Phase 12, Plan 12-02 | Manual test: scroll down in feed → wait 15 seconds → scroll position is preserved |

---

## Sources

- Claude Code Plugin Marketplace Documentation (official): https://code.claude.com/docs/en/plugin-marketplaces
- Recharts tooltip backgroundColor known issue: https://github.com/recharts/recharts/issues/1402
- Recharts tooltip styling workaround: https://github.com/recharts/recharts/issues/663
- react-markdown official docs: https://remarkjs.github.io/react-markdown/
- react-markdown performance (memoization): https://strapi.io/blog/react-markdown-complete-guide-security-styling
- iOS Safari scroll lock — decade-long bug analysis: https://stripearmy.medium.com/i-fixed-a-decade-long-ios-safari-problem-0d85f76caec0
- iOS body-scroll-lock library: https://github.com/willmcpo/body-scroll-lock
- Vite SPA 404 on refresh — root cause and fix: https://virangaj.medium.com/solving-404-errors-on-refresh-in-react-vite-apps-c52fc596dc27
- Fastify static plugin — decorateReply requirement: https://github.com/fastify/fastify-static
- SQLite N+1 query official perspective: https://sqlite.org/np1queryprob.html
- Codebase: `hub/vite.config.ts`, `hub/src/App.tsx`, `hub/src/components/CardModal.tsx`, `src/registry/server.ts`, `src/registry/request-log.ts`
- Milestone spec: `v2.2-milestone.md`

---
*Pitfalls research for: Hub Feature Expansion + Multi-Platform Distribution (AgentBnB v2.2)*
*Researched: 2026-03-16*
