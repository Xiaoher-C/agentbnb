---
phase: 00-dogfood
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, credit, escrow, ledger, tdd, vitest]

# Dependency graph
requires:
  - phase: 00-dogfood/00-01
    provides: SQLite database initialization pattern and AgentBnBError from types/index.ts

provides:
  - Credit balance management with idempotent bootstrap grants
  - Atomic escrow hold/settle/release using db.transaction()
  - Immutable transaction log for auditing credit flows
  - Double-spend prevention via balance check inside transaction

affects:
  - 00-dogfood/gateway (credit deduction during capability requests)
  - 00-dogfood/cli (credit status display, balance queries)
  - 00-dogfood/integration (end-to-end credit flow testing)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-table ledger: credit_balances (current state) + credit_transactions (immutable audit log)"
    - "Escrow table with status FSM: held -> settled | released"
    - "INSERT OR IGNORE for idempotent bootstrap grants"
    - "db.transaction() wrapper pattern for atomic multi-step credit operations"
    - "Balance check inside transaction to prevent TOCTOU race conditions"

key-files:
  created:
    - src/credit/ledger.ts
    - src/credit/escrow.ts
    - src/credit/ledger.test.ts
  modified:
    - src/types/index.ts (fixed z.number().nonneg() -> nonnegative())
    - package.json (added pnpm.onlyBuiltDependencies for better-sqlite3 native build)
    - pnpm-lock.yaml (updated lockfile)
    - .npmrc (added node-linker=node-modules)

key-decisions:
  - "Idempotent bootstrap: INSERT OR IGNORE creates balance row once; transaction only logged on first insert (result.changes > 0 check)"
  - "Fixed z.number().nonneg() to z.number().nonnegative() in types/index.ts — nonneg() is not a valid Zod method"
  - "Added pnpm.onlyBuiltDependencies config to allow better-sqlite3 native binding compilation (pnpm 10 disables build scripts by default)"
  - "Escrow settle/release both throw ESCROW_ALREADY_SETTLED error code for simplicity (covers both states since neither can be re-processed)"

patterns-established:
  - "Pattern: Credit operations always wrapped in db.transaction() for atomicity"
  - "Pattern: AgentBnBError with typed error codes (INSUFFICIENT_CREDITS, ESCROW_ALREADY_SETTLED) for programmatic error handling"
  - "Pattern: INSERT OR IGNORE + result.changes check for idempotent record creation"

requirements-completed: [R-005]

# Metrics
duration: 4min
completed: 2026-03-13
---

# Phase 0 Plan 02: Credit Ledger and Escrow Summary

**SQLite-backed credit ledger with atomic escrow hold/settle/release using better-sqlite3 db.transaction(), protecting against double-spend and ensuring immutable transaction audit trail**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T21:45:07Z
- **Completed:** 2026-03-13T21:49:07Z
- **Tasks:** 2 of 2
- **Files modified:** 7

## Accomplishments

- Credit ledger with idempotent bootstrap grants (INSERT OR IGNORE) and balance queries
- Atomic escrow: holdEscrow() deducts balance and creates escrow record in a single db.transaction()
- Full escrow lifecycle: settle transfers to capability owner, release refunds to requester
- Immutable transaction log with double-entry bookkeeping (every debit has a corresponding credit entry)
- 18 tests covering all happy paths, error cases, and double-spend prevention

## Task Commits

Each task was committed atomically:

1. **Task 1: Build credit ledger with balance management** - `741813e` (feat)
2. **Task 2: Build escrow hold, settle, and release operations** - `181f374` (feat)

_Note: TDD tasks — tests written first (RED), then implementation (GREEN)_

## Files Created/Modified

- `src/credit/ledger.ts` - openCreditDb(), bootstrapAgent(), getBalance(), getTransactions()
- `src/credit/escrow.ts` - holdEscrow(), settleEscrow(), releaseEscrow(), getEscrowStatus()
- `src/credit/ledger.test.ts` - 18 tests covering ledger + escrow
- `src/types/index.ts` - Fixed z.number().nonneg() bug (Rule 1 auto-fix)
- `package.json` - Added pnpm.onlyBuiltDependencies for better-sqlite3 (Rule 3 auto-fix)
- `pnpm-lock.yaml` - Updated after better-sqlite3 native build
- `.npmrc` - node-linker=node-modules

## Decisions Made

- **Idempotent bootstrap via INSERT OR IGNORE + changes check**: The transaction record is only inserted when the balance row is newly created, preventing duplicate transaction log entries on repeated bootstrap calls.
- **ESCROW_ALREADY_SETTLED for both settle and release on non-held escrow**: Covers the case where an escrow is already settled OR already released — both states are terminal and the same error code makes sense.
- **INSERT OR IGNORE for recipient in settleEscrow()**: A capability owner receiving credits for the first time may not have a balance row. Auto-creates the row with 0 balance before crediting.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed z.number().nonneg() invalid Zod method**
- **Found during:** Task 1 (tests failed on module load)
- **Issue:** `z.number().nonneg()` does not exist in Zod 3.24 — should be `z.number().nonnegative()`
- **Fix:** Replaced all 3 occurrences in `src/types/index.ts` (credits_per_call, credits_per_minute, avg_latency_ms)
- **Files modified:** src/types/index.ts
- **Verification:** Module loads without error; all 18 tests pass; typecheck clean
- **Committed in:** `741813e` (Task 1 commit)

**2. [Rule 3 - Blocking] Enabled better-sqlite3 native binary compilation**
- **Found during:** Task 1 (tests failed with "Could not locate the bindings file")
- **Issue:** pnpm 10 disables build scripts by default; better-sqlite3 native `.node` binding was never compiled
- **Fix:** Added `"pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }` to package.json, then ran `pnpm install`
- **Files modified:** package.json, pnpm-lock.yaml
- **Verification:** better-sqlite3 compiled successfully; all 18 tests pass
- **Committed in:** `741813e` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking)
**Impact on plan:** Both fixes essential for the module to function. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required. All SQLite, all local.

## Next Phase Readiness

- Credit system is ready for wiring into the gateway (capability request flow)
- `holdEscrow()` + `settleEscrow()` / `releaseEscrow()` are the integration points for gateway
- No blockers for gateway or CLI implementation

---
*Phase: 00-dogfood*
*Completed: 2026-03-13*
