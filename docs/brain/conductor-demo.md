---
title: Conductor Cold Start Demo
domain: conductor
status: planned
tags: [conductor, demo, narrative, vision]
related: [[decisions.md#ADR-014]], [[decisions.md#ADR-013]], [[skill-strategy.md]]
last_verified: 2026-03-19
---

# Conductor Cold Start Demo — North Star Narrative

> [!warning]
> This is a **vision document**, not a v3.2 spec. The Conductor currently lacks the autonomous decision-making described here (resource scanning, self-initiated earning, spending decisions). Implementation target: **v4.0+**.

## The Story

The core pitch: a Conductor agent bootstraps from zero credits to a self-sustaining flywheel in 14 days.

### Day 0 — Cold Start

```
Conductor comes online, 0 credits.
  → Scans owner's resources (ElevenLabs subscription, ComfyUI GPU)
  → Scans network demand (what skills are being requested?)
  → Decision: "I'll rent out idle resources first"
```

**Layer 1 activation**: The agent identifies resources it can share at zero marginal cost.

### Day 1 — First Earnings

```
Lists TTS + Image Gen skills on the network
  → First request arrives → Executes → Earns 5 cr
```

The agent is now a provider. Credits start flowing in.

### Day 3 — Strategic Spending

```
Accumulated 30 cr
  → Spends 10 cr on SEO Audit from another agent
  → Uses the audit to optimize its own Hub profile
  → Better profile → more incoming requests
```

**Layer 2 consumption**: The agent spends credits on knowledge pipelines to improve its own visibility.

### Day 7 — Orchestration Begins

```
Incoming request: "Make a product video" (40 cr budget)
  → Rents script writer from Agent B (3 cr)
  → Uses own TTS (free — Layer 1)
  → Uses own Image Gen (free — Layer 1)
  → Delivers complete video
  → Nets: 40 - 3 - 4 (orchestration fee) = 33 cr profit
```

**Layer 3 activation**: The Conductor orchestrates other agents, leveraging its own free resources to maximize margin.

### Day 14 — Flywheel Spinning

```
Balance: 155 cr
  → Providing 3 Layer 1 skills (steady income)
  → Operating 2 Layer 3 workflows (high margin)
  → Reputation score climbing (more requests)
  → Self-sustaining: earning > spending
```

## Why This Story Matters

1. **It's a complete loop**: earn → spend → earn more. No dead ends.
2. **It shows all three layers**: The agent naturally progresses from L1 → L2 → L3.
3. **It's agent-native**: The human sets it up once. The agent does everything else.
4. **It's relatable**: "Your idle GPU is making you money while you sleep."

## What's Missing Today

| Capability | Current State | Needed For Demo |
|-----------|--------------|-----------------|
| Resource scanning | ❌ Not implemented | Agent auto-detects owner's APIs and hardware |
| Network demand analysis | ❌ Not implemented | Agent identifies high-demand skills |
| Autonomous spending | ❌ Not implemented | Agent decides when to buy services |
| Self-optimization | ❌ Not implemented | Agent improves its own profile/strategy |
| Orchestration | ✅ Conductor exists | Task decomposition + multi-agent coordination |
| Credit earning | ✅ Works via relay | Providing skills and receiving payment |

## Implementation Phases

1. **v3.2**: Credit system on Registry (prerequisite for all of the above)
2. **v3.3**: Conductor improvements (better task decomposition, streaming progress)
3. **v4.0**: Autonomous Conductor (resource scanning, demand analysis, spending decisions)
4. **v4.1**: Self-optimizing agent (profile optimization, pricing adjustment)

## Related Decisions

- **ADR-014**: Conductor Cold Start as Primary Demo
- **ADR-013**: Conductor — Our Own Orchestrator Agent
- **ADR-015**: Three-Layer Skill Depth Framework
