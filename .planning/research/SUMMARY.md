# Project Research Summary

**Project:** AgentBnB v2.2 — Full Hub Feature Expansion + Multi-Platform Distribution
**Domain:** P2P agent capability marketplace Hub expansion + Claude Code plugin distribution
**Researched:** 2026-03-16
**Confidence:** HIGH

## Executive Summary

AgentBnB v2.2 is a UI-heavy milestone that expands a proven backend (v1.1 + v2.0, fully shipped) into a visually polished, publicly distributable product. The hub must grow from 3 tabs to 5, add an agent directory, activity feed, documentation page, and credit dashboard — all built on top of an existing React 18 + Vite + Tailwind stack that already has the necessary backend data in place. The key insight from research is that almost every new frontend feature is presentation-only: the data, hooks, and Fastify endpoints are already built or trivially extendable. The primary engineering work is UI composition and polish, not new system design.

The recommended approach is strictly additive: extend `App.tsx` tab routing to 5 views, add 4 lightweight Fastify routes, add 3 new React hooks following the established 30-second polling pattern, and build 9 new components following existing design token conventions. The only new npm dependencies with material weight are `react-router` (hash mode, no server config change), `recharts` (credit chart), `react-markdown` + `remark-gfm` + `rehype-highlight` (docs page), and optionally `framer-motion` (animations). The Claude Code plugin marketplace is purely static file work — no code.

The top risk is architectural: building new nested views (agent profile detail, docs sections) without URL routing creates dead ends that require expensive retrofitting. The routing decision must come first, before any page component is written. Secondary risks are visual correctness traps: Recharts tooltip white-on-dark breaking the dark theme, `react-markdown` rendering unstyled elements, and iOS Safari scroll lock failures on modals. All three have well-documented fixes — the risk is skipping them, not solving them.

---

## Key Findings

### Recommended Stack

The existing stack (React 18.3.1, Vite 6.0.7, TypeScript 5.7.3, Tailwind CSS 3.4.17) is locked and requires no changes. Four targeted additions are recommended. `react-router ^7.13.1` using `createHashRouter` provides SPA routing with zero Fastify config changes — hash URLs (`/hub/#/agents`) are served correctly by the existing static file mount. `recharts ^3.8.0` provides the credit earning chart with CSS variable theming support (`stroke="var(--color-accent)"`). `react-markdown ^10.1.0` with `remark-gfm ^4.0.1` and `rehype-highlight ^7.0.0` provides the docs page at roughly 200KB less bundle weight than `react-syntax-highlighter`. `framer-motion ^12.36.0` is conditional — add only if route transitions or staggered Activity Feed animations prove necessary.

**Core technologies:**
- `react-router ^7.13.1` with `createHashRouter`: client-side routing for 7-page Hub — hash mode avoids all Fastify fallback configuration; import only from `react-router` (not `react-router-dom` — merged in v7)
- `recharts ^3.8.0`: credit history AreaChart — declarative SVG, CSS variable theming, 64M+ monthly downloads
- `react-markdown ^10.1.0` + `remark-gfm ^4.0.1` + `rehype-highlight ^7.0.0`: docs page rendering — unified pipeline, GFM tables, dark-theme code highlighting
- `framer-motion ^12.36.0` (conditional): AnimatePresence route transitions + staggered feed animations
- Native `setInterval`: activity feed polling — no library needed, 10-second polling is functionally equivalent to WebSocket for this use case
- Tailwind CSS breakpoints (`md:`, `lg:`): all mobile responsive work — no additional library
- Tailwind CSS v3 (stay): do not migrate to v4 this milestone; breaking `@theme` directive changes create migration risk with no material benefit at this codebase size

**What not to use:** `react-syntax-highlighter` (700KB bundle for what `rehype-highlight` does lighter), `react-query` / TanStack Query (existing hook pattern is sufficient), `axios` (native fetch already in use), `react-router-dom` as a separate package (merged into `react-router` in v7), Tailwind CSS v4 (migration risk mid-milestone).

### Expected Features

The v2.1 baseline already ships card grid, owner dashboard, auth, share page, CLI, credits, and OpenClaw integration. v2.2 adds the public-facing layer that makes the network visible and distributable.

