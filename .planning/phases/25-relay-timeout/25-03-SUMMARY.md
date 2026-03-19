---
phase: 25-relay-timeout
plan: 03
subsystem: relay
tags: [websocket, relay, progress, skill-executor, tdd]

# Dependency graph
requires:
  - phase: 25-01
    provides: relay_progress message type, timer reset in WebSocket relay server
  - phase: 25-02
    provides: ProgressCallback threaded through SkillExecutor, PipelineExecutor, ConductorMode

provides:
  - Public sendProgress(requestId, info) method on RelayClient
  - onProgress field in ExecuteRequestOptions wired to skillExecutor.execute
  - CLI onRequest handler sends relay_progress via relayClient during skill execution
  - Tests verifying onProgress is threaded and backward-compatible
affects: [phase 26, phase 27, conductor, pipeline-executor, relay, gateway]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Progress bridge: SkillExecutor onProgress -> executeCapabilityRequest -> RelayClient.sendProgress -> relay server -> requester"
    - "sendProgress uses Math.round((step/total)*100) for percent calculation"
    - "onProgress as optional 3rd param preserves backward compatibility for HTTP /rpc callers"

key-files:
  created:
    - src/gateway/execute.test.ts
  modified:
    - src/relay/websocket-client.ts
    - src/gateway/execute.ts
    - src/cli/index.ts

key-decisions:
  - "CLI uses relayClient! non-null assertion inside onRequest callback — safe because onRequest only fires when relayClient is connected"
  - "handlerUrl path does not receive onProgress — only SkillExecutor path benefits from progress callbacks"
  - "onProgress is optional in ExecuteRequestOptions — all existing HTTP /rpc callers are unaffected"

patterns-established:
  - "onProgress as optional trailing parameter follows the same pattern as SkillExecutor.execute and ExecutorMode.execute"
  - "TDD red-green: 1 test failed before wiring (onProgress check), 2 already passed (backward compat, handlerUrl path)"

requirements-completed:
  - RELAY-01
  - RELAY-02
  - RELAY-03
  - RELAY-04
  - RELAY-05
  - RELAY-06

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 25 Plan 03: Relay-to-Executor Progress Bridge Summary

**End-to-end relay_progress wiring: RelayClient.sendProgress publishes provider skill progress over WebSocket so PipelineExecutor/ConductorMode heartbeats reach the requester and reset the timeout window**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-19T12:04:00Z
- **Completed:** 2026-03-19T12:12:00Z
- **Tasks:** 1 (TDD: RED -> GREEN)
- **Files modified:** 4

## Accomplishments

- Added `sendProgress(requestId, info)` public method to `RelayClient`, forwarding `{ type: 'relay_progress', id, progress%, message }` over WebSocket
- Added `onProgress?: ProgressCallback` to `ExecuteRequestOptions` and threaded it to `skillExecutor.execute` as the third argument
- CLI `onRequest` handler now constructs an `onProgress` callback that calls `relayClient!.sendProgress(req.id, info)`, completing the provider-side chain
- 3 new tests in `src/gateway/execute.test.ts` covering: onProgress threaded, no-onProgress backward compat, handlerUrl path unaffected
- All 752 tests pass (0 regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire relay-to-executor progress bridge (TDD)** - `0033a60` (feat)

**Plan metadata:** (to be added by final commit)

## Files Created/Modified

- `src/gateway/execute.test.ts` - New tests: onProgress passed through, backward compat, handlerUrl path
- `src/relay/websocket-client.ts` - Added public `sendProgress` method after `request()`
- `src/gateway/execute.ts` - Imported `ProgressCallback`, added `onProgress` to interface + destructuring + `skillExecutor.execute` call
- `src/cli/index.ts` - `onRequest` handler constructs `onProgress` closure that calls `relayClient!.sendProgress(req.id, info)`

## Decisions Made

- Used `relayClient!` non-null assertion inside the `onRequest` callback — safe because this callback is only invoked when the relay client is connected and the handler is active.
- The `handlerUrl` legacy path intentionally does not receive `onProgress` (it's a simple HTTP fetch with no step-level progress) and the test confirms it neither crashes nor calls the callback.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The TDD RED phase confirmed exactly one failing assertion (`onProgress` was `undefined` instead of the spy function). GREEN was achieved with three targeted edits plus one new file.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The full relay_progress chain is now active end-to-end: provider SkillExecutor -> executeCapabilityRequest -> RelayClient.sendProgress -> relay server -> requester timer reset
- Phase 25 relay-timeout milestone is complete (Plans 01 + 02 + 03)
- Ready for Phase 26 (Registry Credit Ledger) or any next phase in the v3.2 roadmap

---
*Phase: 25-relay-timeout*
*Completed: 2026-03-19*
