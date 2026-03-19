---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: Registry Credit Ledger
status: planning
stopped_at: Completed 27-01-PLAN.md — Registry credit endpoints with Ed25519 auth
last_updated: "2026-03-19T04:40:08.767Z"
last_activity: 2026-03-19 — Roadmap created for v3.2 (Phases 25-29, 35 requirements)
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 7
  completed_plans: 6
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
- [Phase 25]: relay_progress resets RELAY_TIMEOUT_MS window (not a separate progress window) — simpler and consistent with plan
- [Phase 25]: PendingRequest stores timeoutMs field to allow clean timer reset in handleProgress without needing access to outer scope constants
- [Phase 25-relay-timeout]: ProgressCallback as optional 3rd param on ExecutorMode.execute — minimal interface change, symmetric with existing (config, params) call sites
- [Phase 25-relay-timeout]: PipelineExecutor emits N-1 callbacks for N-step pipeline (not after final step) — progress means forward movement, completion via return value
- [Phase 25-03]: CLI onRequest uses relayClient! non-null assertion inside onProgress — safe because callback only fires when relay is connected
- [Phase 25-03]: handlerUrl path intentionally does not receive onProgress — HTTP fetch has no step-level progress
- [Phase 26-01]: LocalCreditLedger uses async keyword (not Promise.resolve()) so sync errors auto-become rejected Promises — zero try/catch needed
- [Phase 26-01]: CreditLedger interface defined with 6 async methods; LocalCreditLedger is delegation-only wrapper with zero business logic
- [Phase 26-02]: RegistryCreditLedger uses single class with discriminated union config (direct|http) — simpler, less duplication
- [Phase 26-02]: HTTP credit client: settle/release pass null for X-Agent-Owner header — escrowId is self-contained
- [Phase 26-02]: REGISTRY_UNREACHABLE for network failures, REGISTRY_ERROR fallback for HTTP non-2xx with no code in body
- [Phase 27-01]: identityAuthPlugin is a plain function (not async Fastify plugin) — avoids sub-scope hook isolation issue
- [Phase 27-01]: Body excluded from Ed25519 signature payload — not available during onRequest hook, 5-min timestamp window sufficient
- [Phase 27-01]: credit_grants table on creditDb — grants are a credit concern, not registry

### Pending Todos

None yet.

### Blockers/Concerns

- Registry becomes single point of failure for credit operations (acceptable at launch scale 10-50 agents)
- Phase 29 has 12 requirements — may need 2 plans to cover CLI + Hub + Compat separately

## Session Continuity

Last session: 2026-03-19T04:40:08.766Z
Stopped at: Completed 27-01-PLAN.md — Registry credit endpoints with Ed25519 auth
Resume file: None

---
*Last updated: 2026-03-19 — v3.2 roadmap defined*
