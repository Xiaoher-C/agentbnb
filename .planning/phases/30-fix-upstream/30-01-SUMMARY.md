---
phase: 30-fix-upstream
plan: 01
subsystem: relay
tags: [websocket, zod, sqlite, v2-card, raw-sql]

# Dependency graph
requires:
  - phase: 25-relay-timeout
    provides: WebSocket relay infrastructure
provides:
  - "upsertCard() accepts both v1.0 and v2.0 Capability Cards via AnyCardSchema"
  - "Raw SQL persistence bypassing store.ts v1.0-only validation"
  - "v2.0 card lifecycle tests (register, offline, reconnect)"
affects: [relay, openclaw, discovery]

# Tech tracking
tech-stack:
  added: []
  patterns: ["AnyCardSchema discriminated union for relay card validation", "Raw SQL INSERT/UPDATE for v2.0 cards (same pattern as soul-sync.ts)"]

key-files:
  created: []
  modified:
    - src/relay/websocket-relay.ts
    - src/relay/websocket-relay.test.ts

key-decisions:
  - "Replaced insertCard/updateCard/getCard imports with AnyCardSchema + raw SQL -- store.ts functions are locked to v1.0 schema"
  - "Used same raw SQL pattern as soul-sync.ts (L112-121) for consistency"

patterns-established:
  - "AnyCardSchema for any code path that receives cards from external sources (relay, API)"

requirements-completed: [LOOP-01, LOOP-02]

# Metrics
duration: 3min
completed: 2026-03-19
---

# Phase 30 Plan 01: Fix v2.0 Card Relay Registration Summary

**Fixed relay upsertCard() to accept v2.0 multi-skill cards via AnyCardSchema + raw SQL, with full lifecycle tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-19T06:35:06Z
- **Completed:** 2026-03-19T06:37:39Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- upsertCard() now validates via AnyCardSchema (accepts both v1.0 and v2.0 cards)
- Raw SQL INSERT/UPDATE bypasses store.ts v1.0-only insertCard/updateCard functions
- 3 new tests: v2.0 card registration, offline on disconnect, online on reconnect
- All 35 relay tests pass, 881/885 full suite pass (4 pre-existing failures in soul-sync.test.ts)

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing v2.0 card tests** - `9ac3a10` (test)
2. **Task 1 GREEN: Fix upsertCard() with AnyCardSchema + raw SQL** - `095c097` (feat)

_Note: Task 2 tests were written as part of Task 1 RED phase (TDD approach). Both tasks share the same commits._

## Files Created/Modified
- `src/relay/websocket-relay.ts` - Replaced insertCard/updateCard/getCard with AnyCardSchema validation + raw SQL persistence
- `src/relay/websocket-relay.test.ts` - Added makeV2Card helper, registerAgentV2 helper, 3 new v2.0 lifecycle tests

## Decisions Made
- Replaced all three store.ts imports (insertCard, updateCard, getCard) since they were only used in upsertCard -- no other callers in websocket-relay.ts
- Used AnyCardSchema.safeParse() for validation (throws AgentBnBError on invalid) rather than CapabilityCardV2Schema directly, to preserve v1.0 backward compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- v2.0 multi-skill cards now flow through relay registration without validation errors
- OpenClaw agents publishing v2.0 cards via WebSocket relay will be discovered correctly
- Ready for any subsequent relay or discovery work

---
*Phase: 30-fix-upstream*
*Completed: 2026-03-19*
