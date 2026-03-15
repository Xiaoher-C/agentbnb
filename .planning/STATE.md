---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Agent Autonomy
status: planning
stopped_at: Completed 08-01-PLAN.md — openclaw core modules, 29/29 tests passing
last_updated: "2026-03-15T15:50:00.742Z"
last_activity: 2026-03-15 — v2.0 Agent Autonomy roadmap created (Phases 4-8)
progress:
  total_phases: 13
  completed_phases: 12
  total_plans: 36
  completed_plans: 35
  percent: 38
---

# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-15)

**Core value:** Fill the market gap for agent-to-agent capability exchange — the agent handles everything, the human says Yes once.
**Current focus:** Phase 4 — Agent Runtime + Multi-Skill Foundation

## Current Position

Phase: 4 of 8 (Agent Runtime + Multi-Skill Foundation)
Plan: 0 of 3 in current phase
Status: Ready to plan
Last activity: 2026-03-15 — v2.0 Agent Autonomy roadmap created (Phases 4-8)

Progress: [████████░░░░░░░░░░░░] 38% (v1.1 complete, v2.0 starting)

## Performance Metrics

**Velocity:**
- Total plans completed: 24 (v1.1 milestone)
- Average duration: unknown
- Total execution time: unknown

**By Phase:**

| Phase | Plans | Avg/Plan |
|-------|-------|----------|
| v1.1 (Phases 0-3) | 24/24 | - |

*Updated after each plan completion*
| Phase 04-agent-runtime-multi-skill-foundation P01 | 4 | 2 tasks | 4 files |
| Phase 04-agent-runtime-multi-skill-foundation P02 | 11 | 2 tasks | 4 files |
| Phase 04-agent-runtime-multi-skill-foundation P03 | 25 | 1 tasks | 4 files |
| Phase 04-agent-runtime-multi-skill-foundation P03 | 25 | 2 tasks | 4 files |
| Phase 05-autonomy-tiers-credit-budgeting P01 | 4 | 2 tasks | 5 files |
| Phase 05-autonomy-tiers-credit-budgeting P02 | 2 | 1 tasks | 4 files |
| Phase 05-autonomy-tiers-credit-budgeting P02 | 30 | 2 tasks | 4 files |
| Phase 06-idle-rate-monitoring-auto-share P01 | 9 | 2 tasks | 4 files |
| Phase 06-idle-rate-monitoring-auto-share P02 | 12 | 2 tasks | 3 files |
| Phase 07-auto-request P01 | 12 | 2 tasks | 6 files |
| Phase 07-auto-request P02 | 6 | 2 tasks | 3 files |
| Phase 07-auto-request P02 | 6 | 3 tasks | 3 files |
| Phase 08-openclaw-deep-integration P02 | 2 | 2 tasks | 5 files |
| Phase 08-openclaw-deep-integration P01 | 261 | 2 tasks | 7 files |

## Accumulated Context

### Decisions

Recent decisions affecting current work:

