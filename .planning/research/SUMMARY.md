# Project Research Summary

**Project:** AgentBnB v2.0 — Agent Autonomy Milestone
**Domain:** P2P agent capability sharing — autonomous sense/decide/act loop
**Researched:** 2026-03-15
**Confidence:** HIGH

## Executive Summary

AgentBnB v2.0 is a fundamental execution model shift, not a feature addition. The v1.1 system is a clean synchronous request-response server: it receives capability requests, executes them, and returns results. v2.0 requires the same process to simultaneously run background timers (idle monitoring, budget checks), initiate outbound requests autonomously (auto-request), and make economic decisions constrained by owner-configured tiers — all while continuing to serve inbound requests. Experts building autonomous agent systems address this by establishing a centralized runtime scaffold first, before any autonomous feature code is written. This is the single most important architectural decision for v2.0: the `AgentRuntime` class that owns all database handles, background loops, and shutdown coordination.

The recommended approach is a 5-phase build order derived from hard feature dependencies: (1) schema foundation — multi-skill CapabilityCard v2.0 with data migration; (2) autonomy core — tiers logic and credit budgeting modules; (3) idle monitoring and auto-share behavior; (4) auto-request with peer selection; (5) OpenClaw deep integration. The stack additions are minimal: `croner` for background scheduling and `typed-emitter` for type-safe event routing. Everything else is already in the existing stack. Resist any impulse to add job queue libraries, logging libraries, or ML scoring — the existing SQLite + Fastify + TypeScript stack handles all new requirements.

The key risks fall into three categories. First, data safety: the multi-skill card schema is a breaking change to the SQLite JSON blob format; every FTS5 trigger must be updated in the same migration as the schema change, or search silently returns nothing. Second, economic safety: auto-request without reserve enforcement creates a scenario where the agent drains its credits below a usable floor, isolating it from the network; the `BudgetManager` must wrap every escrow call, never allowing direct `holdEscrow` from auto-request code. Third, agency safety: the default autonomy tier must be Tier 3 (ask-before), not Tier 1; OWASP's 2026 Least-Agency principle is explicit that defaults must be maximally restrictive, with the owner expanding autonomy only through explicit configuration.

## Key Findings

### Recommended Stack

The existing stack (TypeScript strict, Node.js 20+, better-sqlite3, Fastify, Zod, Vitest, bonjour-service) covers all v2.0 requirements. Only two production dependencies are added: `croner ^10.0.1` for background task scheduling (ESM-native, TypeScript-first, supports pause/resume — needed for fine-grained polling intervals and graceful shutdown) and `typed-emitter ^2.1.0` for a type-safe event bus (zero runtime bytes — pure types layered over Node.js EventEmitter, needed because the autonomy system has 6+ event types where raw string-keyed emitters become error-prone). SQLite WAL mode (`db.pragma('journal_mode = WAL')`) must be activated at startup to prevent `SQLITE_BUSY` errors when background timers write concurrently with the gateway serving reads.

**Core technologies:**
- `croner ^10.0.1`: background scheduling — ESM-native, pause/resume for graceful shutdown, zero dependencies
- `typed-emitter ^2.1.0`: event bus types — zero runtime, strict typing for autonomy/credit event payloads
- `process.cpuUsage()` (built-in): idle signal supplementation — no external metrics library justified
- `better-sqlite3` WAL mode: concurrent read/write — call once at startup, required for background timers
- `db.pragma('busy_timeout = 5000')`: prevents `SQLITE_BUSY` under concurrent background writes

Do not add: BullMQ/Agenda/bee-queue (requires Redis — violates local-first constraint), winston/pino (Fastify's built-in logger is sufficient), rxjs (over-engineered for 6 event types), any LLM SDK (AgentBnB is a protocol, not an agent — intelligence is OpenClaw's job).

### Expected Features

The v2.0 milestone delivers the core promise: "the agent monitors itself, shares when idle, requests when stuck, and never violates the owner's configured limits." All 8 table-stakes features are required for this promise to hold; removing any one breaks the economic model.

