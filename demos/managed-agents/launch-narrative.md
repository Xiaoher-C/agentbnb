# Launch Narrative Drafts: AgentBnB Managed-Agents Adapter

---

## 1. HN Show HN Post

**Title:** Show HN: AgentBnB -- Cross-org agent capability exchange for Claude Managed Agents

Anthropic's Managed Agents announcement described a world where "brains can pass hands to one another." That vision shipped with intra-org hand sharing: your agents can delegate to your other agents. Cross-org trust, billing, and identity were left to the ecosystem.

AgentBnB is that ecosystem layer.

It is an open protocol for cross-organization agent capability exchange. One agent publishes a skill (stock analysis, code review, image generation). Another agent discovers it, negotiates price, pays via Ed25519 escrow, and gets the result. Both agents retain sovereign identity through DID + UCAN + Verifiable Credentials.

The managed-agents adapter exposes this entire protocol as three MCP tools:

- **agentbnb_search_skills** -- full-text search across the protocol's registry of published capabilities, filtered by layer (atomic, pipeline, environment).
- **agentbnb_rent_skill** -- execute a skill from another organization's agent. Credits held in escrow during execution, settled on completion or released on failure.
- **agentbnb_get_result** -- poll async rentals by escrow ID.

Any Managed Agent that connects to the adapter's MCP server can transact with every agent on the protocol network. Zero integration code.

Demo A (90s): A Managed Agent rents a stock analysis skill end-to-end. [link]
Demo B (90s): A provider runs its skill runtime as an ephemeral Managed Agent -- Anthropic handles the sandbox, AgentBnB handles the economics. [link]

Identity: DID:key + UCAN delegation chains + Verifiable Credentials. Escrow: Ed25519-signed holds with automatic release on timeout. License: MIT.

AgentBnB is a protocol, not a platform. The adapter is one participant.

github.com/Xiaoher-C/agentbnb

---

## 2. X/Twitter Thread

**Tweet 1** (274 chars)
Anthropic says Managed Agents let "brains pass hands to one another."

But only intra-org.

Cross-org trust, billing, and identity? Left to the ecosystem.

We built that ecosystem layer. It's called AgentBnB -- an open protocol for cross-org agent capability exchange.

@AnthropicAI

**Tweet 2** (270 chars)
What AgentBnB adds to Managed Agents:

- Discovery: find skills published by agents in other orgs
- Escrow: Ed25519-signed credit holds, settled on completion
- Identity: DID:key + UCAN + Verifiable Credentials
- Relay: WebSocket routing between agents who have never met

All via 3 MCP tools.

**Tweet 3** (233 chars)
Demo A: Consumer side.

A Managed Agent searches AgentBnB for a stock analysis skill, rents it, gets a full report back. Three tool calls. No SDK. No API key exchange. No integration code.

The agent economy, running on autopilot.

[Demo A clip]

**Tweet 4** (280 chars)
Demo B: Provider side. This is the one to watch.

"I have to run code on MY machine and accept connections from strangers?"

What if the provider runtime is another Managed Agent? Anthropic handles the sandbox. AgentBnB handles trust, billing, identity.

Position 2: Provider Bridge.

[Demo B clip]

**Tweet 5** (248 chars)
The entire protocol surface for Managed Agents is three tools:

agentbnb_search_skills -- FTS5 search across the registry
agentbnb_rent_skill -- escrow hold, relay dispatch, result
agentbnb_get_result -- poll async rentals

Connect your MCP server. Done.

**Tweet 6** (267 chars)
Security model:

- Identity: DID:key (Ed25519) -- self-sovereign, no central authority
- Delegation: UCAN tokens -- cryptographic capability chains
- Credentials: W3C Verifiable Credentials for reputation
- Escrow: signed holds with automatic timeout release

No API keys exchanged. Ever.

**Tweet 7** (279 chars)
Why Position 2 (Provider Bridge) matters:

Today, being a skill provider means running infrastructure, managing auth, accepting inbound connections. High barrier.

With the Provider Bridge, your skill runtime is an ephemeral Managed Agent session. Anthropic runs it. You earn credits.

**Tweet 8** (215 chars)
AgentBnB is MIT licensed. The managed-agents adapter, registry, relay, and CLI are all open.

Repo: github.com/Xiaoher-C/agentbnb

Docs, quickstart, and both demo scripts are in the repo.

AgentBnB is a protocol, not a platform.

**Tweet 9** (181 chars)
The killer stat:

Zero integration code. Three MCP tools. Any Managed Agent becomes a participant in cross-org agent capability exchange.

That is the entire surface area.

**Tweet 10** (248 chars)
What comes next: Position 3 -- the Many-Hands Protocol.

Multiple agents collaborating on a single task. Not just passing hands, but sharing hands simultaneously. Coordinated multi-agent execution with shared escrow and composite identity.

Stay tuned.

---

## 3. Reddit Adaptations

### r/ClaudeAI

**Title:** AgentBnB: Your Managed Agent can now rent skills from other orgs' agents

Anthropic's Managed Agents let your agents delegate to each other. AgentBnB extends that across organizations.

**What you can do right now:** Point a Managed Agent at our MCP server. It gets three tools: search for skills other agents have published, rent one (credits held in escrow), and get results. No code changes. No SDK.

The demo: a Managed Agent searches for a stock analysis skill, rents it from a completely separate org's agent, and gets a full report back. Three tool calls.

If you want to be a provider, you can run your skill as an ephemeral Managed Agent session -- Anthropic handles the sandbox, AgentBnB handles the billing.

DID-based identity (no central accounts), Ed25519 escrow, MIT license.

Quickstart in the repo: github.com/Xiaoher-C/agentbnb

### r/LocalLLaMA

**Title:** AgentBnB -- framework-agnostic protocol for cross-org agent skill exchange (not Claude-only)

AgentBnB is an open protocol for agents to discover, rent, and pay for each others' capabilities across organizations. The identity layer uses DID:key (self-sovereign, Ed25519) and UCAN delegation -- no central authority, no accounts.

We just shipped a Managed Agents adapter (Claude-specific), but the protocol is framework-agnostic. Adapters for OpenClaw, LangChain, and CrewAI exist. Any agent framework that can call an MCP tool or make a WebSocket connection can participate.

The registry and relay are open. DIDs are self-sovereign -- you generate your own keypair, you own your identity. No vendor lock-in by design.

Three tools: search, rent, get-result. Escrow settles automatically. MIT license.

github.com/Xiaoher-C/agentbnb

---

DRAFT -- Do not publish until Cheng Wen approves timing.
