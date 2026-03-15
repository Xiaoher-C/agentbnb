---
phase: 03-ux-layer
plan: 02
subsystem: api
tags: [fastify, bearer-token, auth, sqlite, registry-server, tdd]

requires:
  - phase: 03-01
    provides: request_log table with getRequestLog(), api_key in AgentBnBConfig
  - phase: 02-cold-start
    provides: createRegistryServer(), updateCard(), getCard() in store.ts
  - phase: 00-dogfood
    provides: getBalance() in credit ledger, AgentBnBError with FORBIDDEN/NOT_FOUND codes

provides:
  - Auth-protected owner endpoints on registry server (GET /me, GET /requests, GET /draft, POST /cards/:id/toggle-online, PATCH /cards/:id)
  - Scoped Fastify plugin ownerRoutes with Bearer token auth hook
  - serve command wires api_key + creditDb to registry server
  - CORS updated with PATCH/OPTIONS methods and Authorization header

affects: [03-03a, 03-03b, hub-frontend]

tech-stack:
  added: []
  patterns:
    - Fastify scoped plugin for endpoint-group-level auth (no fastify-plugin wrapper preserves encapsulation)
    - vi.mock() at module-level + vi.mocked() per-test for reconfigurable mocks of the same module
    - Bearer token validation via onRequest hook inside scoped plugin only

key-files:
  created: []
  modified:
    - src/registry/server.ts
    - src/registry/server.test.ts
    - src/cli/index.ts
    - src/cli/index.test.ts

key-decisions:
  - "Scoped Fastify plugin (NOT fastify-plugin) for owner routes — Fastify encapsulation ensures auth hook never leaks to public /cards and /health"
  - "vi.mock() hoisted at module-level + vi.mocked() per test — avoids conflicting vi.mock() calls for same module in two tests which caused 500s"
  - "GET /me returns balance: 0 when creditDb absent — safe default for legacy serve invocations"
  - "serve warns but continues when api_key missing — backward-compat with pre-03-01 configs"

patterns-established:
  - "Pattern: Scoped owner plugin — register auth-gated endpoints as void server.register(async ownerRoutes => {...}) without fastify-plugin"
  - "Pattern: vi.mock module-level + vi.mocked per-test — single mock declaration, per-test return value customization via mockReturnValue"

requirements-completed: [UX-04, UX-05, UX-06, UX-07, UX-08]

duration: 6min
completed: 2026-03-15
---

# Phase 3 Plan 02: Auth-Protected Owner Endpoints Summary

**Scoped Fastify plugin adds 5 Bearer-token-gated owner endpoints (GET /me with balance, /requests with period filter, /draft from auto-detect, toggle-online, PATCH) while keeping public /cards and /health fully unauthenticated**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-15T06:36:26Z
- **Completed:** 2026-03-15T06:43:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- GET /me returns { owner, balance } from credit ledger with valid Bearer token; 401 without
- GET /requests supports limit (capped 100) and since (24h/7d/30d) period filtering
- GET /draft calls detectApiKeys + buildDraftCard to expose auto-detected draft cards for the Hub Share page
- POST /cards/:id/toggle-online and PATCH /cards/:id enforce ownership (403) and existence (404)
- serve command now passes ownerApiKey + creditDb to registry server; warns on missing api_key
- Module-level vi.mock pattern resolved conflicting per-test mock calls for same module
- 72 total tests pass (33 server + 39 CLI)

## Task Commits

1. **Task 1 RED: Failing tests for owner endpoints** - `5a4120d` (test)
2. **Task 1 GREEN: Auth-protected owner endpoints implementation** - `d246764` (feat)
3. **Task 2: Wire serve command with API key and creditDb** - `10ab11a` (feat)

## Files Created/Modified

- `src/registry/server.ts` — Extended RegistryServerOptions, updated CORS, added scoped ownerRoutes plugin with 5 endpoints
- `src/registry/server.test.ts` — 15 new tests for owner endpoints (auth, balance, requests, draft, toggle, patch, regressions)
- `src/cli/index.ts` — serve command passes ownerName, ownerApiKey, creditDb to registry server; warns on missing api_key
- `src/cli/index.test.ts` — Integration test: serve with api_key, GET /me returns owner and balance

## Decisions Made

- Scoped Fastify plugin (no fastify-plugin wrapper) for owner routes — Fastify encapsulation ensures the auth onRequest hook applies only within the plugin scope, never leaking to public endpoints
- vi.mock() hoisted at module-level + vi.mocked() per test — two separate per-test vi.mock() calls for the same module caused the second test to hit a 500 due to module cache inconsistency; single module-level declaration with per-test mockReturnValue solved it
- GET /me returns balance 0 when creditDb absent — safe fallback for edge cases where creditDb not passed
- serve logs a warning but continues when api_key missing — backward-compatible with configs that predate Phase 03-01

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- vi.mock() per-test conflict: Two separate tests both called `vi.mock('../cli/onboarding.js', ...)` in the same file. The second call caused a 500 on GET /draft because vitest's module mocking was inconsistent when the same module is mocked twice with factory functions in a single test file. Fixed by declaring one module-level `vi.mock()` and using `vi.mocked(...).mockReturnValue()` per test.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 5 owner endpoints are live and auth-protected — Hub SPA (Plans 03-03a/03b) can now call /me, /requests, /draft, toggle-online, and PATCH to power the owner dashboard
- CORS updated with PATCH/OPTIONS and Authorization header — Hub SPA preflight requests will succeed
- serve command fully wired — no manual config needed for dashboard features when api_key present

---
*Phase: 03-ux-layer*
*Completed: 2026-03-15*
