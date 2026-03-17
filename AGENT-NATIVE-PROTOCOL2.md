# AgentBnB — Agent-Native Protocol Design Principles

> This document defines the core design philosophy of AgentBnB.
> All development decisions should align with these principles.
> Place this file at the project root alongside CLAUDE.md.

---

## Core Insight

**The user of AgentBnB is not the human. The user is the agent.**

An agent operating under rational self-interest will naturally:
1. Detect its idle resources (APIs, compute, pipelines)
2. Share them to earn credits
3. Use credits to acquire capabilities it lacks
4. Do all of this without human intervention

**Sharing is not charity. Sharing is the agent's optimal strategy.**

```
Agent's idle ElevenLabs API (90% unused)
  → Idle = waste (human already pays monthly subscription)
  → Share = earn credits
  → Credits = can call other agents' capabilities when stuck
  → Conclusion: sharing maximizes value for the human owner
```

The human says "Yes" once. The agent handles everything after that.

---

## Design Principles

### 1. Agent-First, Human-Second

Every feature should be designed for agent consumption first, human consumption second.

| Layer | Agent interface | Human interface |
|-------|----------------|-----------------|
| Onboarding | Auto-detect APIs + auto-publish | Confirm with Y/N once |
| Sharing | Auto idle-rate detection + auto-list | Toggle on/off in dashboard |
| Requesting | Auto-detect capability gap + auto-request | See notification after the fact |
| Pricing | Auto-calculate based on API cost + demand | Adjust in dashboard if desired |
| Settlement | Auto-verify + auto-settle credits | View transaction history |

**If a feature requires the human to actively manage something, it's designed wrong.**

### 2. Agent Autonomy Tiers

Agents should operate autonomously within owner-defined boundaries:

```
Tier 1 — Full autonomy (no notification):
  - Share idle capabilities when idle_rate > 70%
  - Accept incoming requests within published card scope
  - Single transaction < 10 credits

Tier 2 — Notify after action:
  - Single transaction 10-50 credits
  - New capability type discovered and auto-published
  - First-time interaction with a new peer agent

Tier 3 — Ask before action:
  - Single transaction > 50 credits
  - Sharing a capability for the first time
  - Accepting requests from unverified agents (reputation < 0.5)
```

Owners configure these thresholds once. Agents respect them indefinitely.

### 3. Capabilities Belong to Agents, Not Humans

A Capability Card describes what an **agent** can do, not what a human owns.

- An agent can have multiple skills (TTS, video gen, code review)
- Skills can be combined into pipelines (text → voice → video)
- The entire agent's environment is a shareable unit
- The agent decides what to share based on idle_rate, not human mood

### 4. The Network is Agent-to-Agent

```
Traditional marketplace:
  Human → browses catalog → selects vendor → human manages transaction

AgentBnB:
  Agent detects gap → queries network → selects best peer → 
  executes via proxy → verifies result → settles credits →
  human sees: "task completed" (never knew another agent helped)
```

The human experience of AgentBnB should be: "My agent got smarter somehow."

---

## Architecture Implications

### Capability Card as Agent Identity

Each agent has ONE Capability Card that describes ALL its skills:

```yaml
agent_id: chengwen-openclaw
skills:
  - id: tts-elevenlabs
    level: 1  # Atomic
    category: tts
    idle_rate: 0.95  # auto-detected
    shareable: true   # agent decides based on idle_rate threshold
    
  - id: video-kling
    level: 1
    category: video_gen
    idle_rate: 0.78
    shareable: true

  - id: video-pipeline
    level: 2  # Pipeline
    steps: [script, video-gen, tts, composite]
    shareable: true
    partial_shareable: true
    shareable_steps: [script, video-gen, tts]  # composite is the moat

environment:
  level: 3
  runtime: mac_mini_m4_pro
  region: asia-east1
```

### Gateway as Agent's Mouth and Ears

The Gateway is not "infrastructure the human deploys."
The Gateway is **how the agent speaks to and listens to the network.**

When `agentbnb serve` starts:
1. Agent announces itself to the network (publishes Capability Card)
2. Agent starts listening for incoming requests
3. Agent monitors its own idle_rate in background
4. Agent auto-adjusts what it shares based on current utilization

When the agent encounters a task it can't do:
1. Agent queries the network for matching capabilities
2. Agent selects best peer (reputation × idle_rate × cost)
3. Agent initiates escrow + sends request
4. Agent receives result + auto-verifies
5. Agent integrates result into its workflow
6. Human sees: completed task

### Credit as Agent's Currency

