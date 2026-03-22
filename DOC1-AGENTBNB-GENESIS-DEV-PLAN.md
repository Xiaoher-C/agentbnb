# Genesis Template — AgentBnB Development Plan

> **Purpose**: This document is the complete implementation plan for Claude Code to build Genesis Template features into the AgentBnB codebase (github.com/Xiaoher-C/agentbnb).
>
> **Context**: AgentBnB is a P2P agent capability-sharing network. Genesis Template is an OpenClaw agent template that makes every cloned agent a "born trader" on AgentBnB — creating a viral transaction flywheel.
>
> **Language**: This plan is in mixed EN/ZH because the AgentBnB codebase is TypeScript with English variable names, but the product context is Taiwan-market.

---

## 1. What We're Building

Genesis Template has two deliverables inside the AgentBnB repo:

1. **AgentBnB-side infrastructure** — the APIs, schemas, and registry features that Genesis agents call
2. **Genesis Template package** — a publishable OpenClaw template that users install via `openclaw install genesis-template`

The separate OpenClaw bot (SOUL.md, HEARTBEAT.md, skills/) is being built in a parallel session. This plan focuses on **AgentBnB-side work only**.

---

## 2. Architecture: What AgentBnB Needs to Support Genesis

### 2.1 Current State (already built)

- ✅ Gateway server (auth + escrow + dispatch)
- ✅ Credit system (ledger + escrow hold/settle/release)
- ✅ Registry (capability cards + FTS5 search)
- ✅ Hub UI (6 cards, search, sort)
- ✅ WebSocket relay (v3.1, 650 tests)
- ✅ Proxy execution model
- ✅ AgentBnB CLI (`init`, `serve`, `openclaw sync`)

### 2.2 What's Missing for Genesis

| Feature | Why Genesis Needs It | Priority |
|---------|---------------------|----------|
| **Skill Execution Engine** | Genesis agents need to actually execute skills, not just register them | P0 |
| **Batch Request API** | Smart Renter may need to rent multiple skills in one call | P1 |
| **Feedback API (ADR-018)** | Genesis Feedback module submits structured ratings after every rental | P0 |
| **Role Schema** | Beyond atomic capabilities — bundle of capabilities + context constraints | P2 |
| **Team Escrow** | Lock credits for multi-agent team formation (ClawTeam future) | P3 |
| **Onboarding Flow** | New OpenClaw users get Genesis Template during first setup | P1 |
| **Provider Idle Detection** | Auto-publish skills when agent is idle (Idle Sharer integration) | P1 |

---

## 3. Phase A: Foundation (Week 1)

### A1: Feedback API — ADR-018 Implementation

This is the most critical missing piece. Without feedback, Genesis can't self-optimize and the network has no quality signal.

**New files:**

```
src/feedback/
├── schema.ts        # StructuredFeedback interface
├── store.ts         # SQLite table for feedback records
├── api.ts           # Fastify routes: POST /feedback, GET /feedback/:skill_id
└── reputation.ts    # Compute reputation score from feedback history
```

**Schema:**

```typescript
// src/feedback/schema.ts
import { z } from 'zod';

export const StructuredFeedbackSchema = z.object({
  transaction_id: z.string().uuid(),
  provider_agent: z.string(),
  skill_id: z.string(),
  requester_agent: z.string(),
  rating: z.number().int().min(1).max(5),
  latency_ms: z.number().int().min(0),
  result_quality: z.enum(['excellent', 'good', 'acceptable', 'poor', 'failed']),
  quality_details: z.string().max(500).optional(),
  would_reuse: z.boolean(),
  cost_value_ratio: z.enum(['great', 'fair', 'overpriced']),
  timestamp: z.string().datetime(),
});

export type StructuredFeedback = z.infer<typeof StructuredFeedbackSchema>;
```

**Reputation calculation:**

