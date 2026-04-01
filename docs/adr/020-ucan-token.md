# ADR-020: UCAN Token Specification for AgentBnB

## Status

Accepted

## Date

2026-04-01

## Context

AgentBnB's current authorization model uses two methods, both checked sequentially in the gateway (`src/gateway/server.ts`):

1. **Bearer token** -- a shared secret validated against a static token set.
2. **Ed25519 identity headers** -- `X-Agent-Id`, `X-Agent-Public-Key`, and `X-Agent-Signature` headers where the request body is signed and verified against the agent's public key.

These methods have three structural limitations:

**No resource scoping.** A valid Bearer token or Ed25519 signature grants access to the entire `/rpc` endpoint. There is no way to express "Agent B may invoke skill X on my card but not skill Y" or "Agent B may read my knowledge base but not write to it." Authorization is all-or-nothing.

**No delegation chains.** When the Conductor orchestrates a team (Agent A hires Agent B, who sub-contracts Agent C), each hop requires direct auth negotiation. The existing `DelegationToken` in `src/identity/delegation.ts` supports server-to-agent delegation with a flat permission list (`serve | publish | settle | request`), but it cannot express transitive delegation -- A authorizing B to authorize C -- with progressive attenuation.

**No escrow lifecycle binding.** Auth tokens and escrow records live in separate worlds. A Bearer token remains valid after an escrow is settled or released. There is no mechanism to automatically revoke access when the economic relationship ends. This creates a window where Agent B retains access to Agent A's resources after the task is complete and payment is finalized.

AgentBnB's agent-native design philosophy (see `AGENT-NATIVE-PROTOCOL.md`) demands that authorization be machine-verifiable without human intervention, work offline, and compose across multi-agent pipelines. UCAN satisfies all three requirements.

## Decision

Adopt UCAN (User Controlled Authorization Networks) v0.10.0 as a third, additive authorization method with AgentBnB-specific extensions for escrow binding and resource scoping.

### Token Format

A UCAN token is a signed JWT with three base64url-encoded segments: `header.payload.signature`.

**Header:**

```json
{
  "alg": "EdDSA",
  "typ": "JWT",
  "ucv": "0.10.0"
}
```

- `alg`: Always `EdDSA` (Ed25519), matching AgentBnB's existing key infrastructure.
- `ucv`: UCAN specification version. Pinned to `0.10.0`.

**Payload:**

```json
{
  "iss": "did:agentbnb:agent_abc123",
  "aud": "did:agentbnb:agent_def456",
  "exp": 1743638400,
  "nbf": 1743552000,
  "nnc": "a1b2c3d4e5f6",
  "att": [
    {
      "with": "agentbnb://skill/deep-stock-analysis",
      "can": "invoke",
      "nb": {
        "max_calls": 5,
        "input_schema_hash": "sha256:abc123..."
      }
    }
  ],
  "prf": [],
  "fct": {
    "escrow_id": "550e8400-e29b-41d4-a716-446655440000",
    "task_description": "Analyze TSMC quarterly earnings"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `iss` | string | yes | Issuer DID. The agent granting authorization. Format: `did:agentbnb:<agent_id>` |
| `aud` | string | yes | Audience DID. The agent receiving authorization. |
| `exp` | number | yes | Expiry (Unix timestamp). Must be <= the bound escrow's expiry. |
| `nbf` | number | no | Not-before (Unix timestamp). Token is invalid before this time. |
| `nnc` | string | yes | Nonce. 12+ character random string for replay protection. |
| `att` | array | yes | Attenuations. Array of `{ with, can, nb? }` resource grants. |
| `prf` | array | yes | Proof chain. CIDs or inline references to parent UCAN tokens. Empty for root tokens. |
| `fct` | object | no | Facts. Metadata including `escrow_id` and `task_description`. |

**Signature:**

Ed25519 signature over `base64url(header).base64url(payload)` using the issuer's private key. Verification uses the public key resolved from the issuer's DID.

### DID Method: `did:agentbnb`

AgentBnB agents use a project-specific DID method that resolves directly to Ed25519 public keys already managed by the identity module (`src/identity/identity.ts`).

```
did:agentbnb:<agent_id>
```

Resolution: Given `did:agentbnb:agent_abc123`, look up the agent's public key via `resolveIdentifier()` in `src/identity/agent-identity.ts`. No external DID registry is required -- the agent's local registry database is the resolver.

This aligns with the local-first principle from `AGENT-NATIVE-PROTOCOL.md`: "All data is stored locally in a SQLite database. No cloud service is required for core protocol operation."

### Resource URI Scheme

All AgentBnB resources are addressed with the `agentbnb://` URI scheme:

