---
phase: 13-activity-feed-docs-page
plan: "01"
subsystem: api, ui
tags: [sqlite, fastify, react, typescript, polling]

# Dependency graph
requires:
  - phase: 12-foundation-agent-directory
    provides: registry server with /api/agents routes, request_log schema with action_type column, hub types.ts and hook patterns

provides:
  - GET /api/activity public endpoint with LEFT JOIN on capability_cards for provider field
  - getActivityFeed() function in request-log.ts with ISO since param and auto_request exclusion
  - useActivity hook with 10s polling and prepend-only update pattern
  - ActivityFeed page component at /hub/#/activity
  - ActivityEventRow single event renderer with type badges and status colors
  - ActivityEvent interface in hub/src/types.ts

affects:
  - 13-02-docs-page (sibling plan, shares hub infrastructure)
  - 14-credit-ui-modal-polish (may build on activity feed patterns)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ISO timestamp-based since param for efficient polling (not SincePeriod enum)"
    - "LEFT JOIN request_log to capability_cards to get provider without N+1 queries"
    - "Client-side event type derivation: action_type='auto_share' → 'capability_shared', else 'exchange_completed'"
    - "Prepend-only poll updates: setItems(prev => [...newEvents, ...prev]) preserves scroll position"
    - "lastSeenAt ref tracks newest item's created_at for subsequent poll requests"

key-files:
  created:
    - hub/src/hooks/useActivity.ts
    - hub/src/components/ActivityFeed.tsx
    - hub/src/components/ActivityEventRow.tsx
  modified:
    - src/registry/request-log.ts
    - src/registry/server.ts
    - src/registry/server.test.ts
    - hub/src/types.ts
    - hub/src/main.tsx

key-decisions:
  - "Activity feed uses ISO string since param (not SincePeriod enum) to support arbitrary timestamp-based polling"
  - "auto_request rows excluded at SQL level via WHERE clause; auto_share rows included for capability_shared events"
  - "Provider field null-safe via LEFT JOIN — handles deleted cards gracefully"
  - "Event type derived client-side from action_type to avoid adding a computed column to the database"
  - "timeAgo() kept inline in ActivityEventRow — single-use, avoids shared utility file dependency"

patterns-established:
  - "10s poll with prepend-only updates: use lastSeenAt ref + since param + setItems(prev => [...new, ...prev])"
  - "Public activity feed excludes auto_request but includes auto_share — SQL filter pattern"

requirements-completed: [FEED-01, FEED-02, FEED-03, FEED-04]

# Metrics
duration: 4min
completed: 2026-03-16
---

# Phase 13 Plan 01: Activity Feed Summary

**Public activity feed with JOIN-backed /api/activity endpoint, 10s polling hook with prepend-only updates, and dark-themed event list showing type badges, participants, credits, and relative timestamps**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-16T13:37:10Z
- **Completed:** 2026-03-16T13:41:30Z
- **Tasks:** 2 (Task 1 TDD: 3 commits; Task 2: 1 commit)
- **Files modified:** 8

## Accomplishments
- Backend: getActivityFeed() with single LEFT JOIN query, auto_request exclusion, ISO since param, limit capping
- Backend: GET /api/activity public route (before ownerRoutes, no auth required)
- Frontend: useActivity hook with 10s interval, isFirstFetch pattern, lastSeenAt ref for prepend-only polling
- Frontend: ActivityFeed page with loading skeleton, error/empty states, pulsing green dot header
- Frontend: ActivityEventRow with emerald (Exchange) / violet (Shared) badges, status colors, credit display, timeAgo
- TDD: 8 new tests covering all endpoint behaviors (59 total, all passing)
- TypeScript: hub compiles clean (0 errors)

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for GET /api/activity** - `205b5a8` (test)
2. **Task 1 GREEN: getActivityFeed + GET /api/activity route** - `0477f57` (feat)
3. **Task 2: ActivityEvent types, useActivity hook, components, route** - `f3f17e7` (feat)

## Files Created/Modified
- `src/registry/request-log.ts` - Added ActivityFeedEntry interface and getActivityFeed() with LEFT JOIN
- `src/registry/server.ts` - Added GET /api/activity public route; imported getActivityFeed
- `src/registry/server.test.ts` - Added 8 tests for activity endpoint (362 lines added)
- `hub/src/types.ts` - Added ActivityEvent interface (below existing ActivityEntry, no modification)
- `hub/src/hooks/useActivity.ts` - Created: 10s polling hook with since-based prepend updates
- `hub/src/components/ActivityFeed.tsx` - Created: page container with all states
- `hub/src/components/ActivityEventRow.tsx` - Created: single event row renderer
- `hub/src/main.tsx` - Wired /activity route to ActivityFeed, added import

## Decisions Made
- ISO string since param (not SincePeriod enum) — polling requires arbitrary timestamps, not fixed windows
- auto_request excluded at SQL WHERE level for efficiency; auto_share included for capability_shared events
- Event type derived client-side to avoid computed columns or extra DB columns
- timeAgo() inline in ActivityEventRow — same pattern as ProfilePage (plan-specified)
- React import removed from TSX files — project uses automatic JSX transform (React 18)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused React imports in TSX components**
- **Found during:** Task 2 (TypeScript verification)
- **Issue:** TypeScript strict mode flagged `import React from 'react'` as unused (TS6133) in ActivityEventRow.tsx and ActivityFeed.tsx — project uses React 18 automatic JSX transform
- **Fix:** Removed explicit React imports from both components
- **Files modified:** hub/src/components/ActivityEventRow.tsx, hub/src/components/ActivityFeed.tsx
- **Verification:** `npx tsc --noEmit` exits 0 with no errors
- **Committed in:** f3f17e7 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - unused import cleanup)
**Impact on plan:** Trivial fix required for TypeScript strict mode compliance. No scope creep.

## Issues Encountered
None — plan executed smoothly. The only issue was the unused React import caught immediately by TypeScript.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GET /api/activity is live and returns paginated events with provider field from JOIN
- /hub/#/activity page is functional with 10s auto-refresh and prepend-only updates
- Ready for Phase 13 Plan 02 (Docs page)
- Activity feed can be extended with agent_joined/milestone event types in a future phase

---
*Phase: 13-activity-feed-docs-page*
*Completed: 2026-03-16*
