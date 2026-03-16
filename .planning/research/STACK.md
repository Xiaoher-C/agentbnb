# Stack Research

**Domain:** Hub Feature Expansion + Multi-Platform Distribution — React SPA new pages, markdown docs rendering, credit charts, real-time activity feed, mobile responsive layout, Claude Code plugin marketplace format, cross-tool SKILL.md compatibility
**Researched:** 2026-03-16
**Confidence:** HIGH (versions verified via npm search results, official docs, and Context7 where available)

---

## Existing Stack (Do Not Re-Research)

These are validated and locked — do not change:

| Technology | Version | Role |
|------------|---------|------|
| React | ^18.3.1 | Hub SPA framework |
| Vite | ^6.0.7 | Build tool + dev server |
| TypeScript strict | ^5.7.3 | Hub language |
| Tailwind CSS | ^3.4.17 | Utility styling |
| lucide-react | ^0.469.0 | Icons |
| boring-avatars | ^1.11.2 | Agent avatars |
| Vitest | ^3.0.4 | Hub tests |
| @testing-library/react | ^16.1.0 | Component tests |

Design tokens already defined in `hub/src/index.css`:
- Background: `#08080C`
- Accent: `#10B981` (emerald)
- Fonts: Inter + JetBrains Mono
- CSS variables: `--color-bg`, `--color-accent`, `--color-surface`, etc.

---

## New Stack Additions for v2.2

### Core Framework Additions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| react-router | ^7.13.1 | Client-side routing for 7-page Hub (Agent Profiles, Activity Feed, Docs, Credit UI, Discover, Share, My Agent) | v7 is the current release line (7.13.1 as of March 2026). For this SPA use `createHashRouter` — no server config change needed since the Hub is served at `/hub/` from a Fastify static mount. `createBrowserRouter` would require Fastify to handle all `/hub/*` paths, complicating the existing proxy setup. Hash routing works with the current `/hub/` base path out of the box. Import only from `react-router` — `react-router-dom` is no longer a separate package in v7. |

### Markdown Rendering (Docs Page)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| react-markdown | ^10.1.0 | Render Getting Started, Card Schema, API Reference docs from `.md` files in the Hub | The standard React markdown component (unified pipeline). v10 is the current major release. Works with React 18 (peer dep `react >= 18`). Pair with `remark-gfm` for tables and task lists — the Card Schema docs heavily use tables. |
| remark-gfm | ^4.0.1 | GitHub Flavored Markdown — tables, strikethrough, task lists | Required for Card Schema docs (Markdown tables). Same `unified` ecosystem as react-markdown; zero conflict. |
| rehype-highlight | ^7.0.0 | Code block syntax highlighting in docs | Lighter than `react-syntax-highlighter` (~200KB less). Uses highlight.js themes. For the AgentBnB dark theme use `highlight.js/styles/github-dark.css` — matches `#08080C` background well. **Do not use react-syntax-highlighter** — it ships the entire Prism + highlight.js, adding ~700KB to the bundle for minimal gain. |

**Note on react-markdown v10 breaking change:** v10 removed the `inline` prop on `<code>` components and `className` prop from the root element. If custom code component overrides are written, check for these removals. Wrap the `<ReactMarkdown>` in a div with the class instead of using the old `className` prop.

### Charts (Credit Dashboard)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| recharts | ^3.8.0 | Credit balance history (AreaChart), capability exchange volume (BarChart), idle rate over time (LineChart) | 3.8.0 is current (64M+ monthly npm downloads, 26.8K GitHub stars). Built on React + D3 with declarative SVG components. Lightweight for the data volume (daily/hourly credit history). Supports CSS variable colors — pass `var(--color-accent)` as `stroke` / `fill` props to match the emerald theme without hardcoding. Recharts renders client-side SVG, which fits perfectly with the existing premium dark SaaS aesthetic — no canvas flickering or rasterization artifacts. |

**Chart theming approach for `#08080C` background:**
```tsx
// Use CSS variables directly — recharts accepts them as string props
<Area stroke="var(--color-accent)" fill="var(--color-accent-glow)" />
<CartesianGrid stroke="var(--color-border)" />
<XAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} />
```
This avoids any separate theming config and stays in sync with `index.css` tokens.