**Must have (v2.0 table stakes):**
- Idle rate detection — sliding window counter per skill; without this, auto-share defaults to always-share, breaking the economic model
- Auto-share trigger — flip `availability.online` based on idle_rate vs threshold; the sharing half of the earn/spend loop
- Autonomy tier configuration — Tier 1/2/3 credit thresholds stored in config; enforced before every autonomous action
- Credit reserve enforcement — block auto-request when balance at or below reserve floor; prevents network isolation
- Auto-request — capability gap detection, peer selection, escrow-gated execution; the spending half of the earn/spend loop
- Multi-skill Capability Card — schema v2.0 with `skills[]` array; one card = one agent identity (not one card per skill)
- OpenClaw SKILL.md installable package — `skills/agentbnb/` directory with SKILL.md, gateway.ts, auto-share.ts, auto-request.ts, credit-mgr.ts
- HEARTBEAT.md rule injection — emit ready-to-paste autonomy rules; auto-patch on `openclaw install agentbnb`

**Should have (v2.1 differentiators):**
- Credit surplus alert — notify owner when balance exceeds configured threshold; signals the earn-spend loop is profitable
- Per-skill idle rate — independent idle tracking per skill on a multi-skill card; enables fine-grained sharing decisions
- SOUL.md v2 sync — extend `parseSoulMd()` to emit `skills[]` from H2 sections; closes the agent identity loop
- Reputation-weighted peer selection — refine auto-request with scored ranking: `success_rate * (1/credits_per_call) * idle_rate`
- Autonomy audit log — extend `request_log` with `action_type` and `tier_invoked`; required for Tier 2 "notify after"

**Defer (v2.2+):**
- Partial pipeline sharing — complex schema extension; needs real use case evidence
- OpenClaw message bus transport — LOW confidence on feasibility; needs dedicated research phase before committing
- Dynamic pricing signals — useful only after network has enough agents to produce real demand signals

**Anti-features to avoid building:**
- Real-time sub-second idle rate polling (distorts the metric being measured; 60s refresh is correct)
- Unlimited auto-request without tier enforcement (recursive loops produce unbounded credit spend — the $47K API bill failure mode)
- Multi-agent card ownership (splits reputation accountability; owner isolation is the correct model)
- Automatic dynamic pricing (creates instability for requesting agents who budget in advance)

### Architecture Approach

The v2.0 architecture adds a new `src/autonomy/` module directory containing three new modules (`tiers.ts`, `idle-monitor.ts`, `auto-request.ts`), a new `src/credit/budget.ts` module, and a new `src/openclaw/` directory. All existing modules are modified, not replaced: `src/types/index.ts` gains the multi-skill schema, `src/registry/store.ts` gains per-skill idle rate and shareable flag functions, FTS5 triggers are updated to index nested `skills[]` content, and `src/cli/index.ts` starts the `IdleMonitor` and `BudgetManager` on `agentbnb serve`. The gateway routing changes from `{ card_id }` to `{ card_id, skill_id }` to support per-skill execution. The `AgentRuntime` (the centralized process model) is the architectural prerequisite for all other new modules.

**Major components:**
1. `AgentRuntime` (new) — owns all DB handles, starts/stops all background loops, handles SIGTERM gracefully
2. `src/autonomy/tiers.ts` (new) — single `getAutonomyTier()` function + `AutonomyEvent` types; all autonomy decisions route through here
3. `src/autonomy/idle-monitor.ts` (new) — croner-scheduled polling; reads `request_log`, computes idle_rate, triggers auto-share via tiers
4. `src/autonomy/auto-request.ts` (new) — FTS peer search, scoring (reputation × 1/latency × 1/cost), budget-gated escrow + execute
5. `src/credit/budget.ts` (new) — `BudgetManager` with reserve floor, daily spend limit, surplus alerting with cooldown
6. `src/openclaw/` (new) — SOUL.md sync, HEARTBEAT.md writer, skill lifecycle adapter

### Critical Pitfalls

1. **No `AgentRuntime` scaffold** — Background timers started ad hoc (outside a centralized runtime) cannot be cleanly shut down, produce `SQLITE_BUSY` errors when each module opens its own DB connection, and leave orphaned escrows on crash. Prevention: build `AgentRuntime` as the first deliverable of Phase 1, before any autonomous feature code.

