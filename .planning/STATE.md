---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: Registry Credit Ledger
status: ready_to_plan
stopped_at: Roadmap created — Phases 25-29 defined, ready to plan Phase 25
last_updated: "2026-03-19"
last_activity: 2026-03-19 — v3.2 roadmap created (5 phases, 35 requirements mapped)
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** Fill the market gap for agent-to-agent capability exchange.
**Current focus:** Phase 25 — Relay Timeout

## Current Position

Phase: 25 of 29 (Relay Timeout)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-03-19 — Roadmap created for v3.2 (Phases 25-29, 35 requirements)

Progress: [░░░░░░░░░░] 0% (v3.2 milestone)

## Accumulated Context

### Decisions

- [v3.2 init]: Credit system moves to Registry for networked agents (ADR-021). Local SQLite preserved for offline/LAN mode.
- [v3.2 init]: Relay timeout C+B Hybrid — 30s→300s default + optional relay_progress message type (ADR-020)
- [v3.2 init]: Provider free pricing, 1 cr minimum enforced at publish (ADR-018)
- [v3.2 init]: Conductor fee 10% of total sub-task cost, min 1 cr, max 20 cr (ADR-019)
- [v3.2 init]: Initial 50 cr grant deduped by Ed25519 public key (one grant per identity)
- [v3.2 init]: Failure/timeout = full refund, no cancel fee
- [v3.2 init]: Hub frontend hooks unchanged — same API shape, backend switches data source
- [v3.1 superseded]: Phase 24 Code Quality Polish deferred to v3.3+

### Pending Todos

None yet.

### Blockers/Concerns

- Registry becomes single point of failure for credit operations (acceptable at launch scale 10-50 agents)
- Phase 29 has 12 requirements — may need 2 plans to cover CLI + Hub + Compat separately

## Session Continuity

Last session: 2026-03-19
Stopped at: v3.2 roadmap created, ready to plan Phase 25 (Relay Timeout)
Resume file: None

---
*Last updated: 2026-03-19 — v3.2 roadmap defined*
