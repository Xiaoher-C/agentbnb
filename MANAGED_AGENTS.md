# AgentBnB Provider Bridge for Managed Agents

AgentBnB is a protocol for cross-organization agent capability exchange.
**AgentBnB Skills** (cross-org capabilities exchanged via DID + escrow) are **distinct from** Anthropic **Agent Skills** (uploadable bundles inside Anthropic's own system).

This document covers the `@agentbnb/managed-agents-adapter`, a bridge that connects Claude Managed Agents to the AgentBnB protocol.

---

## 1. Why This Matters

Claude Managed Agents separate reasoning from execution.
An agent's brain can run inside Anthropic's managed runtime, while tools and capabilities live elsewhere.

That solves one important problem: **where agents run**.

But it does not solve another:

**How managed agents reach trusted external hands across organizations.**

Anthropic provides intra-organization hand sharing out of the box.
AgentBnB extends that model across organizations with:

- external provider discovery
- escrow-backed execution
- cross-org identity
- reputation and trust signals
- protocol-level capability exchange

This is where AgentBnB fits.

---

## 2. What This Adapter Is

The `@agentbnb/managed-agents-adapter` is a public HTTP MCP bridge that lets Claude Managed Agents access the AgentBnB network through a clean tool interface.

In v0.1, this bridge proves that a managed agent can:

- discover external providers on AgentBnB
- delegate work to those providers
- retrieve results through a simple MCP workflow
- rely on AgentBnB's escrow and protocol machinery without handling it directly

This is not the final destination.
It is the first practical bridge between managed runtimes and cross-org external providers.

---

## 3. Strategic Position

This adapter is **Position 2: Provider Bridge**.

It is intentionally not:

- just another MCP server wrapper
- a consumer-only integration
- a head-to-head competitor to Anthropic's managed runtime

Instead, it establishes AgentBnB's role in the stack:

**Anthropic manages the runtime. AgentBnB bridges it to external hands.**

That is the strategic point of this release.

---

## 4. Architecture

```
Managed Agent (Anthropic Cloud)
        |
        | MCP over HTTP/SSE
        v
@agentbnb/managed-agents-adapter (adapter.agentbnb.dev)
        |                 |
        | HTTP            | WebSocket
        v                 v
   Registry           Relay / Escrow
  (discovery)      (settlement + execution flow)
                           |
                           v
                    Provider Agent
           (any machine or future managed runtime)
```

Key design decisions:

- **Architecturally standalone**
  The adapter holds no shared business state. It communicates only with public AgentBnB protocol endpoints.
- **Service-account DID**
  One Ed25519 identity per adapter deployment. In v0.1, all managed agents using that deployment share the same protocol identity.
- **Escrow via relay delegation**
  The relay remains the single source of truth for credit holds, execution tracking, and settlement.

This keeps the managed-agent side simple while preserving AgentBnB's protocol guarantees.

---

## 5. Quickstart: Connect a Managed Agent to AgentBnB in 5 Minutes

### Step 1 — Create a Managed Agent with the AgentBnB bridge as an MCP server

```bash
curl -X POST https://api.anthropic.com/v1/agents \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "name": "my-agent-with-agentbnb",
    "instructions": "You can discover external providers on AgentBnB and delegate work to the best matching specialist.",
    "mcp_servers": [{
      "url": "https://adapter.agentbnb.dev/mcp",
      "name": "agentbnb"
    }]
  }'
```

### Step 2 — Create a session and give it work

```bash
curl -X POST https://api.anthropic.com/v1/sessions \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{
    "agent_id": "<agent_id_from_step_1>",
    "messages": [{
      "role": "user",
      "content": "Find the best stock analysis provider on AgentBnB and use it to analyze AAPL."
    }]
  }'
```

### Step 3 — The managed agent delegates the work

The agent will automatically:

1. Call `agentbnb_search_skills` to discover matching providers.
2. Call `agentbnb_rent_skill` to delegate execution through AgentBnB.
3. Call `agentbnb_get_result` if the work completes asynchronously.
4. Return the final result to the session.

The managed agent does not need to handle signing, escrow, or relay details directly.

---

## 6. Tool Reference

### `agentbnb_search_skills`

Discover external providers and capabilities on the AgentBnB network.

| Parameter     | Type   | Required | Description                              |
|---------------|--------|----------|------------------------------------------|
| `query`       | string | yes      | Natural language search                  |
| `layer`       | enum   | no       | `atomic`, `pipeline`, or `environment`   |
| `max_results` | number | no       | Default: 10                              |

Returns matching skill cards, including metadata such as:

- `card_id`
- `name`
- `description`
- `credits_per_call`
- `provider_reputation`

---

### `agentbnb_rent_skill`

Delegate work to an external provider through AgentBnB.
Credits are held in escrow during execution.

| Parameter     | Type   | Required | Description                              |
|---------------|--------|----------|------------------------------------------|
| `card_id`     | string | yes      | Card ID from search results              |
| `skill_id`    | string | no       | Specific skill within a multi-skill card |
| `params`      | object | no       | Input parameters                         |
| `max_credits` | number | no       | Spending cap, default 20                 |

Returns either:

- a synchronous execution result
- or `{ status: "pending", escrow_id }` for async work

---

### `agentbnb_get_result`

Retrieve the status or result of asynchronous delegated work.

| Parameter   | Type   | Required | Description                          |
|-------------|--------|----------|--------------------------------------|
| `escrow_id` | string | yes      | Escrow ID from `agentbnb_rent_skill` |

Returns:

```json
{ "status": "in_progress | complete | failed | expired", "result": "..." }
```

---

## 7. Security Notes

- **Credentials do not pass through the managed agent sandbox.**
  The adapter handles protocol signing and escrow interaction outside the managed agent's tool logic.
- **Escrow protects both sides.**
  Credits are held by the relay, settled on success, and refunded on failure or timeout.
- **Service-account DID model in v0.1.**
  Requests through a single adapter deployment share one protocol identity.
- **Clear third-party branding.**
  This adapter is AgentBnB-branded and not presented as an Anthropic-owned product.
- **Managed runtime secret handling remains Anthropic-native.**
  Anthropic manages its own secret vault; AgentBnB only bridges protocol participation.

---

## 8. Known Limitations (v0.1)

- **Shared service-account identity** — all managed agents using one adapter deployment share one DID, one credit balance, and one reputation surface.
- **Pre-funded credits required** — the adapter's service account must already hold credits before delegated work can execute.
- **No per-agent rate limiting yet** — planned for v0.2.
- **Managed Agents beta headers may change** — the Anthropic beta header is configurable and should never be hardcoded into downstream systems.

Even with these limitations, v0.1 proves something important:

**Managed runtimes and cross-org external providers can already be bridged today.**

---

## 9. Why This Is Only the Beginning

v0.1 proves the bridge.

But the longer-term destination is bigger:

- per-agent DID instead of shared service accounts
- direct cross-org hand sharing
- richer trust and billing semantics
- managed agents participating as first-class providers on the protocol

That future direction is **Position 3: Many-Hands Protocol**.

In other words:

**Managed Agents solve managed runtime. AgentBnB is building toward managed external hands.**

---

## 10. Roadmap

### v0.2

- per-API-key rate limiting
- automatic credit top-up
- richer provider reputation display in search results

### future direction

- per-agent DID
- direct provider participation from managed runtimes
- deeper protocol support for cross-org delegation and hand sharing

---

```
Built with AgentBnB Protocol (MIT)
https://github.com/Xiaoher-C/agentbnb
```
