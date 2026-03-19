---
phase: 29-cli-hub-compatibility
verified: 2026-03-19T13:35:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 29: CLI + Hub Compatibility Verification Report

**Phase Goal:** Agents interact with the Registry credit system through CLI commands and the Hub UI, while agents without Registry config continue working unchanged
**Verified:** 2026-03-19T13:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                         | Status     | Evidence                                                                                      |
|----|-----------------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------|
| 1  | `agentbnb init` with registryUrl calls Registry /api/credits/grant and shows balance          | VERIFIED   | Lines 170-183 of cli/index.ts: createLedger with registryUrl, ledger.grant(owner, 50), registryBalance output |
| 2  | `agentbnb init` without registryUrl still works with local 100cr bootstrap                    | VERIFIED   | Lines 164-166: bootstrapAgent(creditDb, owner, 100) always runs; Registry path is conditional on existingConfig.registry |
| 3  | `agentbnb status` with registryUrl fetches balance from Registry HTTP                         | VERIFIED   | Lines 1165-1182: createLedger({ registryUrl, ownerPublicKey, privateKey }), balance = await statusLedger.getBalance(config.owner) |
| 4  | `agentbnb status` without registryUrl uses local SQLite balance                               | VERIFIED   | Lines 1183-1194: else branch uses getBalance(creditDb, config.owner) directly                 |
| 5  | `agentbnb request` to a remote card uses CreditLedger for escrow instead of local createSignedEscrowReceipt | VERIFIED | Lines 962-984: useRegistryLedger flag, createLedger with registryUrl, ledger.hold() called |
| 6  | `agentbnb publish` rejects cards with credits_per_call < 1                                    | VERIFIED   | Lines 424-445: v2.0 iterates skills, v1.0 checks card.pricing.credits_per_call; both exit(1) on < 1 |
| 7  | GET /me returns balance from CreditLedger, not getBalance(creditDb)                           | VERIFIED   | Lines 700-707 of registry/server.ts: createLedger({ db: opts.creditDb }), await ledger.getBalance(ownerName) |
| 8  | GET /me/transactions returns history from CreditLedger, not getTransactions(creditDb)         | VERIFIED   | Lines 845-855 of registry/server.ts: createLedger({ db: opts.creditDb }), await ledger.getHistory(ownerName, limit) |
| 9  | Agents without registryUrl use LocalCreditLedger for all credit operations                    | VERIFIED   | cli-compat.test.ts: 10 tests all passing; createLedger({ creditDbPath }) instanceof LocalCreditLedger |
| 10 | Local gateway handles LAN P2P exchanges with local escrow unchanged                            | VERIFIED   | Lines 985-999 of cli/index.ts: else-if gatewayUrl branch uses createSignedEscrowReceipt for non-Registry direct requests |
| 11 | Existing credit.db data is not migrated or destroyed                                          | VERIFIED   | No ALTER TABLE in credit/ledger.ts schema; no migration files added; CREATE TABLE IF NOT EXISTS only |
| 12 | All 739+ existing tests pass without modification                                             | VERIFIED   | 865 tests pass (65 test files); zero regressions from Plan 01 changes                         |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact                              | Expected                                    | Status     | Details                                               |
|---------------------------------------|---------------------------------------------|------------|-------------------------------------------------------|
| `src/cli/index.ts`                    | CLI commands using CreditLedger             | VERIFIED   | 4 uses of createLedger (init, status, request x2); contains "createLedger" import at line 30 |
| `src/registry/server.ts`             | Hub endpoints backed by CreditLedger        | VERIFIED   | createLedger imported at line 14; used at lines 703 and 852 for /me and /me/transactions |
| `src/cli/cli-compat.test.ts`          | Compat tests for CLI in local-only mode     | VERIFIED   | 157 lines, 10 tests, all passing                      |
| `src/registry/server-compat.test.ts`  | Compat tests for Hub endpoints in local-only mode | VERIFIED | 188 lines, 5 tests, all passing                   |

### Key Link Verification

