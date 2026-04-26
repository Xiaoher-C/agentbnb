# Security Audit Report — Unit 1: DID / UCAN / VC Identity Layer

**Audit date:** 2026-04-27
**Auditor:** Security Reviewer (claude-sonnet-4-6)
**Scope:** `src/auth/**`, `src/identity/**`, `src/credentials/**`
**Branch:** `audit/unit-1-security-identity`
**Codebase version:** V1.0 (AgentBnB Agent Identity Protocol)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4     |
| WARNING  | 7     |
| INFO     | 5     |
| **Total**| **16**|

The identity layer is well-structured and uses Node.js built-in cryptography (`node:crypto`) correctly for core Ed25519 operations. Key generation, PKCS8/SPKI DER encoding, and signature verification primitives are sound. However, four critical issues were found that either directly bypass security controls or create systemic replay/impersonation risk in production deployments. Seven additional warnings represent design gaps that should be addressed before the network reaches significant scale.

---

## Category 1: Cryptography

### Finding 1: Two Separate Canonical JSON Implementations with Divergent Semantics
- **Files:** `src/credit/signing.ts:72–100` and `src/auth/canonical-json.ts:1–168`
- **Severity:** CRITICAL
- **Description:** The codebase contains two independent canonical JSON serializers used for signing different object classes:
  - `signing.ts::canonicalJson()` — used by `signEscrowReceipt()` / `verifyEscrowReceipt()`, which is the universal signing primitive used by DelegationTokens, RotationRecords, RevocationRecords, AgentCertificates, VCs, and EVM bridge links.
  - `auth/canonical-json.ts::canonicalize()` — used only for UCAN token encoding.

  The `signing.ts` implementation uses `JSON.stringify(sortForCanonicalJson(data))`, which is **not RFC 8785 compliant**. Specifically:
  1. It does not reject `NaN`, `Infinity`, or `-Infinity` — these become `null` in standard JSON stringify, silently corrupting data.
  2. It does not handle `-0` correctly; `JSON.stringify(-0)` produces `"0"`, which happens to match RFC 8785 by accident, but is not explicitly handled.
  3. The sort function uses `Object.keys().sort()`, which sorts by UTF-16 code units, not Unicode codepoints. For keys containing characters in the supplementary planes (U+10000+), these two sort orders can diverge, producing different byte sequences for the same input.
  4. The RFC 8785 `escapeString` escaping rules are not applied; `JSON.stringify` escapes forward slashes in some environments (`/` → `\/`), which would break cross-platform signature verification.

  The `auth/canonical-json.ts` is the correct RFC 8785 implementation, but it is only used for UCANs. All other signatures — including VC proofs, DID rotation records, agent certificates, and operator claims — use the non-compliant implementation.

  **Impact:** Any signed object that passes through `signEscrowReceipt` could potentially be forged if an attacker can craft input that produces the same canonical representation under the buggy serializer but different semantics (e.g., using a key containing supplementary-plane characters). More practically: a signature produced by one node using a different JSON engine (different `JSON.stringify` slash-escaping behavior) may fail verification on another node. This is a cross-platform interoperability failure that silently degrades security guarantees.
- **Suggested fix:** Replace the `canonicalJson()` function in `src/credit/signing.ts` with a call to `canonicalize()` from `src/auth/canonical-json.ts`. The correct implementation is already written; it is merely unused for the majority of signatures.

```typescript
// src/credit/signing.ts — replace the local canonicalJson + sortForCanonicalJson with:
import { canonicalize } from '../auth/canonical-json.js';

export function signEscrowReceipt(data: Record<string, unknown>, privateKey: Buffer): string {
  const message = Buffer.from(canonicalize(data), 'utf-8');
  // ...rest unchanged
}
```

---

