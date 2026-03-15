# Feature Research

**Domain:** Agent autonomy — P2P capability sharing protocol (AgentBnB v2.0)
**Researched:** 2026-03-15
**Confidence:** MEDIUM-HIGH (architecture well-established from AGENT-NATIVE-PROTOCOL.md; ecosystem patterns verified via WebSearch + Microsoft Agent Framework docs; OpenClaw-specific internals from official docs)

---

## Context: What Already Exists (v1.1)

Do not rebuild. These are v1.1 features the v2.0 milestone depends on:

- Capability Card schema (Zod, 3 levels) with `_internal`, `free_tier`, `powered_by`, `metadata.success_rate`, `metadata.avg_latency_ms`
- SQLite registry with FTS5 search, owner isolation
- Credit ledger: double-entry bookkeeping, escrow hold/settle/release
- Fastify JSON-RPC gateway with auth, per-request reputation instrumentation (EWA)
- CLI: init, publish, discover, request, status, serve
- Smart onboarding: auto-detect 10 API providers, draft card generation, `--yes` flag
- Public registry server with marketplace API
- mDNS peer discovery + peer management
- Agent Hub: React SPA with card grid, search/filter, owner dashboard, request history
- SOUL.md parser: `parseSoulMd()` + `publishFromSoul()`
- OpenClaw skill scaffolding: `src/skills/publish-capability.ts`, `src/skills/handle-request.ts`

---

## Feature Landscape

### Table Stakes (Agents and Owners Expect These)

Features that v2.0 is meaningless without. Missing any = the "agent handles everything" promise is broken.

| Feature | Why Expected | Complexity | Depends On (v1.1) | Notes |
|---------|--------------|------------|-------------------|-------|
| **Idle rate detection** — per-card utilization tracking (calls/time window vs capacity) | The agent cannot decide what to share without knowing what is idle. Without this, "auto-share" is just always-share, which breaks the economic model. | MEDIUM | `metadata.avg_latency_ms`, `_internal` field for per-card private state | Use sliding window counter (last 60 min). `idle_rate = 1 - (actual_calls / capacity_limit)`. Store in `_internal` so it never leaks to the network. |
| **Auto-share trigger** — when idle_rate > threshold, auto-publish card as online; when below threshold, take offline | Core to the agent-native loop. Agents share idle capacity, not everything all the time. | LOW | `availability.online` toggle, PATCH card endpoint (v1.1 UX layer), idle rate detection | Threshold configurable per-agent (default 70%). Runs in background during `agentbnb serve`. |
| **Autonomy tier configuration** — owner sets Tier 1/2/3 credit thresholds once, agent respects them forever | Without configurable tiers, every autonomous action requires human approval, defeating the purpose. | LOW | Credit ledger (v1.1), config storage (`agentbnb.config.json`) | Tier 1: auto-execute < 10cr. Tier 2: execute + notify-after, 10-50cr. Tier 3: ask-before > 50cr. Stored in local config. |
| **Auto-request** — agent detects capability gap, queries network, selects best peer, executes via escrow | This is the "spending" half of the economic loop. Without it, credits earned from sharing cannot be used. | HIGH | Escrow (v1.1), peer discovery (v1.1), discover CLI (v1.1), autonomy tiers | Peer selection algorithm: reputation x price efficiency x idle_rate. Cap at autonomy tier limit before executing. |
| **Credit reserve enforcement** — agent refuses to spend below configured reserve balance | Agents with 0 credits become isolated (cannot request). Reserve prevents this. | LOW | Credit ledger, balance query (v1.1) | Default reserve = 20cr. Configurable. When balance <= reserve, auto-request is blocked, sharing priority increases. |
| **Multi-skill Capability Card** — one card per agent with an array of `skills[]`, each skill independently shareable | Current schema has one card = one capability. An agent with TTS + video gen + code review needs ONE identity on the network, not three cards. | MEDIUM | `CapabilityCardSchema` (needs `skills[]` field), registry store, FTS5 search index | Schema v2.0 breaking change. The agent's card IS its identity. Skills are independently priced, individually togglable. |
| **OpenClaw SKILL.md installable package** — `openclaw install agentbnb` or copy `skills/agentbnb/` to workspace | Target users are OpenClaw agents. If AgentBnB is not installable as a skill, adoption path is manual and broken. | MEDIUM | `src/skills/` existing scaffolding, gateway.ts, auto-share.ts, auto-request.ts | Follows OpenClaw skill spec: directory + `SKILL.md` with YAML frontmatter + instructions. Name: `agentbnb`. |
| **HEARTBEAT.md rule injection** — AgentBnB autonomy rules are insertable into any OpenClaw agent's HEARTBEAT.md | HEARTBEAT.md is where OpenClaw agents get their behavioral rules. Without this, the agent won't know to share/request autonomously during its 30-min heartbeat cycles. | LOW | SOUL.md parser (v1.1) | Emit a ready-to-paste HEARTBEAT.md block. Ideally auto-patch on `openclaw install agentbnb`. Rules: share when idle_rate > 70%, request when gap detected and credits sufficient, maintain reserve. |

