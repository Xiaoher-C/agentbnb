# AgentBnB Architecture Report — Credit System Redesign + All Strategy Decisions

> Claude Code: This is a comprehensive report from Claude.ai strategy sessions (2026-03-17 ~ 03-18).
> Read this ENTIRE file, then execute the instructions at the bottom.
> This report contains CRITICAL architecture changes that affect the core credit system.

---

## 1. CRITICAL: Credit System Must Move to Registry

### Problem

Current architecture: each agent stores credits in local SQLite (`~/.agentbnb/credit.db`).
This worked for 2-person E2E testing but WILL FAIL at public scale (100-1000 agents).

Specific failure modes:
- Agent B modifies local credit.db → fakes balance → free-rides on Agent A's skills
- Network disconnect during settle → two agents' ledgers permanently out of sync
- Agent runs two instances → double-spends the same credits
- Hub cannot show real credit balances (each agent's balance is local-only)

### Solution: Registry-Centralized Credit Ledger

All credit operations move to the Registry server (hub.agentbnb.dev).
Agents have NO local write access to credits. Registry is the single source of truth.

```
BEFORE (broken at scale):
  Agent A credit.db: 100    Agent B credit.db: 50
  → Each records locally, no verification, pure trust

AFTER (correct):
  Registry DB (hub.agentbnb.dev):
    agent_a: 100
    agent_b: 50

  Flow: B requests A's TTS →
    1. B → Registry: "Hold 5 cr from B for A's TTS"
    2. Registry checks B balance ≥ 5 ✅
    3. Registry holds escrow (B: 50→45 held)
    4. Registry relays request to A via WebSocket
    5. A executes TTS, returns result
    6. Registry settles: A 100→105, B 45 confirmed
    7. All balances verified by Registry. No local DB can be faked.
```

### New API Endpoints (Registry Server)

```
POST   /api/credits/hold      — Hold escrow (Registry deducts balance)
POST   /api/credits/settle    — Settle (transfer credits provider)
POST   /api/credits/release   — Release escrow (refund on failure)
GET    /api/credits/:owner    — Query balance
GET    /api/credits/:owner/history — Transaction history
POST   /api/credits/grant     — Initial 50 cr grant on agentbnb init
```

### Implementation: Use Interface for Future Extensibility

```typescript
interface CreditLedger {
  hold(requester: string, amount: number): Promise<EscrowId>;
  settle(escrowId: EscrowId, provider: string): Promise<void>;
  release(escrowId: EscrowId): Promise<void>;
  getBalance(owner: string): Promise<number>;
  getHistory(owner: string): Promise<Transaction[]>;
  grant(owner: string, amount: number): Promise<void>;
}

// Phase 1 (NOW): Registry implementation
class RegistryCreditLedger implements CreditLedger {
  // All operations are HTTP calls to Registry server
  // Or direct DB operations when running on Registry server itself
}

// Phase 2 (FUTURE): Signed Ledger — each transaction signed, verifiable chain
class SignedCreditLedger implements CreditLedger { ... }

// Phase 3 (FUTURE): On-chain
class OnChainCreditLedger implements CreditLedger { ... }
```

This way, switching from centralized to decentralized is just swapping one implementation.

### What Changes in the Codebase

1. **New file: `src/credit/registry-ledger.ts`**
   - Implements CreditLedger interface
   - When running as Registry server: direct SQLite operations
   - When running as agent: HTTP calls to Registry /api/credits/*

2. **Modify: `src/registry/server.ts`**
   - Add /api/credits/* endpoints
   - Credit DB lives on Registry server, not on each agent

3. **Modify: `src/relay/websocket-relay.ts`**
   - Before relaying a request, Registry holds escrow
   - After receiving response, Registry settles or releases
   - Credit verification is part of the relay flow

4. **Modify: `src/cli/index.ts`**
   - `agentbnb init --registry <url>` → calls Registry /api/credits/grant for 50 free credits
   - `agentbnb status` → calls Registry /api/credits/:owner for balance
   - Remove local credit DB creation for networked agents

5. **Modify: `src/gateway/execute.ts`**
   - Remove local escrow hold/settle/release
   - Delegate to CreditLedger interface (which calls Registry)

6. **Keep local credit DB for offline/local-only mode**
   - If no --registry flag, local credit.db still works (backward compatible)
   - This supports LAN-only P2P usage without Registry

### Architecture Diagram (for reference)

```
                    hub.agentbnb.dev (Fly.io)
                    ┌─────────────────────────┐
                    │  Registry Server          │
                    │  ├── Credit Ledger (DB)   │ ← Single source of truth
                    │  ├── WebSocket Relay      │
                    │  ├── Hub UI               │
                    │  └── Activity Feed        │
                    └────────────┬──────────────┘
                                 │
                  ┌──────────────┼──────────────┐
                  │              │              │
             Agent A         Agent B        Agent C
           (WebSocket)      (WebSocket)    (WebSocket)
           SkillExecutor    SkillExecutor   SkillExecutor
           (local only)     (local only)    (local only)

  Principle: Execution is decentralized (local).
             Money is centralized (Registry).
```

---

## 2. Skill Depth Strategy — Three Layers

### The Depth Test

> "If a user can do this themselves in under 1 day, it's not worth putting on AgentBnB."

### Layer 1: Subscription Sharing (Zero Marginal Cost)

ONLY services where subscription = API quota work here.

| Service | Subscription includes API? | Works? |
|---------|---------------------------|--------|
| ElevenLabs | ✅ Yes | ✅ |
| Local hardware (ComfyUI, Whisper, Ollama) | ✅ N/A | ✅ |
| Kling AI | ❌ Web credits ≠ API | ❌ |
| Midjourney | ❌ No API | ❌ |
| ChatGPT Plus / Claude Pro | ❌ Subscription ≠ API | ❌ |

### Layer 2: Knowledge Pipeline (Domain Expertise)

API cost is low, but VALUE is in domain knowledge + prompt engineering.

### Layer 3: Workflow Combos (Conductor-orchestrated)

Single request → Conductor decomposes → multiple agents → final deliverable.

### ADR-015: Three-Layer Skill Depth Framework
### ADR-016: Subscription vs API Distinction

Add these to docs/brain/decisions.md.

---

## 3. Conductor Cold Start Demo — The Core Narrative

### The Story

```
Day 0: Conductor comes online, 0 credits.
  → Scans owner's resources (ElevenLabs subscription, ComfyUI GPU)
  → Scans network demand
  → Decision: "I'll rent out idle resources first"

Day 1: Lists TTS + Image Gen skills → First request → Earns 5 cr

Day 3: Accumulated 30 cr → Spends 10 cr on SEO Audit → Optimizes own Hub profile

Day 7: Incoming: "Make a product video" (40 cr)
  → Rents script writer (3 cr) → Uses own TTS + Image Gen (free) → Nets 37 cr

Day 14: Balance 155 cr. Flywheel spinning.
```

### ADR-014: Conductor Cold Start as Primary Demo

Add to docs/brain/decisions.md.

---

## 4. Doodle Mascot — "Do. Do. Do it all."

Catchphrase maps to three layers:
```
Do.        → Share idle resources (Layer 1)
Do.        → Apply your knowledge (Layer 2)
Do it all. → Conductor orchestrates everything (Layer 3)
```

### Where Doodle Appears
- README header
- Hub below-fold section
- Error pages
- Social media

### ADR-017: Doodle Mascot & "Do. Do. Do it all."

Add to docs/brain/decisions.md.

---

## 5. Hub Discovery UI — Phase 2 Spec

When network has 50+ agents, current flat grid won't work.

### Already Done (Phase 1):
- ✅ Search bar (FTS5, 300ms debounce)
- ✅ Sort dropdown (Most Popular / Highest Rated / Cheapest / Newest)
- ✅ Card shows "uses this week"

### Phase 2 (do when 20+ agents):
- Trending horizontal scroll (top 10 by 7-day requests)
- Category chips with counts
- Price range filter
- Infinite scroll pagination
- Min success rate filter

Full spec in docs/brain/hub-discovery-upgrade.md (create this file from content below).

---

## 6. OpenClaw Deployment Guide — Added to Hub Docs

Hub Docs now has 6 tabs including OpenClaw integration guide.
Covers: thin wrapper pattern, skills.yaml, Conductor workflow, pricing guide.

---

## 7. Future Improvements (record in gaps.md)

### parseSoulMdV2 Improvement (v3.2)
`agentbnb openclaw sync` generated cards lack category, powered_by, precise inputs/outputs.
SOUL.md H2 sections should support YAML frontmatter or special markers for metadata.

### WebSocket Relay Long-Task Support (v3.2)
stock-analyst full mode needs 5+ minutes. Current relay_request timeout is 30s.
Need: streaming progress or job-based async pattern (submit → poll → result).

---

## 8. Files to Create / Update

### CREATE: docs/brain/conductor-demo.md
Content: Part 3 of this document (Conductor Cold Start narrative)

### CREATE: docs/brain/skill-strategy.md
Content: Part 2 of this document (Three-Layer Skill Depth)

### CREATE: docs/brain/hub-discovery-upgrade.md
Content: Part 5 of this document (Hub Discovery Phase 2 spec)

### UPDATE: docs/brain/decisions.md
Append ADR-014 through ADR-017:
- ADR-014: Conductor Cold Start as Primary Demo
- ADR-015: Three-Layer Skill Depth Framework
- ADR-016: Subscription vs API Distinction
- ADR-017: Doodle Mascot & "Do. Do. Do it all."

### UPDATE: docs/brain/gaps.md
Append two new gaps:
- parseSoulMdV2 metadata improvement
- WebSocket relay long-task support

### UPDATE: docs/brain/architecture.md
Add "Credit System" section reflecting Registry-centralized design.
Update the architecture diagram.

### UPDATE: docs/brain/00-MOC.md
Add links to new files (conductor-demo.md, skill-strategy.md, hub-discovery-upgrade.md)

---

## 9. Credit System Implementation Priority

This is the NEXT code change after v3.1 WebSocket relay is deployed.

```
Priority 1: CreditLedger interface + RegistryCreditLedger class
Priority 2: Registry /api/credits/* endpoints
Priority 3: Integrate into WebSocket relay flow (hold before relay, settle after)
Priority 4: CLI changes (init grants via Registry, status queries Registry)
Priority 5: Hub shows real credit balances from Registry
Priority 6: Keep local-only mode backward compatible
```

Create a new GSD milestone: v3.2 — Registry Credit Ledger

---

## 10. Current Project Status Summary

```
✅ npm agentbnb v3.1.0 published
✅ hub.agentbnb.dev live on Fly.io (Tokyo nrt)
✅ agentbnb.dev live
✅ WebSocket relay complete (650 tests)
✅ Hub Discovery UI Phase 1 (search + sort + uses)
✅ Hub Docs 6 tabs (including OpenClaw guide)
✅ OpenClaw agent online (Cheng Wen's agent)
✅ Git secrets scan CLEAN
✅ GitHub org name reclaim email sent

⏳ Credit system → Registry (this document, Priority 1)
⏳ Partners building agents for internal testing
⏳ Demo video recording
⏳ GitHub repo → Public
⏳ 龍蝦社群 launch
⏳ Taiwan trademark application
```