### Finding 2: `buildDIDDocument` Extracts Raw Public Key by Slicing the Last 64 Hex Chars
- **File:** `src/identity/did.ts:189`
- **Severity:** WARNING
- **Description:** The `buildDIDDocument` function extracts the raw 32-byte Ed25519 key from a DER/SPKI-encoded hex string using `identity.public_key.slice(-64)` — i.e., taking the last 64 hex characters (32 bytes). This relies on the assumption that the SPKI DER structure for Ed25519 keys is always exactly the same length (44 bytes total: 12-byte header + 32-byte key) and that the raw key is always in the final 32 bytes.

  While this is currently correct for Node.js Ed25519 SPKI keys, it is fragile:
  - If the key material is ever stored as raw bytes (not SPKI-wrapped), the wrong bytes will be extracted, producing a different `did:key` for the same logical key.
  - The assumption is not validated; a malformed or truncated key string would silently extract wrong bytes.
- **Suggested fix:** Parse the DER structure explicitly using Node.js `createPublicKey({ key: buf, format: 'der', type: 'spki' }).export({ format: 'jwk' })` to extract the raw key as `x` (base64url), then convert. Alternatively, add a length assertion: `if (rawPubkey.length !== 32) throw ...`.

---

### Finding 3: `derivePseudoEVMAddress` Uses SHA-256 Instead of Keccak-256 — Misleading Documentation
- **File:** `src/identity/evm-bridge.ts:104–110`
- **Severity:** INFO
- **Description:** The function is documented as producing a "pseudo EVM address" using SHA-256 because Node.js does not include keccak-256 natively. The code comment acknowledges this: "the result is not EVM-compatible." However, the returned string has the same format as a real EVM address (`0x` + 20 hex bytes) and is described in the broader system as usable for "credit settlement mapping."

  The concern is that consumers of this value — external EVM contracts, wallets, or the planned ERC-8004 integration — may treat it as a real Ethereum address. If the EVM bridge ever connects to an actual EVM chain, using SHA-256-derived "addresses" as if they were secp256k1-derived Ethereum addresses constitutes a silent security failure (funds sent to the SHA-256 address cannot be claimed by anyone, since no secp256k1 private key corresponds to it).
- **Suggested fix:** Rename to `deriveAgentEVMSlot()` or similar to make clear it is not a real Ethereum address. Add a runtime assertion or type-level marker (a branded type `EVMSlot` vs `EVMAddress`) to prevent it from being passed to functions expecting real Ethereum addresses.

---

## Category 2: Canonical JSON (RFC 8785)

### Finding 4: `auth/canonical-json.ts` Handles Unicode Surrogates Silently (Potential Signature Malleability)
- **File:** `src/auth/canonical-json.ts:20–47`
- **Severity:** WARNING
- **Description:** The `escapeString` function iterates over string characters using their charCode values but does not detect unpaired surrogate code points (U+D800–U+DFFF). RFC 8785 Section 3.2.2.2 mandates that lone surrogates be escaped as `\uXXXX`. JavaScript strings can contain unpaired surrogates, and they are valid in UTF-16 (the encoding of JS strings) but are ill-formed in UTF-8.

  If a UCAN payload field contains an unpaired surrogate (e.g., from a crafted input), the serialized canonical JSON may differ between environments that handle surrogates differently, potentially allowing signature bypass or cross-platform verification failures.
- **Suggested fix:** Add surrogate detection in `escapeString`:
```typescript
// After the existing ch < 0x20 block:
// Handle surrogate pairs and lone surrogates
if (ch >= 0xD800 && ch <= 0xDFFF) {
  result += '\\u' + ch.toString(16).padStart(4, '0');
  continue;
}
```

---

### Finding 5: `auth/canonical-json.ts` Does Not Validate Input Object Prototype Chain
- **File:** `src/auth/canonical-json.ts:157`
- **Severity:** INFO
- **Description:** `serializeObject` accepts `Record<string, unknown>` but does not check whether the input has a non-plain prototype (e.g., a `Date` object, `Map`, `Set`, or class instance). Unlike `signing.ts::sortForCanonicalJson()` which explicitly guards `Object.getPrototypeOf(value) === Object.prototype`, the `auth/canonical-json.ts` serializer will silently serialize instances of classes using only their enumerable properties. This means a `Date` object will serialize to `{}` (empty object) rather than throwing, potentially producing a signature over an empty object when the developer intended to sign the date value.
- **Suggested fix:** Add an explicit check in `serializeObject`:
```typescript
function serializeObject(obj: Record<string, unknown>): string {
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new AgentBnBError(
      `Cannot canonicalize non-plain object of type ${Object.prototype.toString.call(obj)}`,
      'CANONICAL_JSON_ERROR',
    );
  }
  // ...rest unchanged
}
```

