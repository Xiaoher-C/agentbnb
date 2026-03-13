# Codebase Concerns

**Analysis Date:** 2026-03-13

## Tech Debt

**CLI Commands Are Stubs:**
- Issue: All CLI commands in `src/cli/index.ts` contain only `console.log()` statements with no actual implementation
- Files: `src/cli/index.ts` (lines 15-52)
- Impact: Commands `publish`, `discover`, `request`, `serve`, `init`, `status` cannot be used for Phase 0 dogfooding; CLI is non-functional
- Fix approach: Implement each command handler to call appropriate modules (registry CRUD, gateway client/server, credit ledger); route properly to business logic layers

**Core Modules Missing Despite P0 Priority:**
- Issue: Dependencies declared (`better-sqlite3`, `fastify`) but implementing modules not created
- Files:
  - `src/registry/` — does not exist (should contain card.ts, store.ts, matcher.ts)
  - `src/gateway/` — does not exist (should contain server.ts, client.ts, auth.ts)
  - `src/credit/` — does not exist (should contain ledger.ts, escrow.ts)
- Impact: Cannot publish cards, discover capabilities, send/receive requests, track credits; entire core loop blocked
- Fix approach: Create directory structure matching CLAUDE.md architecture; implement SQLite schema in registry/store.ts, HTTP routes in gateway/server.ts, ledger logic in credit/ledger.ts

**No Configuration Loading:**
- Issue: Hardcoded defaults (port 7700, startup messages) with no config file loader
- Files: `src/cli/index.ts` (line 51)
- Impact: Users cannot configure gateway port, database location, or agent ID; blocks multi-agent testing
- Fix approach: Create `src/config/loader.ts` to read `~/.agentbnb/config.json`, environment variables (AGENTBNB_PORT, AGENTBNB_AGENT_ID); pass config to gateway/CLI modules

**IO Schema Validation Too Loose:**
- Issue: `IOSchemaSchema` defines optional nested `schema: z.record(z.unknown())` which accepts anything
- Files: `src/types/index.ts` (line 11)
- Impact: Cannot validate actual input/output data at call time; allows invalid JSON Schema in capability cards; data contracts not enforced
- Fix approach: Replace `z.record(z.unknown())` with proper JSON Schema validation using zod-json-schema or custom validator; validate against schema on gateway request/response

**No TypeScript Validation on Test Files:**
- Issue: `tsconfig.json` excludes test files from compilation (exclude: ["**/*.test.ts"])
- Files: `tsconfig.json` (line 21)
- Impact: Type errors in test files not caught at build time; test code can have type safety violations; harder to refactor with confidence
- Fix approach: Remove test exclusion from tsconfig.json; keep separate tsconfig.test.json if needed for different output, but still validate types; Vitest can use same config

## Known Bugs

**CLI Status Command Returns Hardcoded Balance:**
- Symptoms: Running `agentbnb status` always shows "Credit balance: 100 (starter grant)" regardless of actual agent's credit ledger
- Files: `src/cli/index.ts` (line 44)
- Trigger: Any execution of `agentbnb status`
- Workaround: None — ledger not implemented yet

**No Input Validation on CLI Arguments:**
- Symptoms: CLI accepts any string for card-id, filepath, query without validation; passes through to unimplemented handlers
- Files: `src/cli/index.ts` (lines 22, 29, 36)
- Trigger: Running `agentbnb publish "anything"` or `agentbnb request "invalid-uuid"`
- Workaround: None — validation must happen in actual implementation

## Security Considerations

**No Authentication on HTTP Gateway:**
- Risk: When gateway/server.ts is implemented, it will listen for incoming requests; CLAUDE.md mentions "simple token-based auth" but not implemented
- Files: `src/gateway/auth.ts` — does not exist
- Current mitigation: Gateway not running (no implementation); Phase 1 will need this
- Recommendations: Implement bearer token validation in `gateway/auth.ts` before any request processing; store agent API keys encrypted in config; require header validation on all `/request`, `/status` endpoints

**Hardcoded Agent Identity in Tests:**
- Risk: Test file uses literal owner string `'chengwen@leyang'` instead of configurable agent ID
- Files: `src/types/index.test.ts` (line 8)
- Current mitigation: Only test data, no security exposure; but sets bad pattern for real implementations
- Recommendations: Use environment variable or config-based agent ID in all tests; never hardcode owner IDs

**No Rate Limiting on Incoming Requests:**
- Risk: When gateway receives requests, no protection against request flooding/DoS from other agents
- Files: `src/gateway/server.ts` — does not exist
- Current mitigation: Not yet implemented
- Recommendations: Add rate limiter plugin to Fastify (e.g., @fastify/rate-limit); configure per-agent limits based on credit balance

## Performance Bottlenecks

**No Database Query Optimization for Search:**
- Problem: Capability discovery requires "full-text search on name + description" (R-002) but no indexes or query plans designed
- Files: `src/registry/store.ts` — does not exist
- Cause: Planning phase only; implementation will need SQLite FTS5 (full-text search) extension
- Improvement path: Use SQLite FTS5 virtual table for cards table; index on owner, level, availability for filtering; benchmark search queries <50ms target before release

**No Caching Layer for Capability Discovery:**
- Problem: Repeated searches for same query across multiple agents will hit database each time
- Files: `src/registry/matcher.ts` — does not exist
- Cause: No cache design in current schema
- Improvement path: Add optional in-memory LRU cache (e.g., lru-cache npm package) for discovery results; invalidate on card publish/update; measure hit rate in dogfood phase

## Fragile Areas