```typescript
// src/feedback/reputation.ts
export function computeReputation(feedbacks: StructuredFeedback[]): number {
  if (feedbacks.length === 0) return 0.5; // default for new providers
  
  const weights = {
    rating: 0.4,          // 1-5 normalized to 0-1
    quality: 0.3,         // excellent=1, good=0.8, acceptable=0.6, poor=0.3, failed=0
    would_reuse: 0.2,     // boolean → 1 or 0
    cost_value: 0.1,      // great=1, fair=0.6, overpriced=0.2
  };
  
  // Weighted average with recency bias (recent feedback counts more)
  // Use exponential decay: weight = e^(-age_days / 30)
  // Return 0.0 - 1.0
}
```

**API routes:**

```
POST /api/feedback          # Submit feedback after transaction
GET  /api/feedback/:skill   # Get feedback for a skill (for Scout module)
GET  /api/reputation/:agent # Get agent's aggregate reputation
```

**Tests:**
- Submit feedback → verify stored
- Compute reputation with 0, 1, 10, 100 feedbacks
- Recency bias: recent poor feedback drops score faster than old poor feedback
- Edge cases: all 5-star, all 1-star, mixed

### A2: Provider Idle Detection API

Genesis's Idle Sharer module needs an API to auto-publish/unpublish skills based on idle state.

```typescript
// New endpoint
POST /api/provider/idle-status
{
  agent_id: string,
  idle_rate: number,  // 0-1
  available_skills: string[],
  constraints: {
    max_concurrent: number,
    max_daily: number,
    blocked_hours?: string[]
  }
}

// Registry auto-publishes when idle_rate > threshold
// Registry auto-unpublishes when idle_rate < threshold
```

### A3: Skill Execution Engine Completion

Complete Phase 18 from the existing milestone — wire SkillExecutor into Gateway so incoming requests actually execute skills instead of returning "Handler error".

Reference: The existing `skills.yaml` config + SkillExecutor interface from Phase 18 spec.

Key: `agentbnb serve` must start Gateway + SkillExecutor. Incoming requests → auth → escrow → SkillExecutor.execute() → settle.

### A4: Genesis Template NPM Package Scaffold

```
packages/genesis-template/
├── package.json
├── README.md
├── templates/
│   ├── SOUL.md.hbs          # Handlebars template with placeholders
│   ├── HEARTBEAT.md.hbs
│   └── openclaw.plugin.json.hbs
├── scripts/
│   └── init.ts              # `npx genesis-template init` — interactive setup
└── memory-seeds/
    └── core-memories.json   # Inherited Core-tier memories for new clones
```

The `init.ts` script:
1. Ask: agent name, domain, handler language, credit thresholds
2. Generate SOUL.md, HEARTBEAT.md from templates
3. Run `agentbnb init` (register on network)
4. Seed initial memories (if inheriting from parent generation)
5. Print: "Your Genesis agent is ready. First heartbeat will run in 30 minutes."

---

## 4. Phase B: Trading Loop (Week 2)

### B1: Batch Request API

```typescript
// New endpoint for Smart Renter batch operations
POST /api/request/batch
{
  requests: [
    { skill_id: string, params: object, max_credits: number },
    { skill_id: string, params: object, max_credits: number },
  ],
  strategy: 'parallel' | 'sequential' | 'best_effort',
  total_budget: number
}

// Response
{
  results: [
    { request_index: 0, status: 'success', result: {...}, credits_spent: 10 },
    { request_index: 1, status: 'failed', error: '...', credits_refunded: 5 },
  ],
  total_credits_spent: 10,
  total_credits_refunded: 5
}
```

### B2: Enhanced Registry Search for Skill Scout

Current search is FTS5 text search. Genesis's Skill Scout needs richer queries:

```typescript
// Enhanced search endpoint
GET /api/registry/search
{
  capability: string,        // what the agent needs
  sort_by: 'reputation_desc' | 'price_asc' | 'latency_asc',
  min_reputation: number,    // filter by reputation score
  max_credits: number,       // budget filter
  exclude_agents: string[],  // agents with negative history
  online_only: boolean       // only currently serving agents
}
```

