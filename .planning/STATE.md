---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_plan: 2 of 4 (Phase 2) — complete
status: in_progress
last_updated: "2026-03-14T00:54:31Z"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 13
  completed_plans: 11
---

# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Fill the market gap for agent-to-agent capability exchange
**Current focus:** Phase 2 — Cold Start (web registry, reputation, marketplace)

## Current Phase

**Phase 2: Cold Start** — Build the web-accessible registry, reputation system, and marketplace features.

**Current Plan:** 2 of 4 (Phase 2) — complete

### Progress (Phase 2)

- Reputation Foundation (Plan 01): complete — updateReputation() EWA algorithm in registry store, gateway instrumentation, 133 tests
- Public Registry Server (Plan 02): complete — Fastify HTTP server with GET /health, GET /cards (FTS5 + 6 filters + sort + pagination + CORS), GET /cards/:id, 16 tests

### Progress (Phase 1 — complete)

- npm Package Foundation (Plan 01): complete — schema v1.0, package.json for publish, tsup build pipeline, 99 tests
- mDNS Discovery (Plan 02): complete — bonjour-service announce/browse/cleanup, 4 tests, loopback verified, 99 tests
- Peer Management + mDNS CLI (Plan 03): complete — peers.json CRUD, connect/peers/request --peer/serve --announce/discover --local, 107 tests
- Examples + README (Plan 04): complete — LAN IP detection, README 297 lines, two-agent demo scripts, human-verified

### Phase 0 Progress (complete)

- Foundation (Plan 00): complete — TypeScript types, schema validation, AgentBnBError
- Registry (Plan 01): complete — SQLite registry, FTS5 search, owner isolation
- Credit System (Plan 02): complete — ledger, escrow hold/settle/release, 18 tests
- Gateway (Plan 03): complete — Fastify JSON-RPC gateway, auth, escrow flow, 15 tests
- CLI (Plan 04): complete — Commander CLI with 6 commands wired to real implementations, 17 tests
- OpenClaw Integration (Plan 05): complete — SOUL.md parser, request handler, 13 E2E tests, human-verified

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
| 2026-03-13 | 00-05 | SOUL.md parser uses regex (no markdown library) — avoids new dependencies per plan spec |
| 2026-03-13 | 00-05 | parseSoulMd defaults to level 2 Pipeline — per RESEARCH.md open question resolution |
| 2026-03-13 | 00-05 | createRequestHandler returns raw handler result — gateway JSON-RPC layer wraps in { result }, no double-wrapping |
| 2026-03-13 | 01-01 | tsup array config isolates shebang banner to CLI entry — universal banner causes double-shebang and SyntaxError |
| 2026-03-13 | 01-01 | createRequire used for package.json version in ESM CLI — idiomatic pattern, resolveJsonModule already enabled |
| 2026-03-13 | 01-01 | exports types condition placed first per publint requirement — conditions are order-sensitive for TypeScript resolution |
| 2026-03-13 | 01-02 | Browse before announce in tests — browser must be listening before publication or initial query cycle misses the service |
| 2026-03-13 | 01-02 | Module-level Bonjour singleton lazy-initialized to avoid multiple instances on the same multicast socket |
| 2026-03-13 | 01-02 | IPv4 preference via addresses.filter(addr => !addr.includes(':')) — avoids link-local IPv6 noise |
| 2026-03-13 | 01-03 | peers.json in getConfigDir() — consistent path, AGENTBNB_DIR test isolation works automatically |
| 2026-03-13 | 01-03 | Case-insensitive peer name matching via toLowerCase() — prevents duplicates from case typos |
| 2026-03-13 | 01-03 | discover --local overrides registry search — simpler UX, mDNS and registry serve different contexts |
| 2026-03-13 | 01-03 | stopAnnouncement() before server.close() in gracefulShutdown — proper mDNS cleanup order |
| 2026-03-14 | 01-04 | getLanIp() falls back to localhost if no non-internal IPv4 interface found |
| 2026-03-14 | 01-04 | init --host flag allows manual IP override for edge cases (VPN, multiple interfaces) |
| 2026-03-14 | 01-04 | demo.sh uses AGENTBNB_DIR isolation with trap/cleanup for temp dirs |
| 2026-03-14 | 01-04 | README includes OpenSpec SDD section as process adoption, not runtime dependency |
| 2026-03-14 | 02-01 | EWA alpha=0.1 gives 90% weight to history, smoothing single outlier results |
| 2026-03-14 | 02-01 | Bootstrap uses observed value as prior — first execution sets concrete reputation rather than guessing |
| 2026-03-14 | 02-01 | success_rate rounded to 3 decimal places; avg_latency_ms to integer — precision appropriate for display |
| 2026-03-14 | 02-01 | Silent no-op for non-existent cardId in updateReputation() — gateway must not crash if card deleted mid-execution |
| 2026-03-14 | 02-01 | startMs timer placed before fetch() to capture full round-trip latency in avg_latency_ms |
| 2026-03-14 | 02-02 | origin: true in @fastify/cors allows all origins — public marketplace registry needs no restrictions |
| 2026-03-14 | 02-02 | Limit capped at 100 server-side to prevent large payload abuse |
| 2026-03-14 | 02-02 | Post-filter chaining for tag/success_rate/latency keeps SQL simple and preserves FTS5 BM25 ranking |
| 2026-03-14 | 02-02 | Sort undefined values last: success_rate treats missing as -1, latency treats missing as Infinity |

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 00-dogfood | 01 | 5min | 2 | 4 |
| 00-dogfood | 02 | 4min | 2 | 7 |
| 00-dogfood | 03 | 7min | 2 | 5 |
| 00-dogfood | 04 | 15min | 2 | 5 |
| 00-dogfood | 05 | 5min | 1 | 3 |
| 01-cli-mvp | 01 | 8min | 2 | 5 |
| 01-cli-mvp | 02 | 3min | 1 | 5 |
| 01-cli-mvp | 03 | 3min | 2 | 4 |
| 01-cli-mvp | 04 | 10min | 2 | 6 |
| 02-cold-start | 01 | 8min | 2 | 4 |
| 02-cold-start | 02 | 15min | 2 | 5 |