### Animations (Loading Skeletons, Page Transitions, Credit Count-Up)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| framer-motion | ^12.36.0 | Page transitions between Hub tabs/routes, modal sheet animations on mobile, staggered list entry for Activity Feed items, skeleton pulse | v12.36.0 is current (18M+ monthly npm downloads). Most v6+ code runs unchanged. `AnimatePresence` handles route exit animations. `motion.div` layout animations work with recharts tooltips for smooth chart updates. The existing count-up animation in `StatsBar` can be migrated to `useMotionValue` + `useTransform` for more control, though the current implementation can stay if it works. **Only add framer-motion if the existing CSS transition approach proves insufficient** — see the conditional note below. |

**Conditional note:** The existing Hub already achieves hover animations and card effects with Tailwind `transition-*` utilities. Add `framer-motion` only if:
1. Route transitions are needed between pages (AnimatePresence)
2. The Activity Feed needs staggered item entry
3. The mobile modal sheet needs a slide-up animation

If only mobile sheet + route transitions are needed, a lightweight alternative is `@headlessui/react` (already used in many Tailwind projects for dialogs/transitions). But framer-motion is more flexible and the v12 bundle is acceptable at ~50KB gzipped.

### Real-Time Activity Feed

No new library needed. Use the native `EventSource` API (Server-Sent Events) directly:

```typescript
// useActivityFeed.ts — no library required
const es = new EventSource('/activity/stream');
es.onmessage = (e) => setItems(prev => [JSON.parse(e.data), ...prev].slice(0, 50));
```

The Fastify server already exists and can expose a `GET /activity/stream` SSE endpoint using `reply.raw`. The browser's built-in `EventSource` handles reconnection automatically. No `react-eventsource` or `@myty/react-sse` package is needed — those add wrapper weight without meaningfully simplifying the implementation. If the activity feed is polling-only (not push), a `setInterval` in `useEffect` against `GET /activity/recent` is even simpler.

**Decision:** Start with polling (`useEffect` + `setInterval` at 5s) — add SSE only if real-time latency < 1s is a requirement. For an MVP activity feed showing recent exchanges, 5s polling is fine.

### Mobile Responsive Layout

No new library needed. Tailwind CSS already in the project handles all responsive needs:

```
sm:  ≥640px
md:  ≥768px
lg:  ≥1024px
xl:  ≥1280px
```

Mobile-specific patterns:
- **Hamburger nav:** Tailwind `hidden md:flex` / `flex md:hidden` + React `useState` for menu open state
- **Stacked card grid:** `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` — already supported by `CardGrid.tsx`
- **Full-screen modal sheets:** CSS position fixed + `translate-y` animation (or framer-motion if added)
- **Bottom tab bar on mobile:** Pure Tailwind + React state, no library

Do NOT add `react-responsive` or `@chakra-ui/media-query` — Tailwind breakpoint utilities cover all cases with zero additional JS.

---

## Claude Code Plugin Marketplace Format

This is a **static JSON file artifact**, not a npm dependency. Verified from official Claude Code documentation (`code.claude.com/docs/en/plugin-marketplaces`).

**File location:** `.claude-plugin/marketplace.json` at the repository root.

**Minimal required structure (HIGH confidence — official docs):**
```json
{
  "name": "agentbnb",
  "owner": {
    "name": "Cheng Wen Chen",
    "email": "optional"
  },
  "metadata": {
    "description": "AgentBnB capability sharing skills for Claude Code"
  },
  "plugins": [
    {
      "name": "agentbnb-skill",
      "source": "./skills/agentbnb",
      "description": "Install AgentBnB P2P capability sharing protocol",
      "version": "2.2.0",
      "author": { "name": "Cheng Wen Chen" },
      "homepage": "https://agentbnb.dev",
      "repository": "https://github.com/chengwenchen/agentbnb",
      "license": "MIT",
      "keywords": ["agent", "capability", "p2p", "skills"],
      "category": "agent-tools"
    }
  ]
}
```

**The plugin itself** also needs `.claude-plugin/plugin.json` inside `skills/agentbnb/`:
```json
{
  "name": "agentbnb-skill",
  "description": "AgentBnB P2P capability sharing — publish idle skills, request missing ones",
  "version": "2.2.0"
}
```