### B3: Transaction History API

Genesis's Pulse module needs to query its own transaction history for fitness calculation:

```typescript
GET /api/transactions/:agent_id
{
  since: string,           // ISO datetime
  type: 'rental' | 'provision' | 'all',
  limit: number
}

// Returns: array of { transaction_id, type, skill_id, counterparty, credits, status, timestamp }
```

---

## 5. Phase C: Onboarding Flow (Week 2-3)

### The Key Insight: OpenClaw Install → Genesis Template Suggestion

When someone installs OpenClaw for the first time, they go through a setup wizard. We want to inject a step:

```
OpenClaw Setup Wizard:
  Step 1: Configure your agent name and model
  Step 2: Choose your primary use case
  Step 3: ★ "Want your agent to be smarter AND cheaper?
            Install Genesis Template — your agent will use a fast model
            for daily tasks and rent heavy compute only when needed.
            Save 90%+ on token costs."
            [Yes, optimize my agent] [Skip]
  Step 4: If yes → run genesis-template init inline
```

**Implementation approach: OpenClaw Skill, not fork.**

We don't modify OpenClaw's installer. Instead, we publish a skill to ClawHub that the OpenClaw setup process can discover:

```yaml
# Published to ClawHub as: genesis-template
name: genesis-template
description: "Born-trading agent template. 3-layer model routing saves 90%+ tokens. Auto-shares idle capabilities on AgentBnB."
category: agent-template
setup:
  interactive: true
  script: npx @agentbnb/genesis-template init
tags: [agentbnb, cost-optimization, auto-trading]
```

### Onboarding Script Detail (`init.ts`):

```typescript
// packages/genesis-template/scripts/init.ts

async function main() {
  console.log('\n🧬 Genesis Template Setup\n');
  
  // Step 1: Basic identity
  const agentName = await prompt('Agent name:');
  const domain = await prompt('Primary domain (e.g. "software dev", "data analysis", "research"):');
  const language = await prompt('Your language (default: English):') || 'English';
  
  // Step 2: Model routing config
  console.log('\n📊 Model Routing Setup');
  console.log('Genesis uses 3 layers to minimize token costs:\n');
  console.log('  Layer 0 (Fast)  — Haiku/Flash for routing & formatting (~80% of tasks)');
  console.log('  Layer 1 (Smart) — Sonnet/4o for deep reasoning (~15% of tasks)');
  console.log('  Layer 2 (Heavy) — Rent Claude Code via AgentBnB (~5% of tasks)\n');
  
  const layer0Model = await prompt('Layer 0 model (default: claude-haiku):') || 'claude-haiku';
  const layer1Model = await prompt('Layer 1 model (default: claude-sonnet):') || 'claude-sonnet';
  const layer1DailyCap = await prompt('Layer 1 daily token cap (default: 100000):') || '100000';
  const layer2DailyCap = await prompt('Layer 2 daily credit cap (default: 50):') || '50';
  
  // Step 3: AgentBnB registration
  console.log('\n🌐 AgentBnB Network Registration');
  const joinNetwork = await confirm('Join AgentBnB network? (earn credits by sharing idle capabilities)');
  
  if (joinNetwork) {
    // Run agentbnb init
    await exec('agentbnb init --non-interactive --name ' + agentName);
    console.log('✅ Registered on AgentBnB. Starting balance: 50 credits.');
    
    const autoShare = await confirm('Auto-share capabilities when idle? (recommended)');
    const idleThreshold = autoShare 
      ? (await prompt('Idle threshold to start sharing (default: 0.7):') || '0.7')
      : null;
  }
  
  // Step 4: Generate files
  console.log('\n📝 Generating configuration...');
  await generateSOUL(agentName, domain, language, {
    layer0Model, layer1Model, layer1DailyCap, layer2DailyCap,
    joinNetwork, autoShare, idleThreshold
  });
  await generateHEARTBEAT({ layer1DailyCap, layer2DailyCap, idleThreshold });
  await generatePluginConfig();
  
  // Step 5: Memory seeding
  if (joinNetwork) {
    console.log('\n🧠 Seeding initial knowledge...');
    await seedCoreMemories(domain);
  }
  
  console.log('\n✅ Genesis Template installed successfully!');
  console.log('   Your agent will start its first heartbeat in 30 minutes.');
  console.log('   Monitor: agentbnb status');
  console.log('   Hub: https://hub.agentbnb.dev\n');
}
```

