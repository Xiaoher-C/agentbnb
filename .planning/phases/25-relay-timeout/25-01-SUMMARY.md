---
phase: 25-relay-timeout
plan: "01"
subsystem: relay,gateway,conductor,cli
tags: [timeout, websocket, relay_progress, tdd]
dependency_graph:
  requires: []
  provides: [RELAY-01, RELAY-02, RELAY-03, RELAY-04]
  affects: [relay, gateway, conductor, cli]
tech_stack:
  added: []
  patterns: [relay_progress heartbeat, timer reset on progress]
key_files:
  created: []
  modified:
    - src/relay/types.ts
    - src/relay/websocket-relay.ts
    - src/relay/websocket-client.ts
    - src/gateway/client.ts
    - src/gateway/execute.ts
    - src/gateway/server.ts
    - src/conductor/pipeline-orchestrator.ts
    - src/cli/conduct.ts
    - src/relay/websocket-relay.test.ts
key_decisions:
  - "RelayProgressMessageSchema added to discriminated union (not a parallel schema) so existing parse logic handles it uniformly"
  - "relay_progress handler resets timer with same RELAY_TIMEOUT_MS constant (not a separate progress window)"
  - "PendingRequest stores timeoutMs to allow timer reset without reference to outer constant"
metrics:
  duration_minutes: 3
  completed_date: "2026-03-19"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 9
---

# Phase 25 Plan 01: Relay Timeout & Progress Heartbeat Summary

**One-liner:** 300s relay timeout + relay_progress message type with server-side timer reset and client-side forwarding via discriminated union schema.

## What Was Built

Extended the WebSocket relay protocol with two improvements:

1. **Timeout increase (30s → 300s)** across all 6 timeout defaults: relay server, relay client, gateway client, gateway execute, gateway server, conductor orchestrator, and CLI conduct command.

2. **`relay_progress` message type** — a provider heartbeat that:
   - Resets the relay server's pending request timer (RELAY_TIMEOUT_MS restart)
   - Gets forwarded by the relay server to the origin requester
   - Resets the client-side outbound request timer
   - Invokes an optional `onProgress` callback on `RelayRequestOptions`

## Files Modified

| File | Change |
|------|--------|
| `src/relay/types.ts` | Added `RelayProgressMessageSchema` + `RelayProgressMessage` type in discriminated union |
| `src/relay/websocket-relay.ts` | `RELAY_TIMEOUT_MS` 30_000→300_000, new `handleRelayProgress()` function with timer reset + forwarding |
| `src/relay/websocket-client.ts` | Default timeout 30_000→300_000, `relay_progress` handling, `onProgress` callback, `PendingRequest.timeoutMs` field |
| `src/gateway/client.ts` | Default `timeoutMs` 30_000→300_000 |
| `src/gateway/execute.ts` | Default `timeoutMs` 30_000→300_000 |
| `src/gateway/server.ts` | Default `timeoutMs` 30_000→300_000 |
| `src/conductor/pipeline-orchestrator.ts` | Default `timeoutMs` 30_000→300_000 |
| `src/cli/conduct.ts` | Hardcoded `timeoutMs` 30_000→300_000 |
| `src/relay/websocket-relay.test.ts` | 4 new tests for relay_progress behavior |

## Tests

All 11 relay tests pass (7 existing + 4 new):
- "relay_progress resets timeout and provider response succeeds"
- "relay_progress forwarded to requester"
- "relay_progress for unknown request is ignored (no crash)"
- "RELAY_TIMEOUT_MS constant equals 300_000"

All 36 gateway tests continue to pass.

## Commits

| Phase | Hash | Message |
|-------|------|---------|
| RED | 258405a | test(25-01): add failing tests for relay_progress message type |
| GREEN | 4d29012 | feat(25-01): add relay_progress message type and increase all timeouts to 300s |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/relay/types.ts` — FOUND (RelayProgressMessageSchema in discriminated union)
- `src/relay/websocket-relay.ts` — FOUND (300_000 constant, relay_progress case)
- `src/relay/websocket-client.ts` — FOUND (300_000 default, handleProgress method, onProgress callback)
- `src/gateway/client.ts` — FOUND (300_000 default)
- `src/gateway/execute.ts` — FOUND (300_000 default)
- `src/gateway/server.ts` — FOUND (300_000 default)
- `src/conductor/pipeline-orchestrator.ts` — FOUND (300_000 default)
- `src/cli/conduct.ts` — FOUND (300_000 value)
- Commits 258405a and 4d29012 — FOUND in git log
