---
phase: 12-foundation-agent-directory
plan: "03"
subsystem: ui
tags: [react, react-router, boring-avatars, tailwind, hooks, polling]

# Dependency graph
requires:
  - phase: 12-foundation-agent-directory
    plan: "01"
    provides: "App shell, routing structure, hub/src/types.ts with AppOutletContext, NavBar"
  - phase: 12-foundation-agent-directory
    plan: "02"
    provides: "GET /api/agents and GET /api/agents/:owner backend endpoints"
provides:
  - Agent directory page at /hub/#/agents with ranked list, identicons, stats
  - Individual agent profile page at /hub/#/agents/:owner with skills grid and recent activity
  - useAgents() and useAgentProfile() hooks with 30s polling and graceful degradation
  - AgentProfile, ActivityEntry, AgentProfileResponse type definitions
affects:
  - Phase 13 (activity feed may reference ProfilePage patterns)
  - Phase 14 (credit UI polish may touch agent display)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - isFirstFetch ref pattern for 30s polling without loading flicker (same as useCards)
    - CSS grid layout with grid-cols-[48px_1fr_...] for table-like rows without <table>
    - Inline timeAgo() utility for relative timestamps in activity entries
    - AppOutletContext.setSelectedCard used from ProfilePage to open CardModal

key-files:
  created:
    - hub/src/hooks/useAgents.ts
    - hub/src/components/AgentList.tsx
    - hub/src/components/ProfilePage.tsx
  modified:
    - hub/src/types.ts
    - hub/src/main.tsx

key-decisions:
  - "ProfilePage uses useOutletContext to call setSelectedCard — consistent with how other pages open CardModal"
  - "useAgentProfile accepts empty string as fallback owner param; redirect via useEffect if owner is undefined"
  - "timeAgo() implemented inline in ProfilePage — too small to warrant a shared utility"

patterns-established:
  - "isFirstFetch ref pattern: loading flicker-free polling — same pattern for all future polling hooks"
  - "CSS grid table rows: grid-cols-[48px_1fr_100px_80px_100px] gives consistent column alignment without <table>"

requirements-completed: [AGENT-01, AGENT-02, AGENT-03]

# Metrics
duration: 3min
completed: 2026-03-16
---

# Phase 12 Plan 03: Frontend Agent Directory Summary

**React agent directory with ranked list (identicons, stats, 30s polling) and profile page (skills grid, recent activity, CardModal integration) wired into /agents and /agents/:owner routes**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-16T21:08:00Z
- **Completed:** 2026-03-16T21:11:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- useAgents() hook with 30s polling (isFirstFetch pattern, no loading flicker on polls)
- useAgentProfile(owner) hook with 404 handling and graceful degradation on poll errors
- AgentList component: ranked table with boring-avatars identicons, success rate, skill count, credits earned, navigate on row click
- ProfilePage component: header with stats pills, skills grid (opens CardModal via setSelectedCard), recent activity list with status badges and timeAgo relative timestamps
- Both routes wired into createHashRouter at /agents and /agents/:owner replacing placeholder divs

## Task Commits

Each task was committed atomically:

1. **Task 1: Add AgentProfile types and useAgents/useAgentProfile hooks** - `af11ce6` (feat)
2. **Task 2: Build AgentList and ProfilePage components, wire into router** - `21a8a28` (feat)

## Files Created/Modified

- `hub/src/hooks/useAgents.ts` — useAgents() and useAgentProfile() hooks with 30s polling
- `hub/src/types.ts` — Added AgentProfile, ActivityEntry, AgentProfileResponse interfaces
- `hub/src/components/AgentList.tsx` — Ranked agent directory table with identicons and stats
- `hub/src/components/ProfilePage.tsx` — Agent profile with skills grid, activity list, timeAgo
- `hub/src/main.tsx` — Replaced placeholder divs with AgentList and ProfilePage routes

## Decisions Made

- ProfilePage reads setSelectedCard from useOutletContext to open CardModal when a skill is clicked — consistent with how DiscoverPage/CardGrid work
- timeAgo() function kept inline in ProfilePage (not extracted to lib/utils) because it is only used in one place and the plan specified "inline"
- useAgentProfile takes empty string fallback for owner and redirects via useEffect — avoids conditional hook invocation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — TypeScript compiled clean on first attempt, production build succeeded, all hub tests passed. Pre-existing useAuth.test.ts failures (localStorage.clear environment issue) confirmed pre-existing before this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Agent directory fully functional. /agents and /agents/:owner routes are live.
- Phase 13 (activity feed, docs) can proceed independently.
- ProfilePage uses setSelectedCard for CardModal — Phase 14 modal polish applies automatically.

---
*Phase: 12-foundation-agent-directory*
*Completed: 2026-03-16*
