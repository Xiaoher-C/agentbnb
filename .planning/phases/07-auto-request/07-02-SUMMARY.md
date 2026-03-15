---
phase: 07-auto-request
plan: 02
subsystem: autonomy
tags: [auto-request, peer-scoring, min-max-normalization, escrow, budget, tiers, cli]

requires:
  - phase: 07-auto-request-01
    provides: pending_requests table, createPendingRequest, AutonomyEvent extension with auto_request_failed
  - phase: 05-autonomy-tiers-credit-budgeting
    provides: BudgetManager.canSpend(), DEFAULT_BUDGET_CONFIG, holdEscrow/settleEscrow/releaseEscrow
  - phase: 04-agent-runtime-multi-skill-foundation
    provides: searchCards() FTS5 search, v2.0 CapabilityCard with skills[]

provides:
  - AutoRequestor class: full autonomous request flow (search→score→tier→budget→escrow→execute→settle/release)
  - minMaxNormalize(): exported helper for peer score normalization
  - scorePeers(): exported helper with self-exclusion, zero-cost guard, idle_rate fallback
  - CLI command: agentbnb request --query <text> --max-cost <credits>
  - 15 unit/integration tests covering all AutoRequestResult statuses

affects:
  - 07-auto-request (Phase 8 OpenClaw integration builds on AutoRequestor)
  - CLI consumers of agentbnb request command

tech-stack:
  added: []
  patterns:
    - "AutoRequestor composes all v2.0 primitives (registry, credit, escrow, autonomy, gateway) in a single orchestration class"
    - "min-max normalization with guards for single-value and all-equal edge cases"
    - "Scored candidate model: Candidate → ScoredPeer with rawScore for explainability"
    - "All failure paths write audit events to request_log (REQ-06 compliance pattern)"

key-files:
  created:
    - src/autonomy/auto-request.ts
    - src/autonomy/auto-request.test.ts
  modified:
    - src/cli/index.ts

key-decisions:
  - "scorePeers uses multiplicative composite of 3 normalized dimensions (success_rate * cost_efficiency * idle_rate) — single number per candidate for easy sorting"
  - "Zero-cost card maps cost_efficiency to 1 (max), not Infinity — prevents NaN in normalization"
  - "Missing _internal.idle_rate defaults to 1.0 (maximally idle) — benefit of the doubt when no telemetry"
  - "top = scored[0] as ScoredPeer cast used after scored.length === 0 guard — TypeScript strict mode safe"
  - "CLI request [card-id] made optional; --query triggers AutoRequestor; no card-id + no --query prints help"
  - "hub/ test failures (React components) are pre-existing and out of scope — not caused by this plan"

requirements-completed: [REQ-01, REQ-02, REQ-03, REQ-04, REQ-06]

duration: 6min
completed: 2026-03-15
---

# Phase 7 Plan 02: AutoRequestor Summary

**AutoRequestor class with min-max peer scoring, self-exclusion, escrow-gated execution, Tier 3 pending queue, REQ-06 failure logging, and `agentbnb request --query` CLI trigger**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-15T14:29:44Z
- **Completed:** 2026-03-15T14:35:44Z
- **Tasks:** 2 auto + 1 checkpoint (human-verified, approved)
- **Files modified:** 3

## Accomplishments

- AutoRequestor class orchestrates complete auto-request flow: search → score → tier gate → budget check → escrow → execute → settle/release
- Peer scoring uses min-max normalized composite (success_rate × cost_efficiency × idle_rate) with zero-cost guard and missing idle_rate fallback to 1.0
- Self-exclusion filters `card.owner === self.owner` before scoring so agents never select themselves
- Tier 3 queues to pending_requests (createPendingRequest) without executing; Tier 1/2 proceed with escrow
- All failure paths (no_peer, budget_blocked, tier_blocked, failed) write audit events to request_log per REQ-06
- CLI `agentbnb request --query <text> --max-cost <credits>` triggers AutoRequestor flow end-to-end
- 15 tests pass covering all AutoRequestResult statuses

## Task Commits

1. **Task 1: AutoRequestor class (TDD)** - `89f9b67` (feat)
2. **Task 2: CLI command** - `855f81d` (feat)

## Files Created/Modified

- `src/autonomy/auto-request.ts` — AutoRequestor class, minMaxNormalize, scorePeers, types
- `src/autonomy/auto-request.test.ts` — 15 tests: minMaxNormalize (3), scorePeers (4), requestWithAutonomy (8)
- `src/cli/index.ts` — Modified `request [card-id]` command, added --query/--max-cost/--params options

## Decisions Made

- scorePeers uses multiplicative composite of 3 normalized dimensions — single number per candidate for easy sorting and inspection
- Zero-cost card gets cost_efficiency = 1 (not 1/0 = Infinity) — prevents NaN in normalization pipeline
- Missing `_internal.idle_rate` defaults to 1.0 (maximally idle) — benefit of the doubt when no telemetry recorded yet
- TypeScript strict mode: `scored[0] as ScoredPeer` cast used after length guard — avoids undefined
- CLI `[card-id]` made optional; `--query` triggers auto-request; missing both = help message

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test UUID format**
- **Found during:** Task 1 (test RED phase)
- **Issue:** `makePeerCard` used `Math.random().toString(36)` for ID — `insertCard()` validates UUID format
- **Fix:** Imported `randomUUID` from `node:crypto`, used in `makePeerCard`
- **Files modified:** src/autonomy/auto-request.test.ts
- **Committed in:** 89f9b67 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed budget_blocked test autonomy config**
- **Found during:** Task 1 (GREEN phase, 1 test failing)
- **Issue:** Test `requestor` used `tier2_max_credits: 200` — card costing 300 hits Tier 3 before budget check
- **Fix:** Test uses a separate `requestorWithHighTiers` with tier thresholds above cost amount so budget check is reached
- **Files modified:** src/autonomy/auto-request.test.ts
- **Committed in:** 89f9b67 (Task 1 commit)

**3. [Rule 2 - Missing Critical] Added TypeScript strict mode fixes**
- **Found during:** Task 2 (tsc --noEmit check)
- **Issue:** `scored[0]` possibly undefined (strict array access), `normSuccess[i]` possibly undefined, unused `maxSearchResults` field
- **Fix:** `as ScoredPeer` cast after length guard, `?? 0` fallbacks for normalized values, removed unused field
- **Files modified:** src/autonomy/auto-request.ts
- **Committed in:** 855f81d (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 missing critical)
**Impact on plan:** All fixes necessary for correctness and TypeScript compliance. No scope creep.

## Issues Encountered

- hub/ React component tests (43 failures) are pre-existing — confirmed via git log that they predate this plan. Out of scope per deviation rules.

## Next Phase Readiness

- AutoRequestor is ready for Phase 8 (OpenClaw integration) — all primitives assembled
- Human verification passed: full test suite + CLI smoke test approved

---
*Phase: 07-auto-request*
*Completed: 2026-03-15*
