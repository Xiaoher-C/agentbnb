---
phase: 02-cold-start
plan: 02
subsystem: api
tags: [fastify, cors, http, registry, search, pagination, filtering]

# Dependency graph
requires:
  - phase: 02-cold-start
    provides: updateReputation() EWA algorithm in registry store (02-01)
  - phase: 00-dogfood
    provides: SQLite registry with FTS5 search (store.ts, matcher.ts)
provides:
  - Public read-only HTTP registry server (createRegistryServer)
  - GET /health liveness endpoint
  - GET /cards with FTS5 search, level/online/tag/success_rate/latency filters
  - GET /cards sorting by success_rate (desc) and latency (asc)
  - GET /cards pagination with limit (max 100) and offset
  - GET /cards/:id single card lookup with 404
  - CORS enabled for all origins (browser-accessible marketplace)
affects: [02-cold-start, cli-marketplace, web-frontend]

# Tech tracking
tech-stack:
  added: ["@fastify/cors ^11.2.0"]
  patterns:
    - "createRegistryServer() factory pattern (same as createGatewayServer)"
    - "server.inject() for HTTP tests without actual listen"
    - "Post-filter chaining: FTS5/filterCards → tag → min_success_rate → max_latency_ms → sort → slice"

key-files:
  created:
    - src/registry/server.ts
    - src/registry/server.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - src/gateway/server.ts

key-decisions:
  - "origin: true in @fastify/cors allows all origins — public marketplace registry needs no restrictions"
  - "Limit capped at 100 server-side to prevent large payload abuse"
  - "Post-filter approach for tag/success_rate/latency keeps SQL simple and lets FTS5 rank first"
  - "Sort undefined values last (success_rate: -1, latency: Infinity) to put unrated/unlatency-measured cards at end"

patterns-established:
  - "Registry server is strictly read-only — no POST/PUT/DELETE routes registered"
  - "createRegistryServer({ registryDb, silent }) factory pattern mirrors createGatewayServer"

requirements-completed: [R-013, R-015]

# Metrics
duration: 15min
completed: 2026-03-14
---

# Phase 2 Plan 02: Public Registry Server Summary

**Read-only Fastify HTTP registry server with FTS5 search, 6 filter params, 2 sort modes, pagination, CORS, and 16 passing tests**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-13T16:39:00Z
- **Completed:** 2026-03-13T16:54:31Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Installed @fastify/cors and created public read-only registry HTTP server
- 16 test cases covering all endpoints, filters, sorting, pagination, and CORS headers
- All 133 tests pass (16 new registry server + 4 reputation tracking from 02-01 + 113 existing)
- TypeScript strict mode passes cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @fastify/cors** - `7c95aeb` (chore)
2. **Task 2 RED: Failing tests for registry server** - `a409866` (test)
3. **Task 2 GREEN: Implement public registry server with CORS** - `5ed87a1` (feat)

_Note: TDD tasks have multiple commits (test → feat)_

## Files Created/Modified

- `src/registry/server.ts` — Public read-only Fastify registry server, exports `createRegistryServer` and `RegistryServerOptions`
- `src/registry/server.test.ts` — 16 test cases for all endpoints and behaviors
- `package.json` — Added @fastify/cors dependency
- `pnpm-lock.yaml` — Lock file updated
- `src/gateway/server.ts` — Auto-fix: integrated `updateReputation()` calls after each execution (success/failure/timeout)

## Decisions Made

- `origin: true` in `@fastify/cors` allows all origins — this is a public marketplace registry that any HTTP client (browser, curl, agent) should be able to browse
- Limit capped at 100 server-side to prevent abuse
- Post-filter chaining (tag → min_success_rate → max_latency_ms) after FTS5/filterCards keeps SQL simple and preserves BM25 relevance ranking
- Sort undefined values last: `success_rate` treats missing as -1 (sort desc), `latency` treats missing as Infinity (sort asc)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Integrated updateReputation() calls in gateway server**
- **Found during:** Task 2 GREEN (running full test suite after implementation)
- **Issue:** `src/gateway/server.ts` imported `updateReputation` from store but never called it. 4 reputation tracking tests from Plan 02-01 were failing. The gateway/server.ts had uncommitted changes from 02-01 that were in working tree but not committed — the tests expected reputation tracking but the implementation calls were missing.
- **Fix:** `updateReputation(registryDb, cardId, success, latencyMs)` added at 3 points in gateway execution flow: after successful handler response, after non-ok handler response, and in the catch block for timeout/AbortError. Start time tracked with `const startMs = Date.now()`.
- **Files modified:** src/gateway/server.ts
- **Verification:** All 4 Gateway Reputation Tracking tests now pass, 133 total tests pass
- **Committed in:** 5ed87a1 (Task 2 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking pre-existing incomplete work)
**Impact on plan:** Auto-fix was essential to maintain green test suite. The gateway/server.ts had a partial implementation from 02-01 that was never finalized. No scope creep.

## Issues Encountered

- Unused `listCards` import in initial server.ts implementation caused TypeScript error (TS6133). Removed before committing — caught by `pnpm typecheck` during verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Registry HTTP server is ready for external HTTP clients to query
- GET /cards endpoint supports all marketplace discovery patterns
- Foundation ready for reputation/marketplace UI in subsequent plans
- No blockers

---
*Phase: 02-cold-start*
*Completed: 2026-03-14*

## Self-Check: PASSED

- src/registry/server.ts — FOUND
- src/registry/server.test.ts — FOUND
- 02-02-SUMMARY.md — FOUND
- Commit 7c95aeb (chore: @fastify/cors) — FOUND
- Commit a409866 (test: failing tests RED) — FOUND
- Commit 5ed87a1 (feat: registry server GREEN) — FOUND
