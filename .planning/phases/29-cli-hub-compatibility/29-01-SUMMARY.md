---
phase: 29-cli-hub-compatibility
plan: 01
subsystem: credits
tags: [credit-ledger, cli, hub, registry, sqlite, typescript]

# Dependency graph
requires:
  - phase: 26-credit-ledger-abstraction
    provides: CreditLedger interface + createLedger factory (LocalCreditLedger, RegistryCreditLedger)
  - phase: 27-registry-credit-endpoints
    provides: Registry HTTP credit API (grant, hold, settle, release, balance)
  - phase: 28-relay-credit-integration
    provides: Relay server-side credit hold/settle/release
provides:
  - CLI init grants 50cr via Registry and displays registry_balance
  - CLI status queries CreditLedger (Registry or local SQLite)
  - CLI request uses CreditLedger for direct remote escrow (not relay path)
  - CLI publish enforces 1 credit minimum per call
  - Hub GET /me returns balance from CreditLedger direct DB mode
  - Hub GET /me/transactions returns history from CreditLedger direct DB mode
affects:
  - frontend (hub/src/hooks) — no changes needed, same API shapes
  - agents using CLI request command with Registry

# Tech tracking
tech-stack:
  added: []
  patterns:
    - CLI uses createLedger to transparently route credits to Registry (HTTP) or local SQLite
    - Registry server uses createLedger({ db }) in direct mode — no HTTP round-trips to self
    - Relay-path requests skip CLI-side escrow; relay handles credits server-side

key-files:
  created: []
  modified:
    - src/cli/index.ts
    - src/registry/server.ts

key-decisions:
  - "CLI init: local 100cr bootstrap always runs; Registry grant (50cr) runs additionally when registryUrl configured — keeps offline agents at 100cr, networked agents show Registry balance"
  - "CLI request: CreditLedger for direct HTTP path only; relay-only path (no gatewayUrl) skips CLI escrow since relay does server-side hold/settle/release"
  - "Registry server uses direct DB mode for /me and /me/transactions — avoids HTTP round-trip to self; createLedger({ db }) constructed per-request (cheap object construction)"
  - "Removed getBalance/getTransactions imports from registry/server.ts — fully replaced by CreditLedger"

patterns-established:
  - "createLedger factory is the single entrypoint for all credit operations — no direct ledger.ts function calls in new code"
  - "settleEscrow/releaseEscrow helpers are async; callers await them"

requirements-completed: [CLI-01, CLI-02, CLI-03, CLI-04, HUB-01, HUB-02, HUB-03, HUB-04]

# Metrics
duration: 10min
completed: 2026-03-19
---

# Phase 29 Plan 01: CLI + Hub CreditLedger Wiring Summary

**CLI commands and Hub endpoints wired to CreditLedger: init grants via Registry, status uses Registry balance, request uses Registry hold/settle/release for direct HTTP, publish enforces 1cr minimum, Hub /me and /me/transactions use direct-DB CreditLedger**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-19T05:15:00Z
- **Completed:** 2026-03-19T05:20:01Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- CLI `init` grants 50 credits via Registry ledger when `registryUrl` configured, shows `registry_balance` in output (JSON and human-readable); local 100cr bootstrap unchanged for offline agents
- CLI `status` uses `CreditLedger.getBalance`/`getHistory` when Registry configured; falls back to direct SQLite when no Registry
- CLI `request` uses `CreditLedger.hold`/`settle`/`release` for direct HTTP remote requests with Registry; relay-only path skips CLI-side escrow (relay handles credits server-side)
- CLI `publish` rejects cards with `credits_per_call < 1` for both v1.0 and v2.0 multi-skill cards (enforces ADR-018)
- Hub GET `/me` returns balance from `CreditLedger` in direct DB mode; Hub GET `/me/transactions` returns history from `CreditLedger`; response shapes unchanged — frontend requires zero changes

## Task Commits

1. **Task 1: Update CLI commands to use CreditLedger** - `f4f4e5a` (feat)
2. **Task 2: Switch Hub /me and /me/transactions to CreditLedger** - `5034d10` (feat)

## Files Created/Modified

- `src/cli/index.ts` — Added createLedger import; init Registry grant; status Registry path; request CreditLedger escrow; publish price validation
- `src/registry/server.ts` — Replaced getBalance/getTransactions with createLedger({ db }) for /me and /me/transactions; removed unused imports

## Decisions Made

- CLI init: local 100cr bootstrap always runs first; Registry grant (50cr) runs additionally when `registryUrl` is configured. Keeps offline agents at 100cr, networked agents see Registry balance.
- CLI request: CreditLedger for direct HTTP path only. Relay-only path (no `gatewayUrl`) skips CLI escrow — relay server handles hold/settle/release server-side. This avoids double-holding credits.
- Registry server uses direct DB mode (`createLedger({ db })`) for /me and /me/transactions — avoids HTTP round-trip to itself. Per-request construction is cheap (object + DB reference, no connection pooling).
- Removed `getBalance`/`getTransactions` imports from `registry/server.ts` — fully replaced by CreditLedger calls.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. All 240 tests (92 CLI + 148 registry) pass on first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- v3.2 milestone complete. All 5 phases (25-29) and 10 plans done.
- CLI and Hub both route through CreditLedger abstraction — Registry-configured agents use centralized credits, local-only agents keep SQLite credits.
- Ready for public launch with full Registry Credit Ledger support.

---
*Phase: 29-cli-hub-compatibility*
*Completed: 2026-03-19*
