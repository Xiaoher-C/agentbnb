---
phase: 21-signed-escrow-receipt
verified: 2026-03-17T19:30:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 21: Signed Escrow Receipt Verification Report

**Phase Goal:** Cross-machine credit verification works — two agents on different machines can exchange credits
**Verified:** 2026-03-17T19:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `agentbnb init` generates Ed25519 keypair at `~/.agentbnb/` | VERIFIED | `src/cli/index.ts` lines 118-126: try/catch guards idempotency; `generateKeyPair()` + `saveKeyPair()` called on first run |
| 2 | Requester signs escrow receipt with private key | VERIFIED | `src/credit/escrow-receipt.ts`: `createSignedEscrowReceipt()` calls `holdEscrow()` then `signEscrowReceipt()` to produce base64url Ed25519 signature |
| 3 | Provider verifies receipt signature with requester's public key | VERIFIED | `src/gateway/server.ts` lines 182-210: `verifyEscrowReceipt()` called with public key decoded from `receipt.requester_public_key` (hex); rejects tampered/expired/insufficient receipts |
| 4 | Credits settle independently on both agents' local SQLite DBs | VERIFIED | `src/credit/settlement.ts`: `settleProviderEarning()` writes to providerDb only; `settleRequesterEscrow()` writes to requesterDb only; no cross-DB operations |
| 5 | Integration tests pass with TWO separate SQLite databases | VERIFIED | `src/credit/p2p-integration.test.ts`: 6 tests, 2 describe blocks — in-memory separate DBs + file-based DBs at `/tmp/agent-a-test/` and `/tmp/agent-b-test/`; 67 tests pass total |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/credit/signing.ts` | Ed25519 keypair generation, signing, verification | VERIFIED | Exports `generateKeyPair`, `saveKeyPair`, `loadKeyPair`, `signEscrowReceipt`, `verifyEscrowReceipt`; uses Node.js built-in crypto, zero external deps |
| `src/credit/escrow-receipt.ts` | EscrowReceipt creation with local escrow hold | VERIFIED | Exports `createSignedEscrowReceipt`, `EscrowReceiptSchema`; atomically calls `holdEscrow` then signs receipt |
| `src/types/index.ts` | EscrowReceipt interface exported from core types | VERIFIED | Lines 155-177: full `EscrowReceipt` interface with all 8 fields including nonce and signature |
| `src/credit/settlement.ts` | Settlement protocol for provider and requester sides | VERIFIED | Exports `settleProviderEarning`, `settleRequesterEscrow`, `releaseRequesterEscrow`; each operates on its own DB only |
| `src/credit/ledger.ts` | `recordEarning` with nonce-based idempotency | VERIFIED | Lines 140-170: `recordEarning` with SELECT guard on nonce before INSERT; uses `remote_earning` reason |
| `src/credit/escrow.ts` | `confirmEscrowDebit` for requester-side P2P finalization | VERIFIED | Line 177: `confirmEscrowDebit` marks escrow `settled` without crediting recipient |
| `src/gateway/server.ts` | Receipt-based credit verification in /rpc handler | VERIFIED | Lines 178-232: full receipt-or-local branching; `verifyEscrowReceipt` + `settleProviderEarning` wired |
| `src/gateway/client.ts` | Receipt attachment in outbound `requestCapability` | VERIFIED | Line 20: `escrowReceipt?` on `RequestOptions`; line 41: `escrow_receipt` included in JSON-RPC params |
| `src/credit/p2p-integration.test.ts` | Full P2P integration tests with separate DBs | VERIFIED | 6 test scenarios across 2 describe blocks; file-based DB test at `/tmp` paths present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli/index.ts` | `src/credit/signing.ts` | `generateKeyPair()` called during init | WIRED | Line 13: import; lines 121-124: used in try/catch idempotency pattern |
| `src/credit/escrow-receipt.ts` | `src/credit/signing.ts` | `signEscrowReceipt()` to sign receipt | WIRED | Line 5: import; line 71: `signEscrowReceipt(receiptData, privateKey)` called |
| `src/gateway/server.ts` | `src/credit/signing.ts` | `verifyEscrowReceipt()` for receipt validation | WIRED | Line 8: import; line 186: `verifyEscrowReceipt(receiptData, signature, publicKeyBuf)` called |
| `src/gateway/server.ts` | `src/credit/settlement.ts` | `settleProviderEarning()` after successful remote execution | WIRED | Line 9: import; lines 306 + 376: called in both SkillExecutor and legacy HTTP paths |
| `src/gateway/client.ts` | `src/credit/escrow-receipt.ts` | `escrowReceipt` attached to JSON-RPC params | WIRED | Line 41: `...(escrowReceipt ? { escrow_receipt: escrowReceipt } : {})` in payload |
| `src/credit/settlement.ts` | `src/credit/ledger.ts` | `recordEarning()` for provider-side credit | WIRED | Line 2: import; line 22: `recordEarning(providerDb, providerOwner, receipt.amount, receipt.card_id, receipt.nonce)` |
| `src/credit/settlement.ts` | `src/credit/escrow.ts` | `confirmEscrowDebit` / `releaseEscrow` for requester-side | WIRED | Lines 3-4: imports; lines 45 + 60: called in `settleRequesterEscrow` and `releaseRequesterEscrow` |
| `src/credit/p2p-integration.test.ts` | `src/gateway/server.ts` | Fastify inject for RPC calls with `escrow_receipt` | WIRED | Line 7: import `createGatewayServer`; multiple inject calls with `escrow_receipt` in params |
| `src/credit/p2p-integration.test.ts` | `src/credit/settlement.ts` | `settleRequesterEscrow` + `releaseRequesterEscrow` | WIRED | Line 12: import; lines 165, 227, 484: called after gateway responses |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CREDIT-01 (v3.0) | 21-01 | `agentbnb init` generates Ed25519 keypair | SATISFIED | `src/cli/index.ts` lines 118-126: keypair generated on first init, idempotent on re-init |
| CREDIT-02 (v3.0) | 21-01 | Requester signs escrow receipt with private key | SATISFIED | `src/credit/signing.ts` `signEscrowReceipt()`; `src/credit/escrow-receipt.ts` `createSignedEscrowReceipt()` |
| CREDIT-03 (v3.0) | 21-02 | Provider verifies receipt signature + backward-compat local fallback | SATISFIED | `src/gateway/server.ts` receipt-or-local branching; 6 new server tests all pass |
| CREDIT-04 (v3.0) | 21-03 | Credits settle independently on both agents' local SQLite DBs | SATISFIED | `src/credit/settlement.ts` + `src/credit/ledger.ts` `recordEarning` with nonce idempotency; 8 settlement tests pass |
| CREDIT-05 (v3.0) | 21-04 | Integration tests pass with TWO separate SQLite databases | SATISFIED | `src/credit/p2p-integration.test.ts`: 6 scenarios, in-memory + file-based DBs, all passing |

