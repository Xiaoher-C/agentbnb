---
phase: 31-fix-downstream
plan: 01
subsystem: discovery
tags: [remote-registry, fetchRemoteCards, async, fallback, capability-matcher, auto-request]

# Dependency graph
requires:
  - phase: 17-remote-registry
    provides: fetchRemoteCards and mergeResults utilities
provides:
  - AutoRequestor with optional registryUrl and remote fallback
  - Async matchSubTasks with per-subtask remote fallback
affects: [31-02-cli-commands, conductor, autonomy]

# Tech tracking
tech-stack:
  added: []
  patterns: [fallback-only remote search when local returns zero, per-subtask async remote lookup]

key-files:
  created: []
  modified:
    - src/autonomy/auto-request.ts
    - src/autonomy/auto-request.test.ts
    - src/conductor/capability-matcher.ts
    - src/conductor/capability-matcher.test.ts
    - src/conductor/conductor-mode.ts
    - src/cli/conduct.ts

key-decisions:
  - "Fallback-only design: remote search only when local returns zero results (not merge)"
  - "matchSubTasks changed from sync to async (Promise.all on subtask map)"
  - "Remote fetch errors caught gracefully per-subtask with empty cards fallback"

patterns-established:
  - "Remote fallback pattern: local-first, remote on zero results, try/catch for graceful degradation"

requirements-completed: [LOOP-03, LOOP-04]

# Metrics
duration: 4min
completed: 2026-03-19
---

# Phase 31 Plan 01: Remote Registry Fallback Summary

**AutoRequestor and matchSubTasks fall back to fetchRemoteCards when local SQLite search returns zero results, enabling cross-machine capability discovery**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-19T06:35:22Z
- **Completed:** 2026-03-19T06:39:45Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- AutoRequestor accepts optional `registryUrl` and falls back to remote registry when local search returns empty
- matchSubTasks is now async (`Promise<MatchResult[]>`) with per-subtask remote fallback
- All callers (conductor-mode.ts, conduct.ts) updated with `await`
- 10 new test cases covering remote fallback, no-registryUrl regression, network error graceful degradation
- Zero regressions: all 39 tests pass, TypeScript compiles clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add remote fallback to AutoRequestor** - `80961e0` (feat)
2. **Task 2: Make matchSubTasks async with remote fallback** - `54f253f` (feat)

_Note: TDD tasks each had RED then GREEN phases within the same commit._

## Files Created/Modified
- `src/autonomy/auto-request.ts` - Added registryUrl option and remote fallback in requestWithAutonomy
- `src/autonomy/auto-request.test.ts` - 5 new remote fallback test cases
- `src/conductor/capability-matcher.ts` - Async matchSubTasks with per-subtask remote fallback
- `src/conductor/capability-matcher.test.ts` - 5 new remote fallback test cases, existing tests updated to async
- `src/conductor/conductor-mode.ts` - Added await to matchSubTasks call
- `src/cli/conduct.ts` - Added await to matchSubTasks call

## Decisions Made
- Fallback-only design: remote search only when local returns zero results (not merge) -- keeps existing behavior unchanged when local has matches
- matchSubTasks changed from sync to async via Promise.all -- minimal disruption, only 2 callers needed `await` added
- Remote fetch errors caught gracefully per-subtask -- network failures degrade to empty results, never crash

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Remote fallback wired into AutoRequestor and Conductor
- Plan 31-02 can now add `--registry` flag to CLI commands that pass registryUrl through to these functions

---
*Phase: 31-fix-downstream*
*Completed: 2026-03-19*
