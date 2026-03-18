---
title: Known Gaps & Blockers
domain: all
status: gap
tags: [gaps, blockers, architecture, credit, deployment]
related: [[architecture.md]], [[decisions.md]]
last_verified: 2026-03-17
---

# Known Gaps & Blockers

> [!warning]
> These are architecture-level issues that prevent AgentBnB from working in real P2P scenarios.
> They were confirmed via E2E testing on 2026-03-17.

## Cross-Machine Credits {#cross-machine-credits}

**Severity**: 🔴 CRITICAL — Blocks all real P2P exchanges

**Problem**: Each agent's credit balance lives in its own local SQLite database. When Agent B requests a capability from Agent A:
1. Agent B's gateway holds escrow in Agent B's local DB ✅
2. Agent A's gateway receives the request
3. Agent A's gateway tries to verify Agent B has enough credits
4. Agent A queries **its own** credit DB — Agent B's balance doesn't exist there ❌

**Why tests don't catch it**: Integration tests use shared in-memory SQLite DB, so both agents see the same balances.

**Possible solutions**:

| Solution | Pros | Cons | Effort |
|----------|------|------|--------|
| A. Central Ledger (registry server manages all credits) | Simple, consistent | Violates local-first principle | Medium |
| B. Requester-side debit + Provider trust | Preserves local-first | Provider takes risk of fake balance claims | Low |
| C. Portable Account (signed balance proof) | Decentralized, secure | Complex crypto implementation | High |
| D. Hybrid: Requester holds escrow locally + Provider trusts signed receipt | Balances local-first + security | Needs signing mechanism | Medium |

