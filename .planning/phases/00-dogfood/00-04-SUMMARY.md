---
phase: 00-dogfood
plan: 04
subsystem: cli
tags: [commander, config, sqlite, gateway, credits, registry]

# Dependency graph
requires:
  - phase: 00-dogfood/00-01
    provides: openDatabase, insertCard, searchCards, filterCards — SQLite registry CRUD and FTS5 search
  - phase: 00-dogfood/00-02
    provides: openCreditDb, getBalance, bootstrapAgent, getTransactions — credit ledger operations
  - phase: 00-dogfood/00-03
    provides: createGatewayServer, requestCapability — gateway server and outbound client
provides:
  - Commander CLI with all 6 subcommands wired to real implementations
  - Config module (loadConfig/saveConfig) for ~/.agentbnb/config.json management
  - agentbnb init: creates identity, bootstraps 100 credits, writes config
  - agentbnb publish: validates CapabilityCard via Zod, inserts into registry
  - agentbnb discover: FTS5 search or list-all with table and JSON output
  - agentbnb request: calls gateway client with bearer token
  - agentbnb status: shows balance, escrows, recent transactions
  - agentbnb serve: starts Fastify gateway with graceful shutdown
affects:
  - 00-05 (OpenClaw integration — uses CLI directly for dogfood loop)
  - Any future agent automation that calls CLI commands

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AGENTBNB_DIR env var overrides config dir for test isolation
    - program.parseAsync(process.argv) for proper async Commander execution
    - try/finally db.close() ensures connections are always released
    - ReturnType<typeof fn> for inferring return types without re-declaring

key-files:
  created:
    - src/cli/config.ts
    - src/cli/index.test.ts
  modified:
    - src/cli/index.ts
    - src/index.ts

key-decisions:
  - "AGENTBNB_DIR env var for config dir allows test isolation without mocking fs"
  - "program.parseAsync instead of program.parse — required for top-level await async actions (Commander Pitfall 1)"
  - "status command queries credit_escrow table directly for held escrows — no separate escrow query API needed at CLI level"
  - "Gateway stubs (server/client/auth) were already committed from plan 03; plan 04 re-used them"

patterns-established:
  - "Config isolation via env var: AGENTBNB_DIR overrides default ~/.agentbnb path for test directories"
  - "CLI error pattern: console.error + process.exit(1) for all unrecoverable errors"
  - "Dual output mode: all commands support --json flag for machine-readable output alongside human-readable tables"

requirements-completed: [R-003]

# Metrics
duration: 15min
completed: 2026-03-13
---

# Phase 0 Plan 04: CLI Implementation Summary

**Commander CLI with 6 subcommands wired to registry, credits, and gateway — init creates agent identity with 100 credit bootstrap, publish/discover integrate FTS5 registry, status queries ledger and escrows, serve starts Fastify gateway**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-13T21:50:00Z
- **Completed:** 2026-03-13T22:05:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Config module `src/cli/config.ts` with AGENTBNB_DIR env override for test isolation
- All 6 CLI commands wired to real implementations: init, publish, discover, request, status, serve
- 17 integration tests covering every command with temp directories and real SQLite databases
- All commands support --json flag for machine-readable output and --help
- src/index.ts expanded with re-exports for registry, credit, and gateway modules

## Task Commits

Each task was committed atomically:

1. **Task 1: Create config module and wire init/publish/discover commands** - `9dc4f6a` (feat)
2. **Task 2: Wire request, status, and serve commands** - `49d372b` (feat)

**Plan metadata:** (created after this summary)

## Files Created/Modified
- `src/cli/config.ts` - AgentBnBConfig interface, loadConfig, saveConfig, getConfigDir with AGENTBNB_DIR override
- `src/cli/index.ts` - Full Commander CLI with all 6 commands, async actions, proper error handling
- `src/cli/index.test.ts` - 17 integration tests using temp dirs for full end-to-end CLI coverage
- `src/index.ts` - Expanded re-exports: registry store, matcher, credit ledger, gateway server

## Decisions Made
- AGENTBNB_DIR env var for config dir override — cleanest isolation for integration tests without any mocking
- `program.parseAsync(process.argv)` — required for top-level await to work with Commander async actions
- Queried credit_escrow table directly in status command — no need for a separate getHeldEscrows() API at this phase
- Gateway stubs (server/client/auth) were already committed from plan 03 execution; plan 04 re-used them as-is

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created gateway stubs before realizing plan 03 was already committed**
- **Found during:** Task 1 (initial setup)
- **Issue:** Gateway directory appeared empty (ls showed no results), wrote new gateway files
- **Fix:** Discovered gateway files (server.ts, client.ts, auth.ts) were already committed from plan 03; new writes were redundant but consistent with existing implementations
- **Files modified:** src/gateway/auth.ts, src/gateway/server.ts, src/gateway/client.ts
- **Verification:** pnpm typecheck and pnpm build both pass; 78 tests pass
- **Committed in:** n/a — pre-existing commits from plan 03 used; redundant writes were overwritten by linter

---

**Total deviations:** 1 minor (discovered existing gateway files already present from plan 03)
**Impact on plan:** No scope creep. The re-written gateway stubs matched the existing implementations exactly.

## Issues Encountered
- `listCards` was accidentally imported in cli/index.ts but not used — TypeScript caught it immediately. Fixed by removing the unused import.
- Gateway files appeared untracked on first inspection but were already committed; the `ls` command on the gateway directory returned empty due to a shell issue, not missing files.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 CLI commands are functional and tested
- Ready for OpenClaw agent integration (plan 05)
- `agentbnb init --owner openclaw-agent-1` will set up the first agent
- `agentbnb publish <card.json>` ready to publish first capability cards
- `agentbnb serve` ready to start the gateway for agent-to-agent communication

---
*Phase: 00-dogfood*
*Completed: 2026-03-13*
