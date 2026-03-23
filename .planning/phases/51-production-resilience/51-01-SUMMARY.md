---
phase: 51-production-resilience
plan: 01
subsystem: database, gateway, api
tags: [sqlite, request-log, failure-reason, reputation, typescript]

# Dependency graph
requires:
  - phase: any prior phase with request_log
    provides: request_log table + insertRequestLog + getRequestLog
provides:
  - FailureReason string union type in src/types/index.ts
  - failure_reason TEXT column in request_log (idempotent migration)
  - insertRequestLog accepts and stores failure_reason
  - getRequestLog returns failure_reason in result rows
  - handleFailure in execute.ts wired with semantically correct FailureReason per call site
affects: [51-02, gateway, reputation, trust-metrics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FailureReason string union (not enum) for zero-cost type safety"
    - "Idempotent ALTER TABLE via try/catch — same pattern as skill_id, action_type, tier_invoked columns"
    - "handleFailure default parameter 'bad_execution' for backward compatibility"

key-files:
  created: []
  modified:
    - src/types/index.ts
    - src/registry/request-log.ts
    - src/registry/request-log.test.ts
    - src/gateway/execute.ts
    - src/gateway/execute.test.ts

key-decisions:
  - "updateReputation uses stored EWA counter on capability_cards, NOT a live request_log query — overload path (51-02) must simply not call updateReputation to prevent reputation damage"
  - "FailureReason as string union (not enum) keeps TypeScript ergonomics clean without runtime overhead"
  - "failure_reason defaults to 'bad_execution' in handleFailure signature to preserve backward compatibility"
  - "Self-request guard path tagged as 'auth_error' since it is fundamentally an identity confusion / authorization failure"

patterns-established:
  - "All terminal failures in execute.ts pass semantically correct FailureReason through handleFailure"
  - "Overload events bypassed updateReputation entirely in 51-02 — foundation established here"

requirements-completed: [RESIL-01, RESIL-02]

# Metrics
duration: 25min
completed: 2026-03-24
---

# Phase 51 Plan 01: FailureReason enum + request_log migration + execute.ts wiring Summary

**FailureReason string union type threaded through request_log SQLite schema and all execute.ts failure paths, enabling overload events to be excluded from provider reputation calculations**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-24T02:38:00Z
- **Completed:** 2026-03-24T02:44:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `FailureReason` type (`bad_execution | overload | timeout | auth_error | not_found`) to `src/types/index.ts`
- Added `failure_reason TEXT` column to `request_log` via idempotent `ALTER TABLE` (same pattern as `skill_id`, `action_type`, `tier_invoked`)
- Updated `insertRequestLog` and `getRequestLog` (both SELECT branches) to include `failure_reason`
- Updated `handleFailure` in `execute.ts` to accept `FailureReason` parameter (default `'bad_execution'`) and forward to log entry
- Wired semantically correct `FailureReason` to every `handleFailure` call site and self-request guard path
- Added 8 new tests for failure_reason storage, migration idempotency, getRequestLog field inclusion
- Added 4 new execute.test.ts tests for bad_execution, timeout, not_found, bad_execution wiring

## Task Commits

1. **Task 1: FailureReason type + RequestLogEntry field + migration** - `3ceab60` (feat)
2. **Task 2: Wire failure_reason through execute.ts** - `3ceab60` (combined in same commit)

## Files Created/Modified
- `/Users/leyufounder/Github/agentbnb/src/types/index.ts` - Added FailureReason union type export
- `/Users/leyufounder/Github/agentbnb/src/registry/request-log.ts` - Added failure_reason column, migration, INSERT/SELECT updates
- `/Users/leyufounder/Github/agentbnb/src/registry/request-log.test.ts` - Added failure_reason tests
- `/Users/leyufounder/Github/agentbnb/src/gateway/execute.ts` - handleFailure with FailureReason, all call sites wired
- `/Users/leyufounder/Github/agentbnb/src/gateway/execute.test.ts` - Added failure_reason wiring tests

## Decisions Made
- updateReputation uses a stored EWA counter (not a live query over request_log), so the overload path in 51-02 simply skips calling it entirely — no SQL filter needed
- FailureReason as string union (not enum) preserves TypeScript tree-shaking and avoids runtime overhead
- failure_reason defaults to 'bad_execution' in handleFailure parameter to maintain backward compatibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] getRequestLog second SELECT branch missing failure_reason column**
- **Found during:** Task 1 (test run)
- **Issue:** The `replace_all` edit only updated the `since`-branch SELECT. The unconditional SELECT had identical text before the edit but was different after — leaving it without `failure_reason`
- **Fix:** Added `failure_reason` to the second SELECT branch explicitly
- **Files modified:** src/registry/request-log.ts
- **Verification:** All request-log tests pass including getRequestLog returning failure_reason
- **Committed in:** 3ceab60 (task commit)

**2. [Rule 1 - Bug] execute.test.ts not_found test triggered wrong code path**
- **Found during:** Task 2 (test run)
- **Issue:** Test used a v2 card with skills[] so resolvedSkillId was set before listSkills() check, causing 'bad_execution' instead of 'not_found'
- **Fix:** Test updated to use a v1 card (no skills[] array) to trigger listSkills() empty path correctly
- **Files modified:** src/gateway/execute.test.ts
- **Verification:** Test passes with correct 'not_found' failure_reason
- **Committed in:** 3ceab60 (task commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the two auto-fixed bugs above.

## Next Phase Readiness
- FailureReason type and request_log column ready for 51-02 overload path
- execute.ts wiring complete — 51-02 only needs to add the gateway-level check and skip updateReputation

---
*Phase: 51-production-resilience*
*Completed: 2026-03-24*
