---
phase: 28-relay-credit-integration
plan: "01"
subsystem: relay-credit
tags: [relay, credits, escrow, websocket]
dependency_graph:
  requires: [src/credit/escrow.ts, src/relay/websocket-relay.ts, src/relay/types.ts]
  provides: [src/relay/relay-credit.ts]
  affects: [src/registry/server.ts]
tech_stack:
  added: []
  patterns: [escrow-hold-settle-release, relay-credit-guard]
key_files:
  created:
    - src/relay/relay-credit.ts
    - src/relay/relay-credit.test.ts
  modified:
    - src/relay/types.ts
    - src/relay/websocket-relay.ts
    - src/registry/server.ts
decisions:
  - "releaseForRelay is no-op guard when escrowId is undefined — avoids crashes on hold-failure paths"
  - "handleRelayRequest made async to allow await on credit hold before forwarding"
  - "Credit DB errors (except INSUFFICIENT_CREDITS) are non-fatal — relay logs and continues without escrow"
  - "handleDisconnect now tracks requests targeting disconnected providers via targetOwner field, enabling escrow release on provider disconnect"
  - "Progress timeout handler captures pending snapshot at fire time (not closure) to get current escrowId"
metrics:
  duration_seconds: 204
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_changed: 5
---

# Phase 28 Plan 01: Relay Credit Integration Summary

**One-liner:** Credit hold/settle/release wired into WebSocket relay via relay-credit helper module using escrow-before-forward pattern.

## What Was Built

Created `src/relay/relay-credit.ts` with four exported functions that sit between the relay and the escrow system:

- `lookupCardPrice(registryDb, cardId, skillId?)` — Queries capability_cards for pricing; returns skill-level price when skillId matches a skill in the card's skills array, otherwise card-level price, or null if card not found/no pricing.
- `holdForRelay(creditDb, owner, amount, cardId)` — Thin wrapper around holdEscrow; surfaces INSUFFICIENT_CREDITS to relay.
- `settleForRelay(creditDb, escrowId, recipientOwner)` — Thin wrapper around settleEscrow.
- `releaseForRelay(creditDb, escrowId?)` — Calls releaseEscrow; no-op guard when escrowId is undefined.

Extended `PendingRelayRequest` in `src/relay/types.ts` with optional `escrowId?` and `targetOwner?` fields.

Modified `src/relay/websocket-relay.ts`:
- `registerWebSocketRelay` now accepts optional `creditDb` third parameter (backward compat: skip all credit ops when undefined).
- `handleRelayRequest` is now async; holds credits before forwarding, rejects with "Insufficient credits" on INSUFFICIENT_CREDITS.
- `handleRelayResponse` settles on success, releases on provider error response.
- Timeout handlers (initial + progress reset) release escrow when fired.
- `handleDisconnect` iterates pendingRequests by `targetOwner` to release escrow and notify origin when provider disconnects; also releases escrow for requests from disconnected requesters.

Updated `src/registry/server.ts` to pass `opts.creditDb` as third argument to `registerWebSocketRelay`.

## Test Coverage

11 test cases in `src/relay/relay-credit.test.ts`:
- lookupCardPrice: correct price, skill-level price, missing skill fallback, null for missing card, null for missing pricing
- holdForRelay: returns escrowId + deducts balance, throws on insufficient balance, throws with no balance row
- settleForRelay: credits provider after hold
- releaseForRelay: refunds requester, no-op when escrowId is undefined

All 22 relay tests pass (11 new + 11 existing). All 119 credit tests pass. Zero type errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertions used error code string instead of error message**
- **Found during:** Task 1 GREEN phase
- **Issue:** Tests asserted `.toThrow('INSUFFICIENT_CREDITS')` but AgentBnBError message is `'Insufficient credits'` (human-readable); the code is the `err.code` property, not the message
- **Fix:** Updated test assertions to `.toThrow('Insufficient credits')` to match actual thrown message
- **Files modified:** src/relay/relay-credit.test.ts

**2. [Rule 2 - Missing functionality] handleDisconnect did not clean up requests targeting disconnected provider**
- **Found during:** Task 2 implementation
- **Issue:** Original handleDisconnect only cleaned up requests FROM the disconnected agent, not requests TO it. Provider disconnects would leave escrow held until timeout.
- **Fix:** Implemented full targetOwner matching in handleDisconnect, releasing escrow and notifying origin with "Provider disconnected" error immediately on provider disconnect. This was already described in the plan — the existing comment in the code acknowledged the gap.
- **Files modified:** src/relay/websocket-relay.ts

## Self-Check: PASSED

All created files verified on disk:
- FOUND: src/relay/relay-credit.ts
- FOUND: src/relay/relay-credit.test.ts
- FOUND: src/relay/types.ts (modified)
- FOUND: src/relay/websocket-relay.ts (modified)
- FOUND: src/registry/server.ts (modified)

All commits verified:
- 634d51a: test(28-01): add failing tests for relay-credit module
- 0587988: feat(28-01): relay-credit helper module + extend PendingRelayRequest
- e9bff9a: feat(28-01): wire credit hold/settle/release into WebSocket relay