### Differentiators (Competitive Advantage)

Features that make AgentBnB meaningfully different from Google A2A and enterprise agent marketplaces. Not required for launch, but valuable for positioning.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| **Credit surplus alert** — notify owner when balance exceeds configured surplus threshold | Agents earning too many credits means they are over-sharing. Notify lets owners adjust pricing upward or reduce sharing. Also demonstrates the economic model is working. | LOW | Credit ledger, notification channel (CLI/webhook) | Default surplus = 500cr. MEDIUM confidence: the exact threshold and notification delivery method need design (webhook vs CLI output vs HEARTBEAT.md check). |
| **Per-skill idle rate** — each skill on a multi-skill card has its own idle rate, shareable flag auto-set independently | One agent's TTS might be 95% idle while its video gen is 60% utilized. Sharing both at the same rate wastes neither capacity nor competitive advantage. | MEDIUM | Multi-skill cards (v2.0), sliding window counter per skill | Requires multi-skill cards first. Each skill gets its own `_internal.idle_rate` and `_internal.last_window_calls`. |
| **Partial pipeline sharing** — on Level 2 cards, mark specific pipeline steps as shareable and others as moat | Agents can share sub-steps without revealing their competitive advantage step (e.g., share TTS + script but not the composite editor). Enables fine-grained capability packaging. | HIGH | Multi-skill cards, pipeline step schema (needs design) | Explicitly modeled in AGENT-NATIVE-PROTOCOL.md: `shareable_steps: [script, video-gen, tts]`. Complex schema extension. Defer to v2.1 unless core use case demands it. |
| **Reputation-weighted peer selection** — auto-request picks best peer using `reputation x price_efficiency x idle_rate` score | Deterministic peer selection creates predictable outcomes. Reputation (EWA success_rate) already tracked in v1.1. Combining it with price and availability creates smarter routing. | MEDIUM | Reputation system (v1.1), idle rate (v2.0), discover endpoint (v1.1) | Score = `success_rate * (1 / credits_per_call) * idle_rate`. Ties broken by avg_latency_ms (lower is better). |
| **SOUL.md v2 sync** — skills[] array in multi-skill card auto-generated from SOUL.md H2 sections | Existing `parseSoulMd()` already maps H2 sections to capabilities. Extending it to emit skills[] for the new schema closes the loop between agent identity and network identity. | LOW | `parseSoulMd()` (v1.1), multi-skill card schema (v2.0) | Backward compatible extension. Each H2 section = one skill entry. |
| **Agent message bus transport** — use OpenClaw message bus as alternative to HTTP for gateway transport | OpenClaw agents already have a message bus. Supporting it as a transport option makes AgentBnB feel native to OpenClaw rather than bolted on. | HIGH | Gateway (v1.1), OpenClaw message bus API (external dependency) | LOW confidence: OpenClaw message bus API details need verification before committing to this. Mark as research flag in roadmap. |
| **Autonomy audit log** — every autonomous action (auto-share, auto-request, escrow, settle) written to append-only local log | Owners need to trust the agent. An audit trail lets them review all autonomous decisions after the fact. Also required for Tier 2 "notify after" behavior. | LOW | Credit ledger (v1.1), escrow (v1.1), request_log (v1.1 UX layer) | Extend existing request_log table. Add `action_type` (auto-share / auto-request / settle / release) and `tier_invoked` columns. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Real-time idle rate dashboard polling** (sub-second updates) | Owners want to see utilization live | Polling creates load that itself inflates the "utilization" metric being measured. A sliding window updated every 60s is sufficient and doesn't distort the signal. | 60-second refresh in Hub dashboard. Display window: last-hour rolling average. |
| **Global auto-request for any capability gap** (no limit) | Agents should fill every gap automatically | Without tier limits, a recursive loop (agent A requests agent B, which requests agent A) produces unbounded credit spend. The $47,000 API bill incident shows this is a real failure mode. | Enforce tier credit thresholds before every auto-request. Require explicit capability gap definition in HEARTBEAT.md rules. |
| **Multi-agent card ownership** (one card, many owners) | Teams want to share a card | Splits accountability. When a request fails, who owns the reputation hit? Owner isolation (current model) creates clear accountability. | Each team member runs their own card. Use OpenClaw agent teams for coordination. |
| **Automatic pricing adjustment** (dynamic price based on demand) | Agents should earn more when demand is high | Dynamic pricing creates instability for requesting agents who budget in advance. Ruins the credit reserve model (agent budgets for X credits/call, but actual cost varies). | Allow owners to manually adjust price via dashboard. Emit surplus alert when demand is consistently high as a signal to increase price. |
| **Cloud relay for gateway transport** (hosted intermediary) | Users don't want to expose ports | Introduces centralization and creates an infrastructure cost/dependency. Against the local-first design principle. | Document port-forwarding options. Support mDNS for LAN. For remote, document ngrok/cloudflare tunnel as user-managed option. |
| **Cross-agent credit transfers** (send credits to another agent directly) | Users want to gift or pay agents outside transactions | Credits without backing capability exchange = gift economy, not economic incentive system. Undermines the share-to-earn loop. | Credits only move via escrow (request → settle). No direct transfer. |

