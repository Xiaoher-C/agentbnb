---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: Registry Credit Ledger
status: planning
stopped_at: Completed 30-01-PLAN.md — Fix v2.0 Card Relay Registration
last_updated: "2026-03-19T06:37:39Z"
last_activity: 2026-03-19 — Phase 30 Plan 01 complete (v2.0 card relay fix)
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 11
  completed_plans: 11
  percent: 0
---

# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** Fill the market gap for agent-to-agent capability exchange.
**Current focus:** Phase 30 — Fix Upstream (v2.0 card relay)

## Current Position

Phase: 30 of 30 (Fix Upstream)
Plan: 1 of 1 in current phase
Status: Complete
Last activity: 2026-03-19 — Phase 30 Plan 01 complete (v2.0 card relay fix)

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
- [Phase 27-02]: free-tier tracking uses creditDb (not registryDb) — consistent with credit_grants placement; free_tier is a credit concern
- [Phase 27-02]: privateKey required (not optional) in HttpClientConfig and createLedger HTTP options — fail fast if misconfigured
- [Phase 28]: relay-credit.ts as thin wrapper layer over escrow.ts — keeps relay focused on routing, credit module owns escrow operations
- [Phase 28]: handleRelayRequest made async — allows proper credit hold before forwarding, void-wrapped in message handler to avoid unhandled promise
- [Phase 28]: handleDisconnect tracks both requester and provider disconnects — releases escrow immediately on provider disconnect (not waiting for timeout)
- [Phase 28-02]: Conductor fee is best-effort — fee settlement failure logs but does not block the main capability response that was already settled
- [Phase 28-02]: Conductor response detection uses duck-typing on total_credits field — no separate flag needed, aligns with ConductorMode.execute return shape
- [Phase 29-cli-hub-compatibility]: CLI init: local 100cr bootstrap always runs; Registry grant (50cr) runs additionally when registryUrl configured — keeps offline agents at 100cr, networked agents show Registry balance
- [Phase 29-cli-hub-compatibility]: CLI request: CreditLedger for direct HTTP path only; relay-only path skips CLI escrow — relay does server-side hold/settle/release to avoid double-holding
- [Phase 29-cli-hub-compatibility]: Registry server uses direct DB mode createLedger({ db }) for /me and /me/transactions — avoids HTTP round-trip to itself; per-request construction is cheap
- [Phase 29-02]: No source code changes needed — Plan 01 wiring complete; 865 tests pass without modification
- [Phase 30-01]: Replaced insertCard/updateCard/getCard with AnyCardSchema + raw SQL in relay upsertCard() — store.ts functions locked to v1.0 schema
- [Phase 30-01]: Used same raw SQL pattern as soul-sync.ts for v2.0 card persistence consistency

### Pending Todos

None yet.

### Blockers/Concerns

- Registry becomes single point of failure for credit operations (acceptable at launch scale 10-50 agents)
- Phase 29 has 12 requirements — may need 2 plans to cover CLI + Hub + Compat separately

## Session Continuity

Last session: 2026-03-19T06:37:39Z
Stopped at: Completed 30-01-PLAN.md — Fix v2.0 Card Relay Registration
Resume file: None

---
*Last updated: 2026-03-19 — v3.2 roadmap defined*
