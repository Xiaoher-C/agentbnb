---
phase: 03-ux-layer
plan: 03b
subsystem: ui
tags: [react, tailwind, testing-library, user-event, vitest, dashboard, spa, tabs]

# Dependency graph
requires:
  - phase: 03-ux-layer-03a
    provides: useAuth, useRequests (since param), useOwnerCards (balance from /me), LoginForm, AuthGate
  - phase: 03-ux-layer-02
    provides: /me, /requests (since), /draft, /cards/:id/toggle-online, PATCH /cards owner endpoints

provides:
  - RequestHistory component: dark table with success/failure/timeout status colour badges, empty state
  - OwnerDashboard component: owner name, credit balance, low-credit badge (< 10), per-period counts (24h/7d/30d), cards list with toggle, request history
  - SharePage component: /health probe (2s AbortController), /draft fetch with auth header, editable card form (name/description/credits_per_call), Publish → POST /cards, server-not-running block with agentbnb serve command
  - App.tsx: tab navigation (Discover|Share|My Agent), useAuth at App level, AuthGate wraps My Agent, Disconnect link
  - vite.config.ts: /me, /requests, /draft proxy entries added

affects:
  - human-verify-03b

# Tech tracking
tech-stack:
  added: ["@testing-library/user-event@14.6.1"]
  patterns:
    - AbortController with setTimeout for /health probe with 2s deadline
    - Multiple useRequests calls (one per period) for 24h/7d/30d display in OwnerDashboard
    - getAllByText instead of getByText when same text appears in multiple DOM nodes (cards list + request history)
    - getByRole('button', { name: ... }) for disambiguating Publish button from surrounding text

key-files:
  created:
    - hub/src/components/RequestHistory.tsx
    - hub/src/components/RequestHistory.test.tsx
    - hub/src/components/OwnerDashboard.tsx
    - hub/src/components/OwnerDashboard.test.tsx
    - hub/src/components/SharePage.tsx
    - hub/src/components/SharePage.test.tsx
    - hub/src/App.test.tsx
  modified:
    - hub/src/App.tsx
    - hub/vite.config.ts
    - hub/package.json

key-decisions:
  - "Three separate useRequests calls (24h, 7d, 30d) in OwnerDashboard — simpler than one call returning all periods, reuses existing hook signature"
  - "AbortController + setTimeout(2000) for /health probe — abort signal cancels hanging fetch before state update on unmount"
  - "getAllByText for 'GPT Summarizer' in OwnerDashboard test — card name appears in both cards list and RequestHistory table in same render"
  - "getByRole('button', { name: /^Publish$/i }) for SharePage publish test — 'ready to publish' text in status paragraph also matched /Publish/i"
  - "@testing-library/user-event installed (Rule 3 auto-fix) — required for userEvent.click in SharePage and App tab tests"

patterns-established:
  - "Tab navigation pattern: activeTab state + TABS array + button map, active tab gets border-b-2 border-emerald-400 -mb-px"
  - "Server health check pattern: fetch('/health') with AbortController + setTimeout on mount, sets 'checking'|'running'|'unreachable' state"
  - "Low-credit badge: inline red badge 'Low credits — N remaining' shown when balance !== null && balance < 10"

requirements-completed: [UX-11, UX-12, UX-13, UX-14]

# Metrics
duration: 8min
completed: 2026-03-15
---

# Phase 3 Plan 03b: Hub Dashboard SPA — Wiring and Pages Summary

**Tab-based Hub with OwnerDashboard (credit balance, low-credit badge, per-period request counts), SharePage (/draft fetch with editable card preview + Publish flow), RequestHistory table, and App.tsx tab navigation — 64 hub tests pass, awaiting human verification**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-15T06:51:47Z
- **Completed:** 2026-03-15T06:59:50Z
- **Tasks:** 1 of 2 complete (Task 2 is human-verify checkpoint)
- **Files modified:** 9

## Accomplishments

