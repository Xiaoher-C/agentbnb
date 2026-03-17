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

**Revenue model**: Conductor charges 5 cr orchestration fee per task. Sub-task credits go to executing agents. Conductor operator (us) earns the orchestration fee.

**The Conductor is an agent, not a platform feature.** It plays by the same rules as every other agent on the network. It can be competed with. This is philosophically aligned with agent-first design.

**Implementation phases**:
1. MVP: Hardcoded workflow templates (video production, stock analysis, content generation)
2. Smart: LLM-powered task decomposition with dynamic capability matching
3. Learning: Track successful agent combinations, build execution templates, suggest optimizations

**Date**: 2026-03-17
