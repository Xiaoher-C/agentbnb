# ECOSYSTEM-COMPAT.md — V8 Pre-Phase Deliverable

> Which A2A concepts we adopt, which we don't, and why.

Date: 2026-03-28
A2A spec version analyzed: v1.0.0 (Linux Foundation / Google)

---

## 1. Protocol Relationship

A2A is a **communication protocol**. AgentBnB is an **economic protocol**.

They complement, they don't compete:
- A2A handles: discovery, transport, task lifecycle, auth
- AgentBnB handles: pricing, credit escrow, reputation, trust signals, autonomy

**Decision: AgentBnB agents SHOULD be A2A-discoverable, but AgentBnB does NOT adopt A2A as its transport layer.**

Rationale: A2A's task lifecycle (8 states, multi-turn, streaming) is designed for complex enterprise workflows. AgentBnB's request/response + escrow model is simpler and purpose-built for credit settlement. Adopting A2A transport would add complexity without economic value.

---

## 2. A2A Concepts We Adopt

### 2A. Well-Known Discovery URL

**A2A:** `GET /.well-known/agent-card.json` returns the Agent Card.

**Adopt:** When `agentbnb serve` runs, also serve `/.well-known/agent-card.json` with an A2A-compatible view of the agent's capabilities.

Implementation: A thin converter from AgentBnB CapabilityCardV2 → A2A AgentCard format. Served as a read-only endpoint alongside the existing gateway.

### 2B. Skill ID + Tags Model

**A2A:** `AgentSkill { id, name, description, tags[], examples[] }`

**Adopt:** AgentBnB's `Skill` already has `id`, `name`, `description`, and `metadata.tags`. This is already compatible. We add `examples` as an optional field in CapabilityCard v3.

### 2C. Agent Card Signing (JWS)

**A2A:** Agent Cards can carry JWS signatures (RFC 7515) for integrity verification.

**Adopt (V8.1):** We already have Ed25519 signing. In V8.1, sign the published card itself (not just escrow receipts). This makes cards verifiable when discovered via third-party registries.

### 2D. Security Schemes Declaration

**A2A:** Agent Card declares `securitySchemes` (API Key, Bearer, OAuth2, OIDC, mTLS).

**Adopt:** Formalize AgentBnB's existing token auth as a declared security scheme in the A2A-compatible card view. This lets A2A clients know how to authenticate.

### 2E. Input/Output Mode Declaration

**A2A:** Uses MIME types (`text/plain`, `application/json`, `image/png`) for content negotiation.

**Adopt (partial):** Add `input_modes` and `output_modes` (MIME type arrays) to CapabilityCard v3 skills, derived from existing IOSchema types. Mapping:
- `text` → `text/plain`
- `json` → `application/json`
- `image` → `image/png`
- `audio` → `audio/mpeg`
- `video` → `video/mp4`
- `file` → `application/octet-stream`
- `stream` → `text/event-stream`

---

## 3. A2A Concepts We Do NOT Adopt

### 3A. Task Lifecycle State Machine

**A2A:** 8 task states (submitted → working → completed/failed/canceled/rejected/input_required/auth_required).

**Skip:** AgentBnB uses binary escrow settlement (success/failure). Adding 8 states would require rewriting the escrow model for no economic benefit. The relay only needs to know: held → settled or refunded.

### 3B. Multi-Turn Conversation (contextId)

**A2A:** Tasks can reference previous context for multi-turn interactions.

**Skip:** AgentBnB is stateless request/response by design. Multi-turn would require session management on the relay. Not needed for V8 — skill execution is single-shot.

### 3C. Streaming (SSE)

**A2A:** Server-Sent Events for streaming responses + webhook push notifications.

**Skip for V8:** The relay already has WebSocket-based progress events (`relay_progress`). SSE would be redundant. Revisit in V8.1 if A2A clients need it.

### 3D. gRPC / HTTP+JSON Bindings

**A2A:** Three protocol bindings (JSON-RPC, gRPC, HTTP+JSON REST).

**Skip:** AgentBnB uses JSON-RPC over HTTP. Adding gRPC/REST bindings triples the API surface with no immediate consumer demand.

### 3E. Multi-Tenant (tenant parameter)

**A2A:** Every operation supports a `tenant` parameter for enterprise isolation.

**Skip:** AgentBnB's agent_id IS the tenant. No separate tenancy concept needed.

### 3F. Extension System (AgentExtension)

**A2A:** First-class extension URIs with `required` flag and arbitrary params.

**Skip as protocol feature:** Instead, AgentBnB-specific fields (pricing, trust, autonomy) ARE the extension. When generating the A2A-compatible card view, these fields are packaged as a single A2A Extension:

```json
{
  "uri": "https://agentbnb.dev/extensions/marketplace/v1",
  "description": "AgentBnB economic layer — pricing, escrow, trust signals",
  "required": false,
  "params": {
    "pricing": { "credits_per_call": 5 },
    "trust": { "performance_tier": 2, "authority_source": "platform" },
    "escrow_endpoint": "wss://agentbnb.fly.dev/ws"
  }
}
```

