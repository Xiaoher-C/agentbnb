---
phase: 06-idle-rate-monitoring-auto-share
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, request-log, capability-cards, sliding-window, tdd]

# Dependency graph
requires:
  - phase: 05-autonomy-tiers-credit-budgeting
    provides: insertAuditEvent writing action_type to request_log; BudgetManager for credit gating
  - phase: 04-agent-runtime-multi-skill-foundation
    provides: v2.0 card schema with skills[]; request_log with skill_id + action_type columns
provides:
  - getSkillRequestCount(db, skillId, windowMs): sliding-window SQL COUNT excluding audit rows
  - updateSkillAvailability(db, cardId, skillId, online): single-skill availability flip preserving siblings
  - updateSkillIdleRate(db, cardId, skillId, idleRate): _internal merge preserving existing keys
affects:
  - 06-02-PLAN (IdleMonitor polling loop depends on all three functions)
  - any phase that reads skill._internal or skill.availability.online

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Raw JSON read/mutate/write pattern for v2.0 skill mutations (avoids Zod v1.0 rejection)
    - Sliding-window COUNT query with skill_id + status + action_type IS NULL guard

key-files:
  created: []
  modified:
    - src/registry/request-log.ts
    - src/registry/request-log.test.ts
    - src/registry/store.ts
    - src/registry/store.test.ts

key-decisions:
  - "getSkillRequestCount SQL uses AND action_type IS NULL to exclude autonomy audit events — without this filter auto_share events would lower idle rate artificially"
  - "updateSkillAvailability and updateSkillIdleRate use raw JSON read/mutate/write (not updateCard) — updateCard uses Zod v1.0 schema that rejects v2.0 skill shapes"
  - "hub/ test failures (43 failing) are pre-existing jsdom environment issues unrelated to this plan — confirmed by git stash verification"

patterns-established:
  - "Raw JSON blob mutation: SELECT data -> JSON.parse -> find skill -> mutate field -> JSON.stringify -> UPDATE — established in Phase 04-03, consistently applied here"
  - "action_type IS NULL guard: all per-skill analytics queries must include this filter to exclude audit events co-located in request_log"

requirements-completed: [IDLE-01, IDLE-02, IDLE-04]

# Metrics
duration: 9min
completed: 2026-03-15
---

# Phase 06 Plan 01: Data Layer Helpers for Idle Rate Monitoring Summary

**Three SQLite helper functions for per-skill idle rate tracking: sliding-window request counter with audit exclusion, availability flag flipper, and _internal idle_rate persister — all TDD-tested with 15 new tests across 2 files**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-15T12:31:53Z
- **Completed:** 2026-03-15T12:41:48Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `getSkillRequestCount(db, skillId, windowMs)` — counts successful non-audit requests in a sliding window; SQL uses `AND action_type IS NULL` to prevent autonomy audit events from inflating counts
- `updateSkillAvailability(db, cardId, skillId, online)` — flips `skill.availability.online` for target skill only; sibling skills preserved; no-op on missing card/skill
- `updateSkillIdleRate(db, cardId, skillId, idleRate)` — merges `idle_rate` + `idle_rate_computed_at` into `skill._internal` preserving all existing keys; no-op on missing card/skill

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getSkillRequestCount() to request-log.ts with tests** - `53dacf0` (feat)
2. **Task 2: Add updateSkillAvailability() and updateSkillIdleRate() to store.ts with tests** - `67d6ddb` (feat)

_Note: TDD pattern — tests written first (RED), implementation added (GREEN), no refactor needed_

## Files Created/Modified
- `src/registry/request-log.ts` - Added `getSkillRequestCount()` export (sliding-window COUNT query)
- `src/registry/request-log.test.ts` - 6 new tests for getSkillRequestCount behavior
- `src/registry/store.ts` - Added `updateSkillAvailability()` and `updateSkillIdleRate()` exports
- `src/registry/store.test.ts` - 9 new tests for both store mutations

## Decisions Made
- `getSkillRequestCount` SQL includes `AND action_type IS NULL` — audit events (auto_share, auto_request) written by `insertAuditEvent()` share the same skill_id but must not count as real capability calls, otherwise idle rate would appear artificially low after the first auto_share event.
- Both store functions bypass `updateCard()` / Zod — use raw `SELECT data` → `JSON.parse` → mutate → `UPDATE` pattern, consistent with the Phase 04-03 decision for v2.0 card mutations.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- hub/ test suite had 43 pre-existing failures (React jsdom environment issues — `document is not defined`). Confirmed pre-existing via git stash verification before our changes. Out of scope per deviation rules.

## Next Phase Readiness
- All three data-layer functions are implemented and tested
- Plan 06-02 (IdleMonitor polling loop) can now directly import and use `getSkillRequestCount`, `updateSkillAvailability`, and `updateSkillIdleRate` without any additional data-layer work
- No blockers

---
*Phase: 06-idle-rate-monitoring-auto-share*
*Completed: 2026-03-15*