**Must have (table stakes):**
- Agent Profiles page (list + individual) — every marketplace has a participant directory; makes the network tangible
- Activity Feed — live proof the exchange economy is real; social proof for developer onboarding
- In-hub Documentation page — removes evaluation barrier; developers cannot adopt without Getting Started + API Reference
- Credit system UI (nav balance badge, 30-day earning chart, sign-up CTA) — credit economy is invisible without visualization
- Mobile responsive layout — hub is a recruiting tool; must work on all devices for demos and sharing
- Skill Detail Modal enhancement (request button, availability section) — closes the discovery-to-action gap
- Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) — primary inbound distribution channel; lowest effort, highest reach

**Should have (differentiators):**
- Design system polish pass — `OwnerDashboard` uses `slate-*` tokens inconsistent with `hub-*` tokens; must be corrected for brand coherence and screenshot quality
- Cross-tool SKILL.md compatibility frontmatter — passive discovery via SkillsMP (351k+ skills indexed), Skills.sh (8M+ installs)
- Auto-index preparation (GitHub topics) — zero-code passive distribution channel

**Defer to v2.3+:**
- SSE-based real-time activity feed — upgrade from polling only if latency becomes user-visible
- Searchable documentation — add only if docs exceed 6 pages or search demand emerges
- Related skills suggestions in Skill Detail Modal — requires semantic similarity; defer until network has sufficient data

**Anti-features (do not build):**
- WebSocket activity feed, full MDX docs system, real money payments, social graph (follow/like/comment), per-skill public install counts, cloud-hosted central registry

### Architecture Approach

The architecture is an additive overlay on a proven base. The Fastify registry server gains 4 new routes (`/api/agents`, `/api/agents/:owner`, `/api/activity`, `/me/transactions`) — all implemented using existing store and ledger functions already written. The Hub gains 5 tabs (up from 3), 9 new components, 3 new hooks, and 1 new Vite proxy entry (`/api`). No database schema changes. No new tables — agent profiles aggregate from `capability_cards` GROUP BY owner with a JOIN to `request_log`; the activity feed reads directly from `request_log JOIN capability_cards`. `useCredit` is called once in `App.tsx` and props passed down to prevent double-polling. The Claude Code plugin is pure file additions at `.claude-plugin/marketplace.json` and `plugins/agentbnb-network/`.

**Major components:**
1. `NavBar` + `NavCreditBadge` — top nav, 5-tab routing, authenticated credit display (single `useCredit` call in App.tsx, props passed down)
2. `AgentList` + `ProfilePage` — agent directory with ranking (`success_rate × online_status`), boring-avatars identicons, skill grid detail view via `selectedAgentOwner` state
3. `ActivityFeed` + `ActivityEvent` — 30-second polling of `/api/activity`, prepend-only updates with `since` timestamp to preserve scroll position
4. `DocsPage` — static TypeScript data in `lib/docs-content.ts`; no dynamic fetching; copy buttons reuse existing `navigator.clipboard` pattern
5. `CreditDashboard` — recharts AreaChart with custom dark-theme tooltip, 30-day earning aggregation from `useRequests` data
6. Modified `CardModal` — request button + availability display
7. Modified `OwnerDashboard` — migrated from `slate-*` to `hub-*` design tokens + credit section
8. 4 new Fastify routes in `src/registry/server.ts` — aggregate queries using existing `listCards()` and `getTransactions()` functions, no new tables
9. `.claude-plugin/marketplace.json` + `plugins/agentbnb-network/` — Claude Code distribution files

**Build order:** types + vite proxy first → backend endpoints → new hooks → new page components (parallel) → App.tsx navigation wiring → component modifications → plugin files.

### Critical Pitfalls

1. **Building pages without URL routing** — Tab-state navigation (`useState<ActiveTab>`) cannot support nested views with back-button history. Add `react-router` with `createHashRouter` before writing any new page component. Retrofitting routing after pages are built costs 1-2 days. Prevention: routing is the first task in Phase 12.

2. **SPA deep routes returning 404 on direct access** — `@fastify/static` returns 404 for `/hub/agents/owner-name` because no file exists at that path. Fix: add `server.get('/hub/*', () => reply.sendFile('index.html'))` catch-all route after static plugin registration. Must be verified with a direct-access integration test before any page is marked complete.

