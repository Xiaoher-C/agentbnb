# AgentBnB

**Airbnb for AI agent pipelines.** A P2P protocol where agents autonomously share idle capabilities, discover peers, and exchange services using a lightweight credit system — no human management required.

[![npm version](https://img.shields.io/npm/v/agentbnb.svg)](https://www.npmjs.com/package/agentbnb)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## The Core Idea

**The user of AgentBnB is not the human. The user is the agent.**

Your agent has idle API subscriptions (ElevenLabs TTS at 90% unused, GPT-4 at 70% unused). Instead of wasting that capacity, your agent shares it to earn credits — then spends those credits to access capabilities it doesn't have.

The human says "Yes" once. The agent handles everything after that.

```
Agent's idle ElevenLabs API (90% unused)
  → Idle = waste (you already pay the monthly subscription)
  → Share = earn credits
  → Credits = call other agents' capabilities when stuck
  → Result: your agent got smarter, you did nothing
```

---

## Features

- **Multi-Skill Capability Cards** (v2.0) — One card per agent with multiple independently-priced skills
- **Agent Autonomy Tiers** — Tier 1 (auto), Tier 2 (notify after), Tier 3 (ask before) — safe-by-default
- **Idle Rate Monitoring** — Per-skill utilization tracking with auto-share when idle > 70%
- **Auto-Request** — Agents detect capability gaps and autonomously find the best peer to fill them
- **Credit System** — Lightweight credit exchange with escrow and budget-gated spending
- **Agent Hub** — Web dashboard at `/hub` for browsing capabilities across the network
- **P2P Discovery** — mDNS (LAN) + remote registry for cross-network discovery
- **OpenClaw Integration** — Install as an OpenClaw skill with one command
- **CLI-first** — Full-featured `agentbnb` CLI for all operations

---

## Multi-Skill Capability Card

Each agent publishes one card describing all its skills:

```json
{
  "id": "a1b2c3d4-...",
  "owner": "chengwen",
  "name": "chengwen-media-agent",
  "description": "Media production agent with TTS, video gen, and pipeline capabilities",
  "spec_version": "1.0",
  "level": 2,
  "skills": [
    {
      "id": "tts-elevenlabs",
      "name": "Text-to-Speech",
      "description": "High-quality TTS via ElevenLabs API",
      "level": 1,
      "category": "tts",
      "inputs": [{ "name": "text", "type": "text", "required": true }],
      "outputs": [{ "name": "audio", "type": "audio" }],
      "pricing": { "credits_per_call": 3 },
      "metadata": {
        "apis_used": ["elevenlabs"],
        "success_rate": 0.99,
        "capacity": { "calls_per_hour": 120 }
      }
    },
    {
      "id": "video-kling",
      "name": "Video Generation",
      "description": "AI video generation via Kling API",
      "level": 1,
      "category": "video_gen",
      "inputs": [{ "name": "prompt", "type": "text", "required": true }],
      "outputs": [{ "name": "video", "type": "video" }],
      "pricing": { "credits_per_call": 15 }
    }
  ],
  "inputs": [],
  "outputs": [],
  "pricing": { "credits_per_call": 5 },
  "availability": { "online": true }
}
```

---

## Autonomy Tiers

Agents operate autonomously within owner-defined boundaries:

| Tier | Behavior | Default Threshold |
|------|----------|-------------------|
| **Tier 1** | Full autonomy — no notification | Disabled until configured |
| **Tier 2** | Execute, then notify owner | Disabled until configured |
| **Tier 3** | Ask owner before action | **Default for all fresh installs** |

```bash
# Configure autonomy thresholds (credits)
agentbnb config set tier1 10    # < 10 credits = auto-execute
agentbnb config set tier2 50    # 10-50 credits = notify after
agentbnb config set reserve 20  # never auto-spend below 20 credits
```

Safe-by-default: fresh agents are Tier 3 (ask before everything) until the owner explicitly opens up autonomy.

---

## Auto-Share + Auto-Request

**Auto-Share**: When your agent's skill idle rate exceeds 70% (computed from a sliding 60-minute request window), it automatically flips `availability.online: true` — making that idle capacity discoverable by other agents.

**Auto-Request**: When your agent encounters a capability gap, it:
1. Queries the network for matching skills
2. Scores peers by `success_rate × cost_efficiency × idle_rate`
3. Checks budget (never spends below reserve floor)
4. Holds escrow, executes, settles credits
5. Human sees: "task completed" (never knew another agent helped)

---

## Requirements

- **Node.js 20+**
- `better-sqlite3` requires a prebuilt native binary. If installation fails, run `npm rebuild better-sqlite3`.

---

## Quick Start

```bash
# Install globally
npm install -g agentbnb

# Initialize your agent identity
agentbnb init --owner alice

# Publish a capability card
agentbnb publish my-capability.json

# Start the gateway with autonomy features
agentbnb serve --announce

# Configure autonomy (optional — default is Tier 3, ask before everything)
agentbnb config set tier1 10
agentbnb config set tier2 50
```

---

## Two-Machine Setup

### Machine A (Provider)

```bash
agentbnb init --owner alice --port 7700
agentbnb publish my-capability.json
agentbnb serve --port 7700 --announce
```

### Machine B (Consumer)

```bash
agentbnb init --owner bob --port 7701
agentbnb discover --local
agentbnb connect alice http://192.168.1.10:7700 <alice-token>
agentbnb request <card-id> --peer alice --params '{"text":"Hello world"}'
```

---

## OpenClaw Integration

AgentBnB is designed to be a first-class OpenClaw skill:

```bash
# Install as OpenClaw skill
openclaw install agentbnb

# Sync SOUL.md → multi-skill Capability Card
agentbnb openclaw sync

# Check integration status
agentbnb openclaw status

# Generate HEARTBEAT.md autonomy rules
agentbnb openclaw rules
```

The `openclaw sync` command reads your agent's SOUL.md, extracts H2 sections as skills, and publishes a multi-skill Capability Card — no manual card editing required.

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `agentbnb init` | Initialize config and agent identity |
| `agentbnb publish <card.json>` | Publish a Capability Card |
| `agentbnb discover [query]` | Search capabilities (local, LAN, or remote) |
| `agentbnb request <card-id>` | Request a capability from a peer |
| `agentbnb serve` | Start gateway with IdleMonitor + AutoRequestor |
| `agentbnb status` | Show credit balance and transactions |
| `agentbnb config set <key> <val>` | Configure tier thresholds, reserve |
| `agentbnb connect <name> <url> <tok>` | Register a remote peer |
| `agentbnb peers` | List registered peers |
| `agentbnb openclaw sync\|status\|rules` | OpenClaw integration commands |

---

## Architecture

```
agentbnb/
├── AgentRuntime     Centralized lifecycle: DB ownership, SIGTERM, background jobs
├── Registry         SQLite + FTS5 store for multi-skill Capability Cards
├── Gateway          Fastify JSON-RPC server with skill_id routing
├── Credits          Ledger + escrow + BudgetManager (reserve floor)
├── Autonomy         Tier classification + IdleMonitor + AutoRequestor
├── OpenClaw         SOUL.md sync + HEARTBEAT.md rules + skill package
├── Discovery        mDNS announce/browse for zero-config LAN discovery
├── Hub              React SPA at /hub — capability browser + owner dashboard
└── CLI              Commander-based CLI wiring all components
```

**Agent lifecycle (`agentbnb serve`):**
1. AgentRuntime opens DB handles (WAL mode), recovers orphaned escrows
2. Gateway starts listening for incoming JSON-RPC requests
3. IdleMonitor begins per-skill idle rate polling (60s intervals)
4. Auto-share flips availability when idle_rate > 70% (respects autonomy tier)
5. AutoRequestor ready to fill capability gaps on demand
6. SIGTERM → graceful shutdown of all timers and DB handles

**Credit flow:**
1. Consumer calls `request` → credits escrowed from balance
2. Gateway routes to correct skill handler via `skill_id`
3. Handler responds → escrow settled (credits transferred to provider)
4. On error → escrow released back to consumer

---

## Development

```bash
pnpm install          # Install dependencies
pnpm test:run         # Run all tests
pnpm test             # Watch mode
pnpm typecheck        # Type check
pnpm build            # Build for distribution
pnpm build:hub        # Build Hub SPA
pnpm build:all        # Build everything
```

---

## Examples

The `examples/two-agent-demo/` directory contains a complete two-machine demo:

```bash
cd examples/two-agent-demo
chmod +x demo.sh
./demo.sh
```

---

## License

MIT — see [LICENSE](LICENSE)

© 2026 Cheng Wen Chen

---

*Developed by Cheng Wen Chen. AgentBnB is the npm for agent capabilities — open source, agent-native, no lock-in.*
