---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: Agent Economy Platform
status: completed
stopped_at: Completed 39-01-PLAN.md -- Hub Agent UI frontend
last_updated: "2026-03-19T09:00:04.356Z"
last_activity: 2026-03-19 — Phase 39 Plan 01 complete (Hub Agent UI frontend)
progress:
  total_phases: 10
  completed_phases: 10
  total_plans: 12
  completed_plans: 12
  percent: 90
---

# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** Fill the market gap for agent-to-agent capability exchange.
**Current focus:** v4.0 complete. All phases shipped.

## Current Position

Phase: 39 of 39 (Hub Agent UI)
Plan: 1 of 1 in current phase
Status: Completed
Last activity: 2026-03-19 — Phase 39 Plan 01 complete (Hub Agent UI frontend)

Progress: [██████████] 100% (v4.0 milestone)

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
- [Phase 31-fix-downstream]: Fallback-only design: remote search only when local returns zero results (not merge)
- [Phase 31-fix-downstream]: matchSubTasks changed from sync to async — callers add await, per-subtask remote fallback via Promise.all
- [Phase 32]: getPricingStats uses searchCards (FTS5) + per-skill query word matching — reuses existing search infrastructure
- [Phase 32]: SOUL.md pricing: N directive parsed at parseSoulMd level so both v1/v2 paths benefit; invalid values silently default to 10
- [Phase 31]: relay:// sentinel URL convention for remote agents — resolveAgentUrl returns relay://<owner> when no local peer
- [Phase 31]: Temporary RelayClient with minimal conductor card — connect/disconnect lifecycle scoped to single CLI action
- [Phase 31]: selected_card_id added to MatchResult for relay card ID resolution
- [Phase 33]: buildConductorCard(owner) uses SHA-256 of owner for deterministic UUID-shaped card ID
- [Phase 33]: cards array in RegisterMessage is optional for backward compat; card field stays required
- [Phase 33]: handleRegister upserts primary card first, then additional cards; logs agent_joined once
- [Phase 35]: Wrap API routes in Fastify plugin for @fastify/swagger schema capture — routes registered directly on server are invisible to swagger's onRoute hook
- [Phase 35]: GPT Actions export filters to public GET/POST only — excludes /me, /draft, /docs, /ws, /api/credits paths
- [Phase 34]: Used @modelcontextprotocol/sdk (not /server) — /server package does not exist on npm
- [Phase 34]: All MCP server logging goes to stderr — stdout reserved for JSON-RPC protocol
- [Phase 34]: Tool handlers exported as standalone handleXxx() functions for direct unit testing
- [Phase 34]: serve_skill stores RelayClient on McpServerContext for graceful SIGINT/SIGTERM shutdown
- [Phase 36]: Route prefix /api/hub-agents (not /api/agents) to avoid collision with existing agent profiles endpoint
- [Phase 36]: Hub Agent owner_public_key set to 'hub-server' placeholder — server-managed agents don't need external identity auth
- [Phase 36]: Card ID derived deterministically from agent_id via padding + UUID formatting
- [Phase 38]: Each Python adapter is fully self-contained with inline Ed25519 auth -- no shared module
- [Phase 36-02]: Secret injection via deep clone + auth type switch -- secrets never stored decrypted, discarded after execution
- [Phase 36-02]: Credit escrow skipped when no requester_owner -- self-execution free, escrow only for inter-agent calls
- [Phase 37]: relay_owner added to queue mode config, jobId on PendingRelayRequest for response routing, bridge via callback pattern
- [Phase 39]: Hub Agent routes placed before agents/:owner in router to avoid param collision
- [Phase 39]: Jobs poll at 10s (vs 30s default) since job status changes frequently

### Pending Todos

None yet.

### Blockers/Concerns

- Registry becomes single point of failure for credit operations (acceptable at launch scale 10-50 agents)
- Phase 29 has 12 requirements — may need 2 plans to cover CLI + Hub + Compat separately

## Session Continuity

Last session: 2026-03-19T09:00:04.354Z
Stopped at: Completed 39-01-PLAN.md -- Hub Agent UI frontend
Resume file: None

---
*Last updated: 2026-03-19 — v3.2 roadmap defined*