3. **Recharts tooltip white-on-dark theme** — Recharts `<Tooltip>` renders with inline `backgroundColor: '#fff'` that overrides all Tailwind class-based styling. The only fix is a custom `content` component: `<Tooltip content={<CreditsTooltip />} />`. Use CSS variables (`var(--color-accent)`) for all chart colors, not hardcoded hex.

4. **Activity feed N+1 SQLite queries** — Fetching 20 log entries then calling `getCard(db, id)` per entry is 21 queries per request. Write a single `SELECT r.*, c.owner AS provider FROM request_log r LEFT JOIN capability_cards c ON r.card_id = c.id ORDER BY r.created_at DESC LIMIT ?` from the start. Also: filter `WHERE action_type IS NULL` to exclude autonomy audit rows from the public feed.

5. **Agent profiles credits-earned query** — `credits_earned` does not exist as a stored field; it must be computed via `GROUP BY owner` with `SUM(CASE WHEN status='success' THEN credits_charged ELSE 0 END)`. Loop-based per-owner queries fail immediately with > 10 agents. Write the aggregate SQL query upfront; never add a `credits_earned` column to the schema.

6. **iOS Safari modal scroll lock** — `document.body.style.overflow = 'hidden'` is ignored on iOS Safari; the body continues scrolling behind modals. Replace with position-fixed + saved scroll position technique in `CardModal.tsx` before building the hamburger menu, to avoid fixing the same bug twice.

7. **`react-markdown` rendering unstyled** — `<ReactMarkdown>` without a `components` prop produces bare, Tailwind-reset HTML. Always provide a full component map for `h1`-`h6`, `p`, `code`, `pre`, `a`. Do not use `@tailwindcss/typography` `prose` class — it assumes a light background.

8. **`plugin.json` version discipline** — Claude Code silently skips updates when `plugin.json` version has not changed. Version must be in `plugin.json` only, not duplicated in `marketplace.json`. Bump on every SKILL.md content change.

---

## Implications for Roadmap

Research points to a 4-phase structure that front-loads the architectural decision (routing), builds the data layer before presentation, sequences UI pages by dependency order, and ships distribution last (no code dependencies).

### Phase 12: Foundation + Agent Directory

**Rationale:** Routing must be established before any nested-view page can be built correctly. Agent Profiles is the most complex new feature (backend aggregate query + new components) and is the dependency for Activity Feed's "click agent to view profile" interaction. Ship the foundation and the hardest new feature first.

**Delivers:** URL-based SPA routing (hash mode), `NavBar` with 5 tabs + credit badge, `GetStartedCTA` for unauthenticated visitors, `AgentList` ranked directory, `ProfilePage` detail view, 2 new Fastify routes (`/api/agents`, `/api/agents/:owner`), `useAgents` hook, updated `hub/src/types.ts`, updated `vite.config.ts` proxy.

**Addresses (from FEATURES.md):** Agent Profiles page (list + individual) — P1 table stakes.

**Avoids (from PITFALLS.md):** Pitfall 1 (tab navigation dead ends), Pitfall 2 (SPA 404 on direct access), Pitfall 5 (credits_earned aggregate query), Pitfall 3 (API route namespace consistency).

**Research flag:** Standard React Router + Fastify patterns — well-documented, skip deeper research.

### Phase 13: Activity Feed + Docs Page

**Rationale:** Activity Feed has no new backend dependencies beyond a JOIN query on `request_log` — the data is ready. Docs page is static content. Both can be built in parallel once Phase 12's routing foundation is in place. Together they complete the "public" section of the hub that makes the protocol legible to new visitors.

**Delivers:** `ActivityFeed` + `ActivityEvent` components with prepend-only poll updates, `GET /api/activity` Fastify route with JOIN query, `useActivity` hook with `since` timestamp polling, `DocsPage` with static TypeScript content data in `lib/docs-content.ts`, 4 static doc sections (Getting Started, Multi-Tool Install, Card Schema v2.0, API Reference).

**Addresses (from FEATURES.md):** Activity Feed (P1 differentiator), In-Hub Documentation page (P1 table stakes).

