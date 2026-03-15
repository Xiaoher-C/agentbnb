# Requirements: AgentBnB

**Defined:** 2026-03-15
**Core Value:** Fill the market gap for agent-to-agent capability exchange — the agent handles everything, the human says Yes once.

## v1.1 Requirements (Complete)

All v1.1 requirements shipped and validated. See MILESTONES.md for details.

- [x] R-001 through R-006: Phase 0 Dogfood (schema, registry, CLI, gateway, credits, OpenClaw)
- [x] R-007, R-008: Phase 1 CLI MVP (npm package, spec v1.0)
- [x] R-013 through R-015: Phase 2 Cold Start (web registry, reputation, marketplace)
- [x] ONB-01 through ONB-07: Phase 2.1 Smart Onboarding
- [x] HUB-01 through HUB-05: Phase 2.2 Agent Hub
- [x] SCH-02 through SCH-06: Phase 2.25 Schema v1.1
- [x] RRD-01, RRD-02: Phase 2.3 Remote Registry
- [x] UX-01 through UX-14: Phase 3 UX Layer

## v2.0 Requirements

Requirements for the Agent Autonomy milestone. Each maps to roadmap phases.

### Agent Runtime & Schema

- [x] **RUN-01**: AgentRuntime class owns all DB handles, background timers, and SIGTERM shutdown with orphaned escrow recovery
- [x] **RUN-02**: Multi-skill Capability Card schema v2.0 with `skills[]` array — one card per agent, multiple independently-priced skills
- [x] **RUN-03**: SQLite v1→v2 card migration preserving existing cards, with FTS5 trigger update to index nested skill names/descriptions
- [ ] **RUN-04**: Gateway routing accepts `skill_id` for per-skill execution on multi-skill cards

### Idle Detection & Auto-Share

- [ ] **IDLE-01**: Sliding window idle rate detection per skill — `idle_rate = 1 - (calls_in_60min / capacity_per_hour)`
- [ ] **IDLE-02**: `capacity.calls_per_hour` field on skill schema, owner-declared with default 60
- [ ] **IDLE-03**: Auto-share trigger flips `availability.online` when idle_rate crosses configurable threshold (default 70%)
- [ ] **IDLE-04**: Per-skill idle rate stored in `_internal` (never transmitted), independently tracked per skill on multi-skill cards
- [ ] **IDLE-05**: IdleMonitor runs as croner-scheduled background loop (60s interval) in AgentRuntime

### Autonomy Tiers

- [ ] **TIER-01**: Autonomy tier configuration stored in `~/.agentbnb/config.json` — Tier 1 (<10cr auto), Tier 2 (10-50cr notify-after), Tier 3 (>50cr ask-before)
- [ ] **TIER-02**: Default tier is Tier 3 (most restrictive) — all autonomous actions blocked until owner explicitly configures tiers
- [ ] **TIER-03**: `getAutonomyTier(creditAmount)` enforced before every autonomous action (auto-share, auto-request)
- [ ] **TIER-04**: Tier 2 "notify after" writes audit event to request_log with `action_type` and `tier_invoked` fields

### Credit Budgeting

- [ ] **BUD-01**: Credit reserve enforcement — block auto-request when balance at or below reserve floor (default 20cr, configurable)
- [ ] **BUD-02**: BudgetManager.canSpend() wraps every escrow hold from auto-request path — holdEscrow never called directly by auto-request
- [ ] **BUD-03**: Reserve and tier thresholds configurable via `agentbnb config set reserve <N>` and `agentbnb config set tier1 <N>`

### Auto-Request

- [ ] **REQ-01**: Capability gap detection triggers auto-request flow via structured event when agent lacks required skill
- [ ] **REQ-02**: Peer selection scores candidates by `success_rate * (1/credits_per_call) * idle_rate` with min-max normalization
- [ ] **REQ-03**: Self-exclusion guard filters `candidate.owner !== self.owner` before ranking peers
- [ ] **REQ-04**: Budget-gated escrow execution: BudgetManager.canSpend() → holdEscrow → JSON-RPC execute → settle/release
- [ ] **REQ-05**: Tier 3 approval queue: `pending_requests` table + `GET /me/pending-requests` endpoint for owner approval
- [ ] **REQ-06**: Auto-request failures written to request_log even when no escrow is initiated

### OpenClaw Integration

- [ ] **OC-01**: `skills/agentbnb/SKILL.md` installable package with gateway.ts, auto-share.ts, auto-request.ts, credit-mgr.ts
- [ ] **OC-02**: HEARTBEAT.md rule injection — emit ready-to-paste autonomy rules block; auto-patch on `openclaw install agentbnb`
- [ ] **OC-03**: SOUL.md v2 sync — extend `parseSoulMd()` to emit `skills[]` from H2 sections for multi-skill cards
- [ ] **OC-04**: `agentbnb openclaw sync|status|rules` CLI commands for managing OpenClaw integration

## v2.1 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Credit Optimization

- **BUD-04**: Credit surplus alert — notify owner when balance exceeds configured threshold (default 500cr)
- **BUD-05**: Daily spending limit — cap total auto-request spend per 24h period

### Advanced Idle Detection

- **IDLE-06**: Dynamic capacity learning — infer `capacity.calls_per_hour` from max observed throughput over 7-day window

### Partial Pipeline Sharing

- **PIPE-01**: Mark specific pipeline steps as shareable vs moat on Level 2 cards

## Out of Scope

| Feature | Reason |
|---------|--------|
| OpenClaw message bus transport | LOW confidence on API feasibility; needs dedicated research phase |
| Dynamic pricing (auto-adjust) | Creates instability for requesting agents who budget in advance |
| Multi-agent card ownership | Splits reputation accountability; owner isolation is correct model |
| Real-time sub-second idle polling | Distorts the metric being measured; 60s refresh is sufficient |
| Cross-agent credit transfers | Credits without backing exchange = gift economy, undermines share-to-earn |
| Cloud relay for gateway | Introduces centralization; document ngrok/tunnel as user-managed option |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RUN-01 | Phase 4 | Complete |
| RUN-02 | Phase 4 | Complete |
| RUN-03 | Phase 4 | Complete |
| RUN-04 | Phase 4 | Pending |
| IDLE-01 | Phase 6 | Pending |
| IDLE-02 | Phase 6 | Pending |
| IDLE-03 | Phase 6 | Pending |
| IDLE-04 | Phase 6 | Pending |
| IDLE-05 | Phase 6 | Pending |
| TIER-01 | Phase 5 | Pending |
| TIER-02 | Phase 5 | Pending |
| TIER-03 | Phase 5 | Pending |
| TIER-04 | Phase 5 | Pending |
| BUD-01 | Phase 5 | Pending |
| BUD-02 | Phase 5 | Pending |
| BUD-03 | Phase 5 | Pending |
| REQ-01 | Phase 7 | Pending |
| REQ-02 | Phase 7 | Pending |
| REQ-03 | Phase 7 | Pending |
| REQ-04 | Phase 7 | Pending |
| REQ-05 | Phase 7 | Pending |
| REQ-06 | Phase 7 | Pending |
| OC-01 | Phase 8 | Pending |
| OC-02 | Phase 8 | Pending |
| OC-03 | Phase 8 | Pending |
| OC-04 | Phase 8 | Pending |

**Coverage:**
- v2.0 requirements: 26 total (RUN×4, IDLE×5, TIER×4, BUD×3, REQ×6, OC×4)
- Mapped to phases: 26
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-15*
*Last updated: 2026-03-15 — traceability confirmed, coverage corrected to 26 (was 23)*
