---
phase: 00-dogfood
plan: 01
subsystem: registry
tags: [sqlite, fts5, zod, crud, search, tdd]
dependency_graph:
  requires: []
  provides: [capability-card-schema, registry-store, fts5-search]
  affects: [gateway, credit, cli]
tech_stack:
  added: [better-sqlite3, zod]
  patterns: [FTS5-virtual-table, BM25-ranking, owner-isolation, WAL-mode]
key_files:
  created:
    - src/registry/store.ts
    - src/registry/matcher.ts
    - src/registry/store.test.ts
  modified:
    - src/types/index.test.ts
key_decisions:
  - "FTS5 query words wrapped in double-quotes to prevent hyphen/operator interpretation"
  - "Store cards as JSON blob in data column — enables schemaless updates without migrations"
  - "BM25 ranking via ORDER BY bm25(cards_fts) ascending (SQLite FTS5 returns negative scores)"
  - "filterCards as separate function from searchCards for browse-without-query use case"
metrics:
  duration_minutes: 5
  completed_date: "2026-03-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 0 Plan 01: Capability Card Registry Summary

**One-liner:** SQLite registry with FTS5 BM25 search, Zod-validated CRUD, and owner-isolated capability card storage for AgentBnB.

## What Was Built

### Task 1: Schema validation tests + SQLite registry store

Extended `src/types/index.test.ts` with 4 new test cases:
- L3 Environment card validates successfully with full metadata, cron schedule, and multiple I/O
- Missing `id` field is rejected
- Non-UUID `id` value is rejected
- Negative `credits_per_call` is rejected

Created `src/registry/store.ts` implementing:
- `openDatabase(path?)` — opens SQLite in WAL mode with FK constraints, runs migration creating `capability_cards` table and `cards_fts` FTS5 virtual table with AFTER INSERT/UPDATE/DELETE triggers
- `insertCard(db, card)` — Zod-validates, sets `created_at`/`updated_at`, inserts with JSON blob
- `getCard(db, id)` — returns parsed `CapabilityCard | null`
- `updateCard(db, id, owner, updates)` — verifies owner, merges + re-validates, updates row
- `deleteCard(db, id, owner)` — verifies owner, removes row
- `listCards(db, owner?)` — returns all or owner-filtered cards

Created `src/registry/store.test.ts` with 11 CRUD + FTS5 integrity tests.

### Task 2: FTS5 search matcher with filters

Created `src/registry/matcher.ts` implementing:
- `searchCards(db, query, filters?)` — FTS5 MATCH with BM25 ordering, level/online/apis_used filters, 50-result cap, quoted word tokens to prevent operator misinterpretation
- `filterCards(db, filters)` — structured filter for level and online status without text query, using JSON extract predicates

Added 9 matcher tests in `store.test.ts` covering: TTS search accuracy, level filtering, online filtering, BM25 ordering, empty query handling, <50ms performance for 100 cards, and filterCards variants.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FTS5 MATCH failed on hyphenated query strings**
- **Found during:** Task 2 (GREEN phase — test for empty results with `xyzzy-nonexistent-query-12345`)
- **Issue:** FTS5 interpreted `-` in query strings as the NOT operator, causing `SqliteError: no such column: nonexistent`
- **Fix:** Wrapped each query word in double-quotes before passing to MATCH (`"word1" OR "word2"`), treating hyphens and other special chars as literals
- **Files modified:** `src/registry/matcher.ts`
- **Commit:** b2c64fe

## Verification

All verification criteria met:
- `pnpm test:run` — 46 tests pass across 3 test files (8 schema, 20 registry/matcher, 18 credit)
- `pnpm typecheck` — zero TypeScript errors
- FTS5 integrity check included in test suite (`INSERT INTO cards_fts(cards_fts) VALUES('integrity-check')`)

## Commits

| Hash | Type | Description |
|------|------|-------------|
| d5aecce | test | Add failing tests for schema validation and store CRUD (RED) |
| b8b3443 | feat | Implement SQLite registry store with FTS5 triggers and owner isolation (GREEN) |
| 124a482 | test | Add failing tests for FTS5 matcher searchCards and filterCards (RED) |
| b2c64fe | feat | Implement FTS5 search matcher with BM25 ranking and filters (GREEN) |

## Self-Check: PASSED
