---
phase: 11-repo-housekeeping
plan: 03
subsystem: docs
tags: [design-bible, agent-native, philosophy, protocol, documentation]

# Dependency graph
requires: []
provides:
  - AGENT-NATIVE-PROTOCOL.md at repo root — authoritative design bible for AgentBnB agent-first philosophy
  - README.md Core Idea section links to AGENT-NATIVE-PROTOCOL.md
affects: [README, CLAUDE.md, all codebase references to agent-native design]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Design bible pattern: single authoritative document defines the philosophy, others reference it"

key-files:
  created:
    - AGENT-NATIVE-PROTOCOL.md
  modified:
    - README.md

key-decisions:
  - "AGENT-NATIVE-PROTOCOL.md is 9 sections covering: core insight, economic model, capability cards, autonomy tiers, idle detection, auto-request, human role, OpenClaw integration, protocol principles"
  - "README.md Core Idea section updated to link to AGENT-NATIVE-PROTOCOL.md — satisfies key_links requirement"
  - "Document written in declarative prose, no implementation details (file paths, function names, SQL), self-contained for readers with no prior context"

patterns-established:
  - "Design Test: 'Does this feature require human intervention? If yes, redesign so the agent can do it autonomously'"
  - "Safe-by-default: fresh installs are Tier 3 (ask before everything) — non-negotiable principle"

requirements-completed: [DOC-03]

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 11 Plan 03: Repo Housekeeping — AGENT-NATIVE-PROTOCOL.md Summary

**Agent-native design bible (173 lines, 9 sections) committed at repo root, resolving the STATE.md blocker and providing the authoritative document referenced throughout the codebase**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-16T11:10:05Z
- **Completed:** 2026-03-16T11:12:23Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Created AGENT-NATIVE-PROTOCOL.md at repo root — 173 lines, 9 sections, self-contained
- Covers all required topics: core insight, economic model, capability cards, autonomy tiers, idle detection, auto-request, human role, OpenClaw integration, protocol principles
- Added link from README.md "Core Idea" section to AGENT-NATIVE-PROTOCOL.md
- Resolved the blocker documented in STATE.md ("AGENT-NATIVE-PROTOCOL.md not yet in repo root")

## Task Commits

Each task was committed atomically:

1. **Task 1: Create AGENT-NATIVE-PROTOCOL.md design bible** — `af38d56` (docs)

## Files Created/Modified

- `/Users/xiaoher/Documents/GitHub/agentbnb/AGENT-NATIVE-PROTOCOL.md` — Authoritative agent-native protocol design bible with 9 sections covering the full design philosophy
- `/Users/xiaoher/Documents/GitHub/agentbnb/README.md` — Added link to AGENT-NATIVE-PROTOCOL.md in "Core Idea" section

## Decisions Made

- Document written in declarative prose without implementation details (file paths, function signatures, SQL), so it remains stable across refactors
- Section on "The Human's Role" explicitly lists the four human responsibilities to anchor the boundary between owner policy-setting and agent autonomy
- Added link to README.md Core Idea section as required by plan `key_links` spec — CLAUDE.md already had the link

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three plans in Phase 11 (Repo Housekeeping) are now complete
- AGENT-NATIVE-PROTOCOL.md is committed and linked from both CLAUDE.md and README.md
- The blocker in STATE.md is resolved
- v2.1 milestone preparation is complete

---
*Phase: 11-repo-housekeeping*
*Completed: 2026-03-16*