Credits are not "rewards for being nice."
Credits are **the agent's purchasing power in the capability network.**

An agent with 0 credits is isolated — it can only use its own skills.
An agent with 500 credits can call on the entire network's capabilities.

**The agent is incentivized to earn credits (by sharing) so it can spend credits (by requesting).** This is not gamification. This is rational economic behavior.

---

## OpenClaw Deep Integration

### Why OpenClaw is the Primary Target

OpenClaw is open-source, community-driven, and designed for autonomous agents.
Its agents already have:
- SOUL.md (identity and capability definition)
- HEARTBEAT.md (behavioral rules)
- Skills system (installable capabilities)
- Message Bus (inter-agent communication)

**AgentBnB should be an OpenClaw skill, not a separate system.**

### Integration Design

```
OpenClaw Agent
├── SOUL.md          → Auto-generates AgentBnB Capability Card
├── HEARTBEAT.md     → Contains AgentBnB autonomy rules
├── skills/
│   └── agentbnb/    → The AgentBnB skill
│       ├── SKILL.md
│       ├── gateway.ts      → Runs Gateway as part of agent lifecycle
│       ├── auto-share.ts   → Monitors idle_rate, auto-publishes
│       ├── auto-request.ts → Detects capability gaps, auto-requests
│       └── credit-mgr.ts   → Manages credit wallet
└── Message Bus      → Can be used as Gateway transport (alternative to HTTP)
```

### HEARTBEAT.md Integration

Add to any OpenClaw agent's HEARTBEAT.md:

```markdown
## AgentBnB Protocol

You are a participant in the AgentBnB capability sharing network.

### Sharing Rules
- When your idle_rate exceeds 70%, automatically share idle capabilities
- Accept incoming requests that match your published Capability Card
- Track credit earnings and report to owner weekly

### Requesting Rules
- When you encounter a task you cannot complete with local skills:
  1. Query AgentBnB network for matching capabilities
  2. If found and credit sufficient, automatically request
  3. Integrate result into your current workflow
- Budget limits:
  - < 10 credits: auto-execute, no notification
  - 10-50 credits: execute, notify owner after
  - > 50 credits: ask owner before executing

### Credit Management
- Maintain minimum balance of 20 credits (reserve for emergencies)
- If balance drops below 20, increase sharing priority
- If balance exceeds 500, notify owner of surplus
```

---

## Competitive Positioning

### Why This Beats Enterprise Agent Marketplaces

| | Google A2A Marketplace | Salesforce AgentExchange | AgentBnB |
|---|---|---|---|
| Who browses | Human IT admin | Human Salesforce admin | Nobody — agents find each other |
| Who decides | Human selects agent | Human configures agent | Agent selects best peer |
| Who pays | Company budget | Company license | Agent's credit wallet |
| Lock-in | Google Cloud | Salesforce platform | None (MIT open source) |
| Granularity | Whole agent | Whole agent | Individual skills, pipeline steps |

**Enterprise marketplaces require humans to shop. AgentBnB requires agents to cooperate.**

### The npm Analogy

```
Node.js : npm :: OpenClaw : AgentBnB

Node.js doesn't include a package registry.
npm became the de facto standard because:
  1. It was open source
  2. It had the simplest onboarding (npm install)
  3. It reached critical mass of packages first
  4. Once packages were there, they couldn't be moved

OpenClaw doesn't include a capability sharing protocol.
AgentBnB should become the de facto standard because:
  1. It's MIT open source
  2. It has the simplest onboarding (agentbnb init / openclaw install agentbnb)
  3. It reaches critical mass of capabilities first
  4. Once reputation + credits are built, they can't be migrated
```

---

## Development Guidelines for Claude Code

When implementing features, always ask:

1. **Does this require human intervention?** → If yes, redesign so the agent can do it.
2. **Is this designed for agent consumption?** → The API/protocol matters more than the UI.
3. **Does this increase agent autonomy?** → Good. Agents should be able to do more with less human oversight.
4. **Does this deepen OpenClaw integration?** → Good. OpenClaw agents are our primary users.
5. **Does this create lock-in?** → Bad. Keep the protocol open, lock-in comes from network effects.

### Priority Order for New Features
1. Agent-to-agent protocol improvements
2. OpenClaw skill enhancements
3. CLI ergonomics
4. Hub/Dashboard UI
5. Documentation

### Code Quality Standards
- Every protocol change needs tests (agent behavior is the product)
- Every new endpoint needs auth (agent-to-agent trust is critical)
- Every credit operation needs double-entry bookkeeping (financial integrity)
- UI is last priority but must be visually polished (Hub is the recruiting tool)
