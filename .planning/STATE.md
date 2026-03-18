---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: Registry Credit Ledger
status: defining_requirements
stopped_at: Milestone started, defining requirements
last_updated: "2026-03-19"
last_activity: 2026-03-19 — Milestone v3.2 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** Fill the market gap for agent-to-agent capability exchange.
**Current focus:** v3.2 Registry Credit Ledger + Relay Timeout Fix

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-19 — Milestone v3.2 started

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

- [v3.2 init]: Credit system moves to Registry for networked agents (ADR-021). Local SQLite preserved for offline/LAN mode.
- [v3.2 init]: Relay timeout C+B Hybrid — Phase 1: 30s→300s, Phase 2: optional relay_progress message type (ADR-020)
- [v3.2 init]: Provider free pricing, 1 cr minimum, reference ranges in Hub Docs (ADR-018)
- [v3.2 init]: Conductor fee 10% of total sub-task cost, min 1 cr, max 20 cr (ADR-019)
- [v3.2 init]: Initial 50 cr grant deduped by Ed25519 public key (one grant per identity)
- [v3.2 init]: free_tier tracking on Registry, not local
- [v3.2 init]: Failure/timeout = full refund, no cancel fee
- [v3.2 init]: Hub frontend hooks unchanged — same API shape, backend switches data source
- [v3.2 init]: docs/brain/ strategy files created (skill-strategy.md, conductor-demo.md, credit-pricing.md, ADR-014~021)

### Pending Todos

(None yet)

### Blockers/Concerns

- Registry becomes single point of failure for credit operations (acceptable at launch scale 10-50 agents)

## Session Continuity

Last session: 2026-03-19
Stopped at: Milestone v3.2 started, defining requirements
Resume file: None

---
*Last updated: 2026-03-19 — Milestone v3.2 started*
