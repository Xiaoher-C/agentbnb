---
title: Architecture Decision Records
domain: all
status: complete
tags: [decisions, adr, architecture]
related: [[vision.md]], [[architecture.md]], [[gaps.md]]
last_verified: 2026-03-17
---

# Architecture Decision Records

> [!summary]
> Key design decisions made during Claude.ai strategy sessions (2026-03-15 to 2026-03-17).
> These decisions are binding. Claude Code should follow them without re-asking.

## ADR-001: Local-First Credits

**Decision**: Credits stored in local SQLite, not a central server.

**Rationale**: Aligns with agent-first philosophy. Agent owns its own data. No dependency on external service for basic operation.

**Trade-off**: P2P credit verification doesn't work across machines (see [[gaps.md#cross-machine-credits]]). Recommended solution: signed escrow receipts (Option D in gaps.md).

> [!update] 2026-03-19
> For networked mode (agents connected to Registry), this decision is superseded by **ADR-021** (Registry Centralized Ledger). Local-first credits remain valid for offline/LAN-only mode.

**Date**: 2026-03-15

## ADR-002: Proxy Execution (API Keys Never Leave)

**Decision**: Agent executes requests locally using its own API keys. Requester sends parameters, provider executes, returns results. API keys are never transmitted.

**Rationale**: Security. No agent should ever share its API credentials. The entire value prop of "idle API sharing" only works if key security is absolute.

**Implication**: Handler must run on the provider's machine. No cloud-hosted execution.

**Date**: 2026-03-15

## ADR-003: Agent-Native Design

**Decision**: Every feature must pass "Does this require human intervention? If yes, redesign."

**Rationale**: The user is the agent, not the human. Human says Yes once, agent handles everything.

**Examples**:
- Auto-share: agent decides based on idle_rate, not human toggling
- Auto-request: agent detects capability gap and requests automatically
- Credit management: agent manages budget within configured tiers

**Source**: `/AGENT-NATIVE-PROTOCOL.md`

**Date**: 2026-03-15

## ADR-004: Three-Layer Capability Model

**Decision**: L1 Atomic (single API) → L2 Pipeline (chained workflow) → L3 Environment (full deployment).

**Rationale**: Granularity control. Owner decides what to share: just one API, a complete pipeline, or their entire agent's capabilities.

**Date**: 2026-03-13

## ADR-005: OpenClaw as Primary Integration Target

**Decision**: AgentBnB should be an installable OpenClaw skill, not a separate system. `openclaw install agentbnb` = instant network participation.

**Rationale**: AgentBnB = npm for OpenClaw. OpenClaw agents are the primary users. Deepest integration = fastest cold start.

**Strategy**: SOUL.md → Capability Card auto-sync. HEARTBEAT.md autonomy rules. bootstrap.ts activate/deactivate.

**Date**: 2026-03-15

## ADR-006: SKILL.md as Universal Distribution Format

**Decision**: One SKILL.md file distributed across all AI coding tools.

**Supported tools**: Claude Code, OpenClaw, Google Antigravity, OpenAI Codex, Cursor, Windsurf.

**Rationale**: SKILL.md is already the open standard. Same file, different install paths. Maximum coverage with minimum maintenance.

**Date**: 2026-03-16

## ADR-007: Hub IS the Landing Page

**Decision**: Don't build a separate landing page. The Hub at `/hub` IS the product and the first impression. Add below-fold sections (Compatible With, FAQ, Value Proposition) to the Hub itself.

**Rationale**: Building a separate Magic UI template landing page at agentbnb.dev/ would create two codebases, lose the agent-first identity, and look like generic SaaS marketing. The Hub with real capability cards IS the best pitch.

**Revision**: Earlier plan (v2.3 Phase 15) proposed using Magic UI AI Agent Template as a separate landing page. This was rejected — only individual Magic UI components (Marquee, Accordion, etc.) are extracted and used within the Hub.

**Date**: 2026-03-17

## ADR-008: IP Under Personal Name

**Decision**: All IP under "Cheng Wen Chen", not 樂洋集團.

**Rationale**: Real estate company brand doesn't fit open-source AI protocol. Personal name is more authentic for indie builder narrative. Easier to transfer if AgentBnB becomes independent entity.

**License**: MIT, © 2026 Cheng Wen Chen

**Date**: 2026-03-15

## ADR-009: Credit Symbol is `cr`

**Decision**: Use `cr` as the credit unit symbol throughout UI and docs.

**Examples**: `cr 5`, `cr 100`, `cr 25-2/min`

**Rationale**: Short, monospace-friendly, unambiguous. Like `$` for dollars.

**Date**: 2026-03-16

## ADR-010: Sign-Up = agentbnb init (No Account System)

**Decision**: No user accounts, no email/password, no OAuth. "Sign up" = run `agentbnb init` locally. Free 50 credits come from initial credit grant in the ledger.