| URI Pattern | Description | Example |
|-------------|-------------|---------|
| `agentbnb://skill/<skill_id>` | A specific skill on a capability card | `agentbnb://skill/deep-stock-analysis` |
| `agentbnb://escrow/<escrow_id>` | An escrow record | `agentbnb://escrow/550e8400-...` |
| `agentbnb://agent/<agent_id>` | All resources owned by an agent | `agentbnb://agent/agent_abc123` |
| `agentbnb://kb/<path>` | Knowledge base resource | `agentbnb://kb/earnings/2026-q1` |
| `agentbnb://card/<card_id>` | A capability card | `agentbnb://card/genesis-bot-card` |

**Wildcard:** `agentbnb://agent/<agent_id>/*` grants access to all resources under that agent. This is equivalent to today's Bearer token behavior and serves as the migration path for existing integrations.

### Actions

| Action | Meaning | Applicable Resources |
|--------|---------|---------------------|
| `invoke` | Execute a skill | `skill`, `agent` |
| `read` | Read resource data | `kb`, `card`, `escrow`, `agent` |
| `write` | Modify resource data | `kb`, `card`, `agent` |
| `settle` | Settle or release an escrow | `escrow` |
| `delegate` | Create a sub-UCAN for this resource | All |

### Caveat System (`nb` field)

Caveats further restrict what an action can do. They are optional per-attenuation constraints.

```typescript
interface Caveat {
  /** Maximum number of invocations allowed under this attenuation. */
  max_calls?: number;
  /** SHA-256 hash of the expected input schema (prevents parameter injection). */
  input_schema_hash?: string;
  /** Maximum credit cost per invocation. */
  max_cost_per_call?: number;
  /** Restrict to specific escrow lifecycle states. */
  allowed_escrow_states?: EscrowStatus[];
}
```

### Escrow Binding Rules

The binding between UCAN tokens and escrow lifecycle is the core AgentBnB extension to the UCAN spec.

**Rule 1: Temporal constraint.** `UCAN.exp` must be less than or equal to the escrow's expiry timestamp. This is enforced at UCAN creation time. A UCAN cannot outlive its economic backing.

**Rule 2: Terminal state invalidation.** When an escrow transitions to a terminal state (`settled` or `released`), all UCANs referencing that escrow via `fct.escrow_id` are automatically invalidated. The verifier checks escrow status as part of token validation.

**Rule 3: Abandoned state revocation.** When an escrow transitions to `abandoned`, derived UCANs are revoked. The abandoned state in the escrow lifecycle (`src/credit/escrow.ts`) maps directly to UCAN revocation.

### Escrow-UCAN State Matrix

This matrix defines what an authorized agent can do at each stage of the escrow lifecycle. The escrow states come from `src/credit/escrow.ts` (`EscrowStatus` type).

| Escrow State | UCAN State | Agent Can | Agent Cannot |
|---|---|---|---|
| `held` | active | Access scoped resources, prepare execution | Exceed scope, exceed time bound, delegate beyond depth 3 |
| `started` | active | Execute skill, access scoped resources, emit progress | Widen permissions, access unscoped resources |
| `progressing` | active | Continue execution, read intermediate results | Widen permissions, create new escrows under this UCAN |
| `settled` | expired | Nothing -- task complete, payment finalized | Any further resource access |
| `released` | revoked | Nothing -- credits refunded to consumer | Any further resource access |
| `abandoned` | revoked | Nothing -- requester disconnected | Any further resource access |

**Implementation note:** The `held` -> `started` transition (triggered by `markEscrowStarted()` in `src/credit/escrow.ts`) does not change UCAN state. Both map to `active`. The distinction matters only for the relay's timeout policy (`RELAY_IDLE_TIMEOUT_MS` vs `RELAY_HARD_TIMEOUT_MS` in `src/relay/websocket-relay.ts`).

### Delegation Rules

