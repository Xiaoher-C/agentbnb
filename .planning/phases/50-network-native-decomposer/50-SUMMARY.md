---
phase: 50-network-native-decomposer
plans: [01, 02, 03]
subsystem: conductor
tags: [conductor, capability-type, dag-validation, decomposer, genesis-template, bootstrap]
dependency_graph:
  requires: []
  provides:
    - capability_type field on CapabilityCard schemas (v1.0 and v2.0)
    - getCardsByCapabilityType() in registry store
    - ConductorRequestContext type (decomposition_depth + orchestration_depth)
    - Network-native Conductor routing with Rule Engine fallback
    - validateAndNormalizeSubtasks() DAG integrity validator
    - genesis-decomposer skill in genesis-template
    - Auto-register task_decomposition card on bootstrap activate()
  affects:
    - src/conductor/conductor-mode.ts (depth guards + network routing)
    - src/registry/store.ts (new lookup function)
    - skills/agentbnb/bootstrap.ts (auto-registration on startup)
tech_stack:
  added: []
  patterns:
    - Kahn's algorithm for DAG cycle detection
    - json_extract SQLite for exact-match capability type lookup
    - Fail-safe validator (never throws, always returns {valid, errors})
key_files:
  created:
    - src/conductor/decomposition-validator.ts
    - src/conductor/decomposition-validator.test.ts
    - genesis-template/templates/skills/genesis-decomposer/SKILL.md
  modified:
    - src/types/index.ts
    - src/registry/store.ts
    - src/registry/store.test.ts
    - src/conductor/types.ts
    - src/conductor/conductor-mode.ts
    - src/conductor/conductor-mode.test.ts
    - src/conductor/task-decomposer.ts
    - genesis-template/templates/SOUL.md.hbs
    - skills/agentbnb/bootstrap.ts
decisions:
  - "capability_type is optional on both v1.0 and v2.0 card schemas — backward-compatible, no migration needed"
  - "getCardsByCapabilityType uses json_extract exact-match, not FTS5 — query volume is one call per conduct invocation"
  - "validateAndNormalizeSubtasks never throws — always returns {valid, errors} for fail-safe operation"
  - "role field is stripped from external subtasks during normalization — SubTask type has no role field"
  - "registerDecomposerCard failure is non-fatal — logged to stderr, agent still starts"
  - "validateAndNormalizeSubtasks is re-exported from task-decomposer.ts as single import point for conductor-mode"
metrics:
  duration_seconds: 1122
  completed_date: "2026-03-24"
  tasks_completed: 6
  files_changed: 9
  files_created: 3
  tests_added: 26
---

# Phase 50: Network-Native Decomposer Summary

**One-liner:** Network-native Conductor routing with capability_type lookup, Kahn's DAG validator, depth guards, genesis-decomposer skill, and idempotent bootstrap auto-registration.

## Plans Executed

| Plan | Name | Commit | Status |
|------|------|--------|--------|
| 50-01 | capability_type schema + registry query + ConductorMode routing + depth guards | 73aa072 | Complete |
| 50-02 | decomposition-validator.ts (DAG integrity validation) | 1840008 | Complete |
| 50-03 | genesis-template SOUL.md.hbs + bootstrap.ts auto-register | bff9cf7 | Complete |

## What Was Built

### Plan 50-01: Schema + Registry + Conductor Routing

Added `capability_type?: string` to:
- `CapabilityCardSchema` (v1.0)
- `CapabilityCardV2Schema` (v2.0)
- `SkillSchema` (per-skill routing hint)

Added `getCardsByCapabilityType(db, capabilityType)` to `src/registry/store.ts`:
- Uses `json_extract(data, '$.capability_type')` exact-match lookup (no FTS5)
- Returns `AnyCard[]`, empty array if none found

Added `ConductorRequestContext` interface to `src/conductor/types.ts`:
- `decomposition_depth: number` — 0 = top-level
- `orchestration_depth: number` — 0 = top-level, >= 2 = error

