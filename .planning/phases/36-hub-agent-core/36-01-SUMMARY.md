---
phase: 36-hub-agent-core
plan: 01
subsystem: api
tags: [hub-agent, aes-256-gcm, ed25519, sqlite, fastify, crud]

# Dependency graph
requires:
  - phase: 30-fix-upstream
    provides: AnyCardSchema + raw SQL card insertion pattern
  - phase: 27-registry-credit-endpoints
    provides: bootstrapAgent, creditRoutesPlugin pattern
provides:
  - Hub Agent types (HubAgent, SkillRoute, CreateAgentRequest) with Zod schemas
  - AES-256-GCM encrypt/decrypt for API key storage at rest
  - SQLite CRUD store for hub_agents table
  - 5 REST endpoints at /api/hub-agents for agent lifecycle management
  - Auto-published v2.0 CapabilityCard per Hub Agent
affects: [36-02-hub-agent-execution, 37-job-queue, 39-hub-agent-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [AES-256-GCM via HUB_MASTER_KEY env var, hub_agents SQLite table, /api/hub-agents prefix]

key-files:
  created:
    - src/hub-agent/types.ts
    - src/hub-agent/crypto.ts
    - src/hub-agent/crypto.test.ts
    - src/hub-agent/store.ts
    - src/hub-agent/store.test.ts
    - src/hub-agent/routes.ts
    - src/hub-agent/routes.test.ts
  modified:
    - src/registry/server.ts

key-decisions:
  - "Route prefix /api/hub-agents (not /api/agents) to avoid collision with existing agent profiles endpoint"
  - "Hub Agent owner_public_key set to 'hub-server' placeholder — server-managed agents don't need external identity auth"
  - "Card ID derived deterministically from agent_id via padding + UUID formatting"

patterns-established:
  - "AES-256-GCM encrypt/decrypt pattern: iv:authTag:ciphertext hex format, 32-byte master key from HUB_MASTER_KEY env var"
  - "Hub Agent routes as Fastify plugin registered alongside creditRoutesPlugin"

requirements-completed: [HUB-AGENT-01, HUB-AGENT-02]

# Metrics
duration: 7min
completed: 2026-03-19
---

# Phase 36 Plan 01: Hub Agent Core Summary

**Hub Agent CRUD with AES-256-GCM encrypted secrets, Ed25519 identity, 50cr bootstrap, and auto-published v2.0 CapabilityCard**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-19T08:12:33Z
- **Completed:** 2026-03-19T08:19:59Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Hub Agent types with Zod schemas (HubAgent, SkillRoute, CreateAgentRequest)
- AES-256-GCM encrypt/decrypt with HUB_MASTER_KEY env var for API key storage
- SQLite CRUD (create/get/list/update/delete) with encrypted private keys and secrets
- 5 REST endpoints at /api/hub-agents with Swagger tags
- Auto-publishes v2.0 CapabilityCard on agent creation, updates on skill_routes change, deletes on agent removal
- 50 credit bootstrap per new Hub Agent
- 36 new tests passing, 970 total tests passing (zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Hub Agent types, crypto, and SQLite store** - `8b38280` (feat)
2. **Task 2: Hub Agent CRUD API routes and server wiring** - `5c0eda8` (feat)

## Files Created/Modified
- `src/hub-agent/types.ts` - HubAgent, SkillRoute, CreateAgentRequest Zod schemas and TS types
- `src/hub-agent/crypto.ts` - AES-256-GCM encrypt/decrypt with HUB_MASTER_KEY env var
- `src/hub-agent/crypto.test.ts` - 8 crypto tests (round-trip, wrong key, env var validation)
- `src/hub-agent/store.ts` - SQLite CRUD for hub_agents table with encrypted secret storage
- `src/hub-agent/store.test.ts` - 17 store tests (CRUD operations, encryption, idempotency)
- `src/hub-agent/routes.ts` - Fastify plugin with 5 CRUD endpoints at /api/hub-agents
- `src/hub-agent/routes.test.ts` - 11 route tests (happy path + error cases for all endpoints)
- `src/registry/server.ts` - Wired hubAgentRoutesPlugin into registry server

## Decisions Made
- Route prefix `/api/hub-agents` instead of `/api/agents` to avoid collision with existing agent profiles endpoint (GET /api/agents already exists for reputation-sorted agent listing)
- Hub Agent `owner_public_key` set to `'hub-server'` placeholder since server-managed agents don't need external Ed25519 auth
- Card ID derived deterministically from agent_id via padding and UUID formatting for consistent lookup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Changed route prefix from /api/agents to /api/hub-agents**
- **Found during:** Task 2 (API routes)
- **Issue:** Existing server already has GET /api/agents for agent profiles — Fastify throws FST_ERR_DUPLICATED_ROUTE
- **Fix:** Changed all 5 endpoints from /api/agents to /api/hub-agents prefix
- **Files modified:** src/hub-agent/routes.ts, src/hub-agent/routes.test.ts
- **Verification:** Full suite passes (970 tests, 71 files)
- **Committed in:** 5c0eda8

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Route prefix change is cosmetic — all functionality identical. No scope creep.

## Issues Encountered
None beyond the route prefix collision documented above.

## User Setup Required
- `HUB_MASTER_KEY` environment variable must be set (64-character hex string = 32 bytes) for Hub Agent secret encryption. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Next Phase Readiness
- Hub Agent CRUD complete, ready for Plan 02 (skill execution via ApiExecutor + credit escrow)
- All types and store functions exported for consumption by execution layer

---
*Phase: 36-hub-agent-core*
*Completed: 2026-03-19*
