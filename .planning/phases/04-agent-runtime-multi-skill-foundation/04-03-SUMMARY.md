---
phase: 04-agent-runtime-multi-skill-foundation
plan: 03
subsystem: gateway
tags: [fastify, skill_id, routing, escrow, json-rpc, multi-skill, backward-compat]

# Dependency graph
requires:
  - phase: 04-agent-runtime-multi-skill-foundation/04-02
    provides: CapabilityCardV2 schema with skills[] array, skill_id in request_log, SQLite migration
provides:
  - Gateway POST /rpc accepts { card_id, skill_id } and routes using per-skill pricing
  - Handler dispatch supports skill_id and card_id keys with fallback chain
  - request_log entries include skill_id when provided
  - v1.0 backward compat maintained (no skill_id falls back to first skill)
affects:
  - phase 5 (idle detection / per-skill tracking uses skill_id in request_log)
  - phase 6 (auto-requester uses skill_id when requesting specific skills)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "v2.0 skill lookup: cast card to CapabilityCardV2, check skills[] presence, find by skill_id or fallback to skills[0]"
    - "Handler dispatch priority: handlers[skill_id] ?? handlers[card_id] — skill key first, card key as fallback"
    - "resolvedSkillId propagated through all logging paths to ensure consistent skill_id in request_log"

key-files:
  created:
    - src/skills/handle-request.test.ts
  modified:
    - src/gateway/server.ts
    - src/gateway/server.test.ts
    - src/skills/handle-request.ts

key-decisions:
  - "Cast getCard() result to CapabilityCardV2 via unknown narrowing (check for skills[] property) — avoids changing store.ts return type which is owned by Plan 02"
  - "Handler dispatch: skill_id key tried first, falls back to card_id key — backward compat without any registry lookup"
  - "creditsNeeded resolved before escrow hold — always uses skill-level pricing for v2.0 cards, card-level for v1.0"

patterns-established:
  - "Pattern: resolvedSkillId is undefined for v1.0 cards and set to skill.id for v2.0 — null coalesce safely in all log calls"
  - "Pattern: TDD tests pre-written and failing (RED) before implementation (GREEN) confirmed for both files"

requirements-completed:
  - RUN-04

# Metrics
duration: 25min
completed: 2026-03-15
---

# Phase 4 Plan 03: Gateway skill_id Routing Summary

**Gateway updated to route multi-skill v2.0 cards via skill_id with per-skill escrow pricing, backward compat for v1.0 clients, and skill_id logged in all request_log entries**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-15T18:50:00Z
- **Completed:** 2026-03-15T19:15:00Z
- **Tasks:** 2 of 2 (Task 2 checkpoint human-verified — approved)
- **Files modified:** 4

## Accomplishments

- Gateway POST /rpc accepts `skill_id` in params; resolves the matching skill from the v2.0 card's `skills[]` array
- Per-skill `credits_per_call` used for escrow hold — not card-level pricing
- Invalid `skill_id` returns JSON-RPC error -32602 "Skill not found"
- Without `skill_id`, gateway falls back to `skills[0]` (v1.0 backward compat)
- `createRequestHandler` dispatch updated: tries `handlers[skill_id]` first, falls back to `handlers[card_id]`
- All `insertRequestLog` calls include `skill_id: resolvedSkillId`
- 34/34 tests pass across both test files

## Task Commits

1. **Task 1: Update gateway and handler to support skill_id routing** - `af65fa2` (feat)
2. **Task 2: Human verification — approved** - checkpoint passed (no code commit)

## Files Created/Modified

- `src/gateway/server.ts` — Added skill_id extraction, v2.0 skill resolution, per-skill pricing, skill_id in log entries (252 lines)
- `src/gateway/server.test.ts` — Added `insertCardV2`/`makeV2Card` helpers + 6 skill_id routing tests (Tests 1-5, 8)
- `src/skills/handle-request.ts` — Updated HandlerMap type comment, dispatch to try skill_id key first, then card_id fallback
- `src/skills/handle-request.test.ts` — Already-written TDD tests for skill_id dispatch (6 tests, were RED before implementation)

## Decisions Made

- Cast `getCard()` result via `unknown` narrowing (check `Array.isArray(rawCard['skills'])`) instead of changing `store.ts` return type — store.ts is owned by Plan 02 and the cast approach is minimal-change
- Handler dispatch uses `??` chain: `handlers[skillId] ?? handlers[cardId]` — simple, no registry lookup needed at handler layer
- `resolvedSkillId` initialized as `undefined` for v1.0 cards and populated for v2.0 — ensures safe null coalesce in log calls

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `makeCard` missing `spec_version: '1.0'`**
- **Found during:** Task 1 (adding test helpers to server.test.ts)
- **Issue:** IDE diagnostic reported `CapabilityCard` type requires `spec_version: '1.0'` but `makeCard` omitted it — TypeScript strict type error
- **Fix:** Added `spec_version: '1.0'` to `makeCard` return object
- **Files modified:** src/gateway/server.test.ts
- **Verification:** Type check passes clean, tests pass
- **Committed in:** af65fa2 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type bug)
**Impact on plan:** Necessary correctness fix for TypeScript strict mode. No scope creep.

## Issues Encountered

- Pre-existing hub component test failures (43 tests across 10 files) were present before this plan and are unrelated to gateway changes — confirmed by git stash verification
- `handle-request.test.ts` was already created with tests in RED state (Plan 02 pre-wrote them); my implementation turned them GREEN

## Next Phase Readiness

- Phase 4 is COMPLETE: AgentRuntime lifecycle (Plan 01) + multi-skill schema v2.0 (Plan 02) + gateway skill_id routing (this plan) — all human-verified
- Phase 5 (idle detection) can consume `skill_id` from request_log for per-skill idle rate tracking
- Phase 5 (auto-request loop) can use skill_id routing when targeting specific skills on multi-skill cards

## Self-Check: PASSED

All files found, commit af65fa2 confirmed.

---
*Phase: 04-agent-runtime-multi-skill-foundation*
*Completed: 2026-03-15*