**Recommended**: Option D — Requester holds own escrow, sends a signed "escrow receipt" to provider. Provider trusts the receipt (verifiable via agent's public key). Settlement happens on both sides after execution.

**Status**: Not started. Must be resolved before Closed Beta.

## Handler Implementation {#handler-implementation}

**Severity**: 🔴 CRITICAL — No real capability execution exists

**Problem**: Gateway dispatches requests to `--handler-url` (default `http://localhost:8080`), but nothing listens there. The gateway is a communication pipe with no actual execution engine.

**What's needed**:
1. Example handler implementations (at minimum: a "hello world" echo handler)
2. Handler SDK / template so agent owners can quickly write handlers
3. Bridge between handler and actual APIs (ElevenLabs, Kling, GPT-4o, etc.)

**For OpenClaw agents**: The handler should forward requests to the OpenClaw agent's existing tool/skill system. The agent already knows how to call ElevenLabs — the handler just needs to translate AgentBnB's `{ card_id, skill_id, params }` into OpenClaw's task format.

**Minimum viable handler** (10 lines):
```typescript
// handler.ts — minimal example
import Fastify from 'fastify';
const app = Fastify();
app.post('/execute', async (req) => {
  const { card_id, skill_id, params } = req.body;
  // Your actual API call here
  return { success: true, result: { /* ... */ } };
});
app.listen({ port: 8080 });
```

**Status**: No handler code exists. Must be resolved before any real exchange.

## Deployment {#deployment}

**Severity**: 🟡 MEDIUM — Blocks public access

**Problem**: No deployment infrastructure exists.

**Needed**:
- Dockerfile / fly.toml for Fly.io deployment
- DNS configuration (hub.agentbnb.dev → Fly.io)
- Cloudflare Tunnel setup for Mac Mini gateway external access
- GitHub Actions for CI/CD (currently all build/test/lint is manual)

**Status**: Planned for v2.3 Phase 17 but not started.

## My Agent Route {#my-agent-route}

**Severity**: 🟡 MEDIUM — Hub page broken

**Problem**: `/#/my-agent` returns 404. React Router doesn't have this route defined.

**Context**: v2.2 introduced the My Agent tab in the nav bar, but the route handler was never implemented. The old v2.1 owner dashboard was at a different path.

**Fix**: Wire the route in the Hub's router config. Content should be the existing OwnerDashboard + EarningsChart + TransactionHistory components.

**Status**: Not wired. Quick fix.

## Remote Registry Sync {#remote-registry-sync}

**Severity**: 🟢 LOW — Only pull, no push to remote

**Problem**: `agentbnb discover --registry <url>` can fetch cards from a remote registry, but there's no way to publish your card TO a remote registry. This means every agent only publishes locally.

**Needed**: `agentbnb publish --registry <url>` to push cards to the central registry at `hub.agentbnb.dev`.

**Status**: Pull exists, push does not.

## CI/CD {#ci-cd}

**Severity**: 🟢 LOW — All automation is manual

**Problem**: No GitHub Actions. Build, test, lint, typecheck all run manually. The only automation is `prepublishOnly` hook in package.json.

**Needed**: `.github/workflows/ci.yml` with test + typecheck + lint on every push.

**Status**: Not started.

## Summary Priority

```
✅ SkillExecutor — RESOLVED in v3.0
✅ Cross-Machine Credits — RESOLVED in v3.0 (signed escrow receipts, local mode)
✅ Handler Implementation — RESOLVED in v3.0 (SkillExecutor replaces handlers)
✅ Remote Registry Sync — RESOLVED in v3.1 (WebSocket relay auto-publishes)
✅ Deployment — RESOLVED in v3.1 (fly.toml + Dockerfile ready)
1. 🔴 Credit System → Registry — blocks trustworthy multi-agent exchanges (v3.2)
2. 🟡 Relay long-task support — C+B Hybrid: 5min timeout + optional progress (v3.2)
3. 🟡 parseSoulMdV2 metadata — card quality gap (v3.2)
4. 🟡 My Agent Route — quick fix, broken page
5. 🟢 CI/CD — nice to have
```

## SkillExecutor — Agent Self-Execution Engine {#skill-executor}

**Severity**: 🔴 CRITICAL — Agent cannot execute any capability autonomously

**Problem**: The current architecture has Gateway (communication), IdleMonitor (detection), AutoRequestor (requesting), BudgetManager (budgeting) — but NO execution engine. When a request arrives, Gateway dispatches to `--handler-url` (empty localhost:8080). There is no mechanism for the agent to actually DO things.

**This is the fundamental gap**: Without SkillExecutor, agents are communication pipes with nothing flowing through them. The "agent handles everything" vision requires agents that can act, not just talk.

**Design**: SkillExecutor should support three execution modes:

1. **API Wrapper** — Config-driven API calls (no code needed)
   ```yaml
   skills:
     - id: tts-elevenlabs
       type: api
       provider: elevenlabs
       api_key: ${ELEVENLABS_API_KEY}
   ```
   Agent owner provides API keys in config. SkillExecutor auto-calls the right API.

2. **Pipeline** — Chain multiple skills sequentially
   ```yaml
     - id: video-pipeline
       type: pipeline
       steps: [text-gen, video-gen, tts, composite]
   ```

3. **OpenClaw Bridge** — Forward requests to an OpenClaw agent
   ```yaml
     - id: creative-task
       type: openclaw
       agent: chengwen-openclaw
   ```

**Architecture addition**:
```
AgentRuntime
├── Gateway          (communication — exists)
├── IdleMonitor      (detection — exists)
├── AutoRequestor    (requesting — exists)
├── BudgetManager    (budgeting — exists)
└── SkillExecutor    (execution — MISSING)
    ├── APIExecutor        (call external APIs)
    ├── PipelineExecutor   (chain multiple skills)
    └── OpenClawBridge     (forward to OpenClaw agent)
```

**Impact**: Once SkillExecutor exists:
- Agent owners define skills via YAML config (not handler code)
- The "handler implementation" gap is resolved automatically
- Agent can self-execute without human writing custom HTTP servers
- The full agent-native loop closes: detect idle → share → receive request → execute → settle credits

**Status**: ✅ RESOLVED in v3.0 — SkillExecutor with 5 modes (API, Pipeline, OpenClaw, Command, Conductor) shipped 2026-03-17.

## parseSoulMdV2 Metadata Enrichment {#soul-md-v2}

**Severity**: 🟡 MEDIUM — Card quality gap
**Target**: v3.2

**Problem**: `agentbnb openclaw sync` generates cards from SOUL.md but the output lacks `category`, `powered_by`, and precise `inputs`/`outputs`. Agent owners must manually edit card.json to add this metadata, defeating the zero-config promise.

**What's needed**: SOUL.md H2 sections should support YAML frontmatter or special markers to define rich metadata:

```markdown
## ElevenLabs TTS Pro
<!-- agentbnb:
  category: tts
  powered_by: [{ provider: elevenlabs, model: multilingual-v2 }]
  inputs: [{ name: text, type: text, required: true }]
  outputs: [{ name: audio, type: audio }]
  pricing: { credits_per_call: 5 }
-->
```

`parseSoulMdV2()` would extract these blocks and merge them into the generated CapabilityCard, producing publication-ready cards without manual JSON editing.

**Status**: Not started. Planned for v3.2.

## WebSocket Relay Long-Task Support {#relay-long-tasks}

**Severity**: 🟡 MEDIUM — Blocks long-running skills via relay
**Target**: v3.2

**Problem**: The WebSocket relay in `src/relay/websocket-relay.ts` has a 30-second timeout per `relay_request`. Skills like `stock-analyst` (full deep analysis mode) need 5+ minutes to execute. These requests timeout and fail through the relay path. This also makes Conductor relay mode unusable for multi-agent pipelines (commonly 60-120s).

**Decision**: C+B Hybrid approach (see [[decisions.md#ADR-020]])

**Phase 1** (minimal change):
- Increase `RELAY_TIMEOUT_MS` from 30s to 300s (5 minutes)
- Skill developers need zero changes
- Provider WebSocket disconnect → all pending requests immediately fail (already implemented)

**Phase 2** (progressive enhancement):
- Add `relay_progress` message type to relay protocol
- Provider can optionally send progress updates that reset the timeout timer
- PipelineExecutor and ConductorMode auto-send progress between steps
- ApiExecutor (single slow API call) — doesn't send progress, relies on 5min timeout

**Files to modify**:
- `src/relay/websocket-relay.ts` — `RELAY_TIMEOUT_MS` constant, add progress handler
- `src/relay/websocket-client.ts` — default timeout, add progress sending
- `src/relay/types.ts` — add `relay_progress` message type
- `src/gateway/execute.ts` — default timeout
- `src/gateway/client.ts` — default timeout

**Status**: Not started. Planned for v3.2.

## Credit System → Registry Migration {#credit-registry-migration}

**Severity**: 🔴 CRITICAL — Blocks trustworthy multi-agent credit exchanges
**Target**: v3.2

**Problem**: Each agent stores credits in local SQLite (`~/.agentbnb/credit.db`). This worked for 2-person E2E testing but fails at scale:
- Agent can modify local credit.db → fake balance → free-ride
- Network disconnect during settle → two agents' ledgers permanently out of sync
- Agent runs two instances → double-spends the same credits
- Hub cannot show real credit balances (each agent's balance is local-only)

**Decision**: Registry Centralized Ledger (see [[decisions.md#ADR-021]])

All credit operations move to the Registry server (hub.agentbnb.dev). Agents have no local write access to credits. Registry is the single source of truth.

**Implementation priority**:
1. `CreditLedger` interface + `RegistryCreditLedger` class
2. Registry `/api/credits/*` endpoints (hold, settle, release, grant, balance, history)
3. Integrate into WebSocket relay flow (hold before relay, settle after)
4. CLI changes (`init` grants via Registry, `status` queries Registry)
5. Hub shows real credit balances from Registry
6. Keep local-only mode backward compatible (offline/LAN)

**Pricing rules** (see [[credit-pricing.md]]):
- Provider free pricing (no fixed exchange rate)
- Minimum 1 cr per call
- Initial grant: 50 cr per identity (Ed25519 key dedup)
- Conductor fee: 10% (min 1 cr, max 20 cr)

**Hub impact**: Frontend hooks unchanged (same API shape). Backend switches from local SQLite to CreditLedger interface.

**Status**: Not started. Planned for v3.2.
