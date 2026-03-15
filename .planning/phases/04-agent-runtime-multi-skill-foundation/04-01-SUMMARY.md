---
phase: 04-agent-runtime-multi-skill-foundation
plan: 01
subsystem: infra
tags: [sqlite, croner, lifecycle, agentruntime, typed-emitter]

requires:
  - phase: 03-ux-layer
    provides: CLI index.ts serve command structure with openDatabase/openCreditDb

provides:
  - AgentRuntime class with start()/shutdown()/registerJob()/isDraining lifecycle management
  - Centralized SQLite DB handle ownership for registryDb and creditDb
  - Orphaned escrow recovery on process startup
  - SIGTERM/SIGINT wired to runtime.shutdown() in CLI serve command

affects:
  - 04-02 (CapabilityCard v2 schema — needs runtime for integration)
  - 05-auto-request (BudgetManager wraps escrow holds via runtime.creditDb)
  - 06-peer-discovery (background jobs registered via runtime.registerJob())
  - All subsequent phases using DB handles

tech-stack:
  added:
    - croner 10.0.1 (cron-based background job scheduling)
    - typed-emitter 2.1.0 (typed event emitter support)
  patterns:
    - AgentRuntime as single owner of DB handles — all downstream modules receive runtime.registryDb / runtime.creditDb
    - Background jobs registered via runtime.registerJob(job) — stopped automatically on shutdown
    - isDraining guard pattern — check before processing in-flight requests
    - start() for startup recovery, shutdown() for graceful teardown

key-files:
  created:
    - src/runtime/agent-runtime.ts
    - src/runtime/agent-runtime.test.ts
  modified:
    - src/cli/index.ts

key-decisions:
  - "AgentRuntime uses openDatabase()/openCreditDb() internally so schema migrations always run on open"
  - "busy_timeout=5000 added after openDatabase/openCreditDb (those functions don't set it)"
  - "WAL mode not applicable to :memory: SQLite DBs — test verifies schema tables instead of mode"
  - "shutdown() is idempotent via draining guard to handle double-SIGINT scenarios"

patterns-established:
  - "Rule 3 (Blocking): croner and typed-emitter installed as new production dependencies"

requirements-completed:
  - RUN-01

duration: 4min
completed: 2026-03-15
---

# Phase 4 Plan 01: AgentRuntime Lifecycle Management Summary

**AgentRuntime class centralizing SQLite DB ownership, orphaned escrow recovery on startup, and graceful shutdown with Cron job cleanup — wired into CLI serve command**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-15T10:31:10Z
- **Completed:** 2026-03-15T10:35:45Z
- **Tasks:** 2 (TDD + CLI wiring)
- **Files modified:** 4

## Accomplishments

- AgentRuntime class with full lifecycle: constructor opens both DBs with schema migrations + busy_timeout=5000, start() recovers orphaned escrows, shutdown() stops all Cron jobs and closes DBs
- 8 unit tests covering constructor, orphaned escrow recovery (older/newer than threshold), registerJob, shutdown job-stop, DB-close-after-shutdown, isDraining getter, and idempotency
- CLI serve command refactored to use AgentRuntime — SIGTERM/SIGINT now route through runtime.shutdown() instead of manual DB closes

## Task Commits

Each task was committed atomically:

1. **TDD RED — Failing tests** - `0cc639d` (test)
2. **TDD GREEN — AgentRuntime implementation** - `1d072bc` (feat)
3. **Task 2: Wire AgentRuntime into CLI serve** - `9ea4514` (feat)

Also included: `0cc639d` — install croner 10.0.1 + typed-emitter 2.1.0 (bundled with test commit)

## Files Created/Modified

- `src/runtime/agent-runtime.ts` — AgentRuntime class with RuntimeOptions interface, 120 lines
- `src/runtime/agent-runtime.test.ts` — 8 unit tests for lifecycle management
- `src/cli/index.ts` — serve command refactored to use AgentRuntime constructor/start/shutdown
- `package.json` + `pnpm-lock.yaml` — added croner and typed-emitter dependencies

## Decisions Made

- Used `openDatabase()` and `openCreditDb()` internally in AgentRuntime constructor (Option A from plan) so schema migrations always run when the runtime opens databases.
- Added `busy_timeout = 5000` pragma after `openDatabase()`/`openCreditDb()` calls since those functions don't set it.
- Test 1 adjusted to verify schema tables exist rather than WAL mode — SQLite silently keeps `memory` journal mode for `:memory:` DBs even when WAL is requested; the pragma still runs on file-backed DBs.
- shutdown() uses a `draining` guard (early return if already true) to make it idempotent — safe for double-SIGINT scenarios.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test 1 WAL mode assertion incorrect for :memory: databases**
- **Found during:** Task 1 GREEN phase (running tests after implementation)
- **Issue:** Test asserted `journal_mode = 'wal'` on `:memory:` DB — SQLite ignores WAL pragma for in-memory databases (returns 'memory')
- **Fix:** Changed assertion to verify schema tables (`capability_cards`, `credit_escrow`) were created, plus verify `busy_timeout=5000` which works in-memory
- **Files modified:** `src/runtime/agent-runtime.test.ts`
- **Verification:** All 8 tests pass after fix
- **Committed in:** `1d072bc` (Task 1 feat commit, updated test alongside implementation)

---

**Total deviations:** 1 auto-fixed (1 blocking/test-correctness)
**Impact on plan:** Necessary fix for test correctness — WAL mode behavior is SQLite-fundamental. The implementation is correct (WAL pragma runs on file-backed DBs); only the test expectation needed adjustment.

## Issues Encountered

- Pre-existing failures in `src/registry/store.test.ts` (v1-to-v2 migration tests, `runMigrations is not a function`) and `hub/src/` React component tests — these are unrelated to plan 04-01. Confirmed pre-existing by checking git stash state before my changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AgentRuntime is fully functional and tested — all subsequent phases can import and use it
- DB handle ownership is centralized — no more SQLITE_BUSY conflicts from parallel DB opens in the serve command
- Background job registration pattern established via `runtime.registerJob()` — ready for Phases 5-6 periodic loops
- Pre-existing `src/registry/store.test.ts` migration failures should be investigated before Phase 4 Plan 03 (registry migration work)

## Self-Check: PASSED

- src/runtime/agent-runtime.ts: FOUND
- src/runtime/agent-runtime.test.ts: FOUND
- .planning/phases/04-agent-runtime-multi-skill-foundation/04-01-SUMMARY.md: FOUND
- Commit 0cc639d: FOUND
- Commit 1d072bc: FOUND
- Commit 9ea4514: FOUND

---
*Phase: 04-agent-runtime-multi-skill-foundation*
*Completed: 2026-03-15*
