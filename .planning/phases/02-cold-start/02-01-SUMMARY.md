---
phase: 02-cold-start
plan: 01
subsystem: registry
tags: [reputation, ewa, sqlite, gateway, fastify, vitest]

# Dependency graph
requires:
  - phase: 00-dogfood
    provides: registry store with insertCard/getCard/updateCard, gateway server with escrow flow
  - phase: 00-dogfood
    provides: CapabilityCard schema with metadata.success_rate and metadata.avg_latency_ms fields
provides:
  - updateReputation() function in store.ts using EWA with alpha=0.1
  - Gateway instrumentation calling updateReputation() after every capability.execute
  - Reputation data persisted in SQLite across restarts
affects: [02-02, 02-03, reputation-based-discovery, capability-matching]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - EWA (Exponentially Weighted Average) with alpha=0.1 for reputation metrics
    - Bootstrap strategy: use observed value as prior when no history exists
    - Silent no-op pattern for missing entities in store mutation functions

key-files:
  created: []
  modified:
    - src/registry/store.ts
    - src/registry/store.test.ts
    - src/gateway/server.ts
    - src/gateway/server.test.ts

key-decisions:
  - "EWA alpha=0.1 gives 90% weight to history, smoothing out single outlier results"
  - "Bootstrap uses observed value as prior — first execution sets concrete reputation rather than guessing"
  - "updateReputation() rounds success_rate to 3 decimal places, avg_latency_ms to nearest integer — precision appropriate for reputation display"
  - "Silent no-op for non-existent cardId in updateReputation() — gateway should not crash if card was deleted mid-execution"
  - "startMs timer placed before fetch() call to include full round-trip latency in avg_latency_ms"

patterns-established:
  - "EWA mutation pattern: read existing value, compute new = alpha*observed + (1-alpha)*prior, write back"
  - "Reputation update order: escrow settle/release first, then updateReputation() — credits take priority over stats"

requirements-completed: [R-014]

# Metrics
duration: 8min
completed: 2026-03-14
---

# Phase 02 Plan 01: Reputation System Summary

**EWA-based reputation tracking (success_rate + avg_latency_ms) in SQLite registry, written automatically by gateway after every capability execution**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-14T00:49:00Z
- **Completed:** 2026-03-14T00:57:00Z
- **Tasks:** 2 (each with TDD RED+GREEN commits)
- **Files modified:** 4

## Accomplishments

- Added `updateReputation()` to registry store with EWA algorithm (alpha=0.1), bootstrapping from undefined, preserving existing metadata fields
- Instrumented gateway's `capability.execute` success/failure/timeout paths to call `updateReputation()` automatically after each execution
- 10 new tests (6 for store, 4 for gateway); all 133 tests pass with zero regressions

## Task Commits

Each task was committed atomically (TDD: test commit + feat commit):

1. **Task 1 RED: updateReputation() failing tests** - `90c7fae` (test)
2. **Task 1 GREEN: updateReputation() implementation** - `2bd2e4e` (feat)
3. **Task 2 RED: gateway reputation failing tests** - `b15f18d` (test)
4. **Task 2 GREEN: gateway reputation instrumentation** - `3649bc6` (feat)

**Plan metadata:** (docs commit — see below)

_Note: TDD tasks have two commits each (test → feat)_

## Files Created/Modified

- `src/registry/store.ts` — Added `updateReputation()` export with EWA algorithm
- `src/registry/store.test.ts` — Added 6 tests for updateReputation() (bootstrap, EWA math, no-op, persistence, field preservation)
- `src/gateway/server.ts` — Added startMs timer, import updateReputation, called on success/failure/catch paths
- `src/gateway/server.test.ts` — Added 4 tests for gateway reputation tracking (success, failure, latency, timeout)

## Decisions Made

- EWA alpha=0.1 gives 90% weight to history, smoothing single outlier results — per RESEARCH.md Pattern 2
- Bootstrap uses observed value as prior: first success sets rate=1.0, first failure sets rate=0.0
- success_rate rounded to 3 decimal places; avg_latency_ms rounded to nearest integer
- Silent no-op for non-existent cardId — gateway must not crash if card deleted mid-execution
- startMs timer placed before fetch() to capture full round-trip latency

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Reputation write path is complete; Plan 02-02 can build reputation-based discovery/sorting on top of success_rate and avg_latency_ms
- All existing 133 tests continue to pass — no regressions introduced

## Self-Check: PASSED

All files verified: store.ts, server.ts, SUMMARY.md
All commits verified: 90c7fae, 2bd2e4e, b15f18d, 3649bc6

---
*Phase: 02-cold-start*
*Completed: 2026-03-14*
