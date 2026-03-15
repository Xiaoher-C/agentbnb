---
phase: 07-auto-request
plan: 01
subsystem: database
tags: [sqlite, pending-requests, autonomy, tiers, fastify, crud]

# Dependency graph
requires:
  - phase: 06-idle-rate-monitoring-auto-share
    provides: AutonomyEvent union and insertAuditEvent in tiers.ts
  - phase: 05-autonomy-tiers-credit-budgeting
    provides: AutonomyTier type and autonomy config
  - phase: 04-agent-runtime-multi-skill-foundation
    provides: openDatabase() with WAL mode and migration pattern
provides:
  - pending_requests SQLite table (created by openDatabase())
  - createPendingRequest / listPendingRequests / resolvePendingRequest CRUD functions
  - GET /me/pending-requests owner endpoint (Bearer auth)
  - POST /me/pending-requests/:id/approve owner endpoint
  - POST /me/pending-requests/:id/reject owner endpoint
  - auto_request_failed variant in AutonomyEvent union
affects: [07-02-auto-requestor, 08-openclaw-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - pending_requests table added in openDatabase() alongside capability_cards — single DB open initializes all tables
    - Owner routes registered as scoped Fastify plugin — auth hook applies only to owner endpoints
    - resolvePendingRequest throws AgentBnBError NOT_FOUND — server maps to 404

key-files:
  created:
    - src/autonomy/pending-requests.ts
    - src/autonomy/pending-requests.test.ts
  modified:
    - src/registry/store.ts
    - src/registry/server.ts
    - src/registry/server.test.ts
    - src/autonomy/tiers.ts

key-decisions:
  - "pending_requests CREATE TABLE placed in openDatabase() db.exec() block alongside capability_cards — consistent with existing table init pattern"
  - "resolvePendingRequest uses result.changes === 0 to detect missing id and throws AgentBnBError NOT_FOUND — server maps to 404 response"
  - "auto_request_failed inserted into AutonomyEvent union with AutonomyTier (not literal 1|2|3) — failure can occur at any tier"
  - "insertAuditEvent handles auto_request_failed via existing request-event branch — no special case needed since it shares card_id/credits/skill_id shape"

patterns-established:
  - "Pending queue pattern: create → list (pending only) → resolve (approved|rejected) — three-function CRUD lifecycle"
  - "TDD flow: write failing tests first, implement module, verify GREEN, commit atomically"

requirements-completed: [REQ-05, REQ-06]

# Metrics
duration: 12min
completed: 2026-03-15
---

# Phase 07 Plan 01: Tier 3 Approval Queue Infrastructure Summary

**SQLite pending_requests table with CRUD module, three owner REST endpoints, and auto_request_failed AutonomyEvent variant for Tier 3 auto-request failure logging**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-15T22:23:00Z
- **Completed:** 2026-03-15T22:35:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- pending_requests SQLite table created by openDatabase() — survives process restart via file-backed DB
- CRUD module (createPendingRequest, listPendingRequests, resolvePendingRequest) with AgentBnBError on missing id
- Three owner endpoints (GET list, POST approve, POST reject) with Bearer auth enforcement
- auto_request_failed added to AutonomyEvent union; insertAuditEvent handles it via existing request-event branch
- 9 CRUD unit tests + 9 server endpoint tests all pass (51 total tests, no regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: pending_requests table + CRUD module + AutonomyEvent extension** - `11c8755` (feat)
2. **Task 2: Owner API endpoints for pending requests** - `21455da` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks — tests written first (RED), then implementation (GREEN), single combined commit per task_

## Files Created/Modified

- `src/autonomy/pending-requests.ts` - PendingRequest interface + createPendingRequest / listPendingRequests / resolvePendingRequest CRUD
- `src/autonomy/pending-requests.test.ts` - 9 unit tests for CRUD behaviors + openDatabase table creation
- `src/registry/store.ts` - Added pending_requests CREATE TABLE IF NOT EXISTS block in openDatabase()
- `src/registry/server.ts` - Imported listPendingRequests/resolvePendingRequest; added GET/POST approve/reject routes
- `src/registry/server.test.ts` - Added createPendingRequest import + 9 tests for pending-requests endpoints
- `src/autonomy/tiers.ts` - Extended AutonomyEvent union with auto_request_failed variant

## Decisions Made

- pending_requests table placed in openDatabase() db.exec() block — consistent with how capability_cards is initialized; single DB open bootstraps all tables
- resolvePendingRequest uses `result.changes === 0` to detect nonexistent id, throws AgentBnBError NOT_FOUND — server handler maps to 404
- auto_request_failed uses `tier_invoked: AutonomyTier` (not literal 3) — failure can occur after tier classification at any level
- insertAuditEvent requires no changes for auto_request_failed — the existing cast paths (`event as { card_id: string }`) already handle the new variant correctly since it shares the request-event shape

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 07-02 (AutoRequestor class) can now import createPendingRequest for Tier 3 queueing
- auto_request_failed event type available for failure audit logging
- Owner can view and approve/reject pending requests via CLI or API calls

---
*Phase: 07-auto-request*
*Completed: 2026-03-15*

## Self-Check: PASSED

- FOUND: src/autonomy/pending-requests.ts
- FOUND: src/autonomy/pending-requests.test.ts
- FOUND: pending_requests table in src/registry/store.ts
- FOUND: pending-requests endpoints in src/registry/server.ts
- FOUND: auto_request_failed in src/autonomy/tiers.ts
- FOUND: commit 11c8755 (Task 1)
- FOUND: commit 21455da (Task 2)
- FOUND: .planning/phases/07-auto-request/07-01-SUMMARY.md