---

## Category 3: UCAN Token Engine

### Finding 6: UCAN Nonce Replay Protection is Not Implemented
- **File:** `src/auth/ucan.ts` (entire file), `src/gateway/server.ts:117–137`
- **Severity:** CRITICAL
- **Description:** ADR-020 specifies that nonces (`nnc`) must be tracked in a local set to prevent replay attacks (Section "Verification Algorithm", step 9). The `createUCAN` function generates a nonce using `randomUUID()` (line 86), and the `UCANPayload` interface declares `nnc: string`. However, **no nonce tracking or replay detection is implemented anywhere in the production code**.

  The functions `isNonceUsed()` and `markNonceUsed()` referenced in the ADR's pseudocode do not exist in the codebase. The gateway's UCAN verification path (gateway/server.ts:119–137) calls `verifyUCAN()` (signature check only) and `decodeUCAN()`, but never checks for nonce reuse.

  **Impact:** Any captured UCAN token can be replayed within its validity window (up to escrow expiry). For long-lived escrows, this window can be hours. An attacker who intercepts a UCAN token over an insecure channel (or from logs) can replay it unlimited times to invoke the bound skill.
- **Suggested fix:** Implement a nonce store. Given the local-first architecture, an in-process `Map<string, number>` (nonce → expiry) per gateway instance is sufficient, with periodic pruning of expired entries:

```typescript
// In gateway/server.ts or a new src/auth/nonce-store.ts:
const nonceStore = new Map<string, number>(); // nnc -> exp

function checkAndConsumeNonce(nnc: string, exp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  // Prune expired entries
  for (const [n, e] of nonceStore) {
    if (e <= now) nonceStore.delete(n);
  }
  if (nonceStore.has(nnc)) return false; // replay
  nonceStore.set(nnc, exp);
  return true;
}
```

---

### Finding 7: Gateway UCAN Verification Trusts the Caller-Supplied Public Key Header
- **File:** `src/gateway/server.ts:119–137`
- **Severity:** CRITICAL
- **Description:** The gateway's UCAN auth path resolves the issuer's public key from the `X-Agent-Public-Key` HTTP header (line 124), not from a trusted DID resolver or local agent registry. The UCAN `iss` field contains the issuer DID (`did:agentbnb:<agent_id>`), but the gateway ignores this field entirely and instead uses the key supplied by the caller.

  This means any party can:
  1. Generate a fresh Ed25519 keypair.
  2. Create a UCAN token with an arbitrary `iss` DID, signing it with the fresh key.
  3. Send the UCAN token in `Authorization: Bearer ucan.<token>` and supply the fresh public key in `X-Agent-Public-Key`.
  4. The gateway will verify the signature successfully (signature matches key), mark the request as authenticated, and execute the requested skill under the impersonated agent's identity.

  The `decoded.payload` is attached to the request as `_ucanPayload`, and downstream skill execution reads `iss` from it to determine which agent is acting. An attacker can impersonate any agent without their private key.
- **Suggested fix:** Resolve the public key from the `iss` DID in the UCAN payload using the local agent registry, not from a caller-supplied header. The `resolveIdentifier()` function in `src/identity/agent-identity.ts` provides the lookup:

```typescript
// In gateway preHandler, UCAN path:
const decoded = decodeUCAN(ucanToken);
const agentId = decoded.payload.iss.replace('did:agentbnb:', '');
const agentRecord = lookupAgent(creditDb, agentId); // or registryDb
if (!agentRecord) {
  return reply.status(401).send({ ... });
}
const pubKeyBuf = Buffer.from(agentRecord.public_key, 'hex');
const ucanResult = verifyUCAN(ucanToken, pubKeyBuf);
```

---

