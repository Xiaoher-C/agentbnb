---
phase: 02-cold-start
verified: 2026-03-14T01:20:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Start server and curl registry endpoints"
    expected: "agentbnb serve starts both gateway (7700) and registry (7701); curl /health returns ok; curl /cards returns paginated JSON; CORS headers present"
    why_human: "Requires running the full server process and making live HTTP requests"
  - test: "Verify --registry-port 0 disables registry"
    expected: "agentbnb serve --registry-port 0 only shows gateway line, no registry line"
    why_human: "Requires running the server and observing stdout"
---

# Phase 2: Cold Start Verification Report

**Phase Goal:** Grow from dogfood to 10+ active agent owners with a public web registry and reputation system.
**Verified:** 2026-03-14T01:20:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | updateReputation() updates success_rate and avg_latency_ms using EWA (alpha=0.1) | VERIFIED | `src/registry/store.ts:237-278` -- ALPHA=0.1, EWA formula correct, rounds to 3dp/nearest int |
| 2 | Gateway calls updateReputation() after every capability.execute | VERIFIED | `src/gateway/server.ts:169,179,185` -- called on failure (line 169), success (line 179), and catch/timeout (line 185) |
| 3 | First execution bootstraps reputation from undefined to concrete value | VERIFIED | `src/registry/store.ts:252-260` -- undefined check with direct assignment on first call |
| 4 | External HTTP clients can GET /cards and receive paginated JSON | VERIFIED | `src/registry/server.ts:70-143` -- returns `{total, limit, offset, items}` |
| 5 | GET /cards supports all filters (q, level, online, tag, min_success_rate, max_latency_ms, sort, limit, offset) | VERIFIED | `src/registry/server.ts:70-143` -- all query params parsed and applied |
| 6 | CORS headers present on all registry responses | VERIFIED | `src/registry/server.ts:47` -- `cors({ origin: true })` registered; test 16 verifies header |
| 7 | CLI `agentbnb serve` starts both gateway and registry sharing same DB | VERIFIED | `src/cli/index.ts:383,429-432` -- `--registry-port` option defaults to 7701, `createRegistryServer({ registryDb })` shares gateway's DB instance |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/registry/store.ts` | updateReputation() with EWA | VERIFIED | 301 lines, exports updateReputation, function at line 237, correct algorithm |
| `src/registry/server.ts` | Public Fastify registry server with CORS | VERIFIED | 162 lines (>80 min), exports createRegistryServer and RegistryServerOptions |
| `src/registry/server.test.ts` | Tests for registry endpoints | VERIFIED | 394 lines (>100 min), 16 test cases covering all filters, pagination, CORS |
| `src/gateway/server.ts` | Reputation instrumentation after settle/release | VERIFIED | 197 lines, imports and calls updateReputation on all 3 code paths |
| `src/cli/index.ts` | Extended serve command with --registry-port | VERIFIED | Line 383: `--registry-port` option, line 429-432: conditional registry startup |
| `.planning/REQUIREMENTS.md` | R-013, R-014, R-015 definitions | VERIFIED | Lines 138, 158, 175: all three requirements with acceptance criteria |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/gateway/server.ts` | `src/registry/store.ts` | `import { getCard, updateReputation }` | WIRED | Line 3: imported; lines 169,179,185: called with registryDb |
| `src/gateway/server.ts` | escrow functions | calls updateReputation after settle/release | WIRED | Line 178: after settleEscrow; lines 168,184: after releaseEscrow |
| `src/registry/server.ts` | `src/registry/store.ts` | `import { getCard }` | WIRED | Line 4: imported; line 152: used in GET /cards/:id |
| `src/registry/server.ts` | `src/registry/matcher.ts` | `import { searchCards, filterCards }` | WIRED | Line 5: imported; lines 97,99: used in GET /cards |
| `src/registry/server.ts` | `@fastify/cors` | `server.register(cors)` | WIRED | Line 2: imported; line 47: registered |
| `src/cli/index.ts` | `src/registry/server.ts` | `import { createRegistryServer }` | WIRED | Line 18: imported; line 430: called in serve action |
| `src/cli/index.ts` | `src/gateway/server.ts` | `import { createGatewayServer }` | WIRED | Line 17: imported; line 397: called in serve action |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| R-013 | 02-02, 02-03 | Web-Based Registry | SATISFIED | GET /health, GET /cards (paginated, FTS5, filters), GET /cards/:id, CORS, read-only, port 7701 default |
| R-014 | 02-01 | Reputation System | SATISFIED | updateReputation() with EWA alpha=0.1, gateway auto-records on all paths, persists in SQLite, preserves existing metadata |
| R-015 | 02-02 | Capability Card Marketplace | SATISFIED | Pagination (limit/offset/total), tag filtering, reputation filtering, sort by success_rate/latency, unrated cards sort last |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No anti-patterns detected in any Phase 2 files |

No TODOs, FIXMEs, placeholders, empty implementations, or console.log-only handlers found in any of the key files.

### Automated Verification

| Check | Result |
|-------|--------|
| `pnpm test:run` | 136/136 tests passed (9 test files) |
| `pnpm typecheck` | Clean -- no type errors |
| Store tests (updateReputation) | 6 reputation tests pass in store.test.ts |
| Server tests (registry endpoints) | 16 tests pass in server.test.ts |
| Gateway tests (reputation tracking) | Reputation tracking test suite passes in server.test.ts |
| CLI tests (--registry-port) | 2 tests verify --registry-port option in index.test.ts |

### Human Verification Required

### 1. End-to-End Server Startup

**Test:** Run `agentbnb serve --handler-url http://localhost:8080` and verify both servers start
**Expected:** Console output shows both "Gateway running on port 7700" and "Registry API: http://0.0.0.0:7701/cards"
**Why human:** Requires running the full server process and observing stdout