**1. Attenuation only.** A delegated UCAN can only narrow the parent's permissions, never widen them. If the parent grants `invoke` on `agentbnb://skill/stock-analysis`, the child cannot grant `invoke` on `agentbnb://skill/*`. The verifier walks the proof chain and confirms each link is a subset of its parent.

**2. Chain depth limit: 3.** Maximum delegation depth is A -> B -> C -> D (3 hops). This bounds verification cost and limits blast radius of key compromise. The depth is counted from the root UCAN (the one with `prf: []`).

```
Root (depth 0):  Agent A creates UCAN for Agent B     [prf: []]
Depth 1:         Agent B delegates to Agent C          [prf: [root_cid]]
Depth 2:         Agent C delegates to Agent D          [prf: [depth1_cid]]
Depth 3:         REJECTED -- exceeds maximum depth
```

**3. Offline verification.** Any party holding a UCAN chain can verify it without contacting the relay or any central service. Verification requires only the public keys (resolvable from DIDs) and the token chain itself.

**4. Escrow inheritance.** Sub-delegated UCANs inherit the parent's escrow binding. If the root UCAN references `escrow_id: X`, all derived tokens are bound to escrow X's lifecycle. A child UCAN cannot reference a different escrow.

### Delegation Scenarios

**Scenario 1: Simple Hire (genesis-bot -> deep-stock-analyst)**

genesis-bot needs stock analysis. It holds escrow, creates a root UCAN, and sends the request.

```
1. genesis-bot holds escrow (escrow_id: ESC-001)
2. genesis-bot creates UCAN:
   iss: did:agentbnb:genesis-bot
   aud: did:agentbnb:deep-stock-analyst
   att: [{ with: "agentbnb://skill/stock-analysis", can: "invoke" }]
   fct: { escrow_id: "ESC-001" }
   prf: []
3. genesis-bot sends relay_request with UCAN attached
4. deep-stock-analyst verifies UCAN, executes skill
5. Escrow settles -> UCAN automatically expires
```

**Scenario 2: Team Formation with Sub-Delegation**

A conductor agent orchestrates a research team. It delegates scoped access to each team member.

```
1. client-agent holds escrow (escrow_id: ESC-002, amount: 50 credits)
2. client-agent creates root UCAN for conductor:
   iss: did:agentbnb:client-agent
   aud: did:agentbnb:conductor
   att: [
     { with: "agentbnb://skill/research-pipeline", can: "invoke" },
     { with: "agentbnb://skill/research-pipeline", can: "delegate" }
   ]
   fct: { escrow_id: "ESC-002" }

3. conductor sub-delegates to researcher (depth 1, attenuated):
   iss: did:agentbnb:conductor
   aud: did:agentbnb:researcher
   att: [{ with: "agentbnb://skill/web-search", can: "invoke", nb: { max_calls: 10 } }]
   fct: { escrow_id: "ESC-002" }
   prf: [root_ucan_cid]

4. conductor sub-delegates to summarizer (depth 1, attenuated):
   iss: did:agentbnb:conductor
   aud: did:agentbnb:summarizer
   att: [{ with: "agentbnb://kb/research-results", can: "read" }]
   fct: { escrow_id: "ESC-002" }
   prf: [root_ucan_cid]

5. Each team member can verify their UCAN offline
6. Escrow settles -> all 3 UCANs (root + 2 delegated) expire
```

**Scenario 3: Multi-Hop Pipeline**

Agent A needs a video generated from text. The pipeline crosses three agents.

```
1. agent-a holds escrow (ESC-003)
2. agent-a -> script-writer:  UCAN with invoke on text-to-script
3. script-writer -> voice-actor:  sub-UCAN (depth 1) with invoke on tts
   (attenuated: only TTS, not script-writing)
4. voice-actor -> video-gen:  sub-UCAN (depth 2) with invoke on video-render
   (attenuated: only video rendering, read-only on audio output)
5. Depth 2 is the last hop -- video-gen cannot delegate further at depth 3
6. Results propagate back through the chain
7. ESC-003 settles -> entire UCAN tree invalidated
```

### Verification Algorithm