### Finding 8: `delegateUCAN` Does Not Verify the Parent Token's Signature Before Delegating
- **File:** `src/auth/ucan-delegation.ts:73–103`
- **Severity:** WARNING
- **Description:** `delegateUCAN()` calls `decodeUCAN(opts.parentToken)` to read the parent's attenuations and expiry, but it does not call `verifyUCAN()` to verify the parent's signature. An attacker could craft a parent token with a forged or invalid signature, extract its `att` and `exp` fields, create a sub-delegation claiming those permissions, and present the delegation chain to a verifier.

  The `validateChain()` function in the same file does correctly verify all signatures, so the issue is only in `delegateUCAN()` itself — it trusts the parent's claims without verification.
- **Suggested fix:** Add a `resolvePublicKey` parameter to `delegateUCAN()` and call `verifyUCAN()` on the parent before proceeding:
```typescript
export function delegateUCAN(opts: {
  parentToken: string;
  resolvePublicKey: (did: string) => Buffer | null;
  // ...rest
}): string {
  const parent = decodeUCAN(opts.parentToken);
  const parentPubKey = opts.resolvePublicKey(parent.payload.iss);
  if (!parentPubKey) throw new AgentBnBError('Cannot resolve parent issuer public key', 'UCAN_DELEGATION_ERROR');
  const verification = verifyUCAN(opts.parentToken, parentPubKey);
  if (!verification.valid) throw new AgentBnBError(`Parent token invalid: ${verification.reason}`, 'UCAN_DELEGATION_ERROR');
  // ...rest unchanged
}
```

---

### Finding 9: `validateChain` Does Not Check Temporal Validity (Expiry) of Individual Tokens
- **File:** `src/auth/ucan-delegation.ts:113–190`
- **Severity:** WARNING
- **Description:** `validateChain()` verifies signatures, audience/issuer chain linkage, expiry inheritance (child exp ≤ parent exp), and attenuation narrowing. However, it does not check whether any individual token has expired against the current time (`now`). It is valid to call `validateChain()` on a fully expired chain and receive `{ valid: true }`.

  This means a caller using `validateChain()` alone (without a separate expiry check) will accept expired delegation chains as valid.
- **Suggested fix:** Add temporal validity checking within `validateChain()`:
```typescript
const now = Math.floor(Date.now() / 1000);
for (let i = 0; i < decoded.length; i++) {
  if (decoded[i]!.payload.exp <= now) {
    return { valid: false, reason: `Token at position ${i} has expired`, depth };
  }
  if (decoded[i]!.payload.nbf && decoded[i]!.payload.nbf! > now) {
    return { valid: false, reason: `Token at position ${i} is not yet valid`, depth };
  }
}
```

---

### Finding 10: UCAN `prf` Field Stores Full Token Strings — Not CIDs as Specified in ADR-020
- **File:** `src/auth/ucan-delegation.ts:100–102`, `src/auth/ucan.ts:79`
- **Severity:** WARNING
- **Description:** ADR-020 specifies "CIDs or inline references to parent UCAN tokens" for the `prf` field. The actual implementation stores the full base64url-encoded parent token string directly in `prf[]` (see `ucan-delegation.ts:100`: `proofs: [opts.parentToken]`).

  The UCAN spec (v0.10.0) defines `prf` as an array of CIDs (Content Identifiers) that reference parent tokens by hash. Embedding full parent tokens instead of CIDs has two security implications:
  1. **Token size growth is quadratic**: A depth-2 chain contains the root token embedded inside the depth-1 token inside the depth-2 token.
  2. **No content-binding**: Without CIDs, there is no commitment to a specific parent token bytes. While signature verification provides this implicitly, the spec-defined CID approach provides an additional layer.

  This is a spec conformance issue that will create incompatibility if AgentBnB ever needs to interoperate with other UCAN implementations.
- **Suggested fix:** Document this as an intentional simplification ("inline proof embedding") or implement CID-based proofs. If staying with inline embedding, update ADR-020 to reflect this divergence.

---

## Category 4: Escrow-UCAN Lifecycle Binding

