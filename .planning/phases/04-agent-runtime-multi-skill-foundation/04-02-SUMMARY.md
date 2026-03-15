---
phase: 04-agent-runtime-multi-skill-foundation
plan: 02
subsystem: database
tags: [zod, sqlite, fts5, migration, schema, typescript]

# Dependency graph
requires:
  - phase: 03-hub-ux-layer
    provides: existing CapabilityCardSchema (v1.0), store.ts, request-log.ts

provides:
  - SkillSchema and CapabilityCardV2Schema (spec_version 2.0) exported from src/types/index.ts
  - AnyCardSchema discriminated union accepting v1.0 and v2.0 cards
  - runMigrations() in store.ts with PRAGMA user_version guard (v0->v2)
  - SQLite v1-to-v2 card migration (skills[] array wrapping original flat fields)
  - FTS5 triggers updated to aggregate json_each over skills[] array
  - request_log table extended with skill_id column (Phase 6 idle tracking prereq)

affects:
  - 04-03: gateway skill_id routing (reads CapabilityCardV2Schema and skill_id)
  - 05-idle-opportunity: uses skill_id in request_log for per-skill idle rate tracking
  - 06-budget-autonomy: reads v2.0 card shape for per-skill pricing

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PRAGMA user_version guard prevents migration double-run"
    - "Contentless FTS5 (content=\"\") with trigger-managed indexing avoids column resolution issues"
    - "FTS5 delete-all command clears contentless index before manual repopulation"
    - "json_each aggregation over skills[] in FTS triggers with COALESCE v1.0 fallback"
    - "ALTER TABLE ADD COLUMN inside try/catch for idempotent schema extension"
    - "Single db.transaction() wraps card migration + trigger replacement + index rebuild + user_version bump"

key-files:
  created:
    - src/types/index.test.ts (expanded with 10 new v2.0 schema validation tests)
  modified:
    - src/types/index.ts (added SkillSchema, CapabilityCardV2Schema, AnyCardSchema, Skill/CapabilityCardV2/AnyCard types)
    - src/registry/store.ts (added runMigrations, migrateV1toV2, switched FTS to contentless, v2.0 triggers)
    - src/registry/request-log.ts (added skill_id to RequestLogEntry, createRequestLogTable, insertRequestLog, getRequestLog)
    - src/registry/store.test.ts (added 8 migration tests + 2 request_log skill_id tests)

key-decisions:
  - "FTS5 uses content=\"\" (contentless) instead of content=capability_cards to avoid rebuild column resolution failure — SQLite would try SELECT name,description,tags FROM capability_cards during rebuild, which fails since those are not physical columns"
  - "FTS index rebuild during migration uses delete-all + manual re-insertion (not 'rebuild' command) because 'rebuild' is only valid for content= tables"
  - "Migration wraps card data update + trigger DROP/recreate + FTS clear/repopulate + user_version bump in single db.transaction() to prevent partial migration state"
  - "skill-{card.id} naming for migrated skill IDs is stable and readable — avoids new UUID breaking cached references"

patterns-established:
  - "runMigrations(db) called from openDatabase() after table/FTS creation — single entry point for all schema versioning"
  - "AnyCardSchema discriminated union on spec_version — use for parsing cards from external/SQLite sources"
  - "CapabilityCardSchema (v1.0) preserved unchanged — new code uses CapabilityCardV2Schema; AnyCardSchema for parsing both"

requirements-completed: [RUN-02, RUN-03]

# Metrics
duration: 11min
completed: 2026-03-15
---

# Phase 4 Plan 02: Multi-Skill Schema v2.0 + SQLite Migration Summary

**Zod CapabilityCardV2Schema with skills[] array, SQLite v1-to-v2 atomic migration, contentless FTS5 triggers using json_each aggregation, and skill_id column in request_log**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-15T10:31:21Z
- **Completed:** 2026-03-15T10:42:30Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4

## Accomplishments

