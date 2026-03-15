---
phase: 03-ux-layer
plan: 03a
subsystem: ui
tags: [react, hooks, auth, localStorage, polling, vitest, testing-library]

# Dependency graph
requires:
  - phase: 03-ux-layer-02
    provides: auth-protected owner endpoints (/me, /requests, /draft, toggle-online, PATCH cards)
  - phase: 02.2-agent-hub-02
    provides: useCards hook pattern (30s polling, fetch mocking pattern)

provides:
  - useAuth hook: localStorage-backed API key state with login/logout
  - useRequests hook: 30s polling of /requests with since period filter
  - useOwnerCards hook: fetches /me for owner+balance, filters /cards by owner
  - LoginForm component: API key input with emerald/slate-800 theme
  - AuthGate component: conditional wrapper — LoginForm vs children

affects:
  - 03-ux-layer-03b

# Tech tracking
tech-stack:
  added: []
  patterns:
    - vi.stubGlobal('fetch', ...) for hook fetch mocking in jsdom
    - vi.unstubAllGlobals() in afterEach for clean fetch mock teardown
    - fake timers NOT used with waitFor — incompatible, causes timeouts

key-files:
  created:
    - hub/src/hooks/useAuth.ts
    - hub/src/hooks/useAuth.test.ts
    - hub/src/hooks/useRequests.ts
    - hub/src/hooks/useRequests.test.ts
    - hub/src/hooks/useOwnerCards.ts
    - hub/src/hooks/useOwnerCards.test.ts
    - hub/src/components/AuthGate.tsx
    - hub/src/components/AuthGate.test.tsx
    - hub/src/components/LoginForm.tsx
    - hub/src/components/LoginForm.test.tsx
  modified: []

key-decisions:
  - "vi.useFakeTimers() incompatible with waitFor in @testing-library/react — removed from hook tests to prevent timeouts"
  - "vi.unstubAllGlobals() in afterEach preferred over vi.restoreAllMocks() for fetch stub cleanup"
  - "useOwnerCards performs two sequential fetches (/me then /cards) in a single useEffect run, cancellable via boolean flag"
  - "AuthGate checks truthiness (!apiKey) to handle both null and undefined — consistent with optional prop typing"
  - "useRequests returns loading:false immediately when apiKey is null — no pending state for unauthenticated callers"

patterns-established:
  - "Hook fetch mocking: vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true, json: async () => ...}))"
  - "Cancellation in useEffect: let cancelled = false; return () => { cancelled = true; }"
  - "30s polling pattern: setInterval in separate useEffect, clears on cleanup"

requirements-completed: [UX-09, UX-10]

# Metrics
duration: 3min
completed: 2026-03-15
---

# Phase 3 Plan 03a: Hub Auth Layer Summary

**localStorage API key auth hook, 30s-polling /requests hook with since filter, /me credit balance extraction, and LoginForm/AuthGate components — 48 hub tests pass**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-15T06:45:38Z
- **Completed:** 2026-03-15T06:49:03Z
- **Tasks:** 2
- **Files modified:** 10 (all created)

## Accomplishments

- Built `useAuth` — reads API key from localStorage on mount, exposes `login(key)`, `logout()`, and `isAuthenticated` derived boolean
- Built `useRequests` — 30s polling of auth-protected `/requests?since={period}` with 401 → 'Invalid API key' error handling; skips fetch when apiKey null
- Built `useOwnerCards` — sequentially fetches `/me` (owner name + credit balance) then `/cards` (filtered by owner); balance returned as number, never null when authenticated
- Built `LoginForm` — monospace API key input with emerald Connect button, slate-800/900 dark theme matching Hub aesthetic
- Built `AuthGate` — renders LoginForm or children based on apiKey truthiness; handles null and undefined

## Task Commits

Each task committed atomically:

1. **Task 1: Auth hooks** - `b35edd9` (feat)
2. **Task 2: Auth gate components** - `8d34436` (feat)

**Plan metadata:** (this commit, docs)

_Note: TDD tasks had RED (failing tests) → GREEN (implementation) cycle per task_

## Files Created/Modified

- `hub/src/hooks/useAuth.ts` — localStorage-backed API key hook
- `hub/src/hooks/useAuth.test.ts` — 6 tests for login/logout/isAuthenticated
- `hub/src/hooks/useRequests.ts` — 30s polling hook for /requests with since param
- `hub/src/hooks/useRequests.test.ts` — 4 tests for auth header, since param, null skip, 401
- `hub/src/hooks/useOwnerCards.ts` — /me + /cards fetch with owner filter and balance
- `hub/src/hooks/useOwnerCards.test.ts` — 4 tests for balance, card filter, null skip
- `hub/src/components/LoginForm.tsx` — API key form with Tailwind dark theme
- `hub/src/components/LoginForm.test.tsx` — 4 tests for input, button, submit, empty guard
- `hub/src/components/AuthGate.tsx` — conditional wrapper component
- `hub/src/components/AuthGate.test.tsx` — 3 tests for authenticated/unauthenticated/undefined states

## Decisions Made

- Removed `vi.useFakeTimers()` from hook tests — incompatible with `waitFor` in @testing-library/react; causes all tests to time out at 5000ms because `waitFor` uses real timers internally
- Used `vi.unstubAllGlobals()` in afterEach for clean fetch mock teardown (more explicit than vi.restoreAllMocks which targets spies)
- `useOwnerCards` uses a `cancelled` boolean flag for cleanup in useEffect rather than AbortController — simpler pattern, sufficient for sequential async calls
- `AuthGate` checks `!apiKey` (falsy) rather than strict null check — covers both null and undefined for flexible prop typing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed vi.useFakeTimers() causing waitFor timeout**
- **Found during:** Task 1 (GREEN phase — hook implementation)
- **Issue:** Tests for useRequests and useOwnerCards all timed out at 5000ms because vi.useFakeTimers() prevents the real timers that waitFor relies on
- **Fix:** Removed vi.useFakeTimers()/useRealTimers() from beforeEach/afterEach; added vi.unstubAllGlobals() to afterEach for fetch cleanup
- **Files modified:** useRequests.test.ts, useOwnerCards.test.ts
- **Verification:** All 48 tests pass in 883ms
- **Committed in:** b35edd9 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — test configuration bug)
**Impact on plan:** Fix was necessary for tests to pass; no scope change.

## Issues Encountered

None beyond the fake timers issue documented above (auto-fixed).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 5 artifacts ready for Plan 03b (dashboard, share page, app wiring):
  - `useAuth` — API key state management
  - `useRequests` — owner request log with period filter
  - `useOwnerCards` — owner cards + credit balance
  - `LoginForm` — authentication entry point
  - `AuthGate` — top-level auth wrapper
- 48 hub tests pass, TypeScript strict-mode compatible

---
*Phase: 03-ux-layer*
*Completed: 2026-03-15*