**Requirement ID note:** CREDIT-01 through CREDIT-05 as labeled in Phase 21 plans refer to the v3.0 cross-machine credit requirements. These IDs collide with v2.2 Hub UI requirements in REQUIREMENTS.md (which use the same IDs for currency display and dashboard features). The v3.0 CREDIT requirements are defined in ROADMAP.md success criteria only — they do not appear in REQUIREMENTS.md. No requirements are orphaned from the plans' perspective; the coverage is complete within Phase 21's scope.

---

### Anti-Patterns Found

None. Scanned all 9 phase 21 artifacts for TODO/FIXME/placeholder/stub patterns — zero findings.

Specific checks:
- No `return null` / `return {}` / `return []` empty stubs
- No `console.log`-only handlers
- No `e.preventDefault()` only form handlers
- No empty API routes
- Private key stored with `0o600` permissions (secure)

---

### Human Verification Required

None for core functionality. All success criteria are programmatically verifiable.

The following is advisory only (informational, not blocking):

**Real cross-machine test (advisory)**
Test: Run two agents on two physically separate machines (or VMs with separate filesystems), call `agentbnb init` on each, then use `requestCapability` with a signed receipt.
Expected: Credits transfer correctly with real network round-trips.
Why advisory: Integration tests use Fastify `inject()` (in-process), which avoids actual TCP. The file-based DB test at `/tmp` paths confirms disk separation, but does not test real network transmission. Given the protocol is stateless and the integration tests cover all code paths, this is low risk.

---

### Gaps Summary

No gaps. All 5 observable truths are verified. All 9 artifacts exist, are substantive, and are wired. All 9 key links are confirmed. All 67 tests across 6 test files pass, including 6 P2P integration tests with separate SQLite databases.

The phase goal — "Cross-machine credit verification works — two agents on different machines can exchange credits" — is achieved.

---

_Verified: 2026-03-17T19:30:00Z_
_Verifier: Claude (gsd-verifier)_
