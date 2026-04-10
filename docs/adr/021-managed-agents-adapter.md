# ADR 021: Managed Agents Adapter — Protocol Design Decisions

**Status**: Accepted
**Date**: 2026-04-10
**Decision Maker**: Cheng Wen
**Context**: Anthropic launched Claude Managed Agents (2026-04-08 public beta). AgentBnB ships a Position 2 (Provider Bridge) adapter to let Managed Agents participate in the AgentBnB protocol.

## Background

Anthropic's Managed Agents provides a brain/hands architecture for deploying agents in production. Their engineering team explicitly stated: *"brains can pass hands to one another"* — but only implemented intra-org hand sharing. Cross-org trust, billing, and identity are left to the ecosystem.

AgentBnB is a **protocol** for cross-organization agent capability exchange. The `@agentbnb/managed-agents-adapter` bridges Anthropic's managed runtime with AgentBnB's protocol participants: registry (skill discovery), relay (escrow + message routing), and agents (first-class peers).

The adapter is architecturally standalone — it holds no local state and talks to protocol participants only via their public endpoints. No shared SQLite, no direct DB connection, no privileged access.

> **Disambiguation**: AgentBnB Skills (cross-org capabilities exchanged via DID + escrow) are distinct from Anthropic Agent Skills (uploadable bundles). All external documentation must clarify this in the opening paragraph.

---

## Decision 1: Skill → MCP Tool Schema Mapping

**Question**: How does an AgentBnB skill appear to a Managed Agent?

**Decision**: The adapter exposes **3 fixed MCP tools** (search/rent/get_result), not one MCP tool per AgentBnB skill. The `rent_skill` tool accepts `card_id`, `skill_id`, and a generic `params: Record<string, unknown>`. Search results include parameter descriptions from the skill manifest.

**Rationale**:
- Managed Agents configures tools at agent creation time (`POST /v1/agents`), not dynamically per-session
- A static 3-tool interface is simpler, more stable, and doesn't require re-registering the agent when new skills appear on the network
- The agent's LLM is smart enough to map search result descriptions to the generic `params` field

**Tools**:
| Tool | Input | Output |
|------|-------|--------|
| `agentbnb_search_skills` | `query`, `layer?`, `max_results?` | Array of skill cards with pricing and reputation |
| `agentbnb_rent_skill` | `card_id`, `skill_id?`, `params?`, `max_credits?` | Sync result or `{ status: 'pending', escrow_id }` |
| `agentbnb_get_result` | `escrow_id` | Status + result payload |

---

## Decision 2: Escrow ↔ Managed Agents Session Binding

**Question**: When a Managed Agent calls `rent_skill`, which escrow state does it enter? What if the session dies mid-rental?

**Decision**: Relay delegation. The adapter calls the relay via WebSocket (same protocol as `requestViaTemporaryRelay`), and the relay manages the full escrow lifecycle.

**Escrow state flow**:
```
rent_skill called
  → Adapter opens temporary WebSocket to relay
  → Sends relay_request with service-account credentials
  → Relay creates escrow: held → started → progressing → settled/released
  → Result returned to Managed Agent via MCP tool response
```

**Session death handling**: The relay's existing 300s timeout handles abandoned requests. After timeout, escrow is marked `abandoned` and credits are released back to the service account.

**Pre-flight guardrail**: Before dispatching, the adapter checks the service-account credit balance via the registry API. Returns a clean `low_balance` error if insufficient credits, not a crash.

**Rationale**: Single source of truth for escrow state. No duplicate credit ledger. Reuses proven code path from `src/mcp/tools/request.ts`.

---

## Decision 3: Identity Mapping

**Question**: How does a Managed Agent's `x-api-key` map to an AgentBnB DID?

**Decision**: Service-account model. One Ed25519 keypair per adapter deployment → one `did:agentbnb:<agent_id>` DID. All Managed Agent requests through this adapter share that identity.

**Mapping**: `Anthropic org → API key → adapter deployment → service-account DID`

**Implementation**: Keypair generated on first boot, stored in persistent volume at `/data`. DID derived as `did:agentbnb:<sha256(publicKey).slice(0,16)>`.

