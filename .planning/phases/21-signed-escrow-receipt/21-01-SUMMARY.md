---
phase: 21-signed-escrow-receipt
plan: 01
subsystem: credit
tags: [ed25519, crypto, escrow, signing, keypair]

# Dependency graph
requires:
  - phase: 03-credit-system
    provides: escrow hold/settle/release, credit ledger
provides:
  - Ed25519 keypair generation and persistence
  - signEscrowReceipt / verifyEscrowReceipt functions
  - EscrowReceipt type and Zod schema
  - createSignedEscrowReceipt (atomic escrow hold + signed receipt)
  - CLI init keypair generation (idempotent)
affects: [21-02, 21-03, 21-04, gateway, cross-machine-credits]

# Tech tracking
tech-stack:
  added: []
  patterns: [Ed25519 DER signing with canonical JSON, base64url signatures]

key-files:
  created:
    - src/credit/signing.ts
    - src/credit/signing.test.ts
    - src/credit/escrow-receipt.ts
    - src/credit/escrow-receipt.test.ts
  modified:
    - src/cli/index.ts
    - src/cli/config.ts
    - src/types/index.ts

key-decisions:
  - "Ed25519 with DER encoding (SPKI/PKCS8) via Node.js crypto — zero external deps"
  - "Canonical JSON (sorted keys) ensures deterministic signatures across platforms"
  - "CLI init keypair is idempotent — re-init preserves existing keys"

patterns-established:
  - "Canonical JSON signing: JSON.stringify with sorted keys before Ed25519 sign"
  - "Base64url encoding for all signatures (URL-safe, no padding)"
  - "Private key file mode 0o600 for security"

requirements-completed: [CREDIT-01, CREDIT-02]

# Metrics
duration: 4min
completed: 2026-03-17
---

# Phase 21 Plan 01: Signed Escrow Receipt Summary

**Ed25519 keypair generation on init + signed escrow receipt protocol with canonical JSON signatures**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-17T11:01:36Z
- **Completed:** 2026-03-17T11:05:23Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Ed25519 signing module with generateKeyPair, saveKeyPair, loadKeyPair, signEscrowReceipt, verifyEscrowReceipt
- EscrowReceipt type as the canonical interface for cross-machine credit proof
- createSignedEscrowReceipt atomically holds local escrow and returns signed receipt
- CLI init generates keypair on first run, preserves on re-run (idempotent)
- 17 tests total covering roundtrip signing, tamper detection, wrong-key rejection, insufficient credits, unique nonces

## Task Commits

Each task was committed atomically:

1. **Task 1: Ed25519 signing module + keypair generation in CLI init** - `cbb7e93` (feat)
2. **Task 2: EscrowReceipt type + createSignedEscrowReceipt function** - `6715a4a` (feat)

_Note: TDD tasks — tests written first (RED), then implementation (GREEN), committed together._

## Files Created/Modified
- `src/credit/signing.ts` - Ed25519 keypair generation, signing, verification with canonical JSON
- `src/credit/signing.test.ts` - 10 tests for signing module
- `src/credit/escrow-receipt.ts` - createSignedEscrowReceipt + EscrowReceiptSchema Zod validator
- `src/credit/escrow-receipt.test.ts` - 7 tests for escrow receipt creation and validation
- `src/types/index.ts` - EscrowReceipt interface added
- `src/cli/index.ts` - Init command generates Ed25519 keypair (idempotent)
- `src/cli/config.ts` - AgentBnBConfig gains optional public_key field

## Decisions Made
- Used Ed25519 with DER encoding (SPKI for public, PKCS8 for private) via Node.js built-in crypto — zero external dependencies
- Canonical JSON (Object.keys sorted) ensures deterministic signatures across different key-ordering
- Private key stored with 0o600 permissions for security
- CLI init is idempotent: loadKeyPair try/catch guards against overwriting existing keys

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- signing.ts and escrow-receipt.ts ready for 21-02 (provider-side receipt verification)
- EscrowReceipt type is the canonical interface for all cross-machine credit flows
- Pre-existing TS errors in src/conductor/task-decomposer.ts are out of scope (documented in earlier phases)

## Self-Check: PASSED

- All 7 files verified on disk
- Both commits (cbb7e93, 6715a4a) verified in git log
- 17/17 tests passing

---
*Phase: 21-signed-escrow-receipt*
*Completed: 2026-03-17*