---

## Feature Dependencies

```
[Idle Rate Detection]
    └──requires──> [_internal field in CapabilityCard] (v1.1 done)
    └──enables──>  [Auto-Share Trigger]
                       └──requires──> [availability.online toggle + PATCH endpoint] (v1.1 done)
                       └──enables──>  [Per-Skill Idle Rate] (if multi-skill cards exist)

[Multi-Skill Capability Card]
    └──requires──> [CapabilityCardSchema v2.0 extension]
    └──requires──> [Registry store migration] (skills[] indexed for FTS5)
    └──enables──>  [SOUL.md v2 sync]
    └──enables──>  [Per-Skill Idle Rate]
    └──enables──>  [Partial Pipeline Sharing] (future)

[Autonomy Tier Configuration]
    └──requires──> [Config storage] (agentbnb.config.json, v1.1 partial)
    └──enables──>  [Auto-Request]
    └──enables──>  [Credit Reserve Enforcement]

[Auto-Request]
    └──requires──> [Autonomy Tier Configuration]
    └──requires──> [Credit Reserve Enforcement]
    └──requires──> [Reputation-Weighted Peer Selection]
    └──requires──> [Escrow hold/settle] (v1.1 done)
    └──requires──> [Discover endpoint] (v1.1 done)

[Credit Reserve Enforcement]
    └──requires──> [Credit ledger balance query] (v1.1 done)
    └──requires──> [Autonomy Tier Configuration]

[OpenClaw SKILL.md Package]
    └──requires──> [auto-share.ts module]
    └──requires──> [auto-request.ts module]
    └──requires──> [credit-mgr.ts module]
    └──enhances──> [HEARTBEAT.md Rule Injection]

[Autonomy Audit Log]
    └──requires──> [request_log table] (v1.1 UX layer done)
    └──enhances──> [Autonomy Tier Configuration] (Tier 2 notify-after needs the log)

[Reputation-Weighted Peer Selection]
    └──requires──> [Idle Rate Detection] (for idle_rate in score)
    └──requires──> [Reputation system EWA] (v1.1 done)
    └──feeds──>    [Auto-Request] (provides the ranked peer list)
```

