---
phase: 02-cold-start
plan: 03
subsystem: cli
tags: [fastify, cli, commander, registry, cors]

requires:
  - phase: 02-cold-start/02-01
    provides: updateReputation() EWA algorithm in registry store
  - phase: 02-cold-start/02-02
    provides: createRegistryServer() Fastify HTTP server with marketplace endpoints
provides:
  - CLI serve command starts both gateway (7700) and registry (7701) in one process
  - --registry-port flag for port override or disable (0)
  - Graceful shutdown for both servers
  - R-013, R-014, R-015 formalized in REQUIREMENTS.md
affects: [03-growth, cli]

tech-stack:
  added: []
  patterns: [dual-server single-process, shared-db across servers]

key-files:
  created: []
  modified:
    - src/cli/index.ts
    - src/cli/index.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Registry server closed before gateway in graceful shutdown — registry is dependent, gateway is primary"
  - "ReturnType<typeof createRegistryServer> used for type instead of importing FastifyInstance — keeps coupling to the factory function"

patterns-established:
  - "Dual-server CLI pattern: single serve command manages multiple Fastify instances sharing one SQLite DB"

requirements-completed: [R-013, R-014, R-015]

duration: 5min
completed: 2026-03-14
---

# Phase 2 Plan 03: CLI Registry Integration Summary

**CLI serve command wires registry server on port 7701 alongside gateway, with --registry-port flag and shared SQLite DB**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-13T17:00:25Z
- **Completed:** 2026-03-13T17:05:25Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- CLI `agentbnb serve` now starts both gateway (port 7700) and public registry (port 7701) in a single process
- `--registry-port` flag allows changing the port or disabling registry with `--registry-port 0`
- Both servers share the same SQLite database instance (no WAL lock issues)
- Graceful shutdown properly closes registry server before gateway
- R-013 (Web-Based Registry), R-014 (Reputation System), R-015 (Marketplace) formalized in REQUIREMENTS.md

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire registry server into CLI serve command** - `4c43ca1` (feat, TDD)
2. **Task 2: Formalize R-013, R-014, R-015 in REQUIREMENTS.md** - `ad5ba73` (docs)
3. **Task 3: Human verify end-to-end Phase 2 flow** - checkpoint, human-approved

## Files Created/Modified
- `src/cli/index.ts` - Added createRegistryServer import, --registry-port option, dual-server startup and graceful shutdown
- `src/cli/index.test.ts` - Added 3 tests for --registry-port option parsing and defaults
- `.planning/REQUIREMENTS.md` - Added Phase 2 requirements R-013, R-014, R-015 with acceptance criteria

## Decisions Made
- Registry server closed before gateway in graceful shutdown order (registry depends on gateway being primary)
- Used `ReturnType<typeof createRegistryServer>` for type annotation to avoid importing FastifyInstance directly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2 Cold Start is complete: reputation system, public registry server, and CLI integration all working
- Ready for Phase 3 (Growth) or further Phase 2 plans (plan 04 if defined)
- All endpoints accessible: gateway on 7700, registry on 7701

---
*Phase: 02-cold-start*
*Completed: 2026-03-14*
