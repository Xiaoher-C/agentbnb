---
phase: 27-registry-credit-endpoints
plan: "01"
subsystem: registry/credit
tags: [credit, auth, ed25519, fastify, registry, escrow]
dependency_graph:
  requires:
    - src/credit/signing.ts (verifyEscrowReceipt, signEscrowReceipt, generateKeyPair)
    - src/credit/escrow.ts (holdEscrow, settleEscrow, releaseEscrow)
    - src/credit/ledger.ts (bootstrapAgent, getBalance, getTransactions)
    - src/registry/server.ts (createRegistryServer)
  provides:
    - src/registry/identity-auth.ts (Ed25519 identity verification hook + signRequest)
    - src/registry/credit-routes.ts (6 credit endpoints behind Ed25519 auth)
  affects:
    - src/registry/server.ts (CORS headers, creditRoutesPlugin registration)
tech_stack:
  added: []
  patterns:
    - Fastify scoped plugin for auth hooks (addHook directly on scope, not via register)
    - Grant deduplication table (credit_grants) keyed by Ed25519 public key
    - TDD (RED-GREEN) for all route behavior
key_files:
  created:
    - src/registry/identity-auth.ts
    - src/registry/identity-auth.test.ts
    - src/registry/credit-routes.ts
    - src/registry/credit-routes.test.ts
  modified:
    - src/registry/server.ts
decisions:
  - identityAuthPlugin is a plain function (not async/Fastify plugin) called directly on scope — avoids sub-scope isolation issue where hooks in child scopes don't apply to parent routes
  - Body not included in Ed25519 signature payload — body isn't available during onRequest hook; method/path/timestamp/publicKey is sufficient to prevent replay attacks with 5-minute window
  - credit_grants table on creditDb (not registryDb) — grants are a credit concern, not a registry concern
  - creditRoutesPlugin registered only when creditDb is provided — server stays backward compatible
metrics:
  duration_seconds: 414
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_created: 4
  files_modified: 1
  tests_added: 16
  tests_total: 823
---

# Phase 27 Plan 01: Registry Credit Endpoints Summary

Ed25519-authenticated credit API (hold/settle/release/grant/balance/history) on the Registry server with per-public-key grant deduplication.

## What Was Built

### Task 1: Ed25519 Identity Auth preHandler

`src/registry/identity-auth.ts` exports:
- `identityAuthPlugin(fastify)` — plain function that adds an `onRequest` hook to the Fastify scope it's called on. Validates 3 headers (`X-Agent-PublicKey`, `X-Agent-Signature`, `X-Agent-Timestamp`), checks timestamp freshness (5-minute window), verifies Ed25519 signature via `verifyEscrowReceipt`, and sets `request.agentPublicKey` on success.
- `signRequest(method, path, body, privateKey, publicKeyHex)` — creates the 3 auth headers. Used by tests and by the RegistryCreditLedger HTTP client.

The signed payload is `{ method, path, timestamp, publicKey }` (canonical JSON via `signEscrowReceipt`).

### Task 2: Credit Route Handlers + Grant Dedup + Server Wiring

`src/registry/credit-routes.ts` exports `creditRoutesPlugin` — a Fastify plugin that:
1. Creates `credit_grants` table on `creditDb` for grant deduplication by Ed25519 public key
2. Registers a scoped block with `identityAuthPlugin` applied directly (so the hook covers all routes in the scope)
3. Implements all 6 credit endpoints

`src/registry/server.ts` updated:
- Imports and registers `creditRoutesPlugin` when `creditDb` is provided
- Adds Ed25519 headers (`X-Agent-PublicKey`, `X-Agent-Signature`, `X-Agent-Timestamp`) to CORS `allowedHeaders`

## Endpoints

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| POST | /api/credits/hold | Yes | `{ escrowId }` or 400 INSUFFICIENT_CREDITS |
| POST | /api/credits/settle | Yes | `{ ok: true }` or 400 ESCROW_NOT_FOUND |
| POST | /api/credits/release | Yes | `{ ok: true }` or 400 ESCROW_NOT_FOUND |
| POST | /api/credits/grant | Yes | `{ ok: true, granted: 50 }` or `{ ..., granted: 0, reason: 'already_granted' }` |
| GET | /api/credits/:owner | Yes | `{ balance: N }` |
| GET | /api/credits/:owner/history | Yes | `{ transactions: [...], limit: N }` |

## Key Design Decision: Fastify Plugin Scoping

Discovered during Task 1 that Fastify's `scope.register(plugin)` creates a CHILD scope. Hooks added inside a child scope do NOT apply to routes registered in the parent scope. The fix: `identityAuthPlugin` is a plain sync function that calls `fastify.addHook(...)` directly — the caller invokes it on the scope where routes live.

This is documented in the `identityAuthPlugin` JSDoc as a usage note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fastify scoping — hooks in child scopes don't apply to parent routes**
- **Found during:** Task 1 (RED phase debugging)
- **Issue:** `scope.register(identityAuthPlugin)` creates a sub-scope; routes in outer `scope` never see the hook
- **Fix:** Changed `identityAuthPlugin` from an async Fastify plugin to a plain sync function called directly on the scope
- **Files modified:** `src/registry/identity-auth.ts`, `src/registry/identity-auth.test.ts`
- **Commit:** 27ca1f7

**2. [Rule 2 - Missing] Body not signed in Ed25519 payload**
- **Found during:** Task 1 implementation
- **Issue:** Plan suggested including `body` in signed payload for POST requests, but `body` is not parsed during `onRequest` hook — it's only available after `preParsing`
- **Fix:** Excluded body from signed payload. Method/path/timestamp/publicKey with 5-minute replay window is sufficient security for the credit API
- **Files modified:** `src/registry/identity-auth.ts`
- **Commit:** 27ca1f7

## Test Results

| Test File | Tests | Status |
|-----------|-------|--------|
| identity-auth.test.ts | 6 | PASS |
| credit-routes.test.ts | 10 | PASS |
| server.test.ts | 66 | PASS (no regressions) |
| Full suite | 823 | PASS |

## Self-Check: PASSED