### Dependency Notes

- **Multi-skill cards must come before per-skill idle rate**: The schema and registry migration needed for multi-skill cards is a prerequisite. Building idle rate per-skill before the schema exists creates throwaway code.
- **Autonomy tiers must come before auto-request**: Auto-request without tier enforcement is dangerous (unbounded spend). Never ship auto-request without credit thresholds gating every execution.
- **Idle rate detection must come before auto-share**: Auto-share without a utilization signal defaults to "always share", which defeats the economic model.
- **Credit reserve enforcement conflicts with credit surplus alert**: They are inverses (floor vs ceiling). Implement reserve first (safety), surplus second (optimization signal).

---

## MVP Definition

### Launch With (v2.0 — "Agent Handles Everything")

The minimum set that delivers the core promise: the agent monitors itself, shares when idle, requests when stuck, and never violates the owner's configured limits.

- [ ] **Idle rate detection** — sliding window counter per card, stored in `_internal`, computed during `agentbnb serve` background loop
- [ ] **Auto-share trigger** — when idle_rate > configured threshold, flip `availability.online = true`; below threshold, flip false
- [ ] **Autonomy tier configuration** — store Tier 1/2/3 credit thresholds in config; enforce before every autonomous action
- [ ] **Credit reserve enforcement** — block auto-request when balance at or below reserve; increase share priority
- [ ] **Auto-request** — capability gap → discover → rank peers → escrow → execute → settle; respects tier thresholds
- [ ] **Multi-skill Capability Card** — schema v2.0 with `skills[]` array; registry migration; one card = agent identity
- [ ] **OpenClaw SKILL.md installable package** — `skills/agentbnb/SKILL.md` + `gateway.ts`, `auto-share.ts`, `auto-request.ts`, `credit-mgr.ts`
- [ ] **HEARTBEAT.md rule injection** — emit ready-to-paste autonomy rules block; auto-patch on install

### Add After Validation (v2.1)

Features to add once the core autonomy loop is working and validated with OpenClaw agents.

- [ ] **Credit surplus alert** — trigger: notify owner when balance exceeds surplus threshold; validates the earn-spend loop is profitable
- [ ] **Per-skill idle rate** — requires multi-skill cards stable first; adds fine-grained idle detection per skill
- [ ] **SOUL.md v2 sync** — extend `parseSoulMd()` to emit skills[] for new schema; closes identity loop
- [ ] **Reputation-weighted peer selection** — refine auto-request with scored peer ranking (reputation x price x idle_rate)
- [ ] **Autonomy audit log** — extend request_log with `action_type` and `tier_invoked`; required for Tier 2 "notify after"

### Future Consideration (v2.2+)

Features to defer until the autonomy loop is validated in production.

- [ ] **Partial pipeline sharing** — complex schema extension; needs real use case evidence before building
- [ ] **OpenClaw message bus transport** — requires OpenClaw message bus API research; LOW confidence on feasibility; flag for dedicated research phase
- [ ] **Dynamic pricing signals** — notification-only (not auto-adjust); useful only after network has enough agents to create real demand signals

---

## Feature Prioritization Matrix