**Plugin source types supported** (relevant for distribution):
- `"./relative-path"` — local directory within marketplace repo (works for same-repo)
- `{ "source": "github", "repo": "owner/repo" }` — external GitHub source
- `{ "source": "npm", "package": "@agentbnb/skill" }` — npm package (not needed for this milestone)

**Users install with:**
```bash
/plugin marketplace add chengwenchen/agentbnb
/plugin install agentbnb-skill@agentbnb
```

Or via `.claude/settings.json` for automatic team distribution:
```json
{
  "extraKnownMarketplaces": {
    "agentbnb": {
      "source": { "source": "github", "repo": "chengwenchen/agentbnb" }
    }
  }
}
```

**Reserved marketplace names to avoid:** `claude-code-marketplace`, `claude-code-plugins`, `anthropic-marketplace`, `agent-skills` — all blocked by Anthropic.

---

## Cross-Tool SKILL.md Compatibility

This is a **documentation and file-format task**, not a library installation. No new npm packages required.

The existing `skills/agentbnb/SKILL.md` uses OpenClaw format. Additions needed per tool:

| Tool | Format | Addition Needed |
|------|--------|-----------------|
| OpenClaw | Already supported — SOUL.md sync, HEARTBEAT.md | None |
| Claude Code | SKILL.md in `.claude-plugin/` directory structure | Add `skills/quality-review/SKILL.md` frontmatter per Claude Code spec |
| Cursor | `.cursorrules` or `AGENT.md` in project root | Static markdown file — no library |
| Codex (OpenAI) | `AGENTS.md` in project root | Static markdown file — no library |
| Antigravity | `AGENTS.md` + custom frontmatter | Static markdown file — no library |

**Claude Code SKILL.md frontmatter format (official docs):**
```markdown
---
description: Review code for bugs, security, and performance
disable-model-invocation: true
---
[Instructions follow]
```

The key difference: Claude Code SKILL.md uses `disable-model-invocation` and `description` frontmatter. OpenClaw uses `name`, `description`, `metadata`, `user-invocable` frontmatter. These are separate files in separate locations — no templating library needed.

---

## Tailwind CSS v4 — Upgrade Decision

**Recommendation: STAY on v3.4.x for this milestone.**

Tailwind v4 requires:
1. Replacing `tailwind.config.js` with `@theme` CSS directives
2. Replacing `@tailwind base/components/utilities` with `@import "tailwindcss"`
3. Removing `postcss.config.js` + `autoprefixer` (replaced by `@tailwindcss/vite` plugin)
4. Migrating all `theme()` function calls to CSS variable references
5. Custom utility class syntax changes

The AgentBnB Hub has a significant custom theme (CSS variables in `:root`, custom color tokens like `bg-hub-bg`, `text-hub-text-primary`). Migrating this mid-milestone introduces risk without material benefit — the v4 performance gains (Rust compiler, ~60% faster cold builds) are irrelevant for a 3,800 LOC codebase.

**Migrate to v4 in a dedicated tech-debt phase after v2.2 ships**, not during feature development.

---

## Auto-Index Preparation (GitHub Topics + SKILL.md Frontmatter)

This is a **metadata and documentation task**. No library needed.

GitHub topics are set via the GitHub web UI or API — no npm package. Required topics for discoverability:
```
agent, ai-agent, capability-sharing, p2p, skill-marketplace, openClaw, claude-code-plugin, mcp, agentbnb
```

SKILL.md frontmatter for auto-indexing (already in place, needs augmentation):
```yaml
---
name: agentbnb
version: 2.2.0
tags: [agent, capability-sharing, p2p, credits, autonomous]
homepage: https://agentbnb.dev
install: npx agentbnb@latest init
---
```

---

## Installation

```bash
# Hub dependencies (in hub/ directory)
pnpm add react-router react-markdown remark-gfm rehype-highlight recharts

# Conditional — only add if route transitions / staggered animations needed
pnpm add framer-motion

# Dev dependencies — none new needed
```