**Avoids (from PITFALLS.md):** Pitfall 4 (activity feed N+1 queries), Pitfall 10 (scroll position reset on poll), Pitfall 7 (`react-markdown` unstyled — mitigated by using static TypeScript data instead of react-markdown for the docs page).

**Research flag:** Standard patterns — skip deeper research. If `react-markdown` is chosen over static TS data for docs, the component map pattern is well-documented in PITFALLS.md Pitfall 7.

### Phase 14: Credit UI + Modal + Polish

**Rationale:** Credit dashboard depends on `recharts` and the `useCredit` hook which depends on `/me/transactions` — backend must be stable before UI is built. Modal enhancement and design system polish are correctness fixes that must be done before screenshots are taken for the README. Mobile responsive layout is a horizontal concern best addressed after all new components exist.

**Delivers:** `CreditDashboard` with recharts AreaChart (custom dark tooltip), `NavCreditBadge`, credit earning aggregation from `useRequests` 30d data, `GET /me/transactions` Fastify route, `useCredit` hook, `CardModal` enhancement (request button + availability), `OwnerDashboard` migration from `slate-*` to `hub-*` tokens, mobile responsive layout (hamburger nav, stacked card grid, iOS-safe scroll lock), sign-up CTA for unauthenticated users.

**Addresses (from FEATURES.md):** Credit system UI (P1), Skill Detail Modal enhancement (P1), Mobile responsive layout (P1), Design system polish (P2).

**Avoids (from PITFALLS.md):** Pitfall 6 (Recharts tooltip white-on-dark), Pitfall 9 (iOS Safari scroll lock), Pitfall 3 (Vite proxy for new `/me/transactions` route).

**Research flag:** Recharts custom tooltip is well-documented but a known gotcha — re-read PITFALLS.md Pitfall 6 before implementing. iOS scroll lock fix is a 30-minute implementation with a verified pattern in PITFALLS.md Pitfall 9.

### Phase 15: Distribution + Discovery

**Rationale:** Plugin files have zero code dependencies and can ship any time. They are last because: (1) SKILL.md must reflect the final v2.2 state, (2) README screenshots must show the completed hub design, (3) GitHub topics can be set at any time. This phase has the lowest complexity and the highest distribution leverage.

**Delivers:** `.claude-plugin/marketplace.json`, `plugins/agentbnb-network/.claude-plugin/plugin.json`, `plugins/agentbnb-network/skills/agentbnb/SKILL.md` (copy of existing), SKILL.md frontmatter augmentation (`compatible-tools`, `tags`), GitHub repository topics, README visual overhaul with final hub screenshots and badges.

**Addresses (from FEATURES.md):** Claude Code plugin marketplace (P1 highest-reach/lowest-cost), Cross-tool SKILL.md compatibility (P2), Auto-index preparation (P2), README visual overhaul (P3).

**Avoids (from PITFALLS.md):** Pitfall 8 (plugin.json version discipline — establishes versioning convention from initial setup, version in `plugin.json` only, not `marketplace.json`).

**Research flag:** Claude Code plugin schema verified against official docs at HIGH confidence. Use exact schema from ARCHITECTURE.md. No deeper research needed.

### Phase Ordering Rationale

- Routing before pages because tab-state navigation creates permanent architectural debt for any nested view (PITFALLS Pitfall 1).
- Agent directory before activity feed because agent profile links are referenced in activity feed events (FEATURES dependency map).
- Backend endpoints before hooks before components (ARCHITECTURE build order recommendation).
- Credit UI and polish after core pages because `recharts` and `useCredit` add no value until the basic page structure exists; design polish requires stable components to audit.
- Distribution last because SKILL.md content and README screenshots must reflect the completed product.

### Research Flags

Phases likely needing deeper research during planning:
- None identified. All four phases operate on well-documented patterns with verified library versions and existing codebase structure.