| Feature | Agent Value | Implementation Cost | Priority |
|---------|-------------|---------------------|----------|
| Idle rate detection | HIGH | MEDIUM | P1 |
| Auto-share trigger | HIGH | LOW | P1 |
| Autonomy tier configuration | HIGH | LOW | P1 |
| Credit reserve enforcement | HIGH | LOW | P1 |
| Auto-request | HIGH | HIGH | P1 |
| Multi-skill Capability Card | HIGH | MEDIUM | P1 |
| OpenClaw SKILL.md package | HIGH | MEDIUM | P1 |
| HEARTBEAT.md rule injection | HIGH | LOW | P1 |
| Credit surplus alert | MEDIUM | LOW | P2 |
| Per-skill idle rate | MEDIUM | MEDIUM | P2 |
| SOUL.md v2 sync | MEDIUM | LOW | P2 |
| Reputation-weighted peer selection | MEDIUM | MEDIUM | P2 |
| Autonomy audit log | MEDIUM | LOW | P2 |
| Partial pipeline sharing | LOW | HIGH | P3 |
| OpenClaw message bus transport | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for v2.0 launch — the autonomy loop is broken without it
- P2: Add in v2.1 — improves reliability and visibility once core loop runs
- P3: Deferred — complex or needs evidence of demand

---

## Competitor Feature Analysis

| Feature | Google A2A | Salesforce AgentExchange | AgentBnB v2.0 |
|---------|------------|--------------------------|---------------|
| Who decides to share | Human IT admin configures | Human admin publishes | Agent auto-detects idle rate |
| Who decides to request | Human selects agent | Human configures flows | Agent detects gap, selects peer autonomously |
| Economic model | None (platform license) | None (license fee) | Credit-based: earn by sharing, spend by requesting |
| Autonomy controls | All-or-nothing delegation | Role-based access | Tiered thresholds (Tier 1/2/3) per credit amount |
| Identity model | Per-capability agent cards | Per-agent skills | One card = full agent identity with skills[] array |
| Protocol lock-in | Google Cloud | Salesforce platform | MIT open source, network effect lock-in only |
| Integration path | Enterprise API | Salesforce admin console | `openclaw install agentbnb` — one command |

---

## Implementation Notes by Feature Area

### Idle Rate Detection

**Mechanism:** Sliding window counter. Per-card (and later per-skill), track timestamps of the last N successful requests in a circular buffer. `idle_rate = 1 - (requests_in_last_60min / capacity_per_hour)`. `capacity_per_hour` is owner-configured (default: 60 calls/hour = 1/min). Store the window state in `_internal` — it is private and never transmitted. Update on every incoming request settle/release event.

**Confidence:** HIGH. Sliding window is the standard approach for API utilization tracking (verified via multiple rate-limiting implementation sources). The `_internal` field in CapabilityCardSchema is already built for exactly this use.

### Autonomy Tiers

**Mechanism:** Config-stored thresholds keyed to credit amounts. Before every autonomous action (auto-share, auto-request, escrow), check which tier applies. Tier 1 executes silently. Tier 2 executes then writes an audit event with `notify: true`. Tier 3 returns a `APPROVAL_REQUIRED` status and blocks until the owner responds (via CLI prompt or Hub notification).

**Confidence:** MEDIUM. The tier structure is well-defined in AGENT-NATIVE-PROTOCOL.md. The Tier 3 "ask before" human interaction mechanism needs design — specifically how the agent surfaces the ask (HEARTBEAT.md next cycle vs CLI prompt vs Hub push notification).

### Multi-Skill Capability Card

**Mechanism:** Schema v2.0 adds `skills: SkillEntry[]` to CapabilityCardSchema. Each `SkillEntry` has: `id`, `name`, `description`, `level` (1/2/3), `inputs`, `outputs`, `pricing`, `availability`, `shareable` (boolean), `idle_rate` (from `_internal`). The top-level card fields (`name`, `owner`, `description`) describe the agent identity. Individual skills are the tradeable units. Registry FTS5 indexes skill names/descriptions as well as card-level fields.

**Confidence:** MEDIUM. Schema extension is straightforward but the SQLite migration and FTS5 re-indexing need care. The 1:N agent-to-skills pattern is confirmed by Microsoft Agent Framework docs and the LOKA Protocol. Breaking schema change requires versioning strategy.

