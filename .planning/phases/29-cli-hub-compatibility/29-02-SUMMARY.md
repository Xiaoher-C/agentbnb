---
phase: 29-cli-hub-compatibility
plan: 02
subsystem: credits
tags: [compatibility, tests, local-credit-ledger, cli, hub, sqlite]

# Dependency graph
requires:
  - phase: 29-cli-hub-compatibility
    plan: 01
    provides: CLI + Hub CreditLedger wiring (createLedger factory)
provides:
  - Compatibility tests confirming local-only agents use LocalCreditLedger
  - Full test suite verified green (865 tests)
  - COMPAT-01 through COMPAT-04 verified via automated tests
affects:
  - CI/CD — new test files in compat suite

# Tech tracking
tech-stack:
  added: []
  patterns:
    - vitest beforeEach/afterEach with tmpDir for isolated credit DBs per test
    - server.inject() pattern for Hub endpoint assertions (no live server needed)
    - LocalCreditLedger tested through CreditLedger interface (not direct DB calls)

key-files:
  created:
    - src/cli/cli-compat.test.ts
    - src/registry/server-compat.test.ts
  modified: []

key-decisions:
  - "cli-compat.test.ts uses require('better-sqlite3') for direct-comparison test — verifies LocalCreditLedger produces same DB state as direct ledger.ts calls"
  - "No source code changes needed — Plan 01 wiring was complete and correct; all 865 tests pass with zero modifications"
  - "COMPAT-03 verified by absence: no migration files, no ALTER TABLE in credit/ledger.ts schema"

patterns-established:
  - "Compat tests co-located with their primary module (cli/ and registry/)"
  - "Hub compat tests use server.inject() matching existing server.test.ts pattern"

requirements-completed: [COMPAT-01, COMPAT-02, COMPAT-03, COMPAT-04]

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 29 Plan 02: Backward Compatibility Verification Summary

**15 new compat tests verify local-only agents continue using LocalCreditLedger via createLedger factory, Hub /me and /me/transactions return identical shapes, and all 865 tests pass with zero regressions**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-19T13:20:00Z
- **Completed:** 2026-03-19T13:28:00Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Created `src/cli/cli-compat.test.ts` — 10 tests verifying:
  - `createLedger({ creditDbPath })` returns `LocalCreditLedger` instance (COMPAT-01)
  - `getBalance` returns 0 for unknown agent (unchanged behavior)
  - `grant + getBalance` round-trip is identical to direct `bootstrapAgent` calls
  - `grant` is idempotent — second call does not add credits
  - `hold + settle` escrow flow works end-to-end for local credits (COMPAT-01)
  - `hold + release` refund flow works correctly (COMPAT-02)
  - `getHistory` returns transaction list with correct shape (COMPAT-03)
  - `LocalCreditLedger` produces identical DB state to direct `ledger.ts` calls
  - Publish price validation: `credits_per_call >= 1` (CLI-04 compat)

- Created `src/registry/server-compat.test.ts` — 5 tests verifying:
  - GET `/me` with `creditDb` returns `{ owner, balance }` via `CreditLedger` direct DB mode (HUB-01 compat)
  - GET `/me/transactions` with `creditDb` returns `{ items, limit }` with full `CreditTransaction` shape (HUB-02 compat)
  - GET `/me` without `creditDb` returns `balance=0` — unchanged fallback (HUB-03 compat)
  - GET `/me/transactions` without `creditDb` returns `{ items: [], limit: 20 }` — unchanged fallback (HUB-04 compat)
  - GET `/me/transactions?limit=5` respects limit param — same shape as before

- Ran full test suite: **865 tests pass** (no regressions from Plan 01 changes)
- Verified COMPAT-03 (no destructive migration): no migration files, no `ALTER TABLE` in credit schema

## Task Commits

1. **Task 1: Add backward compatibility tests for CLI and Hub** - `490e4fe` (test)
2. **Task 2: Run full test suite and verify no regressions** - No source changes (all 865 tests passed on first run)

## Files Created/Modified

- `src/cli/cli-compat.test.ts` — 10 tests for createLedger + LocalCreditLedger in local-only mode
- `src/registry/server-compat.test.ts` — 5 tests for Hub /me and /me/transactions via CreditLedger

## Decisions Made

- No source code changes needed — Plan 01 wiring was complete and correct; all 865 tests pass without modification.
- `cli-compat.test.ts` includes a direct-comparison test that calls both `ledger.ts` functions directly and via `LocalCreditLedger` interface, confirming they produce identical DB state.
- COMPAT-03 verified by absence: no migration files exist, and `credit/ledger.ts` only has `CREATE TABLE IF NOT EXISTS` (never `ALTER TABLE`).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. All 865 tests pass on first run.

## User Setup Required

None — no external service configuration required.

## Milestone Completion

**v3.2 Registry Credit Ledger milestone is complete.**

All 5 phases (25-29) and 11 plans are done:
- Phase 25: Relay Timeout (C+B Hybrid — 30s→300s + relay_progress)
- Phase 26: CreditLedger Abstraction (LocalCreditLedger + RegistryCreditLedger)
- Phase 27: Registry Credit Endpoints (HTTP credit API + identity auth)
- Phase 28: Relay Credit Integration (server-side hold/settle/release + Conductor fee)
- Phase 29: CLI + Hub Compatibility (CreditLedger wiring + compat verification)

The system is ready for public launch with full Registry Credit Ledger support.

---
*Phase: 29-cli-hub-compatibility*
*Completed: 2026-03-19*

## Self-Check: PASSED

- [x] `src/cli/cli-compat.test.ts` — EXISTS (10 tests, all pass)
- [x] `src/registry/server-compat.test.ts` — EXISTS (5 tests, all pass)
- [x] Commit `490e4fe` — EXISTS (test(29-02): add backward compatibility tests)
- [x] Full suite: 865 tests pass
- [x] No migration files added
- [x] No ALTER TABLE in credit schema
