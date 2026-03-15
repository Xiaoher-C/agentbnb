---
phase: 04-agent-runtime-multi-skill-foundation
verified: 2026-03-15T19:15:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 4: Agent Runtime + Multi-Skill Foundation Verification Report

**Phase Goal:** Agents can run with a stable centralized runtime that owns all DB handles and background lifecycle, publishing a single multi-skill Capability Card instead of one card per skill.
**Verified:** 2026-03-15T19:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AgentRuntime opens registryDb and creditDb with WAL mode and busy_timeout | VERIFIED | `agent-runtime.ts:65-70` calls `openDatabase()`/`openCreditDb()` then sets `busy_timeout = 5000` pragma on both handles |
| 2 | AgentRuntime.start() recovers orphaned escrows older than 10 minutes | VERIFIED | `recoverOrphanedEscrows()` queries `credit_escrow WHERE status = 'held' AND created_at < cutoff`; Test 2 passes (8/8 runtime tests green) |
| 3 | AgentRuntime.shutdown() stops all registered Cron jobs and closes both DBs | VERIFIED | `shutdown()` calls `job.stop()` then closes both DB handles; Test 5 and Test 6 pass |
| 4 | `agentbnb serve` creates an AgentRuntime and wires SIGTERM/SIGINT to shutdown() | VERIFIED | `cli/index.ts:584-589` creates `new AgentRuntime({...})`, calls `await runtime.start()`; lines 615-616 wire SIGINT/SIGTERM to `gracefulShutdown` which calls `await runtime.shutdown()` |
| 5 | The draining flag is set before DB close to prevent in-flight request crashes | VERIFIED | `shutdown()` sets `this.draining = true` before any job or DB close calls; `isDraining` getter verified in Test 7 |
| 6 | A v2.0 card with skills[] array validates against CapabilityCardV2Schema | VERIFIED | `CapabilityCardV2Schema` defined in `src/types/index.ts:116-140`; Tests 1-3 pass (34/34 type tests green) |
| 7 | A v1.0 card still validates against CapabilityCardSchema (backward compat) | VERIFIED | `CapabilityCardSchema` preserved unchanged; Test 4 passes |
| 8 | AnyCardSchema accepts both v1.0 and v2.0 cards via discriminated union on spec_version | VERIFIED | `AnyCardSchema = z.discriminatedUnion('spec_version', [CapabilityCardSchema, CapabilityCardV2Schema])` at line 146; Tests 5-7 pass |
| 9 | Existing v1.0 cards in SQLite are migrated to v2.0 shape with skills[] wrapping original fields | VERIFIED | `migrateV1toV2()` in `store.ts` constructs v2.0 shape; migration Tests 1-5 pass (35/35 store tests green) |
| 10 | FTS5 search returns results for skill names nested inside skills[] array | VERIFIED | V2_FTS_TRIGGERS constant uses `json_each(json_extract(new.data, '$.skills'))` to aggregate skill names/descriptions; Tests 6-8 pass |
| 11 | Migration does not run twice — PRAGMA user_version guard prevents re-execution | VERIFIED | `runMigrations()` reads `user_version`, only calls `migrateV1toV2` if `< 2`, sets `user_version = 2` inside transaction; Test 5 passes |
| 12 | Gateway POST /rpc accepts { card_id, skill_id } and routes to correct skill handler with skill-level pricing | VERIFIED | `server.ts:111` extracts `skillId`, lines 143-147 resolve skill from `v2card.skills`, uses `skill.pricing.credits_per_call` for escrow; Tests 1-5+8 pass (34/34 gateway+handler tests green) |

**Score:** 12/12 truths verified

---

## Required Artifacts

| Artifact | Min Lines | Actual Lines | Status | Details |
|----------|-----------|--------------|--------|---------|
| `src/runtime/agent-runtime.ts` | 80 | 157 | VERIFIED | Exports `AgentRuntime` class and `RuntimeOptions` interface; full lifecycle management |
| `src/runtime/agent-runtime.test.ts` | 60 | 255 | VERIFIED | 8 unit tests covering all lifecycle behaviors; all pass |
| `src/types/index.ts` | 100 | 163 | VERIFIED | Exports `SkillSchema`, `Skill`, `CapabilityCardV2Schema`, `CapabilityCardV2`, `AnyCardSchema`, `AnyCard` |
| `src/registry/store.ts` | 200 | 514 | VERIFIED | Exports `runMigrations()`; v1-to-v2 migration, FTS5 triggers, user_version guard all present |
| `src/types/index.test.ts` | 40 | (included in 34-test run) | VERIFIED | Schema validation tests for v1.0, v2.0, and AnyCard; 34/34 pass |
| `src/gateway/server.ts` | 200 | 275 | VERIFIED | skill_id routing with per-skill pricing; v1.0 backward compat |
| `src/skills/handle-request.ts` | 40 | 78 | VERIFIED | Exports `HandlerMap`, `createRequestHandler`; dispatch supports skill_id and card_id fallback |

---

## Key Link Verification

### Plan 01 Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli/index.ts` | `src/runtime/agent-runtime.ts` | `import AgentRuntime, call start()/shutdown()` | WIRED | Line 21 imports `AgentRuntime`; line 584 creates `new AgentRuntime(...)`, line 589 `await runtime.start()`, lines 611+646 `await runtime.shutdown()` |
| `src/runtime/agent-runtime.ts` | `src/credit/escrow.ts` | `releaseEscrow()` for orphaned escrow recovery | WIRED | Line 4 imports `releaseEscrow`; line 111 calls `releaseEscrow(this.creditDb, row.id)` inside `recoverOrphanedEscrows()` |