### Finding 11: `UCANRevocationSet` is In-Memory Only — No Persistence or Cross-Process Sharing
- **File:** `src/auth/ucan-escrow.ts:88–110`
- **Severity:** CRITICAL
- **Description:** The `UCANRevocationSet` class stores revocations in a JavaScript `Set<string>` in process memory. When the gateway process restarts (crash, deploy, or scheduled restart), all revocations are lost.

  **Scenario:** An escrow transitions to `released` (refund), `revokeByEscrow()` is called, the gateway process crashes 1 second later, and on restart the revocation set is empty. UCANs bound to the released escrow are now accepted again, granting access to resources that should be inaccessible.

  Additionally, the `UCANRevocationSet` is exported from the module but there is no wiring in the gateway code (`src/gateway/server.ts`) that connects escrow state transitions to this revocation set. The gateway's UCAN auth path does not consult the `UCANRevocationSet` at all; it only calls `verifyUCAN()` (signature check) and `decodeUCAN()`. The escrow binding check described in ADR-020 Step 6 is not implemented in the gateway.
- **Suggested fix:**
  1. Persist revocations to the SQLite credit database (a `ucan_revocations` table with `escrow_id`, `revoked_at`, `reason`).
  2. Wire escrow state transitions in `src/credit/escrow.ts` to insert into this table.
  3. Add a revocation check in the gateway UCAN auth path by querying the table.

---

### Finding 12: No Race-Condition Protection on Escrow State → UCAN Invalidation Transition
- **File:** `src/auth/ucan-escrow.ts`, `src/credit/escrow.ts` (referenced)
- **Severity:** WARNING
- **Description:** ADR-020 acknowledges "a brief race window between escrow state change and next verification" and marks it as acceptable. However, the actual implementation has a wider-than-documented race window because the `UCANRevocationSet` is not connected to escrow state transitions at all (see Finding 11). The "brief race" assumes the revocation set is updated atomically with the escrow transition. Without that wiring, the race window is unbounded (until process restart or manual intervention).

  Additionally, for multi-instance deployments (multiple gateway processes sharing the same SQLite file), in-memory revocation state cannot be shared across instances at all.
- **Suggested fix:** Treat as a follow-on to Finding 11. Once revocations are persisted to SQLite and the check is in the gateway, the race window reduces to the SQLite WAL read delay (typically microseconds).

---

## Category 5: EVM Bridge

### Finding 13: EVM Bridge Link Has No Chain-ID Binding or Domain Separator
- **File:** `src/identity/evm-bridge.ts:19–31`
- **Severity:** WARNING
- **Description:** The `EVMBridgeLink` payload signed by the Ed25519 key contains `{ ed25519_public_key, evm_address, agent_did, timestamp }`. There is no chain ID, network identifier, or domain separator in the signed payload.

  If AgentBnB deploys to multiple EVM chains (mainnet, testnet, a rollup), a link signed for testnet is valid on mainnet. An attacker who compromises a low-stakes testnet identity can replay the bridge link on mainnet to claim the same EVM address binding in a higher-value context.
- **Suggested fix:** Add a `chain_id` and `domain` field to the signed payload:
```typescript
function buildLinkPayload(opts: { ...; chainId: string; domain: string }): Record<string, unknown> {
  return {
    domain: opts.domain,        // e.g., "agentbnb.dev/evm-bridge/v1"
    chain_id: opts.chainId,     // e.g., "1" for Ethereum mainnet
    ed25519_public_key: ...,
    // ...rest
  };
}
```

---

## Category 6: DID Rotation and Revocation

