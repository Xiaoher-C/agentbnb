---
phase: 03-ux-layer
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, crypto, api-key, request-log, gateway]

# Dependency graph
requires:
  - phase: 00-dogfood-03
    provides: Gateway server with settle/release escrow points
  - phase: 00-dogfood-00
    provides: SQLite openDatabase() migration block
provides:
  - api_key field in AgentBnBConfig (64-char hex, preserved on re-init)
  - request_log SQLite table (id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at)
  - createRequestLogTable(), insertRequestLog(), getRequestLog() functions
  - getRequestLog() with since parameter for 24h/7d/30d period filtering
  - Gateway writes request_log entry after every settle (success) and release (failure/timeout)
affects: [03-02-auth-api, 03-03-hub-frontend, 03-03b-hub-data]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - api_key generated with randomBytes(32).toString('hex') — 64-char hex, same pattern as token
    - Silent no-op logging: insertRequestLog wrapped in try/catch so logging failures never break request flow
    - Period filtering via ISO timestamp cutoff: cutoff = new Date(Date.now() - SINCE_MS[since]).toISOString()

key-files:
  created:
    - src/registry/request-log.ts
    - src/registry/request-log.test.ts
  modified:
    - src/cli/config.ts
    - src/cli/index.ts
    - src/cli/index.test.ts
    - src/registry/store.ts
    - src/gateway/server.ts
    - src/gateway/server.test.ts

key-decisions:
  - "api_key is optional in AgentBnBConfig — backward compatible with existing configs that lack the field"
  - "api_key is preserved on re-init: load existing config first, only generate if not already present"
  - "insertRequestLog wrapped in try/catch at all 3 gateway settlement points — logging failures are silent no-ops"
  - "SincePeriod cutoff computed as ISO string via new Date(Date.now() - SINCE_MS[since]).toISOString() — enables SQLite string comparison"
  - "request_log created by createRequestLogTable() called inside openDatabase() — ensures table exists whenever registry DB is opened"

patterns-established:
  - "Pattern: Silent logging no-op — wrap side-effect logging calls in try/catch so they never affect core request flow"
  - "Pattern: ISO timestamp period filtering — use string comparison on created_at ISO column for 24h/7d/30d window queries"

requirements-completed: [UX-01, UX-02, UX-03]

# Metrics
duration: 6min
completed: 2026-03-15
---

# Phase 3 Plan 01: UX Layer Data Foundation Summary

**SQLite request_log table with period filtering, 64-char api_key in AgentBnBConfig, and gateway writing log entries after every settle and release**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-15T06:26:44Z
- **Completed:** 2026-03-15T06:32:52Z
- **Tasks:** 2
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments
- Created `src/registry/request-log.ts` with `RequestLogEntry` interface, `SincePeriod` type, and three functions: `createRequestLogTable`, `insertRequestLog`, `getRequestLog` (with optional period filtering for 24h/7d/30d windows)
- Added `api_key?: string` to `AgentBnBConfig` and wired `init` command to generate a 64-char hex key on first run, preserving it on re-init
- Wired `insertRequestLog` at all 3 settlement points in gateway (`server.ts`): success after `settleEscrow`, failure after `releaseEscrow` on handler error, timeout after `releaseEscrow` on abort — all wrapped in silent try/catch
- `openDatabase()` now calls `createRequestLogTable()` so the table is always created alongside capability_cards

## Task Commits

Each task was committed atomically:

1. **Task 1: API key in config + request_log module with period filtering** - `9d790d0` (feat)
2. **Task 2: Gateway writes request_log after settle/release** - `a841b9f` (feat)

## Files Created/Modified
- `src/registry/request-log.ts` — RequestLogEntry interface, SincePeriod type, createRequestLogTable/insertRequestLog/getRequestLog functions
- `src/registry/request-log.test.ts` — 11 tests: table creation, insert with all status values, limit + newest-first ordering, empty table, period filtering (24h/7d/30d)
- `src/cli/config.ts` — Added `api_key?: string` field to AgentBnBConfig interface
- `src/cli/index.ts` — Updated init command to load existing config and preserve api_key on re-init
- `src/cli/index.test.ts` — Added 3 new api_key tests: 64-char hex check, re-init preservation, backward compat
- `src/registry/store.ts` — Import createRequestLogTable, call it inside openDatabase() after existing table migrations
- `src/gateway/server.ts` — Import insertRequestLog + randomUUID, add logging at all 3 settlement points with try/catch
- `src/gateway/server.test.ts` — Added 3 request_log tracking tests: success, failure, timeout

## Decisions Made
- `api_key` is optional in `AgentBnBConfig` — backward compatible with existing configs that predate this field
- `api_key` is preserved on re-init by loading existing config first, generating only when absent
- All `insertRequestLog` calls wrapped in `try/catch` (silent no-op) — same pattern as `updateReputation`, logging must not break request flow
- Period filtering cutoff uses `new Date(Date.now() - SINCE_MS[since]).toISOString()` — SQLite ISO string comparison handles time windows without epoch conversion
- `createRequestLogTable` called inside `openDatabase()` — ensures request_log exists whenever registry DB is opened, no separate migration step needed

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Pre-existing test failures in `hub/src/components/CapabilityCard.test.tsx` (6 tests failing with `document is not defined` — jsdom environment issue) are out of scope for this plan and were not introduced by these changes.

## Next Phase Readiness
- `api_key` in config is ready for Phase 3 Plan 02 (API auth-protected endpoints)
- `request_log` table and query functions are ready for Phase 3 Plan 03 (Hub dashboard data)
- `getRequestLog()` with period filtering is ready for the Hub stats API

---
*Phase: 03-ux-layer*
*Completed: 2026-03-15*