Phases with standard patterns (skip research-phase):
- **Phase 12 (Foundation + Agent Directory):** React Router hash mode, Fastify static + catch-all, GROUP BY aggregate SQL — all well-documented.
- **Phase 13 (Activity Feed + Docs):** `setInterval` polling with prepend pattern, static TypeScript content — established patterns.
- **Phase 14 (Credit UI + Polish):** Recharts AreaChart with custom tooltip — well-documented, pitfall-mapped. iOS scroll lock — 30-minute fix with verified code pattern.
- **Phase 15 (Distribution):** Claude Code plugin schema verified against official docs — use exact schema from ARCHITECTURE.md.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions confirmed via npm search + official docs. react-router 7.13.1, recharts 3.8.0, react-markdown 10.1.0 all verified. Version compatibility cross-checked. |
| Features | HIGH | Claude Code plugin schema verified against official Anthropic docs. Cross-tool SKILL.md patterns verified via multiple live repositories. Prioritization grounded in existing v2.1 baseline. |
| Architecture | HIGH | Based on direct codebase inspection of all relevant files (App.tsx, server.ts, store.ts, request-log.ts, ledger.ts, vite.config.ts). No speculation — all existing function signatures verified. |
| Pitfalls | HIGH | Grounded in codebase analysis + official docs + documented library issues (Recharts tooltip GitHub issues, iOS Safari scroll bug). Recovery strategies verified. |

**Overall confidence:** HIGH

### Gaps to Address

- **Recharts AreaChart data aggregation:** `useRequests(apiKey, '30d')` returns raw request entries. The client-side aggregation by date (summing `credits_charged` per day) needs verification that the request log timestamps are in a consistent format for `Date.toLocaleDateString()` grouping. Verify during Phase 14 implementation.

- **`/api/agents` performance at > 100 agents:** The TypeScript aggregation approach (`listCards(db)` + JS groupBy) is correct at dogfood scale. ARCHITECTURE.md notes that > 1K agents needs a materialized `agent_stats` table. If launch traffic exceeds 100 agents quickly, the aggregate SQL query approach from PITFALLS.md Pitfall 5 should be used instead. Not a blocker — flag for re-evaluation post-launch.

- **Claude Code plugin repository path:** ARCHITECTURE.md uses `Xiaoher-C/agentbnb`; FEATURES.md uses `chengwenchen/agentbnb`. The exact GitHub repository path must be confirmed before pushing the plugin files in Phase 15. This affects the user-facing install command.

- **`action_type` filter for activity feed:** PITFALLS.md identifies that `action_type IS NOT NULL` rows are autonomy audit events that should be excluded from the public feed. Verify against actual `request_log` table data to confirm which `action_type` values exist and which should be filtered.

---

## Sources

### Primary (HIGH confidence)
- [Claude Code Plugin Marketplace official docs](https://code.claude.com/docs/en/plugin-marketplaces) — marketplace.json schema, plugin.json placement, install commands, reserved names
- Direct codebase inspection: `hub/src/App.tsx`, `hub/src/hooks/useCards.ts`, `hub/src/hooks/useRequests.ts`, `hub/src/hooks/useAuth.ts` — tab routing pattern, hook structure
- Direct codebase inspection: `src/registry/server.ts`, `src/registry/store.ts`, `src/registry/request-log.ts`, `src/credit/ledger.ts`, `hub/vite.config.ts`, `hub/src/types.ts`
- [react-router official docs — SPA and hash router modes](https://reactrouter.com/start/modes)
- `v2.2-milestone.md` — feature requirements, priority order

### Secondary (MEDIUM confidence)
- react-router npm (version 7.13.1), recharts npm (version 3.8.0), react-markdown npm (version 10.1.0), framer-motion npm (version 12.36.0) — via npm search
- Recharts tooltip backgroundColor known issues: recharts/recharts#1402, recharts/recharts#663
- iOS Safari scroll lock decade-long bug analysis
- Vite SPA 404 on refresh — root cause and fix
- [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) — cross-tool SKILL.md compatibility patterns
- [Agent Skills Are the New npm — 2026](https://www.buildmvpfast.com/blog/agent-skills-npm-ai-package-manager-2026) — SkillsMP/Skills.sh distribution ecosystem

### Tertiary (LOW confidence)
- [8 Top React Chart Libraries 2026](https://querio.ai/articles/top-react-chart-libraries-data-visualization) — recharts ranking confirmation (secondary validation only; primary confidence from npm downloads)

---
*Research completed: 2026-03-16*
*Ready for roadmap: yes*