Updated `ConductorMode.execute()` in `src/conductor/conductor-mode.ts`:
1. **Depth guards**: `orchestration_depth >= 2` returns error; `decomposition_depth >= 1` skips to Rule Engine
2. **Network routing**: queries `getCardsByCapabilityType('task_decomposition')`, excludes self (conductorOwner)
3. **External call**: `requestCapability` with injected depth params (`decomposition_depth + 1`, `orchestration_depth + 1`)
4. **Fallback**: any HTTP failure or non-array response falls through to `decompose()` Rule Engine

### Plan 50-02: DAG Integrity Validator

Created `src/conductor/decomposition-validator.ts` with `validateAndNormalizeSubtasks()`:
- Input: `unknown` (untrusted external agent response)
- Output: `{ valid: SubTask[], errors: string[] }` — never throws
- Validates: array shape, required fields (id/description/required_capability), unique IDs, referential integrity, acyclic DAG (Kahn's algorithm), valid role values (researcher/executor/validator/coordinator), credit bounds
- Normalizes: missing `params` → `{}`, missing `depends_on` → `[]`, `role` field stripped (not on SubTask)

Wired into `conductor-mode.ts` on the external provider response path — validation replaces the previous `Array.isArray` passthrough stub.

Re-exported from `task-decomposer.ts` as the single import point.

### Plan 50-03: Genesis Template + Bootstrap Auto-Register

Updated `genesis-template/templates/SOUL.md.hbs` Skills table with `genesis-decomposer` row.

Created `genesis-template/templates/skills/genesis-decomposer/SKILL.md`:
- Frontmatter: `capability_type: task_decomposition`
- Documents Rule Engine passthrough behavior, input/output contract, failure handling

Updated `skills/agentbnb/bootstrap.ts` `activate()`:
- `registerDecomposerCard(configDir, owner)` called after `service.ensureRunning()`
- Idempotency: checks `owner + capability_type = 'task_decomposition'` before inserting
- Non-fatal: failure logged to stderr, agent starts normally

## Test Summary

| Suite | Tests Added | All Pass |
|-------|------------|---------|
| `src/registry/store.test.ts` | 4 (getCardsByCapabilityType) | Yes |
| `src/conductor/conductor-mode.test.ts` | 6 (depth guards + routing) | Yes |
| `src/conductor/decomposition-validator.test.ts` | 16 (all validator cases) | Yes |
| Total new tests | **26** | Yes |

Final count: 1175 tests passing in this worktree (0 failures).

## Decisions Made

1. `capability_type` is optional on all card schemas — backward-compatible, no migration needed
2. `getCardsByCapabilityType` uses `json_extract` exact-match, not FTS5 — one call per `agentbnb conduct` invocation, no index needed at current scale
3. `validateAndNormalizeSubtasks` never throws — fail-safe design, always returns structured result
4. `role` field stripped during normalization — `SubTask` type has no role field (roles belong in Phase 52 TEAM formation)
5. `registerDecomposerCard` failure is non-fatal — agent startup must not be blocked by optional feature
6. `validateAndNormalizeSubtasks` re-exported from `task-decomposer.ts` — single import point for `conductor-mode.ts`

## Deviations from Plan

**None** — plan executed exactly as written.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/conductor/decomposition-validator.ts | FOUND |
| src/conductor/decomposition-validator.test.ts | FOUND |
| genesis-template/templates/skills/genesis-decomposer/SKILL.md | FOUND |
| Commit 73aa072 (50-01) | FOUND |
| Commit 1840008 (50-02) | FOUND |
| Commit bff9cf7 (50-03) | FOUND |
| capability_type in types/index.ts | FOUND |
| getCardsByCapabilityType in store.ts | FOUND |
| ConductorRequestContext in types.ts | FOUND |
| validateAndNormalizeSubtasks in conductor-mode.ts | FOUND |
| registerDecomposerCard in bootstrap.ts | FOUND |
| genesis-decomposer in SOUL.md.hbs | FOUND |