### 2. Registry HTTP Endpoints

**Test:** While server is running, `curl http://localhost:7701/health` and `curl http://localhost:7701/cards`
**Expected:** Health returns `{"status":"ok"}`; cards returns `{"total":0,"limit":20,"offset":0,"items":[]}`
**Why human:** Requires live HTTP requests to a running server

### 3. CORS Headers in Browser Context

**Test:** Check `curl -I http://localhost:7701/cards` for `access-control-allow-origin` header
**Expected:** Header present with permissive value
**Why human:** Best verified with actual browser or curl against running server

### 4. Registry Port Disable

**Test:** Run `agentbnb serve --registry-port 0`
**Expected:** Only gateway starts, no registry line in output
**Why human:** Requires running server and observing behavior

### Gaps Summary

No gaps found. All three requirements (R-013, R-014, R-015) are fully implemented and tested:

- **Reputation system** (R-014): `updateReputation()` correctly implements EWA with alpha=0.1 for both success_rate and avg_latency_ms. The gateway server calls it on all three execution paths (success, failure, timeout). First execution bootstraps from undefined. Existing metadata is preserved.

- **Web-based registry** (R-013): `createRegistryServer()` provides a separate Fastify server with CORS, GET /health, GET /cards (paginated with FTS5 search and all required filters), and GET /cards/:id. Read-only with no auth required.

- **Marketplace** (R-015): Pagination, tag filtering, reputation filtering (min_success_rate, max_latency_ms), and reputation-aware sorting (success_rate desc, latency asc) are all implemented. Unrated cards sort last.

- **CLI integration**: The `serve` command starts both servers sharing the same database, with `--registry-port` defaulting to 7701 and supporting disable via 0. Graceful shutdown handles both servers.

**Note:** ROADMAP.md shows plan 02-03 as `[ ]` (unchecked) but the implementation and summary both exist. This is a minor bookkeeping issue, not a code gap.

---

_Verified: 2026-03-14T01:20:00Z_
_Verifier: Claude (gsd-verifier)_