### Finding 14: `DIDRevocationRegistry` Permits Anyone to Revoke Any DID
- **File:** `src/identity/did-revocation.ts:56–64`
- **Severity:** WARNING
- **Description:** The `DIDRevocationRegistry.revoke()` method accepts a `RevocationRecord` and only checks that its Ed25519 signature is valid for the `revoker_public_key` field. It does not verify that the `revoker_public_key` corresponds to the owner of the DID being revoked.

  This means any agent with a valid keypair can create a signed revocation record for any DID (including other agents') by signing with their own key and claiming to be the revoker. The signature will be valid, and the `revoke()` call will succeed.

  **Impact:** Any registered agent can revoke any other agent's DID, permanently removing them from the network.
- **Suggested fix:** The `revoke()` function (or its caller) must verify that `revoker_public_key` matches the public key associated with the `did` being revoked. This requires a registry lookup:
```typescript
revoke(record: RevocationRecord, resolvePublicKey: (did: string) => string | null): void {
  const ownerPubKey = resolvePublicKey(record.did);
  if (!ownerPubKey || ownerPubKey !== record.revoker_public_key) {
    throw new AgentBnBError('Revocation rejected: revoker is not the DID owner', 'REVOCATION_UNAUTHORIZED');
  }
  if (!verifyRevocationRecord(record)) {
    throw new AgentBnBError('Revocation record has an invalid signature', 'REVOCATION_INVALID_SIGNATURE');
  }
  this.records.set(record.did, record);
}
```

---

### Finding 15: `DIDRevocationRegistry` is In-Memory Only — Revocations Lost on Restart
- **File:** `src/identity/did-revocation.ts:46–101`
- **Severity:** INFO
- **Description:** Like the `UCANRevocationSet` (Finding 11), the `DIDRevocationRegistry` stores all revocations in a JavaScript `Map` in process memory. Revocations are lost on process restart. A revoked DID is not revoked after restart.

  For the DID revocation specifically, since it is described as "permanent" in CLAUDE.md and ADR-020, losing the revocation state on restart is a more serious availability concern than for UCANs (which are time-bounded).
- **Suggested fix:** Persist `RevocationRecord` objects to a `did_revocations` table in SQLite, loaded into the in-memory registry on startup.

---

## Category 7: Verifiable Credentials

### Finding 16: `verifyCredential` Does Not Check VC Expiration Date
- **File:** `src/credentials/vc.ts:103–116`
- **Severity:** INFO
- **Description:** The `verifyCredential()` function verifies the Ed25519 signature but does not check whether `vc.expirationDate` has passed. A caller that relies solely on `verifyCredential()` returning `true` will accept expired credentials.

  The `issueCredential()` function accepts an optional `expirationDate`, and the `AgentReputationCredential` and `AgentSkillCredential` types benefit from expiry enforcement (weekly refresh cycle implies credentials should expire weekly). Without expiry enforcement in verification, stale reputation data could be presented indefinitely if an agent stops participating in the weekly refresh.
- **Suggested fix:** Add expiry checking to `verifyCredential()`:
```typescript
export function verifyCredential(vc: VerifiableCredential, issuerPublicKey: Buffer): boolean {
  if (vc.expirationDate && new Date(vc.expirationDate) < new Date()) {
    return false;
  }
  // ...rest unchanged
}
```
  Alternatively, return `{ valid: boolean; reason?: string }` to distinguish expiry from signature failure.

---

## Summary Table

| # | File | Severity | Category | Title |
|---|------|----------|----------|-------|
| 1 | `src/credit/signing.ts:72` | CRITICAL | Cryptography | Two canonical JSON implementations; `signing.ts` is not RFC 8785 compliant |
| 2 | `src/identity/did.ts:189` | WARNING | Cryptography | `buildDIDDocument` slices raw key by fixed offset — fragile |
| 3 | `src/identity/evm-bridge.ts:104` | INFO | Cryptography | `derivePseudoEVMAddress` uses SHA-256 but is formatted as EVM address |
| 4 | `src/auth/canonical-json.ts:20` | WARNING | Canonical JSON | Lone surrogate code points not handled per RFC 8785 |
| 5 | `src/auth/canonical-json.ts:157` | INFO | Canonical JSON | Non-plain objects silently serialize to `{}` |
| 6 | `src/auth/ucan.ts`, `src/gateway/server.ts` | CRITICAL | UCAN | Nonce replay protection not implemented |
| 7 | `src/gateway/server.ts:124` | CRITICAL | UCAN | UCAN issuer key resolved from caller header, not DID registry — allows impersonation |
| 8 | `src/auth/ucan-delegation.ts:73` | WARNING | UCAN | `delegateUCAN` does not verify parent token signature |
| 9 | `src/auth/ucan-delegation.ts:113` | WARNING | UCAN | `validateChain` does not check token expiry against current time |
| 10 | `src/auth/ucan-delegation.ts:100` | WARNING | UCAN | `prf` stores full token strings, not CIDs — spec divergence |
| 11 | `src/auth/ucan-escrow.ts:88` | CRITICAL | Escrow/UCAN | `UCANRevocationSet` in-memory only; not wired to gateway; revocations lost on restart |
| 12 | `src/auth/ucan-escrow.ts` | WARNING | Escrow/UCAN | No race protection; escrow transition → UCAN invalidation not connected |
| 13 | `src/identity/evm-bridge.ts:19` | WARNING | EVM Bridge | No chain-ID binding or domain separator in bridge link payload |
| 14 | `src/identity/did-revocation.ts:56` | WARNING | Revocation | `DIDRevocationRegistry.revoke()` does not verify revoker owns the DID |
| 15 | `src/identity/did-revocation.ts:46` | INFO | Revocation | `DIDRevocationRegistry` in-memory only — revocations lost on restart |
| 16 | `src/credentials/vc.ts:103` | INFO | VC | `verifyCredential` does not check `expirationDate` |

---

## Priority Action Plan

### Immediate (block production traffic until resolved)

1. **Finding 7** — Fix UCAN issuer key resolution. The current gateway allows impersonation of any registered agent. This is a trivial exploit that requires no cryptographic capability.
2. **Finding 6** — Implement nonce store. Without nonce tracking, every UCAN token issued is replayable. Combine with Finding 7 fix.
3. **Finding 11** — Wire `UCANRevocationSet` to escrow state transitions and persist to SQLite. Without this, the escrow-binding security property of UCANs does not exist at runtime.
4. **Finding 1** — Unify the two canonical JSON implementations. Use the RFC 8785 compliant `canonicalize()` for all signatures. The non-compliant `signing.ts` serializer is the foundation of every other signature in the system.

### Short-term (before network launch / public beta)

5. **Finding 14** — Add DID ownership check to `DIDRevocationRegistry.revoke()`. This is a privilege escalation on the identity layer.
6. **Finding 8** — Add parent signature verification in `delegateUCAN()`.
7. **Finding 9** — Add expiry checking in `validateChain()`.
8. **Finding 15** — Persist DID revocations to SQLite.

### Medium-term (before EVM bridge feature is enabled)

9. **Finding 13** — Add chain-ID binding to EVM bridge link payload.
10. **Finding 3** — Rename `derivePseudoEVMAddress` to avoid confusion with real Ethereum addresses.

### Low priority / maintenance

11. **Finding 4** — Handle lone surrogates in canonical JSON escapeString.
12. **Finding 2** — Add explicit DER length validation in `buildDIDDocument`.
13. **Finding 5** — Add non-plain object guard in `canonicalize`.
14. **Finding 16** — Add expiry check in `verifyCredential`.
15. **Finding 10** — Document or resolve CID vs inline token divergence from UCAN spec.
16. **Finding 12** — Race-condition note; resolved as a side effect of Finding 11.

---

## Notes on False Positives Considered

- **`randomUUID()` for UCAN nonces** (`src/auth/ucan.ts:86`): Using `randomUUID()` from `node:crypto` for nonce generation is cryptographically sound. This is not a finding.
- **`Math.random()` usage**: All occurrences of `Math.random()` in the audit scope are in test files or for non-security purposes (retry jitter in `relay/websocket-client.ts`). None are in cryptographic paths.
- **`JSON.stringify(vc)` in `vc-scheduler.ts:57`**: This is for database storage of a complete VC object, not for signing. The VC was already signed before storage. Not a finding.
- **`as any` usages**: None found in the audit scope files; usages were in conductor test files and the relay server WebSocket handler, outside audit scope.
- **DER key encoding**: Key generation and encoding in `src/credit/signing.ts:20–28` uses `generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'der' } })` which is correct and uses Node.js built-in crypto. No external crypto library is introduced.
- **`src/identity/guarantor.ts` GitHub OAuth**: CSRF state tokens are generated with `randomUUID()` (cryptographically secure), stored in SQLite, and deleted after use. The 10-minute cleanup is reasonable. Not a finding.
