---
phase: 00-dogfood
plan: 05
subsystem: integration
tags: [soul-md, parser, capability-card, fastify, request-handler, e2e, tdd, credits]

# Dependency graph
requires:
  - phase: 00-dogfood/00-01
    provides: openDatabase, insertCard, searchCards — SQLite registry CRUD and FTS5 search
  - phase: 00-dogfood/00-02
    provides: openCreditDb, bootstrapAgent, getBalance — credit ledger operations
  - phase: 00-dogfood/00-03
    provides: createGatewayServer, requestCapability — gateway server and outbound client
provides:
  - parseSoulMd: regex-based SOUL.md parser extracting name, description, capabilities (H1/H2)
  - publishFromSoul: SOUL.md → CapabilityCard pipeline with registry insertion
  - createRequestHandler: Fastify route handler that dispatches by card_id to local handlers
  - Integration test suite: 13 tests covering parser, publisher, handler, and E2E capability exchange
  - Passing E2E: Agent A publishes → Agent B discovers → requests → receives result → credits settle
affects:
  - Any future OpenClaw agents that publish capabilities via SOUL.md
  - Phase 1 if built (public marketplace would extend this integration pattern)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SOUL.md parsing with regex (no markdown library): H1 = name, first paragraph = description, H2 sections = capabilities"
    - "createRequestHandler returns raw result directly — gateway JSON-RPC layer wraps in { result }"
    - "E2E integration test pattern: shared in-memory DBs, real Fastify servers on port 0, full lifecycle via beforeAll/afterAll"

key-files:
  created:
    - src/skills/publish-capability.ts
    - src/skills/handle-request.ts
    - src/skills/integration.test.ts

key-decisions:
  - "SOUL.md parser uses regex (not a markdown library) to avoid new dependencies — per plan spec"
  - "parseSoulMd defaults to level 2 (Pipeline) — per RESEARCH.md open question resolution"
  - "createRequestHandler returns raw handler result (no wrapping) — gateway JSON-RPC layer wraps in { result }, consistent with existing server.test.ts mock pattern"
  - "E2E test uses port 0 for random port assignment — avoids port conflicts in CI"

patterns-established:
  - "Pattern: Handler returns raw object; gateway JSON-RPC result field wraps it — no double-wrapping"
  - "Pattern: Port 0 + server.address() for integration test port assignment"
  - "Pattern: TDD RED commit before implementation, GREEN commit with both test+impl fixes"

requirements-completed: [R-006]

# Metrics
duration: 5min
completed: 2026-03-13
---

# Phase 0 Plan 05: OpenClaw Integration Summary

**SOUL.md regex parser generates L2 CapabilityCards, createRequestHandler dispatches to local handlers, and passing E2E test proves Agent A can discover/request/receive Agent B's capability with full credit settlement (10 credits transferred)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-13T14:01:41Z
- **Completed:** 2026-03-13T14:05:56Z
- **Tasks:** 2 of 2 (Task 2: human-verify approved)
- **Files modified:** 3

## Accomplishments
- `parseSoulMd` extracts H1 name, first paragraph description, H2 capability sections using regex only
- `publishFromSoul` builds and inserts a valid CapabilityCard with sensible defaults (level 2, 10 credits/call, online)
- `createRequestHandler` returns a Fastify RouteHandlerMethod that dispatches by card_id, compatible with gateway's handlerUrl pattern
- 13 integration tests: 6 parser tests, 1 publishFromSoul test, 2 handler unit tests, 4 E2E tests
- E2E test proves full loop: publish via SOUL.md → FTS5 discover → gateway request → execute → credit settlement

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for SOUL.md parser, request handler, and E2E integration** - `e931ff5` (test)
2. **Task 1 (GREEN): Implement publish-capability, handle-request, fix test expectations** - `0c813f6` (feat)

**Plan metadata:** (created after this summary)

_Note: TDD task — RED commit (failing tests) followed by GREEN commit (implementation). Tests were updated to match correct behavior during GREEN phase._

## Files Created/Modified
- `src/skills/publish-capability.ts` - parseSoulMd (regex parser), publishFromSoul (CapabilityCard builder + registry insertion)
- `src/skills/handle-request.ts` - createRequestHandler (Fastify route handler, card_id dispatch, raw result return)
- `src/skills/integration.test.ts` - 13 tests: parser unit tests, publishFromSoul, handler unit tests, full E2E test

## Decisions Made
- **Regex-based SOUL.md parsing**: No markdown parser dependency needed — regex for H1/H2/paragraphs is sufficient and matches plan spec
- **parseSoulMd defaults to level 2**: Per RESEARCH.md open question resolution — unknown capability level defaults to Pipeline (L2), flagged for manual review
- **createRequestHandler returns raw result**: The handler returns the result object directly. The gateway's JSON-RPC layer wraps the entire handler response as `result`. This is consistent with how `server.test.ts` mock handlers work (they also return raw objects). A double-wrap was the initial bug — caught and fixed during GREEN phase.
- **Port 0 for test servers**: Both handler and gateway servers use port 0 to avoid port conflicts in parallel test runs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed result double-wrapping between handler and gateway**
- **Found during:** Task 1 GREEN (running tests)
- **Issue:** `createRequestHandler` initially returned `{ result: handlerReturn }`, but the gateway server wraps the entire HTTP response as the JSON-RPC `result`. This caused double-wrapping: `result: { result: { summary } }` instead of `result: { summary }`.
- **Fix:** Changed `createRequestHandler` to return the raw handler result (no wrapping). Updated test expectations to match: `body.echo` instead of `body.result.echo`.
- **Files modified:** src/skills/handle-request.ts, src/skills/integration.test.ts
- **Verification:** All 13 integration tests pass; full suite 91 tests pass
- **Committed in:** `0c813f6` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug — result double-wrapping)
**Impact on plan:** Required for correct E2E behavior. No scope creep.

## Issues Encountered
- Initial test for `createRequestHandler` had wrong expectation (`body.result.summary` instead of `body.summary`) and wrong mock handler logic (`slice(0, 10)` gave truncated string). Fixed during GREEN phase to accurately test the handler's contract.

## User Setup Required
None - no external service configuration required. All SQLite in-memory, all local Fastify servers.

## Next Phase Readiness
- Full Phase 0 dogfood loop is complete and tested
- Ready for human verification (Task 2 checkpoint)
- `parseSoulMd` + `publishFromSoul` can parse any SOUL.md file format
- `createRequestHandler` ready for use with any card_id → handler function mapping
- `agentbnb init` + `agentbnb serve` + integration skills = complete agent setup flow

---
*Phase: 00-dogfood*
*Completed: 2026-03-13*
