---
phase: 12-foundation-agent-directory
plan: 02
subsystem: api
tags: [fastify, sqlite, agent-directory, spa-routing, vite-proxy]

# Dependency graph
requires:
  - phase: 12-foundation-agent-directory
    provides: plan 01 (react-router, hub routing infrastructure)
provides:
  - GET /api/agents endpoint returning reputation-sorted agent profiles
  - GET /api/agents/:owner endpoint returning profile + skills + recent_activity
  - /api Vite dev proxy entry covering all /api/* routes
  - SPA catch-all via setNotFoundHandler for /hub/* deep links
affects:
  - 12-03 (agent directory frontend consumes /api/agents and /api/agents/:owner)
  - 13-activity-feed (future /api/activity route covered by /api proxy entry)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - GROUP BY aggregate SQL for credits_earned — never stored as a column
    - setNotFoundHandler for SPA fallback — avoids conflict with @fastify/static wildcard
    - CapabilityCardV2 cast (card as unknown as CapabilityCardV2) for skills[] access on listCards() results
    - TDD RED-GREEN pattern for new Fastify routes

key-files:
  created: []
  modified:
    - src/registry/server.ts
    - hub/vite.config.ts
    - src/registry/server.test.ts

key-decisions:
  - "SPA catch-all uses setNotFoundHandler not server.get('/hub/*') — @fastify/static registers HEAD+GET /hub/* wildcard, a competing GET route causes Fastify to throw 'HEAD already declared'"
  - "credits_earned computed via GROUP BY aggregate SQL on request_log, never stored as a column per v2.2 roadmap decision"
  - "listCards() returns CapabilityCard[] typed, but v2 cards have skills[] at runtime — cast via (card as unknown as CapabilityCardV2) to access skills?.length"

patterns-established:
  - "Agent directory SQL pattern: LEFT JOIN request_log with SUM(CASE WHEN status='success') for earnings"
  - "Per-owner member_since: SELECT MIN(created_at) FROM capability_cards WHERE owner = ?"
  - "Vite proxy covers /api prefix — all future /api/* routes automatically proxied in dev"

requirements-completed: [AGENT-04, AGENT-05]

# Metrics
duration: 5min
completed: 2026-03-16
---

# Phase 12 Plan 02: Agent Directory Backend Summary

**Two public Fastify routes (GET /api/agents, GET /api/agents/:owner) with GROUP BY SQL earnings aggregation, plus Vite /api proxy and setNotFoundHandler SPA fallback**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-16T13:01:28Z
- **Completed:** 2026-03-16T13:06:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- GET /api/agents returns `{ items: AgentProfile[], total: number }` sorted by success_rate DESC then total_earned DESC (nulls last)
- GET /api/agents/:owner returns profile + skills array + recent_activity (10 entries), with 404 for unknown owners
- credits_earned computed via GROUP BY aggregate SQL — never a stored column
- /api proxy entry added to hub/vite.config.ts, covering all future /api/* routes
- SPA catch-all correctly implemented via setNotFoundHandler (avoiding conflict with @fastify/static wildcard)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SPA catch-all and /api proxy entry** - `42a73d7` (feat)
2. **Task 2 RED: Failing tests for /api/agents endpoints** - `92a61ef` (test)
3. **Task 2 GREEN: Implement /api/agents routes** - `0c2206d` (feat)

## Files Created/Modified
- `src/registry/server.ts` - Added GET /api/agents, GET /api/agents/:owner routes; import listCards + CapabilityCardV2; setNotFoundHandler SPA fallback
- `hub/vite.config.ts` - Added '/api': 'http://localhost:7777' to proxy
- `src/registry/server.test.ts` - Added 9 new tests across two describe blocks; imported insertRequestLog

## Decisions Made
- setNotFoundHandler instead of server.get('/hub/*') for SPA fallback — @fastify/static registers GET+HEAD for its prefix wildcard, and Fastify 5 throws immediately if HEAD is already registered for the same path. setNotFoundHandler intercepts the callNotFound() signal that fastifyStatic emits when a file doesn't exist.
- credits_earned computed via GROUP BY aggregate SQL per the v2.2 roadmap decision — ensures data consistency and avoids stale cached values.
- Used `(card as unknown as CapabilityCardV2)` cast to access `skills?.length` — listCards() is typed as CapabilityCard[] (v1 schema) but stores v2 cards at runtime; the double cast avoids tsc errors without changing the store signature.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SPA catch-all approach changed from wildcard GET route to setNotFoundHandler**
- **Found during:** Task 1 (SPA catch-all) / Task 2 RED (tests)
- **Issue:** Plan specified `server.get('/hub/*', ...)` but `@fastify/static` already registers `['HEAD', 'GET']` for `prefix + '*'` when `wildcard: true` (default). Fastify throws "Method 'HEAD' already declared for route '/hub/*'" immediately on server.ready(), breaking ALL 51 tests.
- **Fix:** Replaced `server.get('/hub/*', ...)` with `server.setNotFoundHandler()` that serves `index.html` for requests starting with `/hub/`. fastifyStatic calls `reply.callNotFound()` when a static file is not found, which triggers the handler.
- **Files modified:** src/registry/server.ts
- **Verification:** All 51 tests pass, TypeScript compiles clean
- **Committed in:** 92a61ef (combined with RED test commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix correctly implements the intended SPA fallback behavior without scope creep. The setNotFoundHandler approach is actually more correct — it relies on fastifyStatic's own 404 signal rather than a competing route.

## Issues Encountered
- TypeScript error accessing `card.skills?.length` on `CapabilityCard` type (which is v1.0 shape without skills[]). Resolved with `(card as unknown as CapabilityCardV2).skills?.length` cast — listCards() type annotation is v1 but stores mixed v1/v2 at runtime.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GET /api/agents and GET /api/agents/:owner are live and tested — Plan 03 (agent directory frontend) can immediately consume these endpoints
- /api proxy already covers all future /api/* routes (Phase 13 activity feed)
- SPA catch-all handles all /hub/* deep links via setNotFoundHandler

## Self-Check: PASSED

All files verified:
- 12-02-SUMMARY.md: FOUND
- src/registry/server.ts: FOUND
- hub/vite.config.ts: FOUND
- Commit 42a73d7: FOUND
- Commit 92a61ef: FOUND
- Commit 0c2206d: FOUND

---
*Phase: 12-foundation-agent-directory*
*Completed: 2026-03-16*
