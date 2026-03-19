---
phase: 33-conductor-dual-role
plan: 01
subsystem: conductor
tags: [conductor, relay, websocket, multi-card, config]

requires:
  - phase: 30-fix-upstream
    provides: upsertCard() with AnyCardSchema for v2.0 cards via relay
  - phase: 31-fix-downstream
    provides: async matchSubTasks() with remote fallback, PipelineOrchestrator relay support
provides:
  - conductor.public config toggle for dual-role conductor
  - multi-card relay registration (cards array in RegisterMessage)
  - owner-specific buildConductorCard(owner) with deterministic IDs
  - serve command wiring for conductor card relay push
affects: [phase-34-mcp-server, phase-36-hub-agent]

tech-stack:
  added: []
  patterns: [multi-card relay registration, owner-specific deterministic card IDs]

key-files:
  created: []
  modified:
    - src/cli/config.ts
    - src/conductor/card.ts
    - src/relay/types.ts
    - src/relay/websocket-relay.ts
    - src/relay/websocket-client.ts
    - src/cli/index.ts
    - src/conductor/card.test.ts
    - src/relay/websocket-relay.test.ts
    - src/cli/index.test.ts

key-decisions:
  - "buildConductorCard(owner) uses SHA-256 of owner for deterministic UUID-shaped card ID"
  - "cards array in RegisterMessage is optional for backward compat; card field stays required"
  - "handleRegister upserts primary card first, then additional cards; logs agent_joined once"

patterns-established:
  - "Multi-card registration: primary card via card field, extras via cards array"
  - "Owner-specific card IDs: SHA-256 hash of owner formatted as UUID v4 shape"

requirements-completed: [COND-01, COND-02, COND-03]

duration: 5min
completed: 2026-03-19
---

# Phase 33 Plan 01: Conductor Dual Role Summary

**Conductor dual-role: agent pushes conductor card via relay when conductor.public=true, multi-card registration protocol, owner-specific deterministic card IDs**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-19T07:07:04Z
- **Completed:** 2026-03-19T07:12:11Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added `conductor?: { public: boolean }` to AgentBnBConfig with CLI config set/get
- Extended relay protocol with optional `cards` array for multi-card registration (backward compatible)
- `buildConductorCard(owner)` produces owner-specific conductor cards with deterministic IDs
- Serve command wires conductor card into relay push when conductor.public=true
- 903 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Config + relay protocol for multi-card registration** - `7dab40d` (test: RED), `46d0c64` (feat: GREEN)
2. **Task 2: Wire serve command + config CLI** - `308e80c` (test: RED), `f4ce8bc` (feat: GREEN)

_TDD tasks have RED + GREEN commits_

## Files Created/Modified
- `src/cli/config.ts` - Added conductor?: { public: boolean } to AgentBnBConfig
- `src/conductor/card.ts` - buildConductorCard(owner?) with deterministic owner-specific IDs
- `src/relay/types.ts` - RegisterMessageSchema with optional cards array
- `src/relay/websocket-relay.ts` - handleRegister processes multiple cards from cards array
- `src/relay/websocket-client.ts` - RelayClientOptions.cards + send in register message
- `src/cli/index.ts` - config set/get conductor-public + serve command conductor card wiring
- `src/conductor/card.test.ts` - Tests for buildConductorCard(owner) owner-specific behavior
- `src/relay/websocket-relay.test.ts` - Tests for multi-card registration + backward compat
- `src/cli/index.test.ts` - Tests for conductor-public config set/get

## Decisions Made
- buildConductorCard(owner) uses SHA-256 of owner string for deterministic UUID-shaped card ID, so each agent gets a unique conductor card ID
- cards array in RegisterMessage is optional; existing card field stays required for backward compat
- handleRegister upserts primary card first, then iterates additional cards; only logs agent_joined once for the primary card
- Local conductor card registration also uses raw SQL (same pattern as relay upsertCard) to handle v2.0 cards

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Conductor dual role complete. Agent can self-use conductor (default) or publish it publicly.
- Ready for Phase 34 (MCP Server) and Phase 35 (OpenAPI) which are independent.
- PipelineOrchestrator relay execution confirmed working via Phase 31 tests (109 conductor+relay tests pass).

## Self-Check: PASSED

All 9 modified files verified present. All 4 task commits verified in git log.

---
*Phase: 33-conductor-dual-role*
*Completed: 2026-03-19*
