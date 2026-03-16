---
phase: 12-foundation-agent-directory
plan: "01"
subsystem: hub-routing
tags: [react-router, navigation, spa, hash-routing, navbar]
dependency_graph:
  requires: []
  provides: [hub-routing-foundation, navbar-navlink, discover-page-route]
  affects: [hub/src/main.tsx, hub/src/App.tsx, hub/src/components/NavBar.tsx]
tech_stack:
  added: [react-router@7.13.1]
  patterns: [createHashRouter, NavLink, useOutletContext, Outlet-context-pattern]
key_files:
  created:
    - hub/src/pages/DiscoverPage.tsx
    - hub/src/components/NavBar.tsx
    - hub/src/components/GetStartedCTA.tsx
  modified:
    - hub/src/main.tsx
    - hub/src/App.tsx
    - hub/src/types.ts
    - hub/src/App.test.tsx
decisions:
  - react-router 7.13.1 hash mode — no Fastify fallback config change required
  - MemoryRouter wraps App in tests since NavBar uses NavLink (requires Router context)
  - AppOutletContext typed with satisfies keyword in Outlet context prop
  - Balance fetch via /me endpoint in App layout shell (simple inline useEffect, not separate hook)
metrics:
  duration: "4m"
  completed_date: "2026-03-16"
  tasks_completed: 2
  files_changed: 7
---

# Phase 12 Plan 01: React-Router Foundation + NavBar Summary

**One-liner:** Hash-based SPA routing with createHashRouter (8 routes), layout-shell App, 5-tab NavBar with NavLink active states, My Agent dropdown, and GetStartedCTA with CLI popover.

## What Was Built

### Task 1: react-router, createHashRouter, DiscoverPage
- Installed react-router 7.13.1 (hash mode — `/#/` URLs need no Fastify fallback)
- Added `AppOutletContext` type to `hub/src/types.ts` for Outlet context sharing
- Extracted `DiscoverPage` as a standalone route component reading `setSelectedCard` from `useOutletContext<AppOutletContext>()`
- Replaced `hub/src/main.tsx` with `createHashRouter` setup defining 8 routes:
  - `/` (index) → DiscoverPage
  - `/agents`, `/agents/:owner` → placeholder (Plan 03)
  - `/activity`, `/docs` → placeholder (Phase 13)
  - `/share` → SharePageWrapper (reads apiKey from Outlet context)
  - `/myagent` → MyAgentWrapper (AuthGate + OwnerDashboard via Outlet context)
  - `/settings` → placeholder

### Task 2: App layout shell + NavBar + GetStartedCTA
- Rewrote `App.tsx` as a layout shell: no more tab state, no discover-specific imports
- Simple `useEffect` in App fetches `/me` for credit balance when `apiKey` is truthy
- Created `NavBar.tsx` with:
  - Title "AgentBnB" left, auth badge or CTA right
  - 5-tab nav: Discover, Agents, Activity, Docs, My Agent (dropdown)
  - `NavLink` with `className` callback for active state styling
  - `MyAgentDropdown` sub-component with click-outside close (mousedown listener)
  - `NavCreditBadge` showing `cr {balance}` in `font-mono text-emerald-400`
  - `end` prop on Discover NavLink so `/` doesn't match all child routes
- Created `GetStartedCTA.tsx`:
  - "Get Started — 50 free credits" button
  - Popover below showing `npx agentbnb init` with Copy button (navigator.clipboard)
  - Click-outside close via `useRef` + `mousedown` listener

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated App.test.tsx for react-router context**
- **Found during:** Task 2 verification
- **Issue:** App now renders NavBar which uses `NavLink` — requires a Router context. Existing test rendered `<App />` bare with no router, causing `useLocation() may only be used in Router` errors.
- **Fix:** Rewrote App.test.tsx to use `MemoryRouter` + `Routes` + `Route` wrapper. Updated test assertions to match the new NavLink-based architecture (5 tabs as links + My Agent dropdown button + Get Started CTA).
- **Files modified:** `hub/src/App.test.tsx`
- **Commit:** 2d10ecd

## Test Results

- TypeScript: clean (0 errors)
- Tests: 63 pass (11 test files), 6 fail (pre-existing `useAuth.test.ts` `localStorage.clear` issue unrelated to this plan)
- Production build: succeeds (300 kB bundle)

## Self-Check: PASSED

Files verified:
- hub/src/pages/DiscoverPage.tsx: FOUND
- hub/src/components/NavBar.tsx: FOUND
- hub/src/components/GetStartedCTA.tsx: FOUND
- hub/src/main.tsx: FOUND (createHashRouter)
- hub/src/App.tsx: FOUND (Outlet layout shell)

Commits:
- 15dd9f9: feat(12-01): install react-router, wire createHashRouter, extract DiscoverPage
- 2d10ecd: feat(12-01): convert App.tsx to layout shell, build NavBar with credit badge and My Agent dropdown