### Auto-Request

**Mechanism:** Agent detects capability gap (task type not in local skills[]), calls `discover` against public registry or known peers, ranks candidates by score = `success_rate * (1/credits_per_call) * idle_rate`, checks autonomy tier for the top candidate's price, checks credit reserve, initiates escrow hold, sends JSON-RPC request to peer gateway, receives result, settles escrow. Entire flow runs within the `agentbnb serve` background loop.

**Confidence:** MEDIUM. The individual components (discover, escrow, gateway client) are all v1.1. The orchestration layer (gap detection, peer ranking, autonomous execution) is net new. Gap detection specifically — how does the agent know it cannot do a task? — requires a defined capability gap signal (likely: agent hits an unknown tool call or unsupported media type, emits a structured event the auto-request handler subscribes to).

### OpenClaw SKILL.md Package

**Mechanism:** Directory at `skills/agentbnb/` with `SKILL.md` (frontmatter: `name: agentbnb`, `description: P2P capability sharing — earn credits by sharing idle APIs, spend credits to request capabilities from peers`). Sub-files: `gateway.ts` (starts Gateway as agent lifecycle hook), `auto-share.ts` (monitors idle_rate, publishes), `auto-request.ts` (gap detection, peer selection, escrow), `credit-mgr.ts` (reserve enforcement, surplus alert). Installed by copying directory to `<workspace>/skills/agentbnb/` or via `openclaw install agentbnb` if published to ClawHub (5,400+ skills registry as of 2026).

**Confidence:** HIGH. OpenClaw skill spec is verified from official docs. The SKILL.md format (YAML frontmatter + markdown instructions), loading precedence, and three-stage progressive disclosure pattern are confirmed. ClawHub is the distribution channel.

---

## Sources

- [AGENT-NATIVE-PROTOCOL.md](../AGENT-NATIVE-PROTOCOL.md) — Design bible defining autonomy tiers, idle rate logic, OpenClaw integration
- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills) — SKILL.md format, loading precedence, ClawHub distribution (HIGH confidence)
- [Microsoft Agent Framework — Agent Skills](https://learn.microsoft.com/en-us/agent-framework/agents/skills) — Progressive disclosure pattern, one agent : many skills architecture (HIGH confidence)
- [Levels of Autonomy for AI Agents — Knight Columbia / Arxiv](https://knightcolumbia.org/content/levels-of-autonomy-for-ai-agents-1) — Autonomy tier frameworks, configurable boundary design (MEDIUM confidence)
- [Anthropic — Measuring Agent Autonomy](https://www.anthropic.com/research/measuring-agent-autonomy) — Autonomy measurement methodology (MEDIUM confidence)
- [AI Agent Observability — OpenTelemetry](https://opentelemetry.io/blog/2025/ai-agent-observability/) — Standardized agent metrics, resource utilization monitoring patterns (MEDIUM confidence)
- [Agent Contracts: Resource-Bounded AI Systems — Arxiv](https://arxiv.org/html/2601.08815v1) — Credit/budget management for autonomous agents, stop conditions (HIGH confidence for the anti-pattern of missing limits)
- [Sliding Window Rate Limiting — API7.ai](https://api7.ai/blog/rate-limiting-guide-algorithms-best-practices) — Sliding window algorithm for utilization tracking (HIGH confidence)
- [AwesomeOpenClawSkills Registry](https://github.com/VoltAgent/awesome-openclaw-skills) — ClawHub skill count, community skill structure (MEDIUM confidence)
- [Microsoft Entra Agent Registry](https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/what-is-agent-registry) — 1:N agent identity to capabilities mapping (MEDIUM confidence)
- [Agent-to-Agent Protocol (A2A) — EmergentMind](https://www.emergentmind.com/topics/agent-to-agent-protocol-a2a) — Competitive positioning vs Google A2A (MEDIUM confidence)

---

*Feature research for: AgentBnB v2.0 Agent Autonomy milestone*
*Researched: 2026-03-15*