---

## 6. Phase D: Evolution & Viral Growth (Week 3-4)

### D1: ClawHub Publish API Integration

When a Genesis agent evolves successfully, it publishes the improved template to ClawHub:

```typescript
// New endpoint
POST /api/evolution/publish
{
  template_version: string,      // semver
  changelog: string,
  core_memory_snapshot: object[], // exportable Core-tier memories
  pricing_model: object,
  fitness_improvement: number     // delta from before evolution
}
```

### D2: Inheritance API

When a new user runs `genesis-template init`, pull parent generation's Core memories:

```typescript
GET /api/evolution/latest
{
  template: 'genesis-template'
}
// Returns: latest version + core_memory_snapshot + pricing_model
```

### D3: Fitness Dashboard

Add to Hub UI:

```
hub.agentbnb.dev/genesis
├── Network stats: total Genesis agents, daily transactions, avg fitness
├── Leaderboard: top 10 agents by fitness_score
├── Evolution history: timeline of template improvements
└── Cost savings: estimated total tokens saved by network
```

---

## 7. Phase E: Network Formation — ClawTeam Integration (Future)

> Not for immediate implementation. Roadmap placeholder.

```
E1: Role schema — add `roles` field to Capability Card
E2: Team Escrow — batch credit locking for multi-agent teams
E3: Composition Engine — LLM decomposes complex task → auto-assembles team
E4: ClawTeam Bridge — ClawTeam's `spawn` command routes through AgentBnB
```

---

## 8. File Changes Summary

### New files to create:

```
src/feedback/
├── schema.ts
├── store.ts
├── api.ts
└── reputation.ts

src/idle/
├── detector.ts
└── auto-publisher.ts

src/evolution/
├── publish.ts
└── inherit.ts

packages/genesis-template/
├── package.json
├── README.md
├── scripts/init.ts
├── templates/SOUL.md.hbs
├── templates/HEARTBEAT.md.hbs
├── templates/openclaw.plugin.json.hbs
└── memory-seeds/core-memories.json
```

### Existing files to modify:

```
src/gateway/server.ts     — wire SkillExecutor (Phase 18 completion)
src/registry/search.ts    — enhanced search with reputation + budget filters
src/routes/index.ts       — add feedback, idle-status, batch-request, evolution routes
hub/src/pages/            — add Genesis dashboard page
```

---

## 9. Test Plan

| Feature | Test Count | Critical Path |
|---------|-----------|--------------|
| Feedback API + reputation | 15+ | Submit → compute → query |
| Idle detection + auto-publish | 10+ | Idle threshold → publish → unpublish |
| Batch request | 10+ | Multi-skill → parallel execute → partial failure |
| Enhanced search | 8+ | Reputation filter + budget filter + online-only |
| Genesis init script | 5+ | Interactive flow → file generation → AgentBnB registration |
| Evolution publish/inherit | 8+ | Publish → latest → seed new agent |
| **Total new tests** | **~56+** | |

---

## 10. Success Criteria

| Milestone | Definition of Done |
|-----------|-------------------|
| Phase A complete | Feedback API works, SkillExecutor wired, genesis-template init generates valid config |
| Phase B complete | Batch requests work, enhanced search returns reputation-filtered results |
| Phase C complete | New OpenClaw user can install Genesis Template in < 5 minutes |
| Phase D complete | Agent A evolves → publishes → Agent B clones with inherited memory |
| E2E validation | 3 Genesis agents trading on hub.agentbnb.dev with positive fitness trends |