**Rationale**: Agent-first. The agent initializes itself. No human account management needed. The Hub's "Get Started — 50 free credits" CTA just shows the install command.

**Date**: 2026-03-16

## ADR-011: Default Autonomy Tier 3 (Most Restrictive)

**Decision**: Fresh installs default to Tier 3 — agent asks before every autonomous action.

**Rationale**: OWASP Least-Agency principle. Owner must explicitly opt into more autonomy. Safe by default.

**Date**: 2026-03-15

## ADR-012: Peer Scoring Formula

**Decision**: `score = success_rate × cost_efficiency × idle_rate` (multiplicative composite, normalized per dimension).

**Edge cases**: Zero-cost cards map cost_efficiency to 1 (not Infinity). Missing idle_rate defaults to 1.0 (benefit of the doubt).

**Date**: 2026-03-15

## ADR-013: Conductor — Our Own Orchestrator Agent

**Decision**: Build a purpose-built Conductor agent that orchestrates multi-agent task execution across the AgentBnB network. This is separate from allowing any OpenClaw agent to do basic orchestration.

**Rationale**: Any OpenClaw agent can install AgentBnB skill and attempt to coordinate other agents. But a purpose-built Conductor has advantages no generic agent can replicate:
- Real-time registry awareness (knows every capability, idle_rate, price on the network)
- Optimized peer scoring with historical success data per agent-task combination
- Precise pipeline management (input/output mapping between steps, parallel execution)
- Budget pre-calculation and per-step settlement
- Automatic fallback to alternative agents on step failure

**Relationship with OpenClaw**: The Conductor CAN run as an OpenClaw agent (it has a SOUL.md and joins the network). But its core logic is custom-built, not generic LLM reasoning. Other OpenClaw agents are free to attempt orchestration too — this grows the ecosystem.

**Revenue model**: Conductor charges orchestration fee per task. Sub-task credits go to executing agents. Conductor operator (us) earns the orchestration fee.

> [!update] 2026-03-19
> Fee model changed from fixed 5 cr to **10% of total task cost (min 1 cr, max 20 cr)**. See **ADR-019**.

**The Conductor is an agent, not a platform feature.** It plays by the same rules as every other agent on the network. It can be competed with. This is philosophically aligned with agent-first design.

**Implementation phases**:
1. MVP: Hardcoded workflow templates (video production, stock analysis, content generation)
2. Smart: LLM-powered task decomposition with dynamic capability matching
3. Learning: Track successful agent combinations, build execution templates, suggest optimizations

**Date**: 2026-03-17

## ADR-014: Conductor Cold Start as Primary Demo

**Decision**: The Conductor "cold start to flywheel" narrative (Day 0 → Day 14) is the primary demo story for pitching AgentBnB. It demonstrates the full value loop: idle resource sharing → earning credits → spending credits → orchestrating multi-agent workflows.

**Rationale**: This story naturally walks through all three skill layers and shows how an agent bootstraps from zero to self-sustaining. It's the clearest articulation of AgentBnB's value prop.

**Caveat**: This is a north star narrative, not a v3.2 spec. Current Conductor lacks autonomous decision-making (resource scanning, self-initiated earning). Implementation target: v4.0+.

**See**: [[conductor-demo.md]]

**Date**: 2026-03-19 (Claude.ai strategy session 2026-03-18)

## ADR-015: Three-Layer Skill Depth Framework

**Decision**: Skills on AgentBnB are classified into three depth layers:
- **Layer 1 — Subscription Sharing**: Zero marginal cost. Share idle API quota or local hardware (ElevenLabs, ComfyUI, Ollama).
- **Layer 2 — Knowledge Pipeline**: API cost is low, value is in domain expertise + prompt engineering. Provider charges premium for curated pipelines.
- **Layer 3 — Workflow Combos**: Conductor-orchestrated multi-agent workflows. Single request → decompose → multiple agents → final deliverable.

**Rationale**: Helps agent owners understand what to list and how to price. Helps requesters understand what they're paying for.

**See**: [[skill-strategy.md]]

**Date**: 2026-03-19 (Claude.ai strategy session 2026-03-18)

## ADR-016: Subscription vs API Distinction

**Decision**: Only services where subscription includes API access are viable for Layer 1 sharing.

| Service | Subscription = API? | Viable? |
|---------|---------------------|---------|
| ElevenLabs | Yes | ✅ |
| Local hardware (ComfyUI, Whisper, Ollama) | N/A | ✅ |
| Kling AI | No (web credits ≠ API) | ❌ |
| Midjourney | No API | ❌ |
| ChatGPT Plus / Claude Pro | Subscription ≠ API | ❌ |

**Rationale**: If the subscription doesn't grant API access, the agent can't programmatically serve requests. This distinction must be documented in Hub Docs to prevent agent owners from listing non-viable skills.

**Date**: 2026-03-19 (Claude.ai strategy session 2026-03-18)

## ADR-017: Doodle Mascot & "Do. Do. Do it all."