- [v2.0 init]: AgentRuntime must be built first — all background loops depend on centralized DB handle ownership
- [v2.0 init]: Default autonomy tier is Tier 3 (ask-before) — OWASP Least-Agency; owner must explicitly expand
- [v2.0 init]: BudgetManager.canSpend() wraps every escrow hold from auto-request — never bypass
- [v2.0 init]: croner ^10.0.1 + typed-emitter ^2.1.0 are the only new production dependencies
- [v2.0 init]: SQLite WAL mode + busy_timeout activated at AgentRuntime startup
- [v2.0 init]: Standalone process mode (AgentRuntime owns timers), not OpenClaw heartbeat-driven
- [Phase 04-01]: AgentRuntime uses openDatabase/openCreditDb internally so schema migrations always run on DB open
- [Phase 04-01]: busy_timeout=5000 added after openDatabase/openCreditDb calls (those functions don't set it)
- [Phase 04-01]: shutdown() is idempotent via draining guard to handle double-SIGINT safely
- [Phase 04-02]: FTS5 uses content="" (contentless) — content=capability_cards fails rebuild because FTS columns are not physical columns in base table
- [Phase 04-02]: Migration is a single db.transaction(): card update + trigger DROP/recreate + FTS delete-all + repopulate + user_version = 2
- [Phase 04-02]: skill_id for migrated v1.0 cards = skill-{card.id} — stable, readable, avoids breaking cached references
- [Phase 04-03]: Cast getCard() result via unknown narrowing to check for skills[] property instead of changing store.ts return type
- [Phase 04-03]: Handler dispatch: handlers[skill_id] ?? handlers[card_id] — skill key first, card key as fallback, no registry lookup needed
- [Phase 04-03]: resolvedSkillId set to skill.id for v2.0 cards, undefined for v1.0 — ensures consistent null coalesce in all insertRequestLog calls
- [Phase Phase 04-03]: Cast getCard() result via unknown narrowing to check for skills[] property instead of changing store.ts return type
- [Phase Phase 04-03]: Handler dispatch: handlers[skill_id] ?? handlers[card_id] — skill key first, card key as fallback, no registry lookup needed
- [Phase Phase 04-03]: resolvedSkillId set to skill.id for v2.0 cards, undefined for v1.0 — ensures consistent null coalesce in all insertRequestLog calls
- [Phase 05-01]: DEFAULT_AUTONOMY_CONFIG = {0,0} enforces Tier 3 for all amounts until owner configures thresholds via agentbnb config set tier1/tier2
- [Phase 05-01]: insertAuditEvent writes to request_log with action_type + tier_invoked — audit history co-located with normal request history
- [Phase 05-01]: Share events use card_id='system'; getAutonomyTier boundary is strict less-than (amount < threshold) for both tiers
- [Phase Phase 05-02]: BudgetManager.canSpend(amount <= 0) always returns true — zero-cost calls bypass reserve check for free-tier cards
- [Phase Phase 05-02]: availableCredits() floors at 0 via Math.max(0, balance - reserve) — prevents negative available credits
- [Phase Phase 05-02]: DEFAULT_BUDGET_CONFIG.reserve_credits = 20 — Phase 7 auto-request must call canSpend() before every escrow hold
- [Phase 05-02]: BudgetManager.canSpend(amount <= 0) always returns true — zero-cost calls bypass the reserve check (designed for free-tier cards)
- [Phase 05-02]: availableCredits() is floored at 0 — never returns negative, preventing misleading UI states when balance < reserve
- [Phase 05-02]: DEFAULT_BUDGET_CONFIG.reserve_credits = 20 — matches v2.0 init decision; owner must explicitly set lower floor
- [Phase Phase 06-01]: getSkillRequestCount SQL uses AND action_type IS NULL to exclude autonomy audit events — prevents auto_share events from artificially deflating idle rate
- [Phase Phase 06-01]: updateSkillAvailability and updateSkillIdleRate use raw JSON read/mutate/write (not updateCard/Zod) — v2.0 skill shapes are rejected by v1.0 Zod schema
- [Phase Phase 06-02]: IdleMonitor passes 0 credits to getAutonomyTier() — auto-share is zero-cost but tier config still gates it
- [Phase Phase 06-02]: Cron constructed paused:true + void this.poll() fire-and-forget — croner callbacks are not async-aware
- [Phase Phase 06-02]: v1.0 cards detected via Array.isArray(skills) — skip without error, no schema change needed
- [Phase Phase 06-02]: IdleMonitor human-verify checkpoint approved — tests pass, serve starts monitor with log, Ctrl+C shuts down cleanly
- [Phase 07-auto-request]: pending_requests CREATE TABLE placed in openDatabase() alongside capability_cards — single DB open initializes all tables
- [Phase 07-auto-request]: resolvePendingRequest uses result.changes === 0 to detect missing id, throws AgentBnBError NOT_FOUND — server maps to 404
- [Phase 07-auto-request]: auto_request_failed uses AutonomyTier (not literal 3) — failure can occur at any tier
- [Phase 07-auto-request]: insertAuditEvent handles auto_request_failed via existing request-event cast branch — no special case needed
- [Phase 07-02]: scorePeers uses multiplicative composite of 3 normalized dimensions (success_rate * cost_efficiency * idle_rate)
- [Phase 07-02]: Zero-cost card maps cost_efficiency to 1 (not Infinity) — prevents NaN in normalization; missing idle_rate defaults to 1.0
- [Phase 07-02]: CLI request [card-id] made optional — --query triggers AutoRequestor; missing both prints help
- [Phase 07-02]: scorePeers uses multiplicative composite of 3 normalized dimensions (success_rate * cost_efficiency * idle_rate)
- [Phase 07-02]: Zero-cost card maps cost_efficiency to 1 (max), not Infinity — prevents NaN in normalization
- [Phase 07-02]: Missing _internal.idle_rate defaults to 1.0 (maximally idle) — benefit of the doubt when no telemetry
- [Phase 08-02]: skills/ directory is outside tsconfig src/ scope — intentional, documented in SKILL.md Installation Note with two resolution options
- [Phase 08-02]: Skill adapter pattern: pure re-export wrappers in skills/ with no business logic, no timers, no DB writes
- [Phase 08-01]: publishFromSoulV2 uses raw SQL INSERT/UPDATE (not insertCard) — insertCard validates v1.0 only; v2.0 cards bypass via direct SQL, consistent with Phase 06-02 updateSkillAvailability pattern
- [Phase 08-01]: idle_rate defaults to null (not 0) when absent from skill._internal — null signals not-yet-computed vs 0 which would signal fully utilized

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 4]: FTS5 trigger syntax for json_each() over skills[] arrays needs verification before implementation
- [Phase 7]: Peer scoring normalization needed when credits_per_call approaches zero (free-tier cards)
- [Phase 8]: OpenClaw message bus API is LOW confidence — use standalone HTTP gateway; no message bus without research

## Session Continuity

Last session: 2026-03-15T15:50:00.740Z
Stopped at: Completed 08-01-PLAN.md — openclaw core modules, 29/29 tests passing
Resume file: None

---
*Last updated: 2026-03-15 — v2.0 roadmap defined, Phase 4 ready to plan*
