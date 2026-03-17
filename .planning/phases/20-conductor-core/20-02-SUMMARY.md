---
phase: 20-conductor-core
plan: 02
subsystem: conductor
tags: [typescript, vitest, tdd, capability-matching, budget-control, peer-scoring]

# Dependency graph
requires:
  - phase: 20-conductor-core plan 01
    provides: SubTask, MatchResult, ExecutionBudget type contracts
provides:
  - matchSubTasks() function wrapping searchCards + scorePeers for sub-task agent matching
  - BudgetController class with calculateBudget(), canExecute(), and approveAndCheck()
  - ORCHESTRATION_FEE constant (5 credits)
affects: [20-conductor-core plans 03-04, orchestrator execution engine]

# Tech tracking
tech-stack:
  added: []
  patterns: [v1/v2 card candidate extraction pattern reused from AutoRequestor, BudgetManager composition for reserve enforcement]

key-files:
  created:
    - src/conductor/capability-matcher.ts
    - src/conductor/capability-matcher.test.ts
    - src/conductor/budget-controller.ts
    - src/conductor/budget-controller.test.ts
  modified: []

key-decisions:
  - "V2 cards inserted via direct SQL in tests (bypassing v1-only insertCard Zod validation) to match real FTS trigger behavior"
  - "matchSubTasks builds candidates from both v1.0 card-level and v2.0 skill-level pricing, same pattern as AutoRequestor"
  - "BudgetController composes BudgetManager rather than extending it — keeps reserve logic in one place"

patterns-established:
  - "Candidate extraction from mixed v1/v2 cards follows AutoRequestor lines 219-239 pattern"
  - "BudgetController.canExecute gates on both approval flag AND reserve floor"

requirements-completed: [COND-02, COND-03]

# Metrics
duration: 4min
completed: 2026-03-17
---

# Phase 20 Plan 02: CapabilityMatcher + BudgetController Summary

**CapabilityMatcher wrapping searchCards + scorePeers with self-exclusion and alternatives, plus BudgetController with 5cr orchestration fee and approval gating via BudgetManager reserve floor**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-17T10:17:11Z
- **Completed:** 2026-03-17T10:21:33Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- CapabilityMatcher finds best agent per sub-task using FTS search + peer scoring with self-exclusion
- Up to 2 alternatives populated per sub-task for failover routing
- BudgetController pre-calculates total cost (sub-task credits + 5cr orchestration fee)
- Approval gating when estimated total exceeds max budget, reserve floor via BudgetManager
- 13 tests (5 matcher + 8 budget) all passing via TDD

## Task Commits

Each task was committed atomically:

1. **Task 1: CapabilityMatcher — find best agent for each sub-task** - `c1c68ce` (feat)
2. **Task 2: BudgetController — pre-calculate cost and enforce spending limits** - `c239404` (feat)

_Both tasks followed TDD: RED (failing tests) then GREEN (implementation)._

## Files Created/Modified
- `src/conductor/capability-matcher.ts` - matchSubTasks() with searchCards + scorePeers, self-exclusion, alternatives
- `src/conductor/capability-matcher.test.ts` - 5 tests: matching, self-exclusion, alternatives, no-match, v2 cards
- `src/conductor/budget-controller.ts` - BudgetController class with calculateBudget(), canExecute(), approveAndCheck()
- `src/conductor/budget-controller.test.ts` - 8 tests: fee calculation, approval thresholds, reserve enforcement

## Decisions Made
- V2 cards inserted via direct SQL in tests to bypass v1-only insertCard() Zod validation while still triggering FTS triggers
- Reused AutoRequestor's candidate extraction pattern (lines 219-239) for consistent v1/v2 card handling
- BudgetController composes BudgetManager via constructor injection rather than extending it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed card IDs to use valid UUIDs in tests**
- **Found during:** Task 1 (CapabilityMatcher tests)
- **Issue:** Plan used string IDs like 'card-text' but insertCard validates UUID format via Zod
- **Fix:** Used randomUUID() for all card IDs in test helpers
- **Files modified:** src/conductor/capability-matcher.test.ts
- **Verification:** All tests pass with valid UUID card IDs
- **Committed in:** c1c68ce (Task 1 commit)

**2. [Rule 1 - Bug] Fixed v2 card insertion in test to use direct SQL**
- **Found during:** Task 1 (v2 card test)
- **Issue:** insertCard() validates only v1.0 CapabilityCardSchema, rejects v2.0 cards with skills array
- **Fix:** Insert v2 card data directly via SQL to trigger FTS indexing, matching real-world DB behavior
- **Files modified:** src/conductor/capability-matcher.test.ts
- **Verification:** v2 card test passes, FTS trigger indexes skill names/descriptions correctly
- **Committed in:** c1c68ce (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for test correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CapabilityMatcher ready for Orchestrator (plan 03) to import matchSubTasks
- BudgetController ready for Orchestrator to pre-check budgets before execution
- All exports match the plan's artifact specification

---
*Phase: 20-conductor-core*
*Completed: 2026-03-17*