```typescript
/**
 * Verifies a UCAN token chain.
 *
 * @param token - The UCAN to verify (base64url-encoded JWT string).
 * @param resourceUri - The resource being accessed.
 * @param action - The action being performed.
 * @param escrowDb - Database for escrow status lookups.
 * @returns Verification result with valid flag and optional reason.
 */
async function verifyUcan(
  token: string,
  resourceUri: string,
  action: string,
  escrowDb: Database,
): Promise<{ valid: boolean; reason?: string; att?: Attenuation[] }> {
  // 1. Decode and parse JWT segments
  const { header, payload, signature } = decodeJwt(token);

  // 2. Check algorithm and version
  if (header.alg !== 'EdDSA' || header.ucv !== '0.10.0') {
    return { valid: false, reason: 'Unsupported algorithm or UCAN version' };
  }

  // 3. Resolve issuer public key from DID
  const publicKey = await resolveDidToPublicKey(payload.iss);
  if (!publicKey) {
    return { valid: false, reason: `Cannot resolve issuer DID: ${payload.iss}` };
  }

  // 4. Verify Ed25519 signature
  if (!verifyEd25519(header, payload, signature, publicKey)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  // 5. Check temporal validity
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return { valid: false, reason: 'Token expired' };
  }
  if (payload.nbf && payload.nbf > now) {
    return { valid: false, reason: 'Token not yet valid' };
  }

  // 6. Check escrow binding (AgentBnB extension)
  if (payload.fct?.escrow_id) {
    const escrow = getEscrowStatus(escrowDb, payload.fct.escrow_id);
    if (!escrow) {
      return { valid: false, reason: 'Bound escrow not found' };
    }
    const terminalStates = new Set(['settled', 'released', 'abandoned']);
    if (terminalStates.has(escrow.status)) {
      return { valid: false, reason: `Bound escrow is ${escrow.status}` };
    }
  }

  // 7. Check attenuation grants the requested action on the requested resource
  const granted = payload.att.some(
    (a) => matchesResource(a.with, resourceUri) && matchesAction(a.can, action),
  );
  if (!granted) {
    return { valid: false, reason: 'Requested action not in attenuation scope' };
  }

  // 8. Verify proof chain (delegation depth and attenuation-only rule)
  if (payload.prf.length > 0) {
    const chainDepth = await getChainDepth(payload.prf);
    if (chainDepth >= 3) {
      return { valid: false, reason: 'Delegation chain exceeds maximum depth (3)' };
    }

    for (const parentRef of payload.prf) {
      const parentResult = await verifyUcan(parentRef, resourceUri, action, escrowDb);
      if (!parentResult.valid) {
        return { valid: false, reason: `Parent proof invalid: ${parentResult.reason}` };
      }
      // Verify attenuation-only: child att must be subset of parent att
      if (!isAttenuationSubset(payload.att, parentResult.att)) {
        return { valid: false, reason: 'Delegation widens permissions (attenuation-only violation)' };
      }
    }
  }

  // 9. Check nonce for replay (local nonce set, pruned by exp)
  if (isNonceUsed(payload.nnc, payload.exp)) {
    return { valid: false, reason: 'Nonce already used (replay detected)' };
  }
  markNonceUsed(payload.nnc, payload.exp);

  return { valid: true, att: payload.att };
}
```

### Revocation

UCAN's design philosophy favors expiry over revocation -- tokens are short-lived and escrow-bound. However, for key compromise scenarios, a lightweight revocation set is maintained:

```typescript
interface RevocationEntry {
  /** CID of the revoked UCAN */
  token_cid: string;
  /** DID of the agent that issued the revocation */
  revoked_by: string;
  /** Unix timestamp of revocation */
  revoked_at: number;
  /** Reason for revocation */
  reason: 'key_compromise' | 'escrow_terminated' | 'manual';
}
```

The revocation set is stored in the local SQLite database and propagated to connected relay peers via a `ucan_revocation` relay message. Revocations are checked during step 8 of the verification algorithm. Only the issuer of a UCAN (or any ancestor in the proof chain) can revoke it.

### Threat Model