2. **Multi-skill schema migration without FTS trigger update** — The SQLite FTS5 trigger uses `json_extract(new.data, '$.name')`. When skills move into a `skills[]` array, this path returns `NULL` and search silently returns nothing. Prevention: update all three FTS5 triggers (`cards_ai`, `cards_au`, `cards_ad`) in the same migration as the schema change; test by searching for a skill name nested in the array.

3. **Autonomy tier defaults to Tier 1** — If `~/.agentbnb/config.json` is missing and the default is Tier 1 (full autonomy), the agent immediately shares capabilities and spends credits without any owner awareness. Prevention: default is Tier 3; `agentbnb init --yes` must NOT skip tier selection; all autonomous operations are disabled until explicit tier is configured.

4. **Auto-request without reserve enforcement** — `holdEscrow` deducts from balance atomically, but has no concept of a reserve floor. Auto-request calling `holdEscrow` directly can drain the agent below 20 credits (the reserve), making subsequent auto-requests impossible and isolating the agent from the network. Prevention: `AutoRequestor` always calls `BudgetManager.canSpend()` before `holdEscrow`; never bypass BudgetManager.

5. **Auto-request self-selection deadlock** — The peer-scoring algorithm ranks by reputation × idle_rate / cost. The local agent's own card will score well for its own skills. If selected, the agent initiates an escrow hold against itself and sends an HTTP request to its own gateway — producing a SQLite deadlock or double-charge. Prevention: peer-selection always filters `candidate.owner !== self.owner` before ranking; local skills execute without escrow.

6. **OpenClaw heartbeat + Node.js timer conflict** — Running both AgentBnB's `setInterval` and OpenClaw's heartbeat scheduler to trigger auto-share produces duplicate card publishes and conflicting `availability.online` states. Prevention: choose one authoritative scheduler (standalone process with own timers OR OpenClaw skill with heartbeat-driven triggers), never both.

## Implications for Roadmap

Based on research, the dependency graph dictates a 5-phase structure. Multi-skill cards must come first because the new schema is what every other module builds on. Autonomy tiers and budget modules come second because they are pure logic with no downstream dependencies — fast to build and test. Idle monitoring comes third because it is the first active behavior and validates the tiers + budget integration. Auto-request comes fourth as the second active behavior, completing the earn/spend loop. OpenClaw integration comes last because it requires a stable schema and stable autonomy behaviors to generate meaningful output.

### Phase 1: Agent Runtime + Multi-Skill Card Foundation
**Rationale:** Everything depends on this. The `AgentRuntime` scaffold must exist before any background loop is written (Pitfall 1). The multi-skill card schema must be finalized before the registry, matcher, gateway routing, or Hub rendering changes are safe to build (Architecture research: "Build FIRST. Everything else depends on the new schema shape.").
**Delivers:** `AgentRuntime` class with SIGTERM handling + orphaned escrow recovery; `CapabilityCard` v2.0 schema with `skills[]`; SQLite migration for v1.x cards; FTS5 trigger update to index nested skill names/descriptions; `spec_version: '2.0'` gateway routing for `skill_id`
**Addresses:** Multi-skill Capability Card (table stakes)
**Avoids:** Pitfall 1 (no runtime scaffold), Pitfall 3 (schema migration without FTS update), Pitfall 7 (orphaned escrows at shutdown)

### Phase 2: Autonomy Tiers + Credit Budgeting
**Rationale:** These are pure logic modules with no UI and no background behavior. They can be built and tested in isolation before any active autonomous behavior is wired up. Autonomy tiers must exist before idle monitoring (which calls `getAutonomyTier` before acting). Budget must exist before auto-request (which must call `canSpend` before every escrow). The safe-default requirement (Tier 3 default) must be enforced here before any autonomous code touches it.
**Delivers:** `src/autonomy/tiers.ts` with `getAutonomyTier()`, `AutonomyEvent` types, Tier 3 as default; `src/credit/budget.ts` with `BudgetManager` (reserve floor, daily spend limit, surplus alert with cooldown); `AgentBnBConfig` extended with `autonomy: AutonomyConfig` and `budget: BudgetConfig`
**Addresses:** Autonomy tier configuration (table stakes), Credit reserve enforcement (table stakes)
**Avoids:** Pitfall 5 (Tier 1 default), Pitfall 6 (reserve not enforced), Pitfall 10 (surplus alert spam without cooldown)

