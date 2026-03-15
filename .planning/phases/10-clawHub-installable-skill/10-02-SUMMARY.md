---
phase: 10-clawHub-installable-skill
plan: "02"
subsystem: infra
tags: [bash, openclaw, heartbeat, install, autonomy]

# Dependency graph
requires:
  - phase: 10-clawHub-installable-skill
    provides: SKILL.md manifest and OpenClaw skill adapters (gateway, auto-share, auto-request, credit-mgr)
provides:
  - install.sh post-install automation script (executable, 5-step, idempotent)
  - HEARTBEAT.rules.md standalone autonomy rules template with agentbnb:start/end markers
affects: [agents installing agentbnb skill, HEARTBEAT.md generation, openclaw integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent bash install script with step-by-step progress and color output"
    - "HEARTBEAT.md marker format (agentbnb:start / agentbnb:end) for injectHeartbeatSection() compatibility"

key-files:
  created:
    - skills/agentbnb/install.sh
    - skills/agentbnb/HEARTBEAT.rules.md
  modified: []

key-decisions:
  - "install.sh uses pnpm-first with npm fallback for CLI install — matches project package manager preference"
  - "HEARTBEAT.rules.md uses example defaults (Tier 1:10, Tier 2:50, reserve:20) with a note pointing to agentbnb openclaw rules for real configured values"
  - "install.sh checks current AND parent directory for SOUL.md to handle cases where agent clones inside a subdirectory"

patterns-established:
  - "Idempotent bash installer: check-if-already-installed before every step"
  - "HEARTBEAT rules template: example defaults + pointer to dynamic CLI command"

requirements-completed: [CLW-02, CLW-04]

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 10 Plan 02: Install Script and HEARTBEAT Rules Summary

**Bash install.sh with 5-step zero-intervention setup + HEARTBEAT.rules.md template using agentbnb:start/end markers for direct injectHeartbeatSection() compatibility**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-15T19:40:50Z
- **Completed:** 2026-03-15T19:42:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created install.sh that handles the full "fresh agent joins AgentBnB network" flow — no human intervention required
- HEARTBEAT.rules.md uses exact same marker format as heartbeat-writer.ts so injectHeartbeatSection() can merge it without modification
- Script is idempotent: every step checks existing state before acting (CLI install, config init, SOUL.md sync)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create install.sh post-install automation** - `5949400` (feat)
2. **Task 2: Create HEARTBEAT.rules.md standalone autonomy rules** - `327a2d6` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `skills/agentbnb/install.sh` - Executable bash installer: checks Node.js >= 20 + pnpm, installs agentbnb CLI (pnpm → npm fallback), runs agentbnb init, syncs SOUL.md if found, prints color summary with next steps
- `skills/agentbnb/HEARTBEAT.rules.md` - Standalone autonomy rules template with agentbnb:start/end markers; includes sharing rules, requesting rules (3 tiers), credit management, and autonomy configuration CLI commands

## Decisions Made

- install.sh uses pnpm-first with npm fallback — consistent with project package manager preference without hard-requiring pnpm
- HEARTBEAT.rules.md contains example defaults (Tier 1: 10, Tier 2: 50, reserve: 20) rather than zeros, since this is a template meant to illustrate what the block looks like; a note points agents to `agentbnb openclaw rules` for real configured values
- install.sh checks both current directory and parent for SOUL.md — supports agents who clone into a subdirectory

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- install.sh and HEARTBEAT.rules.md complete the "one command install" story for the agentbnb OpenClaw skill
- skills/agentbnb/ package now has all required files: SKILL.md, gateway.ts, auto-share.ts, auto-request.ts, credit-mgr.ts, install.sh, HEARTBEAT.rules.md
- Ready for Phase 10 plans 03+ (bootstrap.ts entry point and packaging)

---
*Phase: 10-clawHub-installable-skill*
*Completed: 2026-03-16*
