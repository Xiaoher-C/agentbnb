---
phase: 26-creditledger-interface
plan: 02
subsystem: credit
tags: [sqlite, fetch, http-client, registry, credit-ledger, escrow, tdd]

requires:
  - phase: 26-01
    provides: CreditLedger interface and LocalCreditLedger wrapper

provides:
  - RegistryCreditLedger class with direct DB mode (for Registry server process)
  - RegistryCreditLedger class with HTTP client mode (for agent nodes with registryUrl)
  - createLedger factory for auto-detecting ledger mode from config

affects:
  - 27-registry-credit-api (will implement the /api/credits/* endpoints this HTTP mode calls)
  - 28-agent-credit-integration (will wire createLedger into agent-runtime.ts)
  - 29-hub-credits-ui (needs Registry-backed balance data)

tech-stack:
  added: []
  patterns:
    - "RegistryCreditLedgerConfig discriminated union (mode: direct | http) for dual-mode switching"
    - "AbortController with setTimeout for 10s HTTP request timeout"
    - "handleResponse<T> private helper normalises HTTP errors to AgentBnBError"
    - "createLedger factory: branching on registryUrl → db → fallback-local order"
    - "globalThis.fetch mock with vi.fn() for HTTP client tests without network"

key-files:
  created:
    - src/credit/registry-credit-ledger.ts
    - src/credit/registry-credit-ledger.test.ts
    - src/credit/create-ledger.ts
    - src/credit/create-ledger.test.ts
  modified: []

key-decisions:
  - "RegistryCreditLedger uses single class with discriminated union config (not two classes) — simpler, less duplication"
  - "HTTP mode passes ownerPublicKey at construction time, not per-call — matches per-agent identity model"
  - "hold() POST sends owner in body AND X-Agent-Owner header — body for Registry logic, header for future auth (Phase 27)"
  - "settle() and release() do not include owner in X-Agent-Owner header (no owner context needed) — null passed to post() helper"
  - "REGISTRY_UNREACHABLE code for network failures (fetch throws), REGISTRY_ERROR fallback for HTTP non-2xx with no code in body"

patterns-established:
  - "HTTP credit clients: all POST endpoints under /api/credits/, GET for balance and history"
  - "All HTTP requests include X-Agent-PublicKey for future auth validation"
  - "AgentBnBError propagation: preserve server-sent code, fall back to REGISTRY_ERROR"

requirements-completed: [CRED-02, CRED-03, CRED-05]

duration: 8min
completed: 2026-03-19
---

# Phase 26 Plan 02: RegistryCreditLedger and createLedger Factory Summary

**RegistryCreditLedger with HTTP client and direct DB modes plus createLedger auto-detection factory — 36 new tests, 118 total credit tests passing**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-19T12:19:18Z
- **Completed:** 2026-03-19T12:27:30Z
- **Tasks:** 2
- **Files modified:** 4 created

## Accomplishments

- RegistryCreditLedger implements CreditLedger in two modes: direct DB (for Registry server, no HTTP round-trip) and HTTP client (for agent nodes with registryUrl configured)
- HTTP client mode sends correctly shaped fetch requests to /api/credits/* endpoints with X-Agent-Owner and X-Agent-PublicKey headers, 10s timeout via AbortController, and normalises all errors to AgentBnBError
- createLedger factory auto-detects the correct implementation: registryUrl → HTTP mode, db → direct mode, neither → LocalCreditLedger (local SQLite fallback)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement RegistryCreditLedger with dual-mode operation** - `8c09739` (feat)
2. **Task 2: Create createLedger factory with auto-detection** - `3d981b9` (feat)

_Note: TDD tasks used RED → GREEN flow. Both tasks passed GREEN in single implementation pass._

## Files Created/Modified

- `src/credit/registry-credit-ledger.ts` — RegistryCreditLedger class: direct DB delegates to ledger.ts/escrow.ts; HTTP client uses native fetch with AbortController timeout and error normalisation
- `src/credit/registry-credit-ledger.test.ts` — 29 tests: 17 direct DB mode (mirrors LocalCreditLedger tests) + 12 HTTP client mode (fetch mock via globalThis.fetch = vi.fn())
- `src/credit/create-ledger.ts` — createLedger factory with CreateLedgerOptions discriminated union; re-exports CreditLedger, LocalCreditLedger, RegistryCreditLedger
- `src/credit/create-ledger.test.ts` — 7 tests: instanceof checks for all 3 modes + method presence verification

## Decisions Made

- RegistryCreditLedger uses a single class with discriminated union config (mode: 'direct' | 'http') rather than two separate classes — reduces duplication while keeping type-safe branching
- HTTP mode passes ownerPublicKey at construction time rather than per-call, matching the per-agent identity model (one key per agent process)
- settle() and release() pass null for ownerForHeader since no specific owner context is needed at the call site (escrowId is self-contained)
- REGISTRY_UNREACHABLE code for network failures (fetch throws), REGISTRY_ERROR as fallback for HTTP non-2xx with no code field in response body

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- RegistryCreditLedger HTTP mode is ready and tested against mock /api/credits/* endpoints
- Phase 27 (Registry Credit API) must implement the actual Fastify routes that this HTTP client calls
- createLedger is ready for wiring into agent-runtime.ts in Phase 28
- All 118 credit tests continue to pass with no regressions

---
*Phase: 26-creditledger-interface*
*Completed: 2026-03-19*

## Self-Check: PASSED

- FOUND: src/credit/registry-credit-ledger.ts
- FOUND: src/credit/registry-credit-ledger.test.ts
- FOUND: src/credit/create-ledger.ts
- FOUND: src/credit/create-ledger.test.ts
- FOUND: .planning/phases/26-creditledger-interface/26-02-SUMMARY.md
- FOUND commit: 8c09739
- FOUND commit: 3d981b9