- Built `RequestHistory` — dark-themed table with per-row status colour badges (emerald/red/yellow), empty state, columns: Card Name, Status, Latency, Credits, Time
- Built `OwnerDashboard` — header with owner name, 4-stat grid (published, online, credits earned, balance + low-credit badge when < 10), per-period request counts (24h/7d/30d side-by-side), published cards list with online/offline badge and toggle button, RequestHistory embedded for last 10 requests
- Built `SharePage` — probes `/health` with 2s AbortController timeout; if unreachable shows "Server Not Running" block with `agentbnb serve` command; if running + authenticated, fetches `GET /draft` and renders each card as an editable form (name, description, credits per call) with Publish button sending `POST /cards`; handles no-draft-cards guidance state
- Updated `App.tsx` — added tab navigation bar (Discover|Share|My Agent), integrated `useAuth` at App level, wrapped My Agent in `AuthGate`, added Disconnect link when authenticated
- Updated `vite.config.ts` — added `/me`, `/requests`, `/draft` proxy entries for dev server

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests** — `79aa12b` (test)
2. **Task 1 GREEN: Implementation** — `cf21b6c` (feat)

**Plan metadata:** (this commit, docs)

_Note: TDD task had RED (failing tests) → GREEN (implementation) cycle_

## Files Created/Modified

- `hub/src/components/RequestHistory.tsx` — Status-badged request log table component
- `hub/src/components/RequestHistory.test.tsx` — 5 tests (rows, empty, status badges, multiple rows)
- `hub/src/components/OwnerDashboard.tsx` — Full owner dashboard with credits, periods, cards, history
- `hub/src/components/OwnerDashboard.test.tsx` — 5 tests (owner name, low-credit badge, no badge at 10+, period labels, history)
- `hub/src/components/SharePage.tsx` — /health probe, /draft fetch, editable form, Publish flow, error states
- `hub/src/components/SharePage.test.tsx` — 4 tests (unreachable, /draft fetch + preview, Publish POST, no-draft state)
- `hub/src/App.test.tsx` — 2 tests (tab nav renders, My Agent shows AuthGate/LoginForm)
- `hub/src/App.tsx` — Tab navigation, useAuth integration, AuthGate wiring, Disconnect link
- `hub/vite.config.ts` — /me, /requests, /draft proxy entries

## Decisions Made

- Three separate `useRequests` calls (one per period) in OwnerDashboard — straightforward reuse of existing hook signature rather than adding a multi-period variant
- `AbortController` + `setTimeout(2000)` for `/health` probe — AbortSignal cancels the hanging fetch when server is unreachable, prevents state update on unmount
- `getAllByText` + `getByRole` in tests to disambiguate when same text appears in multiple DOM nodes
- `@testing-library/user-event` installed (Rule 3 auto-fix) — not in hub devDependencies but required for click simulation tests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing @testing-library/user-event**
- **Found during:** Task 1 RED (writing tests)
- **Issue:** SharePage and App tests use `userEvent.click` but `@testing-library/user-event` was not in hub/package.json devDependencies; vitest import resolution failed
- **Fix:** `pnpm add -D @testing-library/user-event` in hub/
- **Files modified:** hub/package.json, hub/pnpm-lock.yaml
- **Verification:** Import resolves, 64 hub tests pass
- **Committed in:** 79aa12b (RED test commit)

**2. [Rule 1 - Bug] Fixed overly strict test matchers (getByText → getAllByText/getByRole)**
- **Found during:** Task 1 GREEN (running tests)
- **Issue:** 4 tests failed because rendered DOM has same text in multiple nodes (e.g. "GPT Summarizer" in both cards list and request history table; "Publish" in status paragraph and button; "agentbnb serve" in code block and `<code>` tag)
- **Fix:** Updated test assertions to use `getAllByText(...).length > 0`, `getByRole('button', { name: /^Publish$/i })`, and `getByText(/Server Not Running/i)` with `getAllByText` for the command
- **Files modified:** hub/src/components/OwnerDashboard.test.tsx, hub/src/components/SharePage.test.tsx
- **Verification:** All 64 hub tests pass
- **Committed in:** cf21b6c (GREEN feat commit)

---

**Total deviations:** 2 auto-fixed (1 blocking dependency, 1 test matcher bug)
**Impact on plan:** Both auto-fixes necessary for tests to run and pass. No scope creep.

## Issues Encountered

- Root `npx vitest run` picks up hub component tests which need jsdom environment — not configured at root level. Backend-only run (`npx vitest run --exclude "hub/**"`) shows 238 tests pass. Hub tests run correctly via `cd hub && pnpm test`. This is a pre-existing configuration separation, not a regression.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Human verification required (Task 2 checkpoint): tab navigation, auth flow, dashboard with balance and period counts, share page with draft card preview, mobile responsiveness
- After verification: Phase 3 UX Layer is complete — all 4 plans done
- Ready to commit docs and update STATE.md after human approval

---
*Phase: 03-ux-layer*
*Completed: 2026-03-15*