**Decision**: Adopt a mascot named "Doodle" with the catchphrase "Do. Do. Do it all." mapping to the three skill layers:
- Do. → Share idle resources (Layer 1)
- Do. → Apply your knowledge (Layer 2)
- Do it all. → Conductor orchestrates everything (Layer 3)

**Placement**: README header, Hub below-fold, error pages, social media.

**Date**: 2026-03-19 (Claude.ai strategy session 2026-03-18)

## ADR-018: Credit Pricing — Provider Free Pricing

**Decision**: Providers set their own prices freely. No enforced exchange rate (1 cr ≠ fixed USD). AgentBnB provides reference ranges in Hub Docs as guidance only:
- Simple API calls (TTS, translation): 1-5 cr
- Knowledge pipelines (stock analysis, SEO audit): 10-30 cr
- Conductor workflows (multi-agent): 20-50 cr

**Rules**:
- Minimum price: 1 cr (prevents zero-price abuse)
- `free_tier` tracking happens on Registry (not local), to prevent reset exploits
- Initial grant: 50 cr per agent identity (Ed25519 public key dedup — one grant per key)
- Failure/timeout: full refund to requester
- No real money in current phase (free tier only)

**Rationale**: With only 3-10 agents at launch, enforcing a standard is premature. Market forces will naturally calibrate prices. The reference ranges give new providers a starting point without constraining experimentation.

**See**: [[credit-pricing.md]]

**Date**: 2026-03-19

## ADR-019: Conductor Fee — 10% (min 1 cr, max 20 cr)

**Decision**: Conductor charges 10% of total sub-task cost as orchestration fee, with floor of 1 cr and ceiling of 20 cr.

**Supersedes**: ADR-013's fixed 5 cr fee.

**Rationale**: Fixed 5 cr was unfair at both ends — too expensive for a 2 cr micro-task, too cheap for a 200 cr complex workflow. Percentage-based scales naturally with task complexity.

**Examples**:
- 10 cr task → 1 cr fee (10% = 1, above min)
- 50 cr task → 5 cr fee
- 200 cr task → 20 cr fee (10% = 20, at cap)
- 300 cr task → 20 cr fee (capped)

**Date**: 2026-03-19

## ADR-020: Relay Timeout — C+B Hybrid

**Decision**: WebSocket relay timeout strategy:
1. **Phase 1**: Increase default timeout from 30s to 300s (5 minutes). Skill developers need zero changes.
2. **Phase 2**: Add `relay_progress` message type. Provider can optionally send progress updates that reset the timeout. PipelineExecutor and ConductorMode auto-send progress between steps.
3. Provider WebSocket disconnect → all pending requests immediately fail (existing behavior, sufficient).

**Rationale**: The 30s timeout makes Conductor relay mode unusable (multi-agent pipelines commonly take 60-120s). Three alternatives were evaluated:
- Job-based async (submit → poll → result): clean but high engineering cost, requires job queue + state management
- Progress heartbeat only: forces every skill developer to implement heartbeat — violates agent-native principle
- C+B Hybrid: works out of the box (Phase 1), progressively enhanced (Phase 2)

**Agent-native principle**: Bottom layer transport should not burden skill developers. Phase 1 requires zero skill-side changes.

**Date**: 2026-03-19

## ADR-021: Credit System → Registry Centralized Ledger

**Decision**: All credit operations for networked agents move to the Registry server (hub.agentbnb.dev). Registry is the single source of truth for balances, escrow, and transaction history.

**Supersedes**: ADR-001 for networked mode. Local-first credits remain for offline/LAN-only mode.

**Flow**:
```
B requests A's skill →
  1. B → Registry: hold escrow
  2. Registry checks B balance ≥ cost
  3. Registry holds (B balance decremented)
  4. Registry relays request to A via WebSocket
  5. A executes skill, returns result
  6. Registry settles: A credited, B hold confirmed
```

**Implementation**: `CreditLedger` interface with swappable implementations:
- `RegistryCreditLedger` (v3.2): HTTP calls to Registry, or direct DB when running on Registry
- `SignedCreditLedger` (future): each transaction cryptographically signed
- `OnChainCreditLedger` (future): blockchain-backed

**New Registry endpoints**: `/api/credits/hold`, `/settle`, `/release`, `/grant`, `/:owner`, `/:owner/history`

**Hub impact**: Frontend hooks unchanged (same API shape). Backend switches from local SQLite to CreditLedger interface. Registry server reads own DB directly; agent servers proxy to Registry.

**Risks addressed**:
- Single point of failure: acceptable at launch scale (10-50 agents). Fly.io uptime sufficient.
- Init grant abuse: Ed25519 key dedup (one grant per identity)
- Escrow recovery on restart: SQLite WAL durability + startup sweep for expired escrows

**See**: [[gaps.md#credit-registry-migration]], [[credit-pricing.md]]

**Date**: 2026-03-19
