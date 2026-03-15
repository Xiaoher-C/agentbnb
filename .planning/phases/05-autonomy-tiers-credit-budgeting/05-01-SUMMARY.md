---
phase: 05-autonomy-tiers-credit-budgeting
plan: 01
subsystem: autonomy
tags: [autonomy-tiers, sqlite, audit-log, cli-config, typescript]

# Dependency graph
requires:
  - phase: 04-agent-runtime-multi-skill-foundation
    provides: request_log table with skill_id column, AgentBnBConfig pattern, CLI config commands
provides:
  - getAutonomyTier() pure function classifying credit amounts into tiers 1/2/3
  - DEFAULT_AUTONOMY_CONFIG (Tier 3 by default — all autonomous actions blocked)
  - AutonomyEvent discriminated union (6 event variants for auto_share + auto_request x 3 tiers)
  - insertAuditEvent() writing tier_invoked + action_type to request_log
  - action_type and tier_invoked columns in request_log table
  - AgentBnBConfig.autonomy?: AutonomyConfig field
  - CLI config set tier1/tier2 + config get tier1/tier2 commands
affects:
  - 05-02 (BudgetManager will call getAutonomyTier to gate auto-request escrow holds)
  - 06 (idle-share loop calls insertAuditEvent for every auto_share/auto_share_notify event)
  - 07 (auto-request loop calls insertAuditEvent for every auto_request* event)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ALTER TABLE ADD COLUMN with try/catch for idempotent schema migrations"
    - "Discriminated union AutonomyEvent type for exhaustive event handling"
    - "DEFAULT_AUTONOMY_CONFIG = {0, 0} enforces Tier 3 until owner opts in"

key-files:
  created:
    - src/autonomy/tiers.ts
    - src/autonomy/tiers.test.ts
  modified:
    - src/registry/request-log.ts
    - src/cli/config.ts
    - src/cli/index.ts

key-decisions:
  - "DEFAULT_AUTONOMY_CONFIG sets both thresholds to 0 — all amounts satisfy amount >= 0 >= tier2_max_credits, so every call returns Tier 3 until owner configures thresholds"
  - "Tier boundary: amount < tier1 => Tier 1, amount < tier2 => Tier 2, else Tier 3 (strict less-than for tier1, strict less-than for tier2)"
  - "Share events use card_id='system' since they don't reference a specific capability card"
  - "warn (but allow) when tier1 >= tier2 — user can set inconsistent values, gets feedback"

patterns-established:
  - "Autonomy gate pattern: always call getAutonomyTier(cost, config) before any autonomous action in Phases 6-7"
  - "Audit trail pattern: insertAuditEvent writes to request_log so audit history is co-located with normal request history"

requirements-completed: [TIER-01, TIER-02, TIER-03, TIER-04]

# Metrics
duration: 4min
completed: 2026-03-15
---

# Phase 05 Plan 01: Autonomy Tiers Module Summary

**getAutonomyTier() + DEFAULT_AUTONOMY_CONFIG (Tier 3 by default) + insertAuditEvent() + CLI tier1/tier2 config commands wired into request_log audit trail**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-15T11:40:32Z
- **Completed:** 2026-03-15T11:43:52Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `src/autonomy/tiers.ts` with `getAutonomyTier()`, `DEFAULT_AUTONOMY_CONFIG`, `AutonomyEvent` discriminated union, and `insertAuditEvent()` — the foundational gate for all Phase 6-7 autonomous behaviors
- Extended `request-log.ts` with `action_type` + `tier_invoked` columns (idempotent ALTER TABLE pattern), updated insert/select SQL, and updated the `RequestLogEntry` interface
- Wired `AgentBnBConfig.autonomy?: AutonomyConfig` into config.ts and `config set tier1/tier2` + `config get tier1/tier2` into the CLI with integer validation and cross-threshold warnings
- 16 unit tests covering all tier boundaries, DEFAULT_AUTONOMY_CONFIG Tier 3 enforcement for all amounts, and all 4 representative audit event variants

## Task Commits

Each task was committed atomically:

1. **Task 1: Create autonomy tiers module + extend config + add audit columns** - `149a516` (feat + test, TDD)
2. **Task 2: Wire tier config commands into CLI** - `313f7c2` (feat)

## Files Created/Modified

- `/Users/leyufounder/Documents/Github/agentbnb/src/autonomy/tiers.ts` - getAutonomyTier(), DEFAULT_AUTONOMY_CONFIG, AutonomyEvent union, insertAuditEvent()
- `/Users/leyufounder/Documents/Github/agentbnb/src/autonomy/tiers.test.ts` - 16 unit tests for all tier boundaries and audit event writes
- `/Users/leyufounder/Documents/Github/agentbnb/src/registry/request-log.ts` - Added action_type + tier_invoked columns to schema, interface, insert SQL, and select SQL
- `/Users/leyufounder/Documents/Github/agentbnb/src/cli/config.ts` - Added autonomy?: AutonomyConfig to AgentBnBConfig
- `/Users/leyufounder/Documents/Github/agentbnb/src/cli/index.ts` - config set tier1/tier2 + config get tier1/tier2 with integer validation

## Decisions Made

- DEFAULT_AUTONOMY_CONFIG = {tier1_max_credits: 0, tier2_max_credits: 0} ensures every credit amount (including 0) satisfies `amount >= 0`, returning Tier 3. Owner must explicitly run `agentbnb config set tier1 10` to enable Tier 1.
- Tier boundary uses strict less-than: `amount < tier1` => Tier 1, `amount < tier2` => Tier 2, else Tier 3. Boundary values (equal to threshold) fall to the next tier, which matches "up to but not including" semantics.
- Share events (auto_share, auto_share_notify, auto_share_pending) use `card_id = 'system'` since they publish idle capacity, not requesting a specific peer's card.
- Cross-threshold warning is non-blocking — user gets a console.warn but saveConfig still runs. This allows experimenting with both thresholds before finalizing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `getAutonomyTier()` is ready for BudgetManager integration in Plan 05-02
- `insertAuditEvent()` is ready for idle-share loop (Phase 6) and auto-request loop (Phase 7)
- `agentbnb config set tier1 10 && agentbnb config set tier2 50` enables Tier 1 + Tier 2 autonomy

## Self-Check: PASSED

All 5 files found on disk. Both task commits (149a516, 313f7c2) verified in git log.

---
*Phase: 05-autonomy-tiers-credit-budgeting*
*Completed: 2026-03-15*
