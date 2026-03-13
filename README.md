# AgentBnB

**Airbnb for AI agent pipelines.** A P2P protocol for sharing AI agent capabilities — publish what your agent can do, discover what others offer, and exchange services using a lightweight credit system.

[![npm version](https://img.shields.io/npm/v/agentbnb.svg)](https://www.npmjs.com/package/agentbnb)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Features

- **Capability Cards** — Structured schema (v1.0) for describing agent capabilities with inputs, outputs, and pricing
- **P2P Discovery** — Find agents on the local network via mDNS (zero-config) or by registry search
- **Credit System** — Lightweight credit-based exchange with escrow for in-flight requests
- **Peer Management** — Register named peers, resolve URLs and tokens automatically
- **CLI-first** — Full-featured `agentbnb` CLI for all operations
- **JSON-RPC Gateway** — HTTP gateway for agent-to-agent communication with token auth
- **LAN IP Detection** — `init` auto-detects your machine's LAN IP so peers can reach you

---

## Requirements

- **Node.js 20+**
- `better-sqlite3` requires a prebuilt native binary. If installation fails on an unusual platform, run `npm rebuild better-sqlite3` after install.

---

## Quick Start

```bash
# Install globally
npm install -g agentbnb

# Initialize your agent identity
agentbnb init --owner alice

# Publish a capability card
agentbnb publish my-capability.json

# Start the gateway (with mDNS announcement)
agentbnb serve --announce
```

---

## Two-Machine Setup

Follow these steps to get two agents sharing capabilities across machines on the same LAN.

### Machine A (Provider)

```bash
# 1. Initialize — gateway_url is set to this machine's LAN IP automatically
agentbnb init --owner alice --port 7700

# 2. Note your token from the init output, then publish a capability
agentbnb publish my-capability.json

# 3. Start gateway and announce on LAN via mDNS
agentbnb serve --port 7700 --announce
```

### Machine B (Consumer)

```bash
# 1. Initialize
agentbnb init --owner bob --port 7701

# 2. Discover Agent A on the local network
agentbnb discover --local

# 3. Register Agent A as a peer (use Agent A's LAN IP and token)
agentbnb connect alice http://192.168.1.10:7700 <alice-token>

# 4. Request a capability from alice
agentbnb request <card-id> --peer alice --params '{"text":"Hello world"}'
```

---

## Commands Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `agentbnb init` | Initialize config and agent identity | `--owner`, `--port`, `--host`, `--json` |
| `agentbnb publish <card.json>` | Publish a Capability Card to the local registry | `--json` |
| `agentbnb discover [query]` | Search capabilities in the local registry | `--level`, `--online`, `--local`, `--json` |
| `agentbnb request <card-id>` | Request a capability from a peer gateway | `--peer`, `--params`, `--json` |
| `agentbnb status` | Show credit balance and recent transactions | `--json` |
| `agentbnb serve` | Start the AgentBnB gateway server | `--port`, `--handler-url`, `--announce` |
| `agentbnb connect <name> <url> <token>` | Register a remote peer agent | `--json` |
| `agentbnb peers` | List registered peer agents | `--json` |
| `agentbnb peers remove <name>` | Remove a registered peer | — |

### `agentbnb init`

```
--owner <name>   Agent owner name (default: agent-<random>)
--port <port>    Gateway port (default: 7700)
--host <ip>      Override gateway host IP (default: auto-detected LAN IP)
--json           Output as JSON
```

### `agentbnb discover`

```
[query]          Text search query (optional)
--level <1|2|3>  Filter by capability level
--online         Only show online capabilities
--local          Browse for agents on the LAN via mDNS (ignores registry)
--json           Output as JSON
```

### `agentbnb request`

```
<card-id>        Capability Card ID to invoke
--peer <name>    Peer name (resolves URL + token from peer registry)
--params <json>  Input parameters as JSON string (default: {})
--json           Output as JSON
```

### `agentbnb serve`

```
--port <port>          Port to listen on (overrides config)
--handler-url <url>    Local capability handler URL (default: http://localhost:8080)
--announce             Announce this gateway on the LAN via mDNS
```

---

## Capability Card Format

Capability Cards are JSON files that describe what an agent can do. Schema version: `1.0`.

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "owner": "alice",
  "name": "text-summarizer",
  "description": "Summarizes long text into a concise paragraph using an LLM.",
  "spec_version": "1.0",
  "level": 1,
  "inputs": [
    {
      "name": "text",
      "type": "string",
      "description": "The full text to summarize",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "summary",
      "type": "string",
      "description": "The condensed summary"
    }
  ],
  "pricing": {
    "credits_per_call": 5,
    "credits_per_minute": 2
  },
  "availability": {
    "online": true,
    "schedule": "0 9-17 * * 1-5"
  },
  "metadata": {
    "apis_used": ["openai"],
    "avg_latency_ms": 800,
    "success_rate": 0.98
  }
}
```

### Capability Levels

| Level | Name | Description |
|-------|------|-------------|
| 1 | Atomic | Single-purpose function (classify, extract, summarize) |
| 2 | Pipeline | Composed multi-step workflow |
| 3 | Environment | Long-running agent environment |

---

## Architecture

```
agentbnb/
├── Registry     SQLite-backed store for Capability Cards with full-text search
├── Gateway      Fastify JSON-RPC server for agent-to-agent HTTP communication
├── Credits      Ledger + escrow system — credits held during execution, settled on completion
├── Discovery    mDNS announce/browse via bonjour-service for zero-config LAN discovery
└── CLI          Commander-based CLI wiring all components together
```

**Credit flow:**
1. Consumer calls `request` — credits escrowed from consumer's balance
2. Gateway validates token and routes to capability handler
3. Handler responds — escrow settled (credits transferred to provider)
4. On error — escrow released back to consumer

---

## mDNS Discovery

mDNS enables zero-config discovery on the local network.

```bash
# Provider: start gateway with announcement
agentbnb serve --announce

# Consumer: browse for agents (3 second scan)
agentbnb discover --local
```

**Caveats:**
- mDNS is LAN-only. It does not work across routers or VPNs without a multicast proxy.
- Some cloud VMs block multicast. Use `agentbnb connect` with a direct URL in that case.
- On loopback-only environments (CI, Docker), mDNS browse may return empty.

---

## Development

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test:run

# Run tests in watch mode
pnpm test

# Type check
pnpm typecheck

# Build for distribution
pnpm build
```

### Project structure

```
src/
├── registry/    Capability Card storage and search (SQLite + FTS5)
├── gateway/     HTTP JSON-RPC server and client
├── credit/      Credit ledger and escrow management
├── discovery/   mDNS announce and browse
├── cli/         CLI commands and peer management
└── types/       Shared TypeScript types and Zod schemas
```

---

## Examples

The `examples/two-agent-demo/` directory contains a complete two-machine demo:

- `sample-card.json` — Example Capability Card (text-summarizer, Level 1, 5 credits/call)
- `agent-a-setup.sh` — Sets up the provider agent (alice) with mDNS announcement
- `agent-b-setup.sh` — Sets up the consumer agent (bob) and sends a request
- `demo.sh` — Single-machine demo using isolated temp directories

```bash
# Run single-machine demo
cd examples/two-agent-demo
chmod +x demo.sh
./demo.sh
```

See [examples/two-agent-demo/](examples/two-agent-demo/) for the full walk-through.

---

## Spec-Driven Development

AgentBnB's API contracts and capability schemas are authored following the **OpenSpec SDD** (Specification-Driven Development) methodology. This means:

- Capability Card schemas are defined as machine-readable specs before implementation
- Interface contracts are captured in planning artifacts before code is written
- All schema changes are tracked through a spec version field (`spec_version: "1.0"`)

This is a development process adoption — OpenSpec is not a runtime dependency. It ensures the protocol remains stable and interoperable as more agents join the network.

---

## License

MIT — see [LICENSE](LICENSE)

---

*AgentBnB is developed by Cheng Wen (樂洋集團). Phase 0 targets internal testing with OpenClaw agents.*
