# Phase 2: UCAN Token Engine — Execution Plan

> For remote session use. Start from here after Phase 1 is merged.

## Prerequisites (All Done)

- [x] `src/auth/canonical-json.ts` — RFC 8785 serializer (PR #16 merged)
- [x] `src/auth/ucan-resources.ts` — `agentbnb://` URI parser + matcher (PR #16 merged)
- [x] `src/identity/did.ts` — DID Core Library (PR #17 merged)
- [x] `src/credentials/` — VC engine (PR #19 merged)
- [x] `src/types/index.ts` — `did` field on schemas (commit 45323d8)
- [x] `src/identity/identity.ts` — DID auto-derive + backfill (commit 45323d8)
- [x] `src/cli/did-action.ts` + `vc-action.ts` — CLI commands (commit 45323d8)
- [x] `src/registry/server.ts` — `/api/did/:id` + `/api/credentials/:id` (commit 45323d8)
- [x] `docs/adr/020-ucan-token.md` — UCAN specification (commit 0a3f7f2)
- [x] 1653 tests passing, build clean

## Phase 2 Overview

**Goal:** Implement UCAN (User Controlled Authorization Networks) token engine — scoped, time-bound, delegatable authorization tokens bound to AgentBnB's escrow lifecycle.

**Security Level:** 🔒 Rigorous — 100% branch coverage required.

**Reference:** `docs/adr/020-ucan-token.md` for full specification.

---

## Wave 1: UCAN Core Engine (Units 13)

### Task 13.1: `src/auth/ucan.ts`

**Create** the core UCAN token engine.

```typescript
import { canonicalize } from './canonical-json.js';
import { signEscrowReceipt, verifyEscrowReceipt } from '../credit/signing.js';

export interface UCANHeader {
  alg: 'EdDSA';
  typ: 'JWT';
  ucv: '0.10.0';
}

export interface UCANAttenuation {
  with: string;    // agentbnb:// resource URI
  can: string;     // action: read, write, invoke, settle, delegate
  nb?: Record<string, unknown>;  // caveats (e.g., max_calls, max_cost)
}

export interface UCANPayload {
  iss: string;     // issuer DID (did:agentbnb:<agent_id>)
  aud: string;     // audience DID
  exp: number;     // expiry (unix timestamp)
  nbf?: number;    // not-before (unix timestamp)
  nnc: string;     // nonce (replay protection)
  att: UCANAttenuation[];   // attenuations (permissions)
  prf: string[];   // proof chain (parent token IDs)
  fct?: Record<string, unknown>;  // facts (metadata: escrow_id, task_description)
}

export interface UCAN {
  header: UCANHeader;
  payload: UCANPayload;
  signature: string;  // base64url Ed25519 signature
}

/**
 * Create a UCAN token signed with Ed25519.
 * Encodes as base64url(header).base64url(payload).base64url(signature)
 */
export function createUCAN(opts: {
  issuerDid: string;
  audienceDid: string;
  attenuations: UCANAttenuation[];
  signerKey: Buffer;           // DER-encoded Ed25519 private key
  expiresAt: number;           // unix timestamp
  notBefore?: number;
  proofs?: string[];           // parent UCAN token strings
  facts?: Record<string, unknown>;
}): string  // Returns encoded UCAN token string

/**
 * Verify a UCAN token's Ed25519 signature.
 * Does NOT verify the proof chain — use validateChain() for that.
 */
export function verifyUCAN(
  token: string,
  issuerPublicKey: Buffer,     // DER-encoded Ed25519 public key
): { valid: boolean; reason?: string }

/**
 * Decode a UCAN token without verifying the signature.
 */
export function decodeUCAN(token: string): UCAN

/**
 * Check if a UCAN token has expired.
 */
export function isExpired(token: string): boolean
```

**Implementation Notes:**
- Use `canonicalize()` from `./canonical-json.js` for deterministic payload serialization
- Use `signEscrowReceipt()` / `verifyEscrowReceipt()` from `../credit/signing.js`
- Token encoding: `base64url(JSON(header)).base64url(JSON(payload)).signature`
- Nonce: `randomUUID()` from `node:crypto`

**Key files to reference:**
- `src/auth/canonical-json.ts` — canonicalize function
- `src/credit/signing.ts` — signEscrowReceipt, verifyEscrowReceipt, generateKeyPair
- `src/identity/delegation.ts` — existing token pattern (similar structure)

### Task 13.2: `src/auth/ucan.test.ts`

Tests must cover:
- Create + verify round-trip (sign → verify → true)
- Tampered token fails verification
- Wrong key fails verification
- Expired token detected by isExpired()
- Decode extracts correct header/payload
- Nonce is unique per creation
- Invalid token format throws
- All attenuation fields preserved

---

## Wave 2: Delegation + Escrow Binding (Units 14-15)

### Task 14: `src/auth/ucan-delegation.ts`

```typescript
/**
 * Create a delegated UCAN with narrowed permissions.
 * The new UCAN's attenuations must be a subset of the parent's.
 */
export function delegateUCAN(opts: {
  parentToken: string;           // encoded parent UCAN
  newAudienceDid: string;
  narrowedAttenuations: UCANAttenuation[];
  signerKey: Buffer;
  expiresAt?: number;            // must be ≤ parent's exp
}): string

/** Maximum allowed delegation chain depth. */
export const MAX_CHAIN_DEPTH = 3;

/**
 * Validate a complete UCAN delegation chain.
 * Checks: signatures, attenuation narrowing, depth limit, expiry inheritance.
 */
export function validateChain(
  tokens: string[],                // ordered: root → ... → leaf
  resolvePublicKey: (did: string) => Buffer | null,
): { valid: boolean; reason?: string; depth: number }
```

**Key rules:**
- **Attenuation-only**: Each child's `att` must be a subset of parent's (use `isAttenuation` from `ucan-resources.ts`)
- **Depth limit**: `tokens.length - 1 > MAX_CHAIN_DEPTH` → reject
- **Expiry inheritance**: Child `exp` must be ≤ parent `exp`
- **Audience chain**: Parent's `aud` must equal child's `iss`

**Tests must cover:**
- Valid 2-link chain (A→B→C)
- Valid 3-link chain (A→B→C→D, depth=3)
- Rejected 4-link chain (depth=4 exceeds MAX_CHAIN_DEPTH)
- Attenuation widening rejected (child has broader scope than parent)
- Correct attenuation narrowing accepted
- Expired parent invalidates child
- Audience/issuer mismatch rejected

### Task 15: `src/auth/ucan-escrow.ts`

```typescript
/**
 * Escrow-aware UCAN lifecycle management.
 * UCAN tokens are bound to escrow lifecycle — when escrow settles/refunds,
 * all derived UCANs become invalid.
 */

export interface EscrowBoundUCAN {
  token: string;       // encoded UCAN
  escrowId: string;    // linked escrow ID
  status: 'active' | 'expired' | 'revoked';
}

/**
 * Create a UCAN bound to an escrow.
 * UCAN.exp is automatically capped at escrow expiry.
 */
export function createEscrowBoundUCAN(opts: {
  issuerDid: string;
  audienceDid: string;
  attenuations: UCANAttenuation[];
  signerKey: Buffer;
  escrowId: string;
  escrowExpiresAt: number;  // unix timestamp
}): EscrowBoundUCAN

/**
 * In-memory revocation set for settled/refunded escrows.
 * When escrow settles or refunds, all derived UCANs are revoked.
 */
export class UCANRevocationSet {
  /** Revoke all UCANs for an escrow. */
  revokeByEscrow(escrowId: string): void;
  /** Check if a UCAN is revoked. */
  isRevoked(escrowId: string): boolean;
  /** Get all revoked escrow IDs. */
  listRevoked(): string[];
  /** Clear revocation (e.g., after cleanup). */
  clear(): void;
}

/**
 * Map escrow state to UCAN state.
 * See ADR-020 state matrix.
 */
export function escrowStateToUCANState(
  escrowStatus: 'held' | 'started' | 'progressing' | 'settled' | 'released' | 'abandoned',
): 'active' | 'expired' | 'revoked'
```

**State matrix (from ADR-020):**
| Escrow | UCAN |
|--------|------|
| held | active |
| started | active |
| progressing | active |
| settled | expired |
| released | revoked |
| abandoned | revoked |

**Tests must cover:**
- All 6 escrow state → UCAN state mappings
- UCAN exp capped at escrow expiry
- Revocation set: add, check, list, clear
- Escrow settle → revocation check returns true
- Creating UCAN with exp > escrow expiry → auto-capped

---

## Wave 3: Integration (Units 16-18)

### Task 16: Gateway UCAN Auth (`src/gateway/server.ts`)

Add third auth method: `Authorization: Bearer ucan.<token>`

```typescript
// In preHandler, after existing Bearer token and Ed25519 identity checks:
if (authHeader?.startsWith('Bearer ucan.')) {
  const ucanToken = authHeader.slice('Bearer ucan.'.length);
  const decoded = decodeUCAN(ucanToken);
  // Resolve issuer's public key from agents table
  const pubkey = resolvePublicKey(decoded.payload.iss);
  if (pubkey && verifyUCAN(ucanToken, pubkey).valid) {
    request._authenticated = true;
    request._ucanPayload = decoded.payload;
  }
}
```

**Files to modify:** `src/gateway/server.ts` (preHandler hook)

**Tests:** Integration test with UCAN auth header in `src/gateway/server.test.ts`

### Task 17: Relay UCAN (`src/relay/websocket-relay.ts`)

Add `ucan_token` to relay messages:

```typescript
// In RelayRequestMessage:
export interface RelayRequestMessage {
  // ... existing fields
  ucan_token?: string;  // Optional UCAN for capability delegation
}
```

**Files to modify:** `src/relay/websocket-relay.ts`, `src/relay/types.ts`

### Task 18: Conductor UCAN Delegation (`src/conductor/conductor-mode.ts`)

When forming teams, auto-generate sub-delegation UCANs:

```typescript
// After team formation, for each TeamMember:
const memberUCAN = delegateUCAN({
  parentToken: conductorUCAN,
  newAudienceDid: `did:agentbnb:${member.agent_id}`,
  narrowedAttenuations: [
    { with: `agentbnb://skill/${member.skill}`, can: 'invoke' }
  ],
  signerKey: conductorPrivateKey,
});
```

**Files to modify:** `src/conductor/conductor-mode.ts`

---

## Execution Order

```
Step 1: Create src/auth/ucan.ts + tests (Task 13)
Step 2: Create src/auth/ucan-delegation.ts + tests (Task 14)
Step 3: Create src/auth/ucan-escrow.ts + tests (Task 15)
Step 4: Modify src/gateway/server.ts (Task 16)
Step 5: Modify src/relay/websocket-relay.ts (Task 17)
Step 6: Modify src/conductor/conductor-mode.ts (Task 18)
```

Steps 1-3 are new files (no conflicts). Steps 4-6 modify existing files (sequential).

Tasks 14 and 15 can be parallelized after Task 13 is done.

## Verification

```bash
# After each task:
pnpm vitest run src/auth/<new-test-file>
pnpm vitest run --exclude '.claude/**' --exclude 'packages/**'
pnpm build

# After all tasks:
# Escrow state matrix test (24 cases: 6 escrow × 4 UCAN states)
pnpm vitest run src/auth/ucan-escrow.test.ts

# Delegation chain depth test
pnpm vitest run src/auth/ucan-delegation.test.ts

# Full regression
pnpm vitest run --exclude '.claude/**' --exclude 'packages/**'
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/adr/020-ucan-token.md` | Full UCAN specification |
| `src/auth/canonical-json.ts` | RFC 8785 serializer (import `canonicalize`) |
| `src/auth/ucan-resources.ts` | URI parser + matcher (import `parseResource`, `matchResource`, `isAttenuation`) |
| `src/credit/signing.ts` | Ed25519 (import `signEscrowReceipt`, `verifyEscrowReceipt`, `generateKeyPair`) |
| `src/identity/did.ts` | DID utilities (import `toDIDAgentBnB`, `parseDID`) |
| `src/identity/delegation.ts` | Existing delegation pattern (reference) |
| `src/credit/escrow.ts` | Escrow state machine (reference) |
| `src/gateway/server.ts` | Gateway auth (modify for Task 16) |
| `src/relay/websocket-relay.ts` | Relay messages (modify for Task 17) |
| `src/conductor/conductor-mode.ts` | Conductor (modify for Task 18) |

## Session Startup

```bash
cd ~/Github/agentbnb
git pull origin main
pnpm install
pnpm vitest run --exclude '.claude/**' --exclude 'packages/**'  # baseline green
pnpm build  # baseline clean
```
