---
title: Test Coverage Map
domain: testing
status: complete
tags: [testing, coverage, verification]
last_verified: 2026-03-17
---

# Test Coverage Map

> [!summary]
> 302+ tests across 22 suites. All passing. But shared in-memory DB masks P2P credit gap.

## Test Suites by Domain

### Gateway
- `gateway/server.test.ts` — Server start/stop, health endpoint, auth rejection
- `gateway/client.test.ts` — Outbound request formatting, error handling
- `gateway/auth.test.ts` — Token validation, rejection of invalid tokens

### Credit
- `credit/ledger.test.ts` — Balance CRUD, transaction history, bootstrap grant
- `credit/escrow.test.ts` — Hold/settle/release, insufficient balance, double-settle prevention
- `credit/budget.test.ts` — Reserve floor, canSpend() logic, zero-cost bypass

### Registry
- `registry/store.test.ts` — Card CRUD, FTS5 search, v1→v2 migration
- `registry/matcher.test.ts` — Query matching, level filtering
- `registry/request-log.test.ts` — Request logging, audit events

### Autonomy
- `autonomy/tiers.test.ts` — Tier 1/2/3 threshold logic, default Tier 3
- `autonomy/idle-monitor.test.ts` — Sliding window, auto-share trigger, v1.0 card skip
- `autonomy/auto-request.test.ts` — Peer scoring, self-exclusion, budget gate
- `autonomy/pending-requests.test.ts` — Approval queue CRUD

### OpenClaw
- `openclaw/soul-sync.test.ts` — SOUL.md parsing, multi-skill card generation
- `openclaw/heartbeat-writer.test.ts` — Rules block generation
- `openclaw/skill.test.ts` — Status info

### CLI
- `cli/index.test.ts` — Command wiring, --help output
- `cli/onboarding.test.ts` — API key detection, draft card generation

### Hub
- `hub/src/**/*.test.ts` — 64 tests for components, hooks, pages

## What Tests DON'T Cover

> [!warning]
> These are blind spots in the test suite.

| Gap | Why It Matters |
|-----|---------------|
| **Cross-machine credit verification** | Tests use shared in-memory DB. Real P2P = separate DBs = credit check fails |
| **Real handler execution** | No handler tests because no handler exists |
| **Remote registry push** | Only pull (fetchRemoteCards) is tested |
| **mDNS across machines** | LAN-only, untestable in CI |
| **Concurrent escrow operations** | No multi-threaded stress tests |
| **Hub E2E (browser)** | No Playwright/Cypress tests |

## E2E Verification (2026-03-17)

Manual two-agent test on local machine:

| Step | Result |
|------|--------|
| Agent A init + publish + serve | ✅ |
| Agent B init + discover + connect | ✅ |
| Agent B request → Agent A (auth) | ✅ |
| Agent B request → Agent A (credit) | ❌ Provider can't see requester balance |
| Agent B request → Agent A (handler) | ❌ No handler on 8080 |
| Escrow release on failure | ✅ |