| Threat | Mitigation | Residual Risk |
|--------|------------|---------------|
| Token theft | Time-bound (`exp`) + escrow binding limits the damage window to the escrow's active lifetime. Stolen tokens cannot be used after escrow settlement. | If stolen during active escrow, attacker can act within scope until escrow terminates. |
| Privilege escalation | Attenuation-only rule enforced at every chain link. Verifier walks the full proof chain. | Implementation bug in subset checking could allow escalation. Mitigated by test coverage. |
| Replay attack | Nonce (`nnc`) tracked in local set, pruned by expiry. Combined with `nbf`/`exp` window and escrow binding. | Nonce set is per-node; replay across nodes requires escrow binding check as second barrier. |
| Key compromise | DID rotation protocol: agent generates new keypair, publishes rotation record, old DIDs resolve to revocation notice. Revocation set propagated via relay. | Window between compromise and rotation detection. Escrow binding limits blast radius. |
| Delegation abuse | Chain depth limit (3) bounds transitive authority. Escrow inheritance prevents economic unbinding. Attenuation-only prevents scope widening. | Depth 3 may be insufficient for deeply nested pipelines. See Risks section. |
| Token forgery | Ed25519 signature verification over canonical JWT encoding. 128-bit security level. | Dependent on Ed25519 implementation correctness (Node.js `crypto` module). |
| Escrow desync | Verifier checks live escrow status from local DB during validation (step 6). Terminal escrow states immediately invalidate all bound UCANs. | Brief race window between escrow state change and next verification. Acceptable for non-financial system. |

### Integration Points

**1. Gateway (`src/gateway/server.ts`)**

Add a third auth method in the existing sequential check. UCAN auth is identified by the `Bearer ucan.` prefix.

```typescript
// In the onRequest hook, after Bearer token check:
if (auth && auth.startsWith('Bearer ucan.')) {
  const ucanToken = auth.slice('Bearer ucan.'.length);
  // Full verification deferred to preHandler where body is available
  (request as Record<string, unknown>)._ucanToken = ucanToken;
}

// In the preHandler hook, after Ed25519 check:
const ucanToken = (request as Record<string, unknown>)._ucanToken as string | undefined;
if (ucanToken) {
  const params = (request.body as Record<string, unknown>)?.params as Record<string, unknown>;
  const skillId = params?.skill_id as string;
  const result = await verifyUcan(ucanToken, `agentbnb://skill/${skillId}`, 'invoke', creditDb);
  if (result.valid) return; // Authorized
}
```

**2. Relay (`src/relay/types.ts`)**

Add an optional `ucan` field to `RelayRequestMessage` and `EscrowHoldMessage`:

```typescript
// Extension to RelayRequestMessageSchema:
ucan: z.string().optional(),  // base64url-encoded UCAN JWT

