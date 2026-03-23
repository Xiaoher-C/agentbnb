---
phase: 51-production-resilience
subsystem: gateway, database, api
tags: [sqlite, request-log, failure-reason, reputation, concurrency, backpressure, overload, fastify, zod]

# Dependency graph
requires:
  - phase: any prior phase with request_log + gateway + SkillExecutor
    provides: request_log table, execute.ts, server.ts, skill-config.ts
provides:
  - FailureReason string union type (bad_execution | overload | timeout | auth_error | not_found)
  - failure_reason TEXT column in request_log with idempotent migration
  - capacity.max_concurrent optional field on all 5 SkillConfig schemas
  - Gateway in-flight concurrency enforcement with structured overload response
  - Overload rejections do not decrement provider success_rate
affects: [gateway, reputation, trust-metrics, phase-53-team-log]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FailureReason string union for zero-cost type safety"
    - "Idempotent ALTER TABLE via try/catch for schema migrations"
    - "Map<string, number> per-server inFlight counter"
    - "typeof guard for backward-compat with legacy mock executors"

key-files:
  created:
    - .planning/phases/51-production-resilience/51-01-SUMMARY.md
    - .planning/phases/51-production-resilience/51-02-SUMMARY.md
  modified:
    - src/types/index.ts
    - src/registry/request-log.ts
    - src/registry/request-log.test.ts
    - src/gateway/execute.ts
    - src/gateway/execute.test.ts
    - src/skills/skill-config.ts
    - src/skills/skill-config.test.ts
    - src/gateway/server.ts
    - src/gateway/server.test.ts

key-decisions:
  - "updateReputation uses stored EWA counter on capability_cards — overload path simply skips calling it"
  - "inFlight map is scoped per createGatewayServer() call — no global state, clean test isolation"
  - "typeof getSkillConfig === 'function' guard for backward compat with existing mock executors"
  - "retry_after_ms hardcoded at 5000ms — simple and deterministic"

requirements-completed: [RESIL-01, RESIL-02, RESIL-03, RESIL-04]

# Metrics
duration: 45min
completed: 2026-03-24
---

# Phase 51: Production Resilience Summary

**FailureReason enum wired through request_log + per-skill concurrency limits (capacity.max_concurrent) enforced by inFlight gateway counter, with structured overload responses that preserve provider reputation**

## Commits

| Plan | Commit | Description |
|------|--------|-------------|
| 51-01 | `3ceab60` | feat(resilience): FailureReason enum + request_log migration + execute.ts wiring |
| 51-02 | `d478a8a` | feat(resilience): skills.yaml max_concurrent + gateway in-flight counter + overload response |

## Plan 51-01: FailureReason + request_log + execute.ts

**What shipped:**
- `FailureReason` union type in `src/types/index.ts`: `'bad_execution' | 'overload' | 'timeout' | 'auth_error' | 'not_found'`
- `failure_reason TEXT` column added to `request_log` via idempotent `ALTER TABLE` (same pattern as `skill_id`, `action_type`, `tier_invoked`)
- `insertRequestLog` and `getRequestLog` updated to include `failure_reason`
- `handleFailure` in `execute.ts` accepts `FailureReason` parameter (defaults to `'bad_execution'`)
- All `handleFailure` call sites wired with semantically correct reason values
- Self-request guard path tagged as `'auth_error'`
- 12 new tests across `request-log.test.ts` and `execute.test.ts`

**Key insight documented:** `updateReputation` uses a stored EWA counter on `capability_cards`, not a live query over `request_log`. The overload path in 51-02 simply skips calling it — no SQL filter needed.

## Plan 51-02: capacity.max_concurrent + Gateway overload enforcement

**What shipped:**
- `CapacitySchema` (`max_concurrent: positive int, optional`) added to all 5 SkillConfig schemas
- `inFlight = new Map<string, number>()` initialized per `createGatewayServer()` call
- Pre-execution check: if `inFlight[skillId] >= max_concurrent`, reject with:
  ```json
  { "error": "overload", "retry_after_ms": 5000 }
  ```
- Overload rejection logs `request_log` row with `failure_reason: 'overload'`, `credits_charged: 0` — `updateReputation` NOT called
- inFlight decremented in `finally` block — guaranteed no leaks on any path
- Skills without `capacity.max_concurrent` have no concurrency limit enforced
- 11 new tests across `skill-config.test.ts` and `server.test.ts`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] getRequestLog second SELECT branch missing failure_reason (51-01 Task 1)**
- The `replace_all` edit only updated one SELECT. The second unconditional branch was left without `failure_reason`.
- Fix: Added `failure_reason` to second SELECT explicitly. Verified via test.

**2. [Rule 1 - Bug] execute.test.ts not_found test triggered wrong code path (51-01 Task 2)**
- Test used a v2 card with `skills[]`, so `resolvedSkillId` was set before `listSkills()` check, returning `'bad_execution'` instead of `'not_found'`.
- Fix: Test updated to use a v1 card (no `skills[]`). Verified via test.

**3. [Rule 1 - Bug] Missing typeof guard on getSkillConfig caused 500s in P2P tests (51-02 Task 2)**
- Existing P2P test mock executors don't implement `getSkillConfig`. Calling it threw TypeError, causing 500 responses.
- Fix: Added `typeof skillExecutor.getSkillConfig === 'function'` guard. All P2P tests pass (12/12).

---

**Total deviations:** 3 auto-fixed (all Rule 1 bugs)
**Impact:** All essential for correctness and backward compatibility. No scope creep.

## Test Results

- `src/registry/request-log.test.ts`: 56 tests pass
- `src/gateway/execute.test.ts`: 13 tests pass
- `src/skills/skill-config.test.ts`: 58 tests pass (including 7 new capacity tests)
- `src/gateway/server.test.ts`: 106 tests pass (including 4 new overload tests)
- Total Phase 51 tests: 233 pass

---
*Phase: 51-production-resilience*
*Completed: 2026-03-24*