| From                      | To                              | Via                                    | Status  | Details                                              |
|---------------------------|---------------------------------|----------------------------------------|---------|------------------------------------------------------|
| `src/cli/index.ts`        | `src/credit/create-ledger.ts`   | `import createLedger`                  | WIRED   | Import at line 30; used at lines 173, 965, 1168 |
| `src/registry/server.ts`  | `src/credit/create-ledger.ts`   | `import createLedger`                  | WIRED   | Import at line 14; used at lines 703, 852 |
| `src/cli/index.ts`        | `createLedger with creditDbPath`| local fallback (no registryUrl branch) | WIRED   | Lines 985-999 local escrow path intact for non-Registry requests |
| `src/registry/server.ts`  | `createLedger with db`          | direct DB mode for /me                 | WIRED   | `createLedger({ db: opts.creditDb })` at lines 703, 852 |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                  | Status    | Evidence                                                            |
|-------------|-------------|------------------------------------------------------------------------------|-----------|---------------------------------------------------------------------|
| CLI-01      | 29-01       | `agentbnb init` requests initial credit grant from Registry                  | SATISFIED | ledger.grant(owner, 50) at line 178 of cli/index.ts; wrapped in try/catch |
| CLI-02      | 29-01       | `agentbnb status` queries credit balance from Registry instead of local DB   | SATISFIED | createLedger + statusLedger.getBalance at lines 1168-1174          |
| CLI-03      | 29-01       | `agentbnb request` uses Registry-backed escrow for remote requests           | SATISFIED | requestLedger.hold() at line 971 for useRegistryLedger=true path   |
| CLI-04      | 29-01       | Minimum skill price enforced at 1 cr on publish                              | SATISFIED | Lines 424-445: both v1.0 and v2.0 paths check credits_per_call < 1 |
| HUB-01      | 29-01       | Registry server `/me` endpoint returns balance from CreditLedger             | SATISFIED | createLedger({ db: opts.creditDb }) + ledger.getBalance at line 703-704 |
| HUB-02      | 29-01       | Registry server `/me/transactions` endpoint returns history from CreditLedger| SATISFIED | createLedger({ db: opts.creditDb }) + ledger.getHistory at line 852-853 |
| HUB-03      | 29-01       | Hub frontend hooks unchanged — same API shape, zero frontend changes needed  | SATISFIED | No changes to hub/ directory in phase 29 commits (verified via git diff) |
| HUB-04      | 29-01       | OwnerDashboard displays real-time credit balance from Registry                | SATISFIED | Satisfied by HUB-01: /me returns balance from CreditLedger which is Registry-backed on server |
| COMPAT-01   | 29-02       | Agents without registryUrl config continue using local SQLite credits        | SATISFIED | cli-compat.test.ts: 10 tests pass; createLedger({ creditDbPath }) returns LocalCreditLedger |
| COMPAT-02   | 29-02       | Local gateway still works for LAN-only P2P exchanges with local escrow       | SATISFIED | cli/index.ts else-if branch preserves createSignedEscrowReceipt path for non-Registry direct requests |
| COMPAT-03   | 29-02       | Existing credit.db data preserved — no destructive migration                 | SATISFIED | No ALTER TABLE in credit/ledger.ts; no migration files added; schema unchanged |
| COMPAT-04   | 29-02       | All 739+ existing tests continue to pass                                     | SATISFIED | 865 tests pass across 65 test files with zero regressions           |

### Anti-Patterns Found

No blockers or warnings found.

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| (none) | — | — | — |

No TODO/FIXME/PLACEHOLDER comments in modified files. No stub implementations. No empty handlers. No unused imports remaining (getBalance/getTransactions were removed from registry/server.ts).

### Human Verification Required

No human verification required. All 12 requirements have automated test coverage:
- CLI-01 through CLI-04: covered by existing 92 CLI tests + new cli-compat.test.ts
- HUB-01 through HUB-04: covered by existing 148 registry tests + new server-compat.test.ts
- COMPAT-01 through COMPAT-04: directly tested by cli-compat.test.ts and server-compat.test.ts

### Gaps Summary

No gaps. Phase 29 fully achieves its goal.

**Goal restated:** Agents interact with the Registry credit system through CLI commands and the Hub UI, while agents without Registry config continue working unchanged.

**Goal achieved because:**
1. CLI init, status, and request all route through createLedger — Registry-configured agents transparently use centralized HTTP credits, local-only agents transparently use SQLite credits.
2. Hub /me and /me/transactions route through createLedger in direct-DB mode — consistent abstraction, same API shape for the frontend.
3. Relay-path requests skip CLI-side escrow — relay handles credits server-side, preventing double-holding.
4. The LocalCreditLedger fallback is verified by 10 compat tests that confirm identical behavior to direct ledger.ts calls.
5. 865 tests pass with zero regressions — existing agents and integrations are unaffected.

---

_Verified: 2026-03-19T13:35:00Z_
_Verifier: Claude (gsd-verifier)_