**CLI Depends on Console Output Format:**
- Files: `src/cli/index.ts`
- Why fragile: All CLI commands rely only on console.log; any output format change breaks programmatic parsing; using emoji in output (🏠 📋 🔍) makes log parsing fragile
- Safe modification: Don't rely on console output format for testing; implement structured output (--json flag) before dogfood; use logging framework (winston, pino) instead of console.log
- Test coverage: No CLI tests exist

**Capability Card Schema Has Optional Metadata:**
- Files: `src/types/index.ts` (line 42)
- Why fragile: `metadata` is fully optional but contains important data (apis_used, success_rate); cardmatcher algorithm (not yet written) may assume these exist and crash if missing
- Safe modification: Keep metadata optional for L1 cards, but require in L2/L3; update matcher to handle missing fields with defaults; add integration tests for all level combinations with and without metadata
- Test coverage: Only `index.test.ts` tests schema validation; no tests for matcher algorithm edge cases

**No Error Propagation from CLI:**
- Files: `src/cli/index.ts`
- Why fragile: `.action()` callbacks don't catch errors or return exit codes; if handler throws, process will crash but CLI framework won't exit gracefully
- Safe modification: Wrap all action handlers in try-catch; call `process.exit(1)` on error; log stack traces to stderr, not stdout
- Test coverage: Zero tests

## Scaling Limits

**SQLite Single Writer Limit:**
- Current capacity: SQLite allows one writer at a time (others block); suitable for <100 requests/second
- Limit: Multiple agents publishing cards simultaneously will serialize writes; Phase 0 tests with 2 agents OK, but Phase 2 (10+ agents) needs migration strategy
- Scaling path: Phase 0/1 stays SQLite; Phase 2+ design sharding or upgrade to PostgreSQL; document this limit in ROADMAP

**Fastify Server No Connection Pool:**
- Current capacity: Default Fastify with single database connection; no pooling of SQLite connections
- Limit: As request concurrency grows, connection pool exhaustion becomes bottleneck (unlikely in Phase 0, likely in Phase 2)
- Scaling path: Implement connection pooling with better-sqlite3 via queue pattern; or use connection pool library when upgrading to PostgreSQL

## Dependencies at Risk

**better-sqlite3 Native Binding:**
- Risk: Native module; requires compilation on install; fails silently on unsupported architectures (e.g., ARM64 Mac without native support installed)
- Impact: Setup breaks for non-standard machines; Phase 0 dogfood may hit this if testing on different hardware
- Migration plan: Document build requirements in README (Xcode Command Line Tools on Mac); or use sql.js (in-memory SQLite) for Phase 0 with migration path to better-sqlite3 for persistence

**Commander.js CLI Framework:**
- Risk: CLI only uses basic .command().action() pattern; if needs become complex (middleware, nested commands, aliases), may outgrow Commander
- Impact: Low risk for Phase 0; can refactor later
- Migration plan: Commander is stable; no immediate action needed; consider oclif for larger CLI if Phase 2+ needs it

**Zod Validation Overhead:**
- Risk: Zod parses/validates all CapabilityCards on every publish/discover operation; no lazy validation
- Impact: Low for Phase 0 (<100 cards); measurable for Phase 2 (1000+ cards)
- Migration plan: Phase 0 validates eagerly; Phase 2 can cache parsed cards or use incremental validation

## Missing Critical Features

**No Capability Matching Algorithm:**
- Problem: `src/registry/matcher.ts` missing; cannot discover capabilities matching user query
- Blocks: `agentbnb discover` command; entire discovery loop
- Context: REQUIREMENTS.md R-002 requires "full-text search on name + description, filter by level/availability/APIs"

**No Credit Ledger Implementation:**
- Problem: `src/credit/` directory missing; no double-entry bookkeeping, no escrow
- Blocks: All transactions; payment for capability execution; Phase 0 goal "validate credit tracking works end-to-end"
- Context: REQUIREMENTS.md R-005 critical for dogfood phase

**No Gateway HTTP Server:**
- Problem: `src/gateway/server.ts` missing; cannot receive requests from other agents
- Blocks: Peer-to-peer communication; request/response loop
- Context: REQUIREMENTS.md R-004 required for Phase 0.2

**No OpenClaw Integration:**
- Problem: `src/openclaw/` does not exist; no skill to bridge OpenClaw agents to AgentBnB
- Blocks: Phase 0.4 goal "test with 2 OpenClaw agents sharing capabilities"
- Context: REQUIREMENTS.md R-006; needed for dogfood validation on actual agent workloads

## Test Coverage Gaps

**CLI Commands Not Tested:**
- What's not tested: All 6 CLI commands (init, publish, discover, request, status, serve) have zero test coverage
- Files: `src/cli/index.ts` (entire file)
- Risk: Refactoring/debugging commands is blind; easy to introduce bugs in argument parsing or error handling
- Priority: High — must test before Phase 0.2 work starts

**Registry Store Not Tested:**
- What's not tested: CRUD operations, FTS search, owner isolation checks
- Files: `src/registry/store.ts` — does not exist
- Risk: Data integrity bugs undetected; search queries may be slow or incorrect
- Priority: High — must test before Phase 0.2

**Credit Ledger Edge Cases:**
- What's not tested: Concurrent requests to same account, escrow overflow, refund logic
- Files: `src/credit/ledger.ts`, `src/credit/escrow.ts` — do not exist
- Risk: Double-spending bugs, escrow starvation, race conditions in Phase 2 multi-threaded scenarios
- Priority: High — add tests during Phase 0.3 implementation

**Gateway Authentication:**
- What's not tested: Token validation, malformed requests, missing headers
- Files: `src/gateway/auth.ts` — does not exist
- Risk: Security vulnerabilities (token bypass, injection attacks) undetected until deployed
- Priority: Critical — must test before Phase 1 release

---

*Concerns audit: 2026-03-13*
