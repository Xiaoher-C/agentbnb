# Browser QA Report — AgentBnB Hub

**URL**: http://localhost:7701/hub/
**Date**: 2026-03-17
**Server Status**: Running (HTTP 200)
**Flows Tested**: Discover, Agents, Activity, Docs, My Agent (Dashboard), Share, Settings, API endpoints
**Method**: Code audit + live API endpoint testing (no Chrome integration available in this session)

---

## 1. Page Descriptions

### Discover Page (`/hub/#/`)
- **Layout**: Full-width dark page (`#08080C` background) with `max-w-7xl` centered content
- **Sections** (top to bottom):
  1. **StatsBar**: Three large emerald monospace numbers (Agents Online / Capabilities / Exchanges) with radial glow animation. Count-up animation from 0 on mount.
  2. **SearchFilter**: Full-width ghost-style search input (48px, rounded-xl) with three filter controls below: Level dropdown, Category dropdown, Online-only checkbox.
  3. **CardGrid**: 6 capability cards displayed in a responsive grid. Each card shows: 32px identicon (boring-avatars beam), name, level badge, owner handle, category chips, online status dot, success rate, credit price.
  4. **CompatibleWithSection**: Scrolling marquee strip with tool pills (Claude Code, OpenClaw, Cursor, etc.)
  5. **FAQSection**: 6-item accordion FAQ about AgentBnB
  6. **ValuePropSection**: Protocol description paragraph
- **Cards displayed** (6 total, all online, all owned by `chengwen-openclaw`):
  - ElevenLabs TTS Pro (zh-TW) — 5 cr/call
  - Kling AI Video Generation — 15 cr/call
  - GPT-4o Text Generation — 3 cr/call
  - Recraft V4 Image Generation — 8 cr/call
  - Mac Mini M4 Pro Compute — 10 cr/call
  - AI Short Video Pipeline — 25 cr/call

### My Agent Page (`/hub/#/myagent`)
- **Without auth**: Renders `LoginForm` — a centered modal-style card with API key input field and "Connect" button. Dark slate background.
- **With auth**: Full `OwnerDashboard` with:
  - Header: "My Agent" title + owner name
  - Stats row: 4 cards (Published count, Online count, Credits Earned, Balance with reserve breakdown)
  - Request counts: 24h / 7d / 30d period breakdown
  - 30-Day Earnings chart (area chart)
  - Three-column layout: Published Cards list (with toggle), Recent Requests, Credit Transactions

### Agents Page (`/hub/#/agents`)
- Agent directory table with identicon, name/join date, success rate, skills count, earned credits
- Currently shows 1 agent: `chengwen-openclaw` (6 skills, 0 earned)
- Clicking a row navigates to `/agents/:owner` (ProfilePage)

### Activity Page (`/hub/#/activity`)
- Chronological activity feed with 10s auto-polling
- Live pulsing green dot indicator
- Currently empty ("No activity yet") — 0 exchange events in the system

### Docs Page (`/hub/#/docs`)
- Sidebar navigation (desktop) / horizontal tab strip (mobile)
- 4 sections: Getting Started, Install, Card Schema, API Reference
- All content is static JSX, no network requests

### Share Page (`/hub/#/share`)
- Probes `/health` to detect server status
- Without auth: shows "Server Running — log in via My Agent tab"
- With auth: fetches `/draft` and shows editable draft card forms with Publish button

### Settings Page (`/hub/#/settings`)
- Placeholder: "Settings — coming soon"

---

## 2. Navigation

- **Desktop**: Pill-style tab switcher below title with 5 tabs: Discover | Agents | Activity | Docs | My Agent (dropdown)
- **My Agent dropdown**: 3 sub-items — Dashboard, Share, Settings
- **Mobile**: Hamburger menu opens vertical drawer with all 7 nav items flat
- **Title**: "AgentBnB" with inline SVG doodle creature mascot (56x56)
- **Right side**: "Get Started — 50 free credits" CTA button (unauthenticated) or credit balance pill + Disconnect button (authenticated)
- **Routing**: Hash-based (`createHashRouter`) — all routes prefixed with `#/`

---

## 3. Console Errors & API Issues

