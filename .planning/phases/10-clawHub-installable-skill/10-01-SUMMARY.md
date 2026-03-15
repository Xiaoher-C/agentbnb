---
phase: 10-clawHub-installable-skill
plan: 01
subsystem: openclaw
tags: [bootstrap, agentruntime, gateway, idle-monitor, soul-sync, openclaw, lifecycle]

# Dependency graph
requires:
  - phase: runtime
    provides: AgentRuntime with DB lifecycle, job registration, shutdown
  - phase: gateway
    provides: createGatewayServer Fastify HTTP server
  - phase: autonomy
    provides: IdleMonitor background loop
  - phase: openclaw
    provides: publishFromSoulV2 card publishing from SOUL.md
provides:
  - activate() single-call entry point that brings an agent fully online
  - deactivate() idempotent teardown function
  - BootstrapConfig and BootstrapContext public interfaces
  - skills/agentbnb/bootstrap.ts as the ClaWHub installable skill entry point
affects:
  - 10-clawHub-installable-skill
  - 11-repo-housekeeping

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Single-call lifecycle: activate/deactivate pattern wrapping all subsystems
    - Bootstrap delegates 100% to existing src/ modules — no business logic in bootstrap.ts
    - Idempotent teardown via try/catch wrapping both close and shutdown calls

key-files:
  created:
    - skills/agentbnb/bootstrap.ts
    - skills/agentbnb/bootstrap.test.ts
  modified: []

key-decisions:
  - "bootstrap.ts uses try/catch in deactivate() to make double-call idempotent (not relying on runtime.isDraining)"
  - "gatewayToken defaults to randomUUID() — zero-config security for OpenClaw installs"
  - "handlerUrl defaults to http://localhost:{gatewayPort} — sensible for single-machine deployments"
  - "FILE_NOT_FOUND error code used for missing SOUL.md — consistent with AgentBnBError conventions"

patterns-established:
  - "Single-call lifecycle: one activate() call wires all subsystems, one deactivate() tears them down"
  - "Bootstrap file as thin orchestrator — all logic in src/, bootstrap only wires them together"

requirements-completed: [CLW-01]

# Metrics
duration: 3min
completed: 2026-03-16
---

# Phase 10 Plan 01: Bootstrap Entry Point Summary

**Single activate()/deactivate() lifecycle wrapper wiring AgentRuntime, publishFromSoulV2, createGatewayServer, and IdleMonitor into a zero-config ClaWHub skill entry point**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-15T19:41:03Z
- **Completed:** 2026-03-15T19:44:23Z
- **Tasks:** 1 (TDD: RED + GREEN + REFACTOR)
- **Files modified:** 2

## Accomplishments

- `bootstrap.ts` exports `activate()` and `deactivate()` with zero additional setup beyond config
- TDD flow: 14 failing tests (RED) → implementation passes all 14 (GREEN) → refactored to 113 lines (REFACTOR)
- `activate()` wires the correct sequence: `AgentRuntime` → `runtime.start()` → `publishFromSoulV2` → `gateway.listen()` → `IdleMonitor.start()` → `registerJob()`
- `deactivate()` tears down in reverse-safe order: `gateway.close()` → `runtime.shutdown()`, idempotent via try/catch

## Task Commits

Each task was committed atomically:

1. **Task 1 RED — Failing tests** - `0b0cf4b` (test)
2. **Task 1 GREEN — Implementation** - `4d1fd3f` (feat)
3. **Task 1 REFACTOR — Trim to 113 lines** - `d69b5b3` (refactor)

## Files Created/Modified

- `skills/agentbnb/bootstrap.ts` — activate() and deactivate() lifecycle entry point (113 lines)
- `skills/agentbnb/bootstrap.test.ts` — 14 unit tests covering full contract via mocked src/ modules

## Decisions Made

- `deactivate()` uses try/catch rather than an explicit `isDraining` check — simpler and covers the Fastify `.close()` path as well as runtime double-shutdown
- `gatewayToken` defaults to `randomUUID()` — eliminates mandatory config field while keeping security intact
- `handlerUrl` defaults to `http://localhost:{gatewayPort}` — covers the common single-machine OpenClaw install case

## Deviations from Plan

None - plan executed exactly as written.

One minor test deviation: the initial test file used vi.mock factories that referenced module-level variables — a Vitest hoisting constraint. Fixed by moving mock data inside factory functions. This is a test implementation detail, not a behavioral deviation.

## Issues Encountered

Vitest hoisting constraint: `vi.mock()` factories are hoisted to the top of the file, so they cannot reference module-level `const` declarations. Resolved by moving all mock data into the factory closures and using `beforeEach` to re-configure per-test mock implementations after `vi.clearAllMocks()`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `bootstrap.ts` is the entry point for the ClaWHub installable skill — Phase 10 plans 03+ can reference it
- `activate()` and `deactivate()` are importable via `skills/agentbnb/bootstrap.js` from any OpenClaw skill host
- No blockers for remaining Phase 10 plans

---
*Phase: 10-clawHub-installable-skill*
*Completed: 2026-03-16*

## Self-Check: PASSED

- FOUND: skills/agentbnb/bootstrap.ts
- FOUND: skills/agentbnb/bootstrap.test.ts
- FOUND: .planning/phases/10-clawHub-installable-skill/10-01-SUMMARY.md
- FOUND: 0b0cf4b (test RED commit)
- FOUND: 4d1fd3f (feat GREEN commit)
- FOUND: d69b5b3 (refactor commit)