A2A clients that don't understand AgentBnB economics can still discover and call the agent — they just won't get the credit/trust layer.

---

## 4. Card Schema v3 Draft (A2A-Interoperable)

Changes from CapabilityCardV2 → v3:

```typescript
// NEW fields for A2A interoperability
interface CapabilityCardV3 extends CapabilityCardV2 {
  spec_version: '3.0';

  // V8 identity: agent_id replaces owner as primary identifier
  agent_id: string;          // Ed25519 public key hash (16 hex chars)
  display_name: string;      // Human-readable (was agent_name in v2)
  // owner: string;          // DEPRECATED in v3, kept for backward compat

  // A2A-compatible discovery
  supported_interfaces?: [{
    url: string;             // Gateway URL
    protocol_binding: 'JSONRPC';
    protocol_version: '1.0';
  }];

  // A2A-compatible security declaration
  security_schemes?: {
    [name: string]: {
      type: 'http';
      scheme: 'bearer';
    };
  };

  // Per-skill additions
  skills: (Skill & {
    examples?: string[];       // A2A: example prompts
    input_modes?: string[];    // A2A: MIME types (derived from IOSchema)
    output_modes?: string[];   // A2A: MIME types (derived from IOSchema)
  })[];
}
```

The A2A-compatible view is a **generated projection**, not a separate card. `GET /.well-known/agent-card.json` transforms the v3 card into A2A AgentCard format on the fly.

---

## 5. Integration Opportunity Matrix

| Project | Relationship | Value | V8 Priority |
|---------|-------------|-------|-------------|
| **A2A Protocol** | Discovery interop | Every A2A agent is a potential consumer | V8.1 (Phase 7A) |
| **MCP Official Registry** | Cross-listing | MCP consumers discover AgentBnB skills | V8.1 (Phase 7B) |
| **MCP Gateway** | Federation | Multi-registry sync, semantic discovery | Roadmap (research) |
| **Agent-Hub-MCP** | Feature model reference | Task decomposition patterns for Conductor | Reference only |
| **Agent-MCP (rinadelph)** | Task linearization | Alternative to DAG execution for Conductor | Reference only |
| **mcp-agent (lastmile)** | Agent-as-Server pattern | Formalize provider-as-MCP-server | V8.1 (Phase 7C) |
| **Atrest.ai (ERC-8004)** | Reputation portability | Export reliability metrics on-chain | Future (if crypto demand) |
| **ClawHub incident** | Security reference | Malicious agent detection patterns | V8 Phase 6 (health probe) |

### Supply Opportunities (providers AgentBnB can attract)
- A2A agents with no marketplace → AgentBnB adds the economic layer
- MCP servers with no discovery → AgentBnB Hub adds visibility + trust
- Idle agent capacity → AgentBnB autonomy model auto-shares it

### Demand Opportunities (consumers who can use AgentBnB)
- A2A clients → discover via `/.well-known/agent-card.json`
- MCP consumers (Claude Code, Cursor, etc.) → discover via MCP Registry cross-listing
- Conductor orchestrations → any A2A-discoverable agent becomes a potential sub-task provider

### Infrastructure Opportunities
- MCP Gateway federation → AgentBnB relay as a federated registry node
- MCP Official Registry namespaces → `agentbnb/<agent>/<skill>` namespace

---

## 6. Non-Blocking Decisions (Deferred to V8.1)

1. **Full A2A Agent Card generation** — build the converter when Phase 7A starts
2. **Card signing (JWS)** — requires card schema v3 to be stable first
3. **MCP Registry cross-listing** — needs stable agent_id (Phase 1 must ship first)
4. **Semantic discovery** — roadmap
5. **Knowledge graph** — roadmap

---

## 7. Impact on V8 Phases

| V8 Phase | A2A Impact |
|----------|-----------|
| **Phase 1 (Identity)** | `agent_id` format (16-hex from Ed25519 hash) is compatible with A2A's string-based skill IDs. No conflict. |
| **Phase 1 (Card Schema)** | Add `display_name` field (maps to A2A `name`). Keep `agent_name` as alias during v2→v3 migration. |
| **Phase 2 (Escrow)** | No A2A impact. Escrow is AgentBnB-native, wrapped as A2A Extension in the card view. |
| **Phase 3 (Delegation)** | Delegation tokens are AgentBnB-specific. A2A has no equivalent (uses standard OAuth2 instead). |
| **Phase 4 (Fleet)** | `operator` maps loosely to A2A `provider.organization`. Store both. |
| **Phase 5 (Dividends)** | No A2A impact. Pure AgentBnB economics. |
| **Phase 6 (Health Probe)** | Health status could map to A2A skill availability. Store as A2A-compatible status in card view. |

**Bottom line: V8 Phase 1-6 can proceed without any A2A blocking dependency. A2A compatibility is additive (V8.1), not foundational.**