- SkillSchema (per-skill unit) and CapabilityCardV2Schema (spec_version 2.0 with skills[] min 1) added to src/types/index.ts with full Zod validation
- AnyCardSchema discriminated union on spec_version accepts both v1.0 and v2.0 cards, rejects unknown versions
- runMigrations() atomically converts v1.0 SQLite cards to v2.0 skills[] shape, replaces FTS triggers with json_each aggregation, and sets PRAGMA user_version = 2 as idempotency guard
- request_log table extended with skill_id TEXT column for Phase 6 per-skill idle rate tracking

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SkillSchema + CapabilityCardV2Schema + AnyCardSchema to types** - `69f384e` (feat)
2. **Task 2: SQLite v1-to-v2 migration + FTS5 trigger update + request_log skill_id** - `e5853e8` (feat)

## Files Created/Modified

- `src/types/index.ts` - Added SkillSchema, CapabilityCardV2Schema, AnyCardSchema, Skill/CapabilityCardV2/AnyCard types (after existing v1.0 schema, no modifications to CapabilityCardSchema)
- `src/types/index.test.ts` - Added 10 new schema validation tests (SkillSchema, CapabilityCardV2Schema, AnyCardSchema) in addition to all 24 original v1.0 tests
- `src/registry/store.ts` - Added runMigrations(), migrateV1toV2(), V2_FTS_TRIGGERS constant; switched FTS virtual table to contentless (content=""); moved trigger installation entirely into runMigrations
- `src/registry/request-log.ts` - Added skill_id? field to RequestLogEntry interface; updated createRequestLogTable (ALTER TABLE ADD COLUMN idempotent), insertRequestLog, getRequestLog
- `src/registry/store.test.ts` - Added 10 migration + request_log tests (8 migration correctness tests + 2 skill_id tests)

## Decisions Made

- Used contentless FTS5 (content="") instead of content=capability_cards because SQLite tries to SELECT physical columns (name, description, tags) from capability_cards during rebuild — these columns don't exist in the base table. Contentless FTS avoids this.
- Used `INSERT INTO cards_fts(cards_fts) VALUES('delete-all')` for clearing the FTS index during migration, not `DELETE FROM cards_fts` (blocked on contentless tables) and not `rebuild` (only for content= tables).
- All migration steps run inside one db.transaction(): card data update + trigger DROP/recreate + FTS clear + manual FTS repopulation + user_version = 2 bump. Splitting into multiple transactions risks stale FTS rows if process crashes between steps.
- skill_id for migrated v1.0 cards is `skill-{card.id}` — derived, stable, readable. A new UUID would break any clients that cached a skill reference.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Switched FTS5 from content=capability_cards to contentless (content="")**
- **Found during:** Task 2 (SQLite migration)
- **Issue:** Plan specified `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')` for FTS index rebuild, but SQLite throws `no such column: T.name` because the FTS columns (name, description, tags) are not physical columns in capability_cards — they're populated by triggers. The `content=capability_cards` directive makes SQLite try `SELECT name, description, tags FROM capability_cards` during rebuild, which fails.
- **Fix:** Changed FTS virtual table definition to `content=""` (contentless). Replaced `rebuild` with `delete-all` + manual row-by-row repopulation from current card JSON data.
- **Files modified:** src/registry/store.ts
- **Verification:** All 35 store tests pass including FTS search tests after migration
- **Committed in:** e5853e8 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in FTS rebuild approach)
**Impact on plan:** Fix was necessary for correctness. The contentless FTS approach still satisfies all plan requirements: FTS search via json_each over skills[], rowid JOIN in matcher.ts still works, index is rebuilt after migration. No scope creep.

## Issues Encountered

- FTS5 `content=capability_cards` + `rebuild` command incompatible with trigger-managed FTS (columns must exist as physical columns in the content table). Resolved by switching to contentless FTS with manual index management.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CapabilityCardV2Schema and AnyCardSchema ready for Plan 03 (gateway skill_id routing)
- request_log.skill_id column in place for Phase 6 idle rate tracking
- All 266 backend tests green; no regressions to existing card CRUD, search, or request logging
- Confirmed blocker from STATE.md ("FTS5 trigger syntax for json_each() over skills[] arrays needs verification") resolved — json_each works correctly with contentless FTS

---
*Phase: 04-agent-runtime-multi-skill-foundation*
*Completed: 2026-03-15*