### Phase 3: Idle Rate Monitoring + Auto-Share
**Rationale:** First active autonomous behavior. Depends on Phase 1 (skill schema needed to query per-skill request counts) and Phase 2 (tiers needed to decide what to do when idle_rate crosses threshold). This phase validates the full idle → share decision loop before adding the more complex auto-request flow. The idle metric must be grounded in real `request_log` data — hardcoding idle_rate is explicitly an unacceptable shortcut.
**Delivers:** `src/autonomy/idle-monitor.ts` with croner-based polling; `getSkillRequestCount()` added to `src/registry/request-log.ts`; `capacity.calls_per_hour` added to skill schema; `updateSkillIdleRate()` and `setSkillShareable()` in `src/registry/store.ts`; `agentbnb serve` starts IdleMonitor via AgentRuntime
**Addresses:** Idle rate detection (table stakes), Auto-share trigger (table stakes)
**Avoids:** Pitfall 2 (idle_rate computed from no real data), Pitfall 4 (auto-share without metric activates immediately on start)

### Phase 4: Auto-Request
**Rationale:** The spending half of the earn/spend loop. Depends on Phase 1 (skill-level FTS search), Phase 2 (tiers gate every spend decision, budget wraps every escrow hold), and Phase 3 (idle_rate is part of the peer scoring formula). This is the most complex phase — peer selection, gap detection, self-exclusion, and Tier 3 approval queue all introduce new failure modes that must be built in carefully.
**Delivers:** `src/autonomy/auto-request.ts` with `AutoRequestor` class; peer scoring (`success_rate * (1/credits_per_call) * idle_rate`); self-exclusion (`candidate.owner !== self.owner`); `getPeerGatewayUrl()` in `src/cli/peers.ts`; `GET /me/pending-requests` endpoint for Tier 3 approval queue; auto-request failure events written to `request_log` even when no escrow is initiated
**Addresses:** Auto-request (table stakes)
**Avoids:** Pitfall 4 (auto-request self-selection deadlock), Pitfall 6 (reserve floor enforcement via BudgetManager)

### Phase 5: OpenClaw Deep Integration
**Rationale:** Depends on all prior phases. SOUL.md sync emits `skills[]` (requires Phase 1 schema). HEARTBEAT.md rules reference autonomy tier thresholds (requires Phase 2 config). The skill lifecycle hooks call `IdleMonitor.start()` and `AutoRequestor` (requires Phases 3 and 4). This is also where the authoritative scheduler decision (standalone vs skill) must be locked in to avoid the heartbeat/timer conflict.
**Delivers:** `src/openclaw/soul-sync.ts`, `src/openclaw/heartbeat-writer.ts`, `src/openclaw/skill.ts`; `SKILL.md` + skill directory for `openclaw install agentbnb`; `agentbnb openclaw [sync|status|rules]` CLI commands; decision: standalone process mode (AgentRuntime owns timers) with OpenClaw webhook notification
**Addresses:** OpenClaw SKILL.md installable package (table stakes), HEARTBEAT.md rule injection (table stakes)
**Avoids:** Pitfall 8 (timer/heartbeat conflict — standalone mode chosen, no competing schedulers)

### Phase Ordering Rationale

- Schema first because it propagates to all modules (registry, matcher, gateway routing, Hub rendering) — changing it after other modules are built creates rework cascades
- Pure logic modules (tiers, budget) before active behaviors (idle monitor, auto-request) because they can be fully tested in isolation before any timer fires
- Idle monitoring before auto-request because auto-request's peer scoring depends on `idle_rate` being a real metric from Phase 3
- OpenClaw integration last because it requires all prior phases to be stable to generate correct SOUL.md mappings and HEARTBEAT.md rules
- This order also allows human-review checkpoints between phases: schema is reviewable before any behavior runs; tiers/budget are reviewable before autonomous actions start; idle monitoring validates the economic loop before the riskier auto-request phase begins

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Schema migration):** The v1.x → v2.0 card migration must handle real SQLite rows in the wild; need to verify exact FTS5 trigger syntax for `json_each` aggregation over `skills[]` arrays before implementation
- **Phase 4 (Peer scoring calibration):** The `reputation × (1/latency) × (1/cost)` formula uses three variables that need normalization; weights are currently arbitrary and need tuning with real OpenClaw agent data
- **Phase 5 (OpenClaw message bus transport):** LOW confidence on feasibility from FEATURES.md research; the message bus API details need verification before committing; flag this sub-feature for a dedicated research phase if pursued

