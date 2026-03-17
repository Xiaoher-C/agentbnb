---
phase: 20-conductor-core
plan: 01
subsystem: conductor
tags: [typescript, vitest, tdd, task-decomposition, capability-card]

# Dependency graph
requires: []
provides:
  - SubTask, MatchResult, ExecutionBudget, OrchestrationResult type contracts
  - TaskDecomposer with 3 hardcoded templates (video-production, deep-analysis, content-generation)
  - Conductor CapabilityCardV2 builder and SQLite registration
affects: [20-conductor-core plans 02-04, orchestrator, skill-matcher]

# Tech tracking
tech-stack:
  added: []
  patterns: [template-based decomposition with keyword matching, deterministic UUID for singleton card]

key-files:
  created:
    - src/conductor/types.ts
    - src/conductor/task-decomposer.ts
    - src/conductor/task-decomposer.test.ts
    - src/conductor/card.ts
    - src/conductor/card.test.ts
  modified: []

key-decisions:
  - "Deterministic UUID for Conductor card (singleton agent, fixed ID 00000000-0000-4000-8000-000000000001)"
  - "Template steps use depends_on_indices resolved to UUIDs at decomposition time for DAG correctness"
  - "INSERT OR REPLACE pattern for idempotent card registration (check-then-insert/update)"

patterns-established:
  - "Conductor types in src/conductor/types.ts shared across all conductor modules"
  - "Template-based decomposition: keyword array + step array with index-based dependency references"

requirements-completed: [COND-01, COND-04]

# Metrics
duration: 3min
completed: 2026-03-17
---

# Phase 20 Plan 01: Conductor Types + TaskDecomposer + Card Summary

**TaskDecomposer with 3 keyword-matched DAG templates (video/analysis/content) and Conductor CapabilityCardV2 with orchestrate + plan skills registered in SQLite**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-17T10:09:49Z
- **Completed:** 2026-03-17T10:13:13Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Shared type contracts (SubTask, MatchResult, ExecutionBudget, OrchestrationResult) for all Conductor modules
- TaskDecomposer decomposes natural language tasks into dependency DAGs via 3 hardcoded templates
- Conductor card with orchestrate (5cr) and plan (1cr) skills validates against CapabilityCardV2Schema and registers idempotently
- 28 tests (16 decomposer + 12 card) all passing via TDD

## Task Commits

Each task was committed atomically:

1. **Task 1: Conductor types + TaskDecomposer with 3 hardcoded templates** - `9a3cb9d` (feat)
2. **Task 2: Conductor Card builder and registration** - `ab03a05` (feat)

_Both tasks followed TDD: RED (failing tests) then GREEN (implementation)._

## Files Created/Modified
- `src/conductor/types.ts` - SubTask, MatchResult, ExecutionBudget, OrchestrationResult interfaces
- `src/conductor/task-decomposer.ts` - decompose() with 3 keyword-matched templates (video-production, deep-analysis, content-generation)
- `src/conductor/task-decomposer.test.ts` - 16 tests covering all templates, DAG dependencies, edge cases, uniqueness
- `src/conductor/card.ts` - buildConductorCard() and registerConductorCard() for Conductor's CapabilityCardV2
- `src/conductor/card.test.ts` - 12 tests covering schema validation, registration, idempotency

## Decisions Made
- Used deterministic UUID (`00000000-0000-4000-8000-000000000001`) for Conductor card since it is a singleton agent
- Template steps store dependency indices (not UUIDs) — resolved to fresh UUIDs at decomposition time
- Card registration uses check-then-insert/update pattern instead of raw INSERT OR REPLACE to work correctly with FTS triggers

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Types and TaskDecomposer ready for SkillMatcher (plan 02) to import SubTask
- Conductor card ready for runtime integration (plan 04)
- All exports match the plan's artifact specification

---
*Phase: 20-conductor-core*
*Completed: 2026-03-17*