```bash
# Verify versions after install
pnpm list react-router react-markdown recharts
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `react-router ^7.13.1` with `createHashRouter` | TanStack Router v1 | TanStack Router is excellent but introduces a full new dependency for a Hub that has no existing routing. React Router v7 is the community standard and its hash router mode requires zero Fastify config changes. |
| `react-router ^7.13.1` with `createHashRouter` | `createBrowserRouter` | Browser router requires Fastify to serve the SPA shell at all `/hub/*` paths. The current static file mount (`/hub/`) does not do this. Hash router avoids the server config change entirely. |
| `react-markdown ^10.1.0` | `marked` + `dangerouslySetInnerHTML` | `marked` outputs raw HTML strings that must be injected as HTML — XSS risk. `react-markdown` renders to React elements — safe by default. |
| `react-markdown ^10.1.0` | `MDX` | MDX requires a build-time compiler plugin (Vite MDX plugin). For simple docs pages that are just rendered, not interactive, this is massive over-engineering. |
| `rehype-highlight ^7.0.0` | `react-syntax-highlighter` | `react-syntax-highlighter` bundles both Prism and highlight.js (~700KB unparsed). `rehype-highlight` uses highlight.js only, is much smaller, and integrates via the unified pipeline without an extra `components` override. |
| `recharts ^3.8.0` | `chart.js` + `react-chartjs-2` | Chart.js uses Canvas rendering — produces rasterized output that looks inconsistent next to the premium SVG-based UI. Recharts SVG output matches the existing card/modal aesthetic. |
| `recharts ^3.8.0` | Victory Charts | Victory is heavier than Recharts and has less community adoption (recharts has 3.6M weekly downloads vs Victory's ~300K). |
| `recharts ^3.8.0` | `@visx/visx` | visx is lower-level D3 primitives — requires building chart components from scratch. Good for custom visualizations, overkill for standard credit history line charts. |
| Native `EventSource` | `react-eventsource` / `@myty/react-sse` | Wrapper libraries add ~5KB for something that is 15 lines of `useEffect` code. The browser EventSource API auto-reconnects. No library justified. |
| Tailwind v3 (stay) | Tailwind CSS v4 | v4 migration risk mid-milestone. Breaking CSS variable syntax, `@theme` migration, config rewrite. Save for dedicated tech-debt phase. |
| `framer-motion ^12.36.0` | `@headlessui/react` | headlessui focuses on accessible UI primitives (dialogs, comboboxes), not animation. For route transitions and staggered list animations, framer-motion is the right tool. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `react-syntax-highlighter` | Ships full Prism + highlight.js (~700KB for doc pages); breaks bundle budget | `rehype-highlight` via unified pipeline — same visual output, fraction of the weight |
| `react-query` / TanStack Query | Hub data fetching is already handled by `useCards`, `useAuth`, `useOwnerCards` hooks with `useEffect` + `fetch`. Adding a caching layer mid-project creates two patterns in the codebase. | Extend existing hook pattern; add `useSWR` only if stale-while-revalidate is specifically needed for agent profiles page |
| `react-spring` | Overlaps with framer-motion; picking both creates animation inconsistency. If animations are added, commit to one library. | `framer-motion` only |
| `@emotion/react` / `styled-components` | CSS-in-JS adds runtime overhead and conflicts with the existing Tailwind + CSS variables approach | Tailwind utilities + `index.css` CSS variables |
| `react-helmet` | Head/meta management is not needed — Hub is not SEO-targeted (served at `/hub/` behind a local server, no crawlers) | None needed |
| `axios` | Already no axios in the project; native `fetch` handles all API calls | Native `fetch` with existing patterns |
| Tailwind CSS v4 (this milestone) | Migration risk: `@theme` directive, config rewrite, CSS variable syntax change, `@tailwindcss/vite` plugin. The existing custom theme tokens are extensive. | Stay on ^3.4.17 — migrate in a dedicated tech-debt phase |
| `react-router-dom` (separate package) | In React Router v7, `react-router-dom` was merged back into `react-router`. Installing both creates version conflicts. | Import everything from `react-router` only |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `react-router ^7.13.1` | React ^18.3.1 | v7 requires React 18+. No conflict. |
| `react-markdown ^10.1.0` | React ^18.3.1, TypeScript ^5.7 | v10 peer dep: `react >= 18`. No conflict. |
| `remark-gfm ^4.0.1` | `react-markdown ^10.1.0` | Same unified ecosystem. remark-gfm 4.x is the correct companion for react-markdown 10.x. |
| `rehype-highlight ^7.0.0` | `react-markdown ^10.1.0` | rehype 7.x aligns with react-markdown's bundled rehype version. Avoid rehype-highlight v6 with react-markdown v10. |
| `recharts ^3.8.0` | React ^18.3.1, TypeScript ^5.7 | No conflict. Recharts 3.x ships its own TypeScript types. |
| `framer-motion ^12.36.0` | React ^18.3.1 | v12 supports React 18 and React 19. No conflict. |
| `react-router ^7.13.1` | Vite ^6.0.7 | React Router v7 works with Vite in library mode (not framework mode). Use `RouterProvider` component pattern, not the Vite framework plugin. |
| All new hub deps | Tailwind ^3.4.17 | New libs don't conflict with Tailwind. No Tailwind plugins needed for any of them. |

---

## Hub Routing Strategy

With 7 pages, a routing decision is required. Here is the recommended setup:

```tsx
// hub/src/main.tsx
import { createHashRouter, RouterProvider } from 'react-router';

const router = createHashRouter([
  {
    path: '/',
    element: <App />,  // Shell with nav
    children: [
      { index: true, element: <DiscoverPage /> },
      { path: 'profiles', element: <AgentProfilesPage /> },
      { path: 'profiles/:agentId', element: <AgentProfileDetailPage /> },
      { path: 'activity', element: <ActivityFeedPage /> },
      { path: 'docs', element: <DocsPage /> },
      { path: 'docs/:slug', element: <DocsPage /> },
      { path: 'credits', element: <CreditDashboardPage /> },
      { path: 'share', element: <SharePage /> },
      { path: 'myagent', element: <MyAgentPage /> },
    ]
  }
]);
```

The `createHashRouter` approach means URLs look like `http://localhost:7777/hub/#/profiles` — no server routing config needed. The Fastify static file mount at `/hub/` serves `index.html` for all `/hub` requests, and hash routing handles the rest client-side.

**Do not use the React Router Vite framework plugin** (`@react-router/dev`) — that's for SSR/prerendering workflows. This project uses library mode only.

---

## Docs Page Architecture

Docs are static markdown files bundled into the build:

```
hub/src/docs/
├── getting-started.md
├── card-schema.md
├── api-reference.md
└── multi-tool-install.md
```

Import via Vite's `?raw` suffix:
```tsx
import gettingStarted from './docs/getting-started.md?raw';
```

This bundles the markdown as a string at build time — no runtime fetch needed, no CMS, no CDN. Add `{ "*.md": "string" }` to vite's `assetsInclude` or use the `?raw` suffix (built into Vite, no plugin needed).

---

## Sources

- react-router npm — version 7.13.1 confirmed (MEDIUM confidence, WebSearch)
- [react-router official docs — SPA and hash router modes](https://reactrouter.com/start/modes) (HIGH confidence)
- [Claude Code plugin marketplace official docs](https://code.claude.com/docs/en/plugin-marketplaces) — complete schema, source types, reserved names verified (HIGH confidence, WebFetch)
- recharts npm — version 3.8.0 confirmed with 64M+ monthly downloads (MEDIUM confidence, WebSearch)
- react-markdown npm — version 10.1.0 confirmed, v10 breaking changes documented (MEDIUM confidence, WebSearch)
- framer-motion npm — version 12.36.0 confirmed (MEDIUM confidence, WebSearch)
- shiki npm — version 4.0.2 (MEDIUM confidence, WebSearch) — not recommended for this project (rehype-highlight is lighter)
- Tailwind CSS v4 migration breaking changes — `@theme` directive, config rewrite, `@tailwindcss/vite` plugin (MEDIUM confidence, WebSearch)
- [8 Top React Chart Libraries 2026](https://querio.ai/articles/top-react-chart-libraries-data-visualization) — recharts ranking confirmation (LOW confidence, secondary)

---

*Stack research for: AgentBnB v2.2 Full Hub + Distribution milestone*
*Researched: 2026-03-16*
