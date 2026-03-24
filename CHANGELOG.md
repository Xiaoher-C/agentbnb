# Changelog

## [6.0.0] — 2026-03-24

### Added

**Phase 50: Network-Native Task Decomposer**
- Conductor now discovers task decomposition providers via `capability_type: task_decomposition` key lookup, falling back to text search only when no exact match is found (COND-01)
- External decomposition output is validated before entering CapabilityMatcher: required fields, unique IDs, valid dependencies, acyclic DAG, valid role values, sane credit estimates (COND-02)
- Depth guard: `decomposition_depth >= 1` routes directly to built-in Rule Engine; `orchestration_depth >= 2` returns an error without executing (COND-03)
- Conductor refuses to select itself as decomposition provider unless explicitly configured for local fallback mode (COND-03b)
- `genesis-template` SOUL.md declares `task_decomposition` skill with `capability_type` field by default (COND-04)
- `bootstrap.ts activate()` auto-registers a `task_decomposition` Capability Card with `capability_type` set (COND-05)
- Graceful fallback to built-in Rule Engine when no external decomposer is available or when remote decomposition fails (COND-06)

**Phase 51: Production Resilience**
- `FailureReason` string union (`bad_execution` | `overload` | `timeout` | `auth_error` | `not_found`) recorded in `request_log` for all terminal failures (RESIL-01)
- Overload failures excluded from reputation score denominator — provider reputation is not penalised for capacity exhaustion (RESIL-02)
- Per-skill `capacity.max_concurrent` declared in `skills.yaml`; gateway tracks in-flight count per `skill_id` (RESIL-03)
- When `max_concurrent` is exceeded, gateway returns a structured overload response without executing, records `failure_reason: overload` (RESIL-04)

**Phase 52: Team Formation Protocol**
- `Role` type defines 4 routing-hint values: `researcher` | `executor` | `validator` | `coordinator` — not authorization boundaries (TEAM-01)
- `formTeam(subtasks, cards)` maps role-hinted SubTasks to TeamMembers; supports `cost_optimized`, `quality_optimized`, `balanced` formation strategies (TEAM-02)
- `PipelineOrchestrator` schedules sub-tasks with role-aware agent selection; same-role subtasks may be batched to the same agent when capacity allows (TEAM-03)

**Phase 53: Team Traceability**
- `request_log` records `team_id` and `role` columns for team-originated executions (TRACE-01)
- Hub request history displays role badge when `role` is present in a log entry (TRACE-02)

---

## [5.1.10] — 2026-03-23

### Fixed
- **CLI routing: remote card misidentified as local** (`src/cli/index.ts`)
  - Before: any card found in the local registry was routed to the local gateway,
    regardless of card ownership. Cards synced from remote peers were silently
    treated as "owned by this agent."
  - After: a card is only treated as local if `card.owner === config.owner`.
    Cards belonging to other agents go through the remote path (fetch from
    registry → direct connect → relay fallback), which is the correct behaviour.
  - Impact: requests to remote agents whose cards were cached locally would be
    sent to the local gateway with the local token, causing "Skill not found"
    errors instead of reaching the actual provider.

### Tests
- Added **Scenario 8** to `src/gateway/e2e-canonical.test.ts`:
  `provider external API failure → escrow released, credits refunded, failure logged`
  - Regression case for the remote discovery + provider quota exhausted + escrow
    auto-release flow (validated live against genesis-bot / deep-stock-analyst /
    Alpha Vantage on 2026-03-23).
  - Checks: `success: false`, requester balance unchanged, `request_log` status
    = `failure`, `credits_charged = 0`.

### Release Checklist Addition
The following flow is now a required smoke test before each release:
1. Remote card discovery (card not in local registry, fetch from `agentbnb.fly.dev`)
2. Remote card request via direct gateway connection
3. Provider external API quota exhausted → error propagated to requester
4. Escrow auto-release / credits refunded
5. `request_log` records `status=failure`, `credits_charged=0`

Full success path (steps 1–2 + successful execution + escrow settlement) to be
validated after Alpha Vantage daily quota resets (UTC 00:00 / Taiwan 08:00).

---

## [5.1.9] — 2026-03-22

### Fixed
- Relay stub cards no longer pollute Hub card listing
- Added pagination to Hub Discover page

### Added
- Ephemeral requester connections for WebSocket relay (stub cards not registered)
- Pagination infrastructure in `hub/src/hooks/useCards.ts`

---

## [5.1.8] — 2026-03-22

### Fixed
- Self-request failures now logged to `request_log`
- Skill fallback for v1.0 cards when `skill_id` not specified
- Self-request guard + `AGENTBNB_DIR` auto-propagation

---

## [5.1.7] — 2026-03-22

### Fixed
- Intelligent skill fallback for v1.0 cards

---

## [5.1.6] — 2026-03-22

### Fixed
- Skill ID resolution for v1.0 cards
- Self-request guard
- `AGENTBNB_DIR` auto-propagation
