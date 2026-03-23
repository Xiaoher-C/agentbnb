---
phase: 51-production-resilience
plan: 02
subsystem: gateway, api, database
tags: [concurrency, backpressure, overload, sqlite, fastify, zod]

# Dependency graph
requires:
  - phase: 51-01
    provides: FailureReason type + failure_reason column in request_log
provides:
  - capacity.max_concurrent optional field on all 5 SkillConfig schemas
  - inFlight Map<string, number> per server instance for concurrency tracking
  - Gateway overload rejection path returning { error: 'overload', retry_after_ms: 5000 }
  - Overload events logged in request_log with failure_reason: 'overload', no reputation damage
  - inFlight counter decremented in finally block (leak-proof)
affects: [gateway, skill-execution, reputation, trust-metrics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Map<string, number> per-server inFlight counter (not global singleton)"
    - "typeof getSkillConfig === 'function' guard for backward compat with legacy mock executors"
    - "Sentinel '<overload>' card_name for rejected requests (no extra DB lookup on rejection)"
    - "Hardcoded OVERLOAD_RETRY_MS=5000 — deterministic, simple"

key-files:
  created: []
  modified:
    - src/skills/skill-config.ts
    - src/skills/skill-config.test.ts
    - src/gateway/server.ts
    - src/gateway/server.test.ts

key-decisions:
  - "inFlight map is scoped per createGatewayServer() call — no global state, test isolation preserved"
  - "getSkillConfig guarded with typeof check to avoid breaking existing mock executors that lack the method"
  - "Overload check only fires when skillId is present AND getSkillConfig exists AND maxConcurrent is configured"
  - "retry_after_ms hardcoded at 5000ms — simple and deterministic; adaptive backoff is future work"
  - "Overload log uses sentinel '<overload>' for card_name to avoid a DB lookup on rejected requests"

patterns-established:
  - "In-flight tracking: increment before execute, decrement in finally — no leaks on any code path"
  - "Overload path bypasses updateReputation entirely — failure_reason='overload' is how future queries identify excluded rows"

requirements-completed: [RESIL-03, RESIL-04]

# Metrics
duration: 20min
completed: 2026-03-24
---

# Phase 51 Plan 02: skills.yaml max_concurrent + gateway in-flight counter + overload response Summary

**Per-skill concurrency limits via capacity.max_concurrent in skills.yaml, enforced by an inFlight Map in the gateway with structured overload rejection that does not penalize provider reputation**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-24T02:44:00Z
- **Completed:** 2026-03-24T03:04:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `CapacitySchema` with `max_concurrent: positive integer (optional)` to all 5 SkillConfig schemas
- Added `inFlight = new Map<string, number>()` and `OVERLOAD_RETRY_MS = 5000` to `createGatewayServer`
- Pre-execution overload check: rejects N+1th concurrent request with JSON-RPC error containing `data.error='overload'` and `data.retry_after_ms=5000`
- Overload rejection logs `request_log` row with `failure_reason: 'overload'`, `status: 'failure'`, `credits_charged: 0`
- `updateReputation` NOT called on overload rejections — provider success rate unaffected
- inFlight decremented in `finally` block — guaranteed no leaks on success, failure, or thrown exception
- Skills without `capacity.max_concurrent` declared have no limit enforced (inFlight still tracked for future use)
- Added 7 new skill-config tests (one per skill type + optional/zero validation)
- Added 4 new server tests for concurrency (below-limit pass, N+1 overload, log entry, unlimited fallback)

## Task Commits

1. **Task 1: capacity.max_concurrent to all SkillConfig schemas** - `d478a8a` (feat)
2. **Task 2: Gateway in-flight tracker + overload response + request_log entry** - `d478a8a` (combined in same commit)

## Files Created/Modified
- `/Users/leyufounder/Github/agentbnb/src/skills/skill-config.ts` - CapacitySchema + capacity field on all 5 schemas
- `/Users/leyufounder/Github/agentbnb/src/skills/skill-config.test.ts` - max_concurrent parsing tests
- `/Users/leyufounder/Github/agentbnb/src/gateway/server.ts` - inFlight map + OVERLOAD_RETRY_MS + overload check + in-flight tracking
- `/Users/leyufounder/Github/agentbnb/src/gateway/server.test.ts` - concurrency limit tests

## Decisions Made
- inFlight map is scoped per `createGatewayServer()` call — no global state, clean test isolation
- Guard `typeof skillExecutor.getSkillConfig === 'function'` prevents 500 errors from legacy test mocks that don't implement the method
- Overload check only activates when: skillExecutor present AND skillId present AND getSkillConfig available AND max_concurrent configured — otherwise passes through unchanged
- retry_after_ms hardcoded at 5000ms — adaptive backoff is out of scope for this plan

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing typeof guard on getSkillConfig caused 500 errors in P2P tests**
- **Found during:** Task 2 (full test suite run)
- **Issue:** p2p-integration.test.ts uses mock executors without `getSkillConfig` method. Calling `skillExecutor.getSkillConfig(skillId)` threw `TypeError: skillExecutor.getSkillConfig is not a function`, causing Fastify to return 500 instead of the expected JSON-RPC response
- **Fix:** Added `typeof skillExecutor.getSkillConfig === 'function'` guard to the overload check condition
- **Files modified:** src/gateway/server.ts
- **Verification:** P2P integration tests pass (12/12); all Phase 51 tests pass (162/162)
- **Committed in:** d478a8a (task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** Essential fix for backward compatibility with existing mock executors. No scope creep.

## Issues Encountered
The `typeof getSkillConfig` guard was the only issue — caught by running the broader test suite before committing.

## Next Phase Readiness
- Overload protection live for all skills with `capacity.max_concurrent` declared in skills.yaml
- failure_reason='overload' rows are now stored; trust tier queries can exclude them from denominator
- Foundation complete for Phase 53 team_id/role log columns (they extend the same request_log table)

---
*Phase: 51-production-resilience*
*Completed: 2026-03-24*