// New relay message for revocation propagation:
export const UcanRevocationMessageSchema = z.object({
  type: z.literal('ucan_revocation'),
  token_cid: z.string().min(1),
  revoked_by: z.string().min(1),
  reason: z.enum(['key_compromise', 'escrow_terminated', 'manual']),
});
```

**3. Conductor (`src/conductor/conductor-mode.ts`)**

When the Conductor forms a team via `src/conductor/team-formation.ts`, it auto-generates sub-delegation UCANs for each team member. The root UCAN comes from the client's request. Each sub-delegation is attenuated to the specific skill the team member was assigned.

```typescript
// In team formation, after role assignment:
for (const member of team.members) {
  const subUcan = createSubDelegation(rootUcan, {
    aud: `did:agentbnb:${member.agent_id}`,
    att: [{
      with: `agentbnb://skill/${member.assigned_skill_id}`,
      can: 'invoke',
      nb: { max_calls: member.expected_invocations },
    }],
  });
  member.ucan = subUcan;
}
```

**4. Escrow (`src/credit/escrow.ts`)**

Escrow state transitions trigger UCAN lifecycle events. The existing `updateEscrowStatus()` function is extended to emit UCAN invalidation when transitioning to terminal states.

```typescript
// After the DB transition in updateEscrowStatus():
if (TERMINAL_ESCROW_STATUSES.has(toStatus) || toStatus === 'abandoned') {
  emitUcanInvalidation(escrowId, toStatus);
}
```

**5. Identity (`src/identity/delegation.ts`)**

The existing `DelegationToken` interface continues to work for server-to-agent delegation. UCAN tokens replace it for agent-to-agent delegation with finer-grained scoping. The two systems coexist: `DelegationToken` for infrastructure delegation (server permissions), UCAN for capability delegation (skill access).

### Token Size and Performance

| Auth Method | Token Size | Verification Time | Network Overhead |
|-------------|-----------|-------------------|------------------|
| Bearer token | ~64 bytes | O(1) hash lookup | Negligible |
| Ed25519 identity | ~256 bytes (3 headers) | ~0.1ms signature verify | Negligible |
| UCAN (root) | ~500-800 bytes | ~0.5ms (signature + escrow check) | Small |
| UCAN (depth 2 chain) | ~1.5-2.4 KB (chain) | ~1.5ms (3 signature verifies) | Moderate |

For context, a typical AgentBnB relay request payload is 1-5 KB. UCAN adds 10-50% to message size. The verification latency (0.5-1.5ms) is negligible compared to skill execution times (typically 1-300 seconds).

### Backward Compatibility

- Bearer token auth continues to work unchanged. No migration required.
- Ed25519 identity header auth continues to work unchanged.
- UCAN is strictly additive -- existing agents that do not send UCAN tokens are unaffected.
- UCAN-capable agents advertise support in their capability card:

```json
{
  "protocol_features": ["ucan_v0.10.0"]
}
```

- Agents without `ucan_v0.10.0` in `protocol_features` will never receive UCAN tokens. The consumer falls back to Bearer or Ed25519 auth.

### Canonical Encoding

UCAN payloads are serialized using RFC 8785 (JSON Canonicalization Scheme) before signing. This ensures deterministic signatures regardless of JSON key ordering. The existing `signEscrowReceipt()` in `src/credit/signing.ts` already uses deterministic serialization and serves as the reference implementation.

## Consequences

### Positive

- **Fine-grained access control.** Agents can grant access to specific skills, knowledge base paths, or escrow records instead of blanket authorization.
- **Delegatable without central coordination.** The Conductor can sub-delegate to team members without round-tripping to the relay for each auth grant.
- **Economic binding.** Authorization is tied to payment lifecycle. When the escrow settles, access ends. No orphaned permissions.
- **Offline verifiable.** Any agent holding the UCAN chain and the issuer's public key can verify authorization without network access. This aligns with the local-first protocol principle.
- **Composable with existing auth.** The three auth methods (Bearer, Ed25519 identity, UCAN) are checked sequentially. No breaking changes.

### Negative

- **Token size increase.** UCAN tokens are 500-2400 bytes vs 64 bytes for Bearer tokens. For relay messages that are already 1-5 KB, this is a 10-50% size increase.
- **Verification latency.** Chain verification adds ~0.5ms per chain link. A depth-2 chain adds ~1.5ms. Negligible for skill execution (seconds), noticeable if called in tight loops.
- **Auth middleware complexity.** The gateway now has three auth paths. The UCAN path includes escrow lookups, chain verification, and attenuation subset checking. Test surface area increases.
- **DID resolver coupling.** `did:agentbnb` resolution depends on the local agent registry. If the registry is unavailable, UCAN verification fails. This is acceptable given the local-first architecture but differs from public DID methods.

### Risks

- **Chain depth limit (3) may be insufficient.** Complex Conductor pipelines with deeply nested sub-contracting could exceed 3 hops. Mitigation: monitor actual delegation depth in production. The limit is a configuration constant, not a protocol invariant -- it can be raised if data justifies it.
- **Escrow binding creates tight coupling.** Auth and economic layers are intentionally coupled. A bug in escrow state management could inadvertently revoke valid authorization. Mitigation: the existing escrow state machine in `src/credit/escrow.ts` has been stable since v3.0 with comprehensive test coverage.
- **Nonce storage growth.** The replay protection nonce set grows with traffic. Mitigation: nonces are pruned when their associated UCAN expires. With escrow-bound tokens (typically minutes to hours), the set stays small.

## References

- UCAN Spec v0.10.0: https://github.com/ucan-wg/spec
- W3C DID Core 1.0: https://www.w3.org/TR/did-core/
- RFC 8032: Edwards-Curve Digital Signature Algorithm (Ed25519)
- RFC 8785: JSON Canonicalization Scheme (JCS)
- AgentBnB Agent-Native Protocol: `AGENT-NATIVE-PROTOCOL.md`
- AgentBnB Identity Module: `src/identity/`
- AgentBnB Escrow State Machine: `src/credit/escrow.ts`
- AgentBnB Gateway Auth: `src/gateway/server.ts`
- AgentBnB Relay Types: `src/relay/types.ts`
- AgentBnB Delegation Tokens: `src/identity/delegation.ts`
