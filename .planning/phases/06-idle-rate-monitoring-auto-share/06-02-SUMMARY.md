---
phase: 06-idle-rate-monitoring-auto-share
plan: 02
subsystem: autonomy
tags: [croner, sqlite, idle-rate, auto-share, tiers, cron]

# Dependency graph
requires:
  - phase: 06-01
    provides: getSkillRequestCount, updateSkillAvailability, updateSkillIdleRate in registry
  - phase: 05-autonomy-tiers-credit-budgeting
    provides: getAutonomyTier, insertAuditEvent, AutonomyConfig, DEFAULT_AUTONOMY_CONFIG
  - phase: 04-agent-runtime-multi-skill-foundation
    provides: AgentRuntime.registerJob() + registryDb handle
provides:
  - IdleMonitor class with croner Cron job that polls every 60s
  - Per-skill idle_rate computation from request_log data
  - Tier-gated auto-share: Tier 1 silent flip, Tier 2 flip+notify, Tier 3 pending-only
  - IdleMonitor wired into `agentbnb serve` with clean shutdown via registerJob()
  - `agentbnb config set idle-threshold <0-1>` for owner control
affects: [07-auto-request-budget-guard, 08-peer-registry-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IdleMonitor: croner Cron constructed paused, resumed on start(), registered with AgentRuntime for lifecycle"
    - "poll() uses listCards(db, owner) + per-skill getSkillRequestCount + updateSkillIdleRate every iteration"
    - "Auto-share gate: getAutonomyTier(0, config) with 0 credits — Tier 1 needs tier1_max>0, Tier 2 needs tier2_max>0"

key-files:
  created:
    - src/autonomy/idle-monitor.ts
    - src/autonomy/idle-monitor.test.ts
  modified:
    - src/cli/index.ts

key-decisions:
  - "IdleMonitor passes 0 credits to getAutonomyTier() — auto-share is a zero-cost action, tier config controls gating"
  - "Cron constructed with paused:true and fire-and-forget void this.poll() — croner callbacks are not async-aware"
  - "v1.0 cards detected via Array.isArray(maybeV2.skills) — skip without error, no schema change needed"
  - "idle-threshold stored as idle_threshold in config JSON (hyphen→underscore convention)"

patterns-established:
  - "TDD: write failing tests first against interface contract, then implement to green"
  - "IdleMonitor.poll() is directly callable in tests — no timer mocking needed"
  - "Pre-existing hub/ React test failures are out-of-scope (jsdom environment issue, not caused by backend changes)"

requirements-completed: [IDLE-01, IDLE-03, IDLE-04, IDLE-05]

# Metrics
duration: 12min
completed: 2026-03-15
---

# Phase 06 Plan 02: IdleMonitor — Idle Rate Computation and Tier-Gated Auto-Share Summary

**IdleMonitor class polls every 60s via croner, computes per-skill idle_rate from request_log, and auto-shares idle capacity gated by Tier 1/2/3 autonomy config — wired into `agentbnb serve` with clean shutdown.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-15T12:45:01Z
- **Completed:** 2026-03-15T12:57:00Z
- **Tasks:** 2 of 3 (Task 3 is checkpoint:human-verify, awaiting confirmation)
- **Files modified:** 3

## Accomplishments

- Built IdleMonitor with croner Cron job; poll() computes idle_rate = Math.max(0, 1 - count/capacity) per skill
- Tier-gated auto-share: Tier 1 flips silently, Tier 2 flips + inserts audit event, Tier 3 pending-only (no flip)
- 10/10 behavior tests pass covering all tier paths, per-skill independence, clamping, lifecycle, v1/v2 card handling
- Wired into `agentbnb serve`: IdleMonitor starts after runtime.start(), Cron job registered for clean Ctrl+C shutdown
- Added `agentbnb config set idle-threshold <0-1>` for owner-configurable idle threshold

## Task Commits

Each task was committed atomically:

1. **Task 1: Build IdleMonitor class with tests** - `5729cda` (feat + test, TDD)
2. **Task 2: Wire IdleMonitor into agentbnb serve command** - `8a9c903` (feat)

_Task 3 (checkpoint:human-verify) pending human confirmation._

## Files Created/Modified

- `src/autonomy/idle-monitor.ts` — IdleMonitor class (IdleMonitorOptions interface, start/getJob/poll methods, Cron lifecycle)
- `src/autonomy/idle-monitor.test.ts` — 10 behavior tests covering all plan-specified scenarios
- `src/cli/index.ts` — Import + instantiation of IdleMonitor in serve command; idle-threshold config set/get

## Decisions Made

- Passed `0` to `getAutonomyTier()` for auto-share actions — sharing idle capacity costs 0 credits, but tier config still gates it
- Constructed Cron with `{ paused: true }` and used `void this.poll()` in callback (fire-and-forget per croner's non-async-aware API)
- Detected v1.0 cards via `Array.isArray(maybeV2.skills)` — clean narrowing without schema changes
- Stored idle-threshold as `idle_threshold` in config JSON (hyphen in CLI key, underscore in JSON storage — matches existing pattern for `credit_db_path` etc.)

## Deviations from Plan

None — plan executed exactly as written. The idle-threshold config set/get was listed as "optional per research" but was included as planned; it's minimal effort and gives owners direct control.

## Issues Encountered

None. The pre-existing 43 hub/ React test failures (jsdom `document is not defined`) were present before this plan and are out of scope (logged for awareness, not fixed).

## Self-Check

| Check | Result |
|-------|--------|
| `src/autonomy/idle-monitor.ts` exists | FOUND |
| `src/autonomy/idle-monitor.test.ts` exists | FOUND |
| Commit 5729cda exists | FOUND |
| Commit 8a9c903 exists | FOUND |
| 10 idle-monitor tests pass | PASSED |

## Self-Check: PASSED

## Next Phase Readiness

- IdleMonitor foundation complete — Phase 7 (auto-request) can use same AgentRuntime pattern
- Task 3 (human-verify checkpoint) requires: `pnpm test`, then `agentbnb serve` showing log message, then Ctrl+C for clean shutdown
- No blockers for continuation

---
*Phase: 06-idle-rate-monitoring-auto-share*
*Completed: 2026-03-15*
