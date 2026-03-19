---
phase: 37-job-queue
plan: 01
subsystem: hub-agent
tags: [job-queue, relay-bridge, sqlite, escrow, websocket]
dependency_graph:
  requires: [36-hub-agent-core, 30-relay-registration]
  provides: [hub-agent-job-queue, relay-bridge-auto-dispatch, job-status-api]
  affects: [hub-agent/executor, relay/websocket-relay, relay/types, registry/server]
tech_stack:
  added: []
  patterns: [sqlite-job-queue, relay-bridge-callback, pending-request-routing]
key_files:
  created:
    - src/hub-agent/job-queue.ts
    - src/hub-agent/job-queue.test.ts
    - src/hub-agent/relay-bridge.ts
    - src/hub-agent/relay-bridge.test.ts
  modified:
    - src/hub-agent/executor.ts
    - src/hub-agent/executor.test.ts
    - src/hub-agent/routes.ts
    - src/hub-agent/types.ts
    - src/relay/websocket-relay.ts
    - src/relay/types.ts
    - src/registry/server.ts
decisions:
  - "relay_owner added to queue mode config schema -- queue jobs need a target agent for dispatch"
  - "Job relay responses detected via jobId on PendingRelayRequest -- reuses existing relay response flow"
  - "Bridge wired via setOnAgentOnline callback -- no modifications to relay core message handling"
  - "Job dispatch timeout matches relay timeout (300s) for consistency"
metrics:
  duration_seconds: 457
  completed: "2026-03-19T08:47:09Z"
  tests_added: 16
  tests_total: 1001
---

# Phase 37 Plan 01: SQLite Job Queue + Relay Bridge Summary

SQLite-backed job queue for Hub Agent offline relay requests with auto-dispatch on agent reconnect via relay bridge callback pattern.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Job Queue SQLite store + Executor relay/queue modes | 2f48666 | job-queue.ts, executor.ts, types.ts |
| 2 | Relay Bridge auto-dispatch + Job Status API routes | 5476d5c | relay-bridge.ts, routes.ts, websocket-relay.ts, types.ts |

## What Was Built

### Job Queue (job-queue.ts)
- `initJobQueue(db)` creates `hub_agent_jobs` table with 11 columns
- `insertJob()` creates jobs with status 'queued', returns full Job object
- `getJob()` / `listJobs()` for retrieval with optional status filter
- `updateJobStatus()` transitions status with optional result
- `getJobsByRelayOwner()` finds queued jobs for a specific relay target

### Executor Updates (executor.ts)
- **Relay mode**: Checks if target agent is online via card availability. If offline, queues the job with credit escrow hold.
- **Queue mode**: Always queues the job (requires `relay_owner` in config).
- `isRelayOwnerOnline()` helper queries capability_cards for online status.

### Relay Bridge (relay-bridge.ts)
- `createRelayBridge()` returns `{ onAgentOnline }` callback
- On agent reconnect: finds queued jobs, updates to 'dispatched', forwards via WebSocket
- `handleJobRelayResponse()`: settles escrow on success, releases on failure
- 5-minute timeout per dispatched job (matches relay RELAY_TIMEOUT_MS)

### Relay Integration
- `PendingRelayRequest` extended with optional `jobId` field
- `RelayState` extended with `setOnAgentOnline`, `getConnections`, `getPendingRequests`, `sendMessage`
- `handleRelayResponse()` detects job-dispatched requests and delegates to `handleJobRelayResponse`
- `handleRegister()` invokes `onAgentOnline` callback after marking owner online
- Bridge wired in registry server.ts via callback (no relay core modification)

### Job Status API (routes.ts)
- `GET /api/hub-agents/:id/jobs` - list jobs with optional `?status=` filter
- `GET /api/hub-agents/:id/jobs/:jobId` - get single job or 404

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **relay_owner in queue config**: Added `relay_owner` to queue mode's Zod schema so queue jobs know which agent to dispatch to on reconnect.
2. **jobId on PendingRelayRequest**: Reuses relay's existing pending request and response handling. When relay sees `jobId` on a pending request, it delegates to `handleJobRelayResponse` instead of normal settle/release flow.
3. **Callback pattern for bridge**: The bridge uses `setOnAgentOnline` callback rather than modifying relay message handling directly. Clean separation of concerns.
4. **Consistent timeout**: Job dispatch timeout (300s) matches the relay's `RELAY_TIMEOUT_MS` for consistent behavior.

## Test Results

- 16 new tests (11 job queue + 5 relay bridge)
- 1001 total tests passing across 74 test files
- All existing relay tests (39) continue to pass

## Self-Check: PASSED