### Plan 02 Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/registry/store.ts` | `src/types/index.ts` | `import CapabilityCardV2Schema for migration` | WIRED | Pattern `CapabilityCardV2Schema` present in store.ts imports and used in migration |
| `src/registry/store.ts` | `cards_fts` | FTS5 triggers using `json_each` over `skills[]` | WIRED | `V2_FTS_TRIGGERS` constant uses `json_each(json_extract(..., '$.skills'))` in all three triggers (INSERT/UPDATE/DELETE) |
| `src/registry/request-log.ts` | `request_log` table | `skill_id` column added | WIRED | `ALTER TABLE request_log ADD COLUMN skill_id TEXT` executed in `createRequestLogTable()`; `insertRequestLog` includes `skill_id`; `getRequestLog` SELECT includes `skill_id` |

### Plan 03 Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/gateway/server.ts` | `src/types/index.ts` | `import CapabilityCardV2 for skill lookup` | WIRED | Line 9 `import type { CapabilityCardV2 } from '../types/index.js'`; used at line 144 to cast and access `v2card.skills` |
| `src/gateway/server.ts` | `src/registry/store.ts` | `getCard returns AnyCard, find skill in skills[]` | WIRED | `getCard(registryDb, cardId)` called; result cast and checked for `Array.isArray(rawCard['skills'])`; `v2card.skills.find(s => s.id === skillId)` at line 146 |
| `src/skills/handle-request.ts` | `skill_id` dispatch | Handler dispatch key changed from card_id to skill_id | WIRED | `const skillId = body.skill_id`; dispatch at lines 60-62: `(skillId ? handlers[skillId] : undefined) ?? (cardId ? handlers[cardId] : undefined)` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RUN-01 | 04-01 | AgentRuntime class owns all DB handles, background timers, and SIGTERM shutdown with orphaned escrow recovery | SATISFIED | `src/runtime/agent-runtime.ts` — full class with start/shutdown/registerJob/isDraining; CLI wired; 8 tests pass |
| RUN-02 | 04-02 | Multi-skill Capability Card schema v2.0 with `skills[]` array — one card per agent, multiple independently-priced skills | SATISFIED | `CapabilityCardV2Schema` in `src/types/index.ts` with `skills: z.array(SkillSchema).min(1)`; `AnyCardSchema` discriminated union; 34 schema tests pass |
| RUN-03 | 04-02 | SQLite v1→v2 card migration preserving existing cards, with FTS5 trigger update to index nested skill names/descriptions | SATISFIED | `runMigrations()` + `migrateV1toV2()` in `store.ts`; contentless FTS5 with `json_each` over `skills[]`; PRAGMA user_version guard; 35 store tests pass |
| RUN-04 | 04-03 | Gateway routing accepts `skill_id` for per-skill execution on multi-skill cards | SATISFIED | `src/gateway/server.ts` extracts `skill_id`, resolves skill, uses per-skill pricing; `src/skills/handle-request.ts` dispatches by skill_id first; 34 gateway tests pass |

No orphaned requirements — all four Phase 4 requirements appear in plan frontmatter and are satisfied.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODOs, FIXMEs, placeholder returns, or empty implementations found in any Phase 4 files.

---

## Human Verification Required

### 1. Live Server Startup and Graceful Shutdown

**Test:** Start `agentbnb serve --port 7700 --handler-url http://localhost:8080`, then send Ctrl+C (SIGINT).
**Expected:** Server starts without migration errors; "Shutting down..." message appears on Ctrl+C; process exits cleanly (exit code 0).
**Why human:** Cannot verify process lifecycle output or clean shutdown in automated tests without a live process.

### 2. Status Command Shows Migrated v2.0 Cards

**Test:** After running serve against a DB that has pre-existing v1.0 cards, run `agentbnb status`.
**Expected:** Cards show skills information (spec_version 2.0, skills[] array visible).
**Why human:** Requires a populated database and CLI output inspection.

---

## Summary

Phase 4 goal is fully achieved. All 12 observable truths verified from actual codebase evidence, not SUMMARY claims.

- **Plan 01 (RUN-01):** `AgentRuntime` class at `src/runtime/agent-runtime.ts` (157 lines) centralizes both DB handles, recovers orphaned escrows on `start()`, stops Cron jobs and closes DBs on `shutdown()`. CLI `serve` command wired to create/start/shutdown the runtime. 8/8 unit tests pass.

- **Plan 02 (RUN-02, RUN-03):** `CapabilityCardV2Schema` with `skills[]` array exported from `src/types/index.ts`. `runMigrations()` in `store.ts` performs atomic v1-to-v2 migration inside a single transaction, replaces FTS5 triggers with `json_each` aggregation over `skills[]`, and guards against double-run with PRAGMA `user_version = 2`. `request_log.skill_id` column added idempotently. 35/35 store tests pass.

- **Plan 03 (RUN-04):** Gateway extracts `skill_id` from params, resolves the matching skill from `v2card.skills[]`, uses per-skill `credits_per_call` for escrow, returns error -32602 for invalid `skill_id`, falls back to `skills[0]` when no `skill_id` provided (v1.0 compat). Handler dispatch tries `handlers[skill_id]` first, falls back to `handlers[card_id]`. 34/34 gateway+handler tests pass.

Backend test suite: 299/299 backend tests pass. 43 hub/React tests fail but are pre-existing failures unrelated to Phase 4 (jsdom environment issue, confirmed in Plan 01 and Plan 03 summaries).

---

_Verified: 2026-03-15T19:15:00Z_
_Verifier: Claude (gsd-verifier)_
