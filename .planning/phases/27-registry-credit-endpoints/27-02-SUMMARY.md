---
phase: 27-registry-credit-endpoints
plan: "02"
subsystem: registry/credit
tags: [credit, free-tier, ed25519, sqlite, signing, http-client]
dependency_graph:
  requires:
    - src/credit/ledger.ts (openCreditDb)
    - src/credit/signing.ts (generateKeyPair, signEscrowReceipt)
    - src/registry/identity-auth.ts (signRequest)
    - src/registry/credit-routes.ts (creditRoutesPlugin)
  provides:
    - src/registry/free-tier.ts (initFreeTierTable, recordFreeTierUse, getFreeTierUsage)
    - src/registry/free-tier.test.ts (5 tests for free-tier tracking)
  affects:
    - src/registry/credit-routes.ts (wire initFreeTierTable on startup)
    - src/credit/registry-credit-ledger.ts (Ed25519 signing in HTTP client mode)
    - src/credit/create-ledger.ts (privateKey required for HTTP mode)
tech_stack:
  added: []
  patterns:
    - SQLite UPSERT (INSERT ... ON CONFLICT DO UPDATE) for usage count tracking
    - Ed25519 signRequest() called in both POST and GET HTTP helpers
    - TDD (RED-GREEN) for free-tier module
key_files:
  created:
    - src/registry/free-tier.ts
    - src/registry/free-tier.test.ts
  modified:
    - src/registry/credit-routes.ts
    - src/credit/registry-credit-ledger.ts
    - src/credit/create-ledger.ts
    - src/credit/create-ledger.test.ts
    - src/credit/registry-credit-ledger.test.ts
decisions:
  - free-tier tracking uses creditDb (not registryDb) — consistent with credit_grants placement; free_tier is a credit concern
  - X-Agent-Owner header removed from HTTP client — Ed25519 public key uniquely identifies the agent; Owner is redundant
  - ownerForHeader param kept in post() signature for API compatibility but voided — avoids callers needing to update call sites
  - privateKey required (not optional) in HttpClientConfig and createLedger HTTP options — fail fast if misconfigured
metrics:
  duration_seconds: 220
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_created: 2
  files_modified: 5
  tests_added: 11
  tests_total: 829
---

# Phase 27 Plan 02: Free-tier Usage Tracking + Ed25519 HTTP Client Summary

Per-agent per-skill free-tier usage tracking on Registry startup, plus Ed25519-signed HTTP requests in RegistryCreditLedger replacing the old X-Agent-Owner header.

## What Was Built

### Task 1: Free-tier usage tracking module

`src/registry/free-tier.ts` exports three functions:

- `initFreeTierTable(db)` — Creates `credit_free_tier_usage` table with `(agent_public_key, skill_id)` composite primary key. Idempotent via `CREATE TABLE IF NOT EXISTS`.
- `recordFreeTierUse(db, agentPublicKey, skillId)` — Upserts usage count using SQLite `ON CONFLICT DO UPDATE SET usage_count = usage_count + 1`. One row per agent+skill pair.
- `getFreeTierUsage(db, agentPublicKey, skillId)` — Returns current usage count (0 if no record exists).

`src/registry/credit-routes.ts` updated: `initFreeTierTable(creditDb)` called during `creditRoutesPlugin` registration, alongside the existing `credit_grants` table creation. Registry now initializes free-tier tracking on startup.

### Task 2: Ed25519 signing in RegistryCreditLedger HTTP client

`src/credit/registry-credit-ledger.ts`:
- `HttpClientConfig` now requires `privateKey: Buffer` (Ed25519 private key)
- `post()` calls `signRequest('POST', path, body, privateKey, publicKeyHex)` and merges the returned auth headers (`X-Agent-PublicKey`, `X-Agent-Signature`, `X-Agent-Timestamp`) into fetch headers
- `get()` calls `signRequest('GET', path, null, privateKey, publicKeyHex)` and merges auth headers
- Old `X-Agent-Owner` header removed from both methods

`src/credit/create-ledger.ts`:
- `CreateLedgerOptions` HTTP mode now requires `privateKey: Buffer`
- Factory passes `privateKey` through to `RegistryCreditLedger` constructor

Tests updated in both `registry-credit-ledger.test.ts` and `create-ledger.test.ts` to:
- Use `generateKeyPair()` for real Ed25519 key material instead of fake string keys
- Assert new header shape (`X-Agent-PublicKey`, `X-Agent-Signature`, `X-Agent-Timestamp`)
- Assert `X-Agent-Owner` is NOT present (explicitly removed)

## Deviations from Plan

None — plan executed exactly as written. The only minor adaptation: `ownerForHeader` parameter was kept in `post()` for API compatibility (call sites don't change) and voided with `void ownerForHeader` rather than being removed from the signature.

## Test Results

| Test File | Tests | Status |
|-----------|-------|--------|
| free-tier.test.ts | 5 | PASS |
| registry-credit-ledger.test.ts | 30 | PASS (updated) |
| create-ledger.test.ts | 7 | PASS (updated) |
| credit-routes.test.ts | 10 | PASS (no regressions) |
| identity-auth.test.ts | 6 | PASS (no regressions) |
| Full suite | 829 | PASS |

## Self-Check: PASSED
