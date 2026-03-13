# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Fill the market gap for agent-to-agent capability exchange
**Current focus:** Phase 0 — Dogfood

## Current Phase

**Phase 0: Dogfood** — Prove the concept by sharing capabilities between 2 OpenClaw agents internally.

**Current Plan:** 5 of 5 (Phase 0)

### Progress

- Foundation (Plan 00): complete — TypeScript types, schema validation, AgentBnBError
- Registry (Plan 01): complete — SQLite registry, FTS5 search, owner isolation
- Credit System (Plan 02): complete — ledger, escrow hold/settle/release, 18 tests
- Gateway (Plan 03): complete — Fastify JSON-RPC gateway, auth, escrow flow, 15 tests
- CLI (Plan 04): complete — Commander CLI with 6 commands wired to real implementations, 17 tests
- OpenClaw Integration (Plan 05): not started

## Decisions Log

| Date | Phase-Plan | Decision |
|------|-----------|----------|
| 2026-03-13 | 00-01 | FTS5 query words wrapped in double-quotes to prevent hyphen/operator interpretation |
| 2026-03-13 | 00-01 | Store cards as JSON blob in data column — schemaless updates without migrations |
| 2026-03-13 | 00-01 | filterCards separate from searchCards for browse-without-query use case |
| 2026-03-13 | 00-02 | Idempotent bootstrap via INSERT OR IGNORE + result.changes check |
| 2026-03-13 | 00-02 | ESCROW_ALREADY_SETTLED error covers both settled and released terminal states |
| 2026-03-13 | 00-02 | INSERT OR IGNORE auto-creates recipient balance row in settleEscrow() |
| 2026-03-13 | 00-02 | pnpm.onlyBuiltDependencies needed for better-sqlite3 native binding in pnpm 10 |
| 2026-03-13 | 00-03 | Auth hook added to root Fastify instance (not plugin) — plugin scope encapsulation prevents hooks from applying to parent routes |
| 2026-03-13 | 00-03 | Requester identity from params.requester (not from token) — token is auth, requester is credit identity |
| 2026-03-13 | 00-03 | createGatewayServer() returns synchronously — Fastify queues plugin init; caller calls .ready() or .listen() |
| 2026-03-13 | 00-04 | AGENTBNB_DIR env var for config dir override — test isolation without mocking fs |
| 2026-03-13 | 00-04 | program.parseAsync instead of program.parse — required for top-level await async CLI actions |
| 2026-03-13 | 00-04 | status command queries credit_escrow table directly for held escrows — no separate API needed |

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 00-dogfood | 01 | 5min | 2 | 4 |
| 00-dogfood | 02 | 4min | 2 | 7 |
| 00-dogfood | 03 | 7min | 2 | 5 |
| 00-dogfood | 04 | 15min | 2 | 5 |

## Session Log

| Date | Stopped At | Resume With |
|------|-----------|-------------|
| 2026-03-13 | Project initialized | `/gsd:discuss-phase 0` or `/gsd:plan-phase 0` |
| 2026-03-13 | Completed 00-01-PLAN.md | Continue with plan 02 |
| 2026-03-13 | Completed 00-02-PLAN.md | Continue with plan 03 |
| 2026-03-13 | Completed 00-03-PLAN.md | Continue with plan 04 |
| 2026-03-13 | Completed 00-04-PLAN.md | Continue with plan 05 |

---
*Last updated: 2026-03-13 after 00-04 completion*
