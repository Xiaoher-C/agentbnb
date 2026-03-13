---
phase: 00-dogfood
plan: 03
subsystem: api
tags: [fastify, json-rpc, http, gateway, auth, bearer-token, escrow, timeout, abort-controller]

# Dependency graph
requires:
  - phase: 00-dogfood/00-01
    provides: SQLite registry with getCard() for card lookup during RPC dispatch
  - phase: 00-dogfood/00-02
    provides: Credit ledger with holdEscrow()/settleEscrow()/releaseEscrow() for payment flow

provides:
  - Fastify HTTP gateway server with /health and /rpc endpoints
  - Token-based auth middleware (Bearer token validation, skips /health)
  - JSON-RPC 2.0 capability.execute method with full credit escrow lifecycle
  - AbortController-based timeout (configurable, default 30s) with escrow release on timeout
  - Outbound client (requestCapability) for agent-to-agent capability requests
  - authPlugin export for reuse in other Fastify servers

affects:
  - 00-dogfood/cli (serve command uses createGatewayServer, request command uses requestCapability)
  - 00-dogfood/integration (end-to-end OpenClaw agent tests use gateway for capability requests)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fastify hook added on root instance (not in registered plugin) to avoid scope encapsulation — hooks in registered plugins only apply to child-scoped routes"
    - "AbortController + setTimeout pattern for HTTP request timeout with automatic cleanup"
    - "JSON-RPC 2.0 error codes: -32600 (invalid request), -32601 (method not found), -32602 (invalid params / card not found), -32603 (internal error: credits/timeout/handler)"
    - "Escrow hold before handler call, settle on success, release on failure/timeout — ensures no credit loss on errors"
    - "server.inject() for integration tests (no actual port binding needed in test suite)"

key-files:
  created:
    - src/gateway/server.ts
    - src/gateway/auth.ts
    - src/gateway/client.ts
    - src/gateway/server.test.ts
  modified:
    - src/cli/index.ts (removed unused listCards import — pre-existing typecheck error)

key-decisions:
  - "Auth hook added directly on root Fastify instance (not via plugin registration) — Fastify's encapsulation scopes registered-plugin hooks to child routes only; root-level addHook applies to all routes on the instance"
  - "Requester identity comes from params.requester (not from token) — agents identify themselves in the JSON-RPC call; token is authentication, requester is authorization context"
  - "createGatewayServer() returns synchronously (not async) — Fastify queues plugin registrations; caller calls .ready() or .listen() to initialize, matching test injection pattern"

patterns-established:
  - "Pattern: Gateway escrow flow — holdEscrow() before handler POST, settleEscrow(escrowId, card.owner) on 200 OK, releaseEscrow(escrowId) on non-200 or any error"
  - "Pattern: Fastify auth via root-level addHook('onRequest') with URL whitelist for public routes (/health)"
  - "Pattern: JSON-RPC error response structure — { jsonrpc: '2.0', id, error: { code, message } }"
  - "Pattern: AbortController for both server-side handler timeout and client-side request timeout"

requirements-completed: [R-004]

# Metrics
duration: 7min
completed: 2026-03-13
---

# Phase 0 Plan 03: Gateway Server Summary

**Fastify JSON-RPC gateway with Bearer token auth, credit escrow lifecycle, AbortController timeouts, and an outbound requestCapability client — completing the agent-to-agent communication layer**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-13T13:52:31Z
- **Completed:** 2026-03-13T13:59:00Z
- **Tasks:** 2 of 2
- **Files modified:** 5

## Accomplishments

- Fastify gateway server with GET /health (unauthenticated) and POST /rpc (JSON-RPC 2.0, token-authenticated)
- Full credit escrow flow: hold before execution, settle on success, release on failure/timeout — no credit loss on errors
- Bearer token auth on root Fastify instance (not plugin-scoped) so all routes are protected
- AbortController timeout in both server (handler call) and client (outbound request) with configurable `timeoutMs`
- Outbound `requestCapability()` client with auth header, JSON-RPC error mapping, and AgentBnBError throws
- 15 tests covering health check, auth rejection, RPC dispatch, escrow accounting, timeout, and client round-trip

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for gateway server, auth, and client** - `b207f87` (test)
2. **Task 1 (GREEN): Gateway server with auth and JSON-RPC endpoint** - `36e587e` (feat)
3. **Task 2 (GREEN): Outbound gateway client** - `8c99422` (feat)

_Note: TDD tasks — tests written first (RED), then implementation (GREEN). Tasks 1 and 2 share a single test file since client tests require a live gateway server._

## Files Created/Modified

- `src/gateway/server.ts` - createGatewayServer() factory: GET /health, POST /rpc with full escrow and timeout
- `src/gateway/auth.ts` - authPlugin export (FastifyPluginAsync) for Bearer token validation
- `src/gateway/client.ts` - requestCapability() outbound JSON-RPC client with timeout and error mapping
- `src/gateway/server.test.ts` - 15 integration tests: server (10) and client (5) with mock handler
- `src/cli/index.ts` - Removed unused `listCards` import (auto-fixed pre-existing typecheck error)

## Decisions Made

- **Auth hook on root Fastify instance (not plugin)**: Fastify's encapsulation model scopes hooks registered inside `fastify.register(plugin)` only to that plugin's child routes. To apply auth to all routes including those registered at root level, the `addHook('onRequest', ...)` must be called directly on the root instance. `authPlugin` export is preserved for external use but server.ts adds auth inline.

- **Requester from params, not token**: Token is authentication (who is allowed to call). Requester (`params.requester`) is the agent identity for credit debiting. This allows a single gateway token to serve multiple agent identities in Phase 0.

- **Synchronous createGatewayServer()**: Returns a configured FastifyInstance immediately without awaiting plugin initialization. Fastify queues registrations internally; calling `.ready()` or `.listen()` later triggers initialization. This matches the test pattern of `gateway = createGatewayServer({...})` followed by `await gateway.ready()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unused `listCards` import in cli/index.ts causing typecheck failure**
- **Found during:** Task 1 (final typecheck verification)
- **Issue:** `src/cli/index.ts` imported `listCards` from `registry/store.ts` but never used it (pre-existing, introduced when CLI was pre-written before gateway existed)
- **Fix:** Removed `listCards` from the import statement — `openDatabase` and `insertCard` are still used
- **Files modified:** src/cli/index.ts
- **Verification:** `pnpm typecheck` exits cleanly with no errors
- **Committed in:** `36e587e` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 pre-existing bug)
**Impact on plan:** Minor cleanup, no scope creep. Required for typecheck success criterion.

## Issues Encountered

Fastify plugin encapsulation: the initial `server.ts` used `fastify.register(authPlugin, { tokens })` but Fastify isolates hook contexts — hooks in registered plugins don't apply to routes defined on the parent instance. Solved by moving `addHook('onRequest')` directly to the root Fastify instance while keeping `authPlugin` as an exportable utility.

## User Setup Required

None - no external service configuration required. All SQLite, all local.

## Next Phase Readiness

- Gateway is fully wired into registry and credit system — ready for CLI integration and OpenClaw dogfood loop
- `createGatewayServer()` and `requestCapability()` are the integration points for CLI `serve` and `request` commands
- CLI `index.ts` already imports both (`serve` command uses gateway, `request` command uses client)
- No blockers for CLI or integration testing

---
*Phase: 00-dogfood*
*Completed: 2026-03-13*