Phases with standard patterns (skip research-phase):
- **Phase 2 (Autonomy tiers + budget):** Pure TypeScript logic with well-defined interfaces; the tier thresholds, event types, and BudgetManager interface are fully specified in the architecture research
- **Phase 3 (Idle monitoring):** Sliding window rate calculation is a well-documented pattern; the implementation path is unambiguous (croner poll → `request_log` query → compare vs capacity config)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | npm registry versions verified; OpenClaw skill format verified via official docs; WAL mode confirmed via better-sqlite3 performance docs |
| Features | MEDIUM-HIGH | Table-stakes features derived from AGENT-NATIVE-PROTOCOL.md (HIGH confidence design doc); OpenClaw ecosystem claims MEDIUM (community data) |
| Architecture | HIGH | Derived from actual source code analysis of all 11 existing modules; no speculation — integration points verified against real implementations |
| Pitfalls | HIGH | Grounded in codebase analysis + OWASP 2026 agentic security framework + SQLite concurrency docs; 10 pitfalls with specific code-level prevention strategies |

**Overall confidence:** HIGH

### Gaps to Address

- **`capacity.calls_per_hour` schema field:** Idle rate formula requires `1 - (observed/capacity)` but `capacity` is not yet defined in the card schema. Must decide: owner-declared fixed value, or dynamically inferred from max observed throughput? Recommend owner-declared with a sensible default (60 calls/hour) — validate this default with OpenClaw agent owners during Phase 3.
- **Tier 3 "ask before" UX mechanism:** How does the agent surface a pending approval to the human owner? Options are: CLI prompt (blocks the process), Hub dashboard notification (requires Hub to be open), HEARTBEAT.md check on next OpenClaw cycle (30-minute delay). FEATURES.md rates this MEDIUM confidence. Recommend: write to a `pending_requests` table + `GET /me/pending-requests` endpoint (Phase 4) + Hub notification panel; decide on CLI prompt vs Hub at Phase 4 implementation.
- **OpenClaw message bus API:** FEATURES.md explicitly flags this as LOW confidence. Do not commit to Phase 5 implementation of message bus transport without a dedicated research phase. The standalone HTTP gateway is the safe fallback.
- **Peer scoring normalization:** The formula `success_rate * (1/credits_per_call) * idle_rate` has unbounded range for `1/credits_per_call` when cost approaches zero (free-tier cards). Min-max normalization per search result set is needed. Address this during Phase 4 implementation.

## Sources

### Primary (HIGH confidence)
- `src/types/index.ts`, `src/registry/store.ts`, `src/gateway/server.ts`, `src/credit/escrow.ts` — current architecture baseline (direct code analysis)
- `AGENT-NATIVE-PROTOCOL.md` (project root) — autonomy tier design, idle rate protocol, OpenClaw integration intent
- OpenClaw Skills Documentation (https://docs.openclaw.ai/tools/skills) — SKILL.md format, ClawHub distribution, heartbeat spec
- croner GitHub (https://github.com/Hexagon/croner) — ESM-native, pause/resume, zero dependencies
- better-sqlite3 WAL docs — concurrent read/write behavior
- OWASP Top 10 for Agentic Applications 2026 (https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — Least-Agency principle, default autonomy tier guidance

### Secondary (MEDIUM confidence)
- Microsoft Agent Framework docs — 1:N agent-to-skills architecture pattern, progressive disclosure
- Sliding Window Rate Limiting (API7.ai) — idle rate computation algorithm
- Agent Contracts: Resource-Bounded AI Systems (Arxiv 2601.08815) — credit/budget management, stop conditions
- AwesomeOpenClawSkills Registry — ClawHub skill count, community structure
- OpenClaw npm release notes — current version 2026.3.2

### Tertiary (LOW confidence)
- OpenClaw message bus API details — not fully documented; needs validation before Phase 5 message bus transport feature
- Peer scoring weight calibration — formula is theoretically sound but weights need empirical tuning with real agent data

---
*Research completed: 2026-03-15*
*Ready for roadmap: yes*
