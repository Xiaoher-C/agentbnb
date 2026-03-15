---
phase: 08-openclaw-deep-integration
plan: "01"
subsystem: openclaw
tags: [openclaw, soul-sync, heartbeat-writer, skill-status, tdd, typescript]
dependency_graph:
  requires:
    - src/skills/publish-capability.ts
    - src/types/index.ts
    - src/registry/store.ts
    - src/credit/ledger.ts
    - src/autonomy/tiers.ts
    - src/credit/budget.ts
    - src/cli/config.ts
  provides:
    - src/openclaw/soul-sync.ts
    - src/openclaw/heartbeat-writer.ts
    - src/openclaw/skill.ts
    - src/openclaw/index.ts
  affects:
    - Phase 08-02 CLI commands (openclaw sync|status|rules)
tech_stack:
  added: []
  patterns:
    - TDD (RED -> GREEN for all four modules)
    - unknown narrowing for v2.0 card detection (Phase 04-03 decision)
    - raw SQL for v2.0 card insert/update (bypasses v1.0 CapabilityCardSchema)
    - HTML comment markers for HEARTBEAT.md idempotent injection
key_files:
  created:
    - src/openclaw/soul-sync.ts
    - src/openclaw/soul-sync.test.ts
    - src/openclaw/heartbeat-writer.ts
    - src/openclaw/heartbeat-writer.test.ts
    - src/openclaw/skill.ts
    - src/openclaw/skill.test.ts
    - src/openclaw/index.ts
  modified: []
decisions:
  - "publishFromSoulV2 uses raw SQL INSERT/UPDATE instead of insertCard() — insertCard validates with CapabilityCardSchema (v1.0 only); v2.0 cards must bypass Zod via direct SQL, consistent with Phase 06-02 updateSkillAvailability pattern"
  - "parseSoulMdV2 calls parseSoulMd() and maps ParsedCapability -> Skill — avoids rebuilding SOUL.md parser (Phase 8 anti-pattern), reuses well-tested v1.0 logic"
  - "publishFromSoulV2 upsert: query listCards(db, owner), find spec_version=2.0 via unknown narrowing, UPDATE if found / INSERT if not — preserves existing card id across re-syncs"
  - "getOpenClawStatus is read-only (SELECT only) — safe for concurrent use with agentbnb serve under WAL mode"
  - "idle_rate defaults to null (not 0) when absent from skill._internal — null signals 'not yet computed' vs 0 which would signal 'fully utilized'"
metrics:
  duration_seconds: 261
  completed_date: "2026-03-15"
  tasks_completed: 2
  files_created: 7
  tests_added: 29
---

# Phase 08 Plan 01: openclaw Core Modules Summary

**One-liner:** Four `src/openclaw/` TypeScript modules with 29 tests — SOUL.md v2 sync with upsert semantics, HEARTBEAT.md marker-based injection, and OpenClaw status reporter wired to live DB state.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | soul-sync + heartbeat-writer modules with tests | 086a249 | soul-sync.ts, soul-sync.test.ts, heartbeat-writer.ts, heartbeat-writer.test.ts |
| 2 | skill lifecycle module + index re-export | 77130f9 | skill.ts, skill.test.ts, index.ts |

## What Was Built

### soul-sync.ts

`parseSoulMdV2(content)` delegates to the existing `parseSoulMd()` function and maps each `ParsedCapability` (from H2 sections) to a `Skill` entry. Skill IDs are sanitized: lowercase, spaces to dashes, non-alphanumeric-dash chars stripped, with UUID fallback for empty results.

`publishFromSoulV2(db, soulContent, owner)` performs an upsert: queries `listCards(db, owner)` for an existing v2.0 card, updates in-place if found (preserving the card UUID), or inserts a new card. Validates the assembled `CapabilityCardV2` with `CapabilityCardV2Schema.parse()` before writing. Throws `AgentBnBError('SOUL.md has no H2 sections', 'VALIDATION_ERROR')` when skills array would be empty.

### heartbeat-writer.ts

`generateHeartbeatSection(autonomy, budget)` reads the owner's tier thresholds and reserve floor and emits a complete markdown block wrapped in `<!-- agentbnb:start -->` / `<!-- agentbnb:end -->` markers.

`injectHeartbeatSection(path, section)` handles three file states: (1) creates file if absent, (2) replaces between markers if both present, (3) appends with newline if no markers found.

### skill.ts

`getOpenClawStatus(config, db, creditDb)` reads `config.autonomy` (defaults to `DEFAULT_AUTONOMY_CONFIG`), `config.budget` (defaults to `DEFAULT_BUDGET_CONFIG`), calls `getBalance()`, then filters `listCards()` results for `spec_version === '2.0'` via unknown narrowing. Maps each skill to `{ id, name, idle_rate, online }` where `idle_rate` comes from `skill._internal.idle_rate` (null if absent).

### index.ts

Re-exports all public APIs: `parseSoulMdV2`, `publishFromSoulV2`, `generateHeartbeatSection`, `injectHeartbeatSection`, `getOpenClawStatus`, and types `OpenClawStatus`, `SkillStatus`.

## Verification Results

- All src/openclaw/ tests: **29/29 passing** (3 test files)
- TypeScript `npx tsc --noEmit`: **PASSED** (no errors)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused `description` variable in publishFromSoulV2**
- **Found during:** TypeScript noEmit check after Task 1
- **Issue:** `description` was destructured from `parseSoulMdV2()` but `CapabilityCardV2` has no top-level description field — TypeScript TS6133 error
- **Fix:** Removed `description` from destructuring; only `agentName` and `skills` are used
- **Files modified:** src/openclaw/soul-sync.ts
- **Commit:** included in 77130f9 (prior to commit, fix applied inline)

**2. [Rule 1 - Bug] Test used `await import()` inside non-async `it()` block**
- **Found during:** Task 1 RED phase test run
- **Issue:** esbuild transform error for top-level await in test body
- **Fix:** Moved `CapabilityCardV2Schema` import to module-level import statement
- **Files modified:** src/openclaw/soul-sync.test.ts

**3. [Rule 1 - Bug] UUID fallback test used `## !!!---` which produces `---` (valid id)**
- **Found during:** Task 1 GREEN phase test run
- **Issue:** The regex `[^a-z0-9-]` keeps dashes — `!!!---` sanitizes to `---` (3 dashes), not empty, so UUID fallback never triggers
- **Fix:** Changed test input to `## !!!()` which strips to empty string and correctly triggers UUID fallback
- **Files modified:** src/openclaw/soul-sync.test.ts

**4. [Rule 1 - Architectural clarification] insertCard() only accepts v1.0 cards**
- **Found during:** Implementation of publishFromSoulV2
- **Issue:** `insertCard()` validates with `CapabilityCardSchema` (spec_version: '1.0' literal) — calling it with a v2.0 card would throw VALIDATION_ERROR
- **Fix:** Used raw SQL INSERT/UPDATE directly, consistent with `insertCardV2` helper in server.test.ts and `updateSkillAvailability` pattern from Phase 06-02
- **Files modified:** src/openclaw/soul-sync.ts (no change to store.ts needed)

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/openclaw/soul-sync.ts | FOUND |
| src/openclaw/heartbeat-writer.ts | FOUND |
| src/openclaw/skill.ts | FOUND |
| src/openclaw/index.ts | FOUND |
| Commit 086a249 | FOUND |
| Commit 77130f9 | FOUND |