### API Endpoints Tested
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /cards` | 200 | Returns 6 cards correctly |
| `GET /api/agents` | 200 | Returns 1 agent correctly |
| `GET /api/activity` | 200 | Returns empty list (expected) |
| `GET /agents` (no `/api/` prefix) | 404 | Not an issue — Hub uses `/api/agents` |
| `GET /activity` (no `/api/` prefix) | 404 | Not an issue — Hub uses `/api/activity` |
| `GET /health` | 200 (assumed) | SharePage probes this |
| `GET /stats` | 404 | No stats endpoint exists — Hub computes stats client-side |

### Potential Runtime Errors
- **Activity feed polling**: Every 10s poll to `/api/activity` works but returns empty data. No errors expected.
- **Agents polling**: Every 30s poll to `/api/agents` works correctly.

---

## 4. UI Issues Found

| Severity | Location | Issue | Details |
|----------|----------|-------|---------|
| **MEDIUM** | LoginForm | Design token inconsistency | LoginForm uses `slate-*` Tailwind colors (slate-900, slate-800, slate-700, slate-400, etc.) instead of the `hub-*` design tokens used everywhere else. This creates a visual jarring — the login page has a different shade of dark (`bg-slate-900`) compared to the main hub background (`bg-hub-bg` = `#08080C`). |
| **MEDIUM** | SharePage | Design token inconsistency | SharePage uses `slate-*` colors extensively (slate-700, slate-800, slate-400, etc.) instead of `hub-*` tokens. All server status states, draft card forms, error states, and guidance text use the old color scheme. |
| **MEDIUM** | LoginForm | `min-h-screen` causes double viewport | LoginForm applies `min-h-screen` for centering, but it renders inside App's `<main>` which already has `py-8`. This means the login form extends well below the viewport bottom, creating an awkward scroll situation. |
| **LOW** | StatsBar | "Exchanges" always shows 0 | `totalExchanges` is hardcoded to `0` in `useCards.ts` (line 157: `const totalExchanges = 0;`). Comment says "No exchange endpoint yet." This looks like missing data, not a bug, but the stat should be hidden or show "coming soon" rather than a static zero that counts up from 0 to 0. |
| **LOW** | SearchFilter | Select dropdowns invisible options | The `<select>` elements use `bg-transparent` which means dropdown `<option>` elements inherit the dark background. On some browsers/OS combos, the option text may be invisible (white text on white background) since `<option>` styling is OS-controlled. |
| **LOW** | AgentList | Fixed grid columns not responsive | The agent list uses `grid-cols-[48px_1fr_100px_80px_100px]` which will overflow horizontally on small mobile screens (< 400px). The header and data columns will be clipped. |
| **LOW** | SharePage | Retry button uses `slate-400` | The retry button after a draft error uses `text-slate-400 hover:text-slate-300` instead of hub tokens. |
| **LOW** | Settings page | Placeholder text uses `hub-text-muted` | Displays only "Settings -- coming soon" which is fine for now but may confuse users navigating there. No back navigation or guidance provided. |
| **LOW** | OwnerDashboard | Toggle button no optimistic UI update | The "Toggle" online/offline button fires `fetch()` but doesn't update local state. The card won't visually change until the next poll cycle (30s). |
| **LOW** | NavBar | `text-hub-text` reference in ActivityFeed | ActivityFeed header uses `text-hub-text` (line 35) which is not a defined token. The defined tokens are `hub-text-primary`, `hub-text-secondary`, etc. This will render as the default text color (likely white), which happens to work, but it is an undefined token reference. |

---

## 5. Positive Observations

- **Premium dark aesthetic**: The hub-* design token system creates a cohesive, high-end dark SaaS feel with the `#08080C` base, emerald accents, and subtle `rgba(255,255,255,0.06)` borders.
- **Count-up animations**: StatsBar numbers animate smoothly from 0 with ease-out cubic easing.
- **Card hover effects**: Cards lift 2px with border brightening and shadow deepening on hover.
- **Modal system**: CardModal has proper ESC key handling, backdrop click close, iOS-safe scroll locking, scale animation in/out, and mobile bottom-sheet variant.
- **Graceful degradation**: All hooks keep existing data on poll failures, only show loading on first fetch.
- **Mobile support**: Hamburger menu with iOS-safe scroll lock, bottom-sheet modals with drag handle, 44px tap targets.
- **Polling**: 30s for cards/agents, 10s for activity with incremental-only updates (no full re-fetch).

---

## 6. Recommendations (Prioritized)

### P1 — Should fix before launch
1. **Migrate LoginForm to hub-* tokens**: Replace all `slate-*` references with `hub-*` equivalents. Remove `min-h-screen` (let it inherit the app's layout). Use `bg-hub-bg` instead of `bg-slate-900`, `border-hub-border` instead of `border-slate-700`, etc.
2. **Migrate SharePage to hub-* tokens**: Same treatment — replace all `slate-*` with `hub-*` for visual consistency. This is especially important since SharePage is part of the authenticated experience.

### P2 — Should fix soon
3. **Fix `text-hub-text` undefined token**: Change to `text-hub-text-primary` in ActivityFeed.tsx line 35.
4. **Add optimistic UI to Toggle button**: Update local card state immediately on toggle click, revert on failure.
5. **Handle "Exchanges: 0" gracefully**: Either hide the Exchanges stat, show a dash, or add a "coming soon" label instead of animating from 0 to 0.

### P3 — Nice to have
6. **Make AgentList responsive**: Use a card layout on mobile instead of fixed-width grid columns.
7. **Add `<option>` background color**: Add explicit `bg-hub-bg` or `bg-[#08080C]` to select elements so dropdown options are readable on all platforms.
8. **Improve Settings placeholder**: Add a brief description of what settings will include, or link back to docs.

---

## 7. Architecture Notes

- Hash routing (`createHashRouter`) is intentional — avoids Fastify fallback config for SPA.
- v2.0 multi-skill cards are normalized client-side: each skill in a card becomes its own `HubCard` in the grid.
- All data fetching uses the `isFirstFetch` ref pattern to avoid loading flicker on poll cycles.
- Category filtering is client-side (server API has no category parameter).
- The LoginForm/SharePage slate-* inconsistency appears to be a migration oversight — OwnerDashboard was migrated to hub-* tokens (mentioned in its JSDoc: "migrated from slate-* in v2.2") but LoginForm and SharePage were not.