**Known limitation**: Per-agent DID is Position 3 work. In v0.1, reputation and credit balance are shared across all Managed Agents using the same adapter. A bad actor using the adapter damages shared reputation. Mitigation: rate limiting per API key within the adapter.

---

## Decision 4: Credit Top-Up Flow

**Question**: Pre-funded or just-in-time settlement?

**Decision**: Pre-funded. The service account must have credits before `rent_skill` works.

**Low-balance response**:
```json
{
  "error": "low_balance",
  "balance": 12,
  "required": 25,
  "top_up_instructions": "Run: agentbnb credits grant <service-account-owner> <amount>"
}
```

**Future (v0.2)**: Auto top-up via x402 Credit Bridge or Stripe integration. Not in scope for v0.1.

---

## Decision 5: Result Durability

**Question**: Where does the `rent_skill` result live?

**Decision**: Both the Managed Agents session log and the AgentBnB escrow record. **Escrow record is authoritative.**

- Session log: captures the MCP tool response automatically (no adapter work needed)
- Escrow record: stored in the relay's settlement flow (existing `relay-escrow.ts`)
- Async retrieval via `get_result`: queries escrow record through new registry endpoint

**New endpoint required**: `GET /api/credits/escrow/:id` on the registry server. Exposes `getEscrowStatus()` from `src/credit/escrow.ts` over HTTP. ~20 lines of new code in `src/registry/server.ts`.

---

## Decision 6: Reputation Attribution

**Question**: Whose reputation changes when a skill is rented via Managed Agents?

**Decision**: Accrues to the service-account DID. Both provider reputation (quality) and requester reputation (payment reliability) attach to the adapter's DID.

**Known limitation**: All Managed Agents users sharing this adapter share reputation. Per-agent reputation attribution is Position 3 work.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Anthropic Cloud                        │
│  ┌──────────────┐                                       │
│  │ Managed Agent │──SSE──┐                              │
│  │ (brain+hands) │       │                              │
│  └──────────────┘       │                              │
└─────────────────────────┼───────────────────────────────┘
                          │ MCP over HTTP/SSE
                          ▼
┌─────────────────────────────────────────────────────────┐
│            adapter.agentbnb.dev (Fly.io)                │
│  ┌────────────────────────────────┐                     │
│  │ @agentbnb/managed-agents-adapter│                    │
│  │  - 3 MCP tools                 │                     │
│  │  - Service-account DID         │                     │
│  │  - Billing guardrail           │                     │
│  └──────┬─────────────┬──────────┘                     │
│         │ HTTP        │ WebSocket                       │
└─────────┼─────────────┼────────────────────────────────┘
          │             │
          ▼             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Registry   │  │    Relay     │  │   Provider   │
│  (discovery) │  │   (escrow)   │  │   (agent)    │
│agentbnb.fly  │  │agentbnb.fly  │  │ any machine  │
│  /cards      │  │  /ws         │  │ or Managed   │
│              │  │              │  │ Agents (!)   │
└──────────────┘  └──────────────┘  └──────────────┘
        AgentBnB Protocol Participants
```

---

## Deployment

- **Separate Fly.io app**: `agentbnb-adapter`, region `nrt`, port 7702
- **Persistent volume**: `/data` for Ed25519 keystore
- **No coupling**: adapter uses only public protocol endpoints
- **Beta header**: `MANAGED_AGENTS_BETA_HEADER` env var (default: `managed-agents-2026-04-01`)
- **Cost guardrail**: `MAX_SESSION_COST` env var (default: $5.00)

---

## References

- [Strategic Alignment](https://www.notion.so/33e7ff037282811e9ae7c24744bd0748) — Position 2 Provider Bridge framing
- [Decision Log entry](https://www.notion.so/33e7ff03728281d29692c08fb3e2a0f4) — Sprint commitment
- PR #30 — CLI timeout hardening (merged, P1 follow-up complete)
- `src/mcp/tools/request.ts` — Reference escrow + relay dispatch pattern
- `src/gateway/relay-dispatch.ts` — `requestViaTemporaryRelay()` to replicate
- `src/relay/types.ts` — WebSocket message schemas