## Session Log

| Date | Stopped At | Resume With |
|------|-----------|-------------|
| 2026-03-13 | Project initialized | `/gsd:discuss-phase 0` or `/gsd:plan-phase 0` |
| 2026-03-13 | Completed 00-01-PLAN.md | Continue with plan 02 |
| 2026-03-13 | Completed 00-02-PLAN.md | Continue with plan 03 |
| 2026-03-13 | Completed 00-03-PLAN.md | Continue with plan 04 |
| 2026-03-13 | Completed 00-04-PLAN.md | Continue with plan 05 |
| 2026-03-13 | Checkpoint: 00-05 Task 1 complete, awaiting human-verify | Run `pnpm test:run`, `pnpm typecheck`, and CLI manual verification |
| 2026-03-13 | Phase 0 complete — human-verified | `/gsd:plan-phase 1` to start CLI MVP |
| 2026-03-13 | Completed 01-01-PLAN.md | Continue with plan 01-02 |
| 2026-03-13 | Completed 01-02-PLAN.md | Continue with plan 01-03 |
| 2026-03-13 | Completed 01-03-PLAN.md | Continue with plan 01-04 |
| 2026-03-14 | Checkpoint: 01-04 Tasks 1-2 complete, awaiting human-verify | Verify: pnpm test:run, pnpm build, node dist/cli/index.js --version, agentbnb init gateway uses LAN IP, README + demo scripts |
| 2026-03-14 | Completed 01-04-PLAN.md — human-verified | Phase 1 CLI MVP complete. `/gsd:plan-phase 2` to continue |
| 2026-03-14 | Completed 02-01-PLAN.md | Continue with plan 02-02 |
| 2026-03-14 | Completed 02-02-PLAN.md | Continue with plan 02-03 |

---
*Last updated: 2026-03-14 — Phase 2 in progress (02-01 reputation + 02-02 public registry complete). 11/12 plans complete across Phase 0, Phase 1, and Phase 2.*
