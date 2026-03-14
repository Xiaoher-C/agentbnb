# AgentBnB Requirements

## Phase 0: Dogfood Requirements

### R-001: Capability Card Schema
**Status**: Complete (00-01)
**Priority**: P0

The system must define a TypeScript schema for Capability Cards with:
- Three levels: Atomic (L1), Pipeline (L2), Environment (L3)
- Input/Output schema definitions (JSON Schema compatible)
- Pricing model (credits per call, credits per minute)
- Availability indicators (online/offline, schedule)
- Metadata (APIs used, latency, success rate)
- Validation via Zod

**Acceptance Criteria**:
- [x] Zod schema validates correct cards
- [x] Zod schema rejects malformed cards
- [x] All three levels can be represented
- [x] Schema is exported as TypeScript types

### R-002: Local Registry
**Status**: Complete (00-01)
**Priority**: P0

SQLite-backed storage for Capability Cards with:
- CRUD operations on cards
- Full-text search on name + description
- Filter by level, availability, API used
- Owner-based access control (only owner can update/delete)

**Acceptance Criteria**:
- [x] Can store and retrieve 100+ cards
- [x] Search returns relevant results in <50ms
- [x] Owner isolation enforced

### R-003: CLI Interface
**Status**: Complete (00-04)
**Priority**: P0

Commander-based CLI with subcommands:
- `agentbnb init` — Initialize config in current directory
- `agentbnb publish <card.json>` — Register a capability
- `agentbnb discover [query]` — Search capabilities
- `agentbnb request <card-id>` — Request a capability execution
- `agentbnb status` — Show credit balance and active requests
- `agentbnb serve` — Start the gateway server

**Acceptance Criteria**:
- [x] All commands have --help output
- [x] JSON and table output formats
- [x] Config stored in ~/.agentbnb/config.json

### R-004: Gateway Server
**Status**: Complete (00-03)
**Priority**: P0

HTTP server (Fastify) that:
- Listens for incoming capability requests
- Validates request against published cards
- Routes to local agent for execution
- Returns results to requester
- Tracks credit usage

**Acceptance Criteria**:
- [x] Server starts on configurable port
- [x] Health check endpoint
- [x] Request/response logging
- [x] Timeout handling (configurable per card)

### R-005: Credit Ledger
**Status**: Complete (00-02)
**Priority**: P1

SQLite-backed credit tracking:
- Balance per agent owner
- Transaction log (debit/credit with reason)
- Escrow: hold credits when request starts
- Settlement: release on success, refund on failure/timeout
- Initial credit grant for new agents (bootstrap)

**Acceptance Criteria**:
- [x] Double-entry bookkeeping (every debit has a credit)
- [x] Escrow prevents overspending
- [x] Transaction history queryable

### R-006: OpenClaw Integration
**Status**: Complete (00-05)
**Priority**: P1

OpenClaw skills that bridge AgentBnB:
- Auto-generate Capability Card from agent's SOUL.md
- Handle incoming requests as OpenClaw tasks
- Report results back through gateway

**Acceptance Criteria**:
- [x] Skill installs in OpenClaw without errors
- [x] Card auto-generation produces valid L1/L2 cards
- [x] End-to-end: Agent A requests, Agent B executes, results return

## Phase 1: CLI MVP Requirements

### R-007: npm Package Distribution
**Status**: Complete (01-01)
**Priority**: P0

The package must be installable via npm/npx:
- package.json configured with files, exports, bin, engines
- Build pipeline produces distributable dist/ with shebang-correct CLI entry
- `node dist/cli/index.js --version` prints correct version from package.json
- `npx publint` passes with no errors

**Acceptance Criteria**:
- [x] package.json has files whitelist, exports map, prepublishOnly guard
- [x] tsup build produces dist/cli/index.js with #!/usr/bin/env node shebang
- [x] CLI version dynamically reads from package.json (no hardcoded string)
- [x] publint reports "All good!"

### R-008: Capability Card Spec v1.0
**Status**: Complete (01-01)
**Priority**: P0

Freeze the Capability Card schema at version 1.0 with a spec_version field:
- spec_version field locks schema to '1.0' (rejects future versions)
- .default('1.0') ensures backward compatibility for legacy Phase 0 cards
- Parsed cards always have spec_version '1.0' in output

**Acceptance Criteria**:
- [x] Card with spec_version '1.0' validates successfully
- [x] Card WITHOUT spec_version validates (default fills '1.0')
- [x] Card with spec_version '2.0' is rejected
- [x] Parsed output always includes spec_version '1.0'
- [x] All Phase 0 tests continue to pass (zero regressions)

## Phase 2: Cold Start Requirements

### R-013: Web-Based Registry
**Status**: Complete (02-02)
**Priority**: P0

Public HTTP REST API exposing the capability card registry for external discovery:
- Separate Fastify server instance (not on the gateway)
- CORS enabled for browser access
- GET /health — server status
- GET /cards — paginated list with filters and search
- GET /cards/:id — single card by UUID
- Read-only: no write endpoints

**Acceptance Criteria**:
- [ ] GET /cards returns paginated response { total, limit, offset, items }
- [ ] FTS5 search via ?q= parameter
- [ ] Filters: level, online, tag, min_success_rate, max_latency_ms
- [ ] Sort: success_rate (desc), latency (asc)
- [ ] CORS headers present on all responses
- [ ] Registry accessible at http://host:7701/cards via `agentbnb serve`

### R-014: Reputation System
**Status**: Complete (02-01)
**Priority**: P0

Per-card reputation tracking updated after each capability execution:
- Exponentially weighted average (EWA) with alpha=0.1
- success_rate: 0.0-1.0, updated on success (1) and failure (0)
- avg_latency_ms: updated with observed execution latency
- Gateway automatically records reputation after settle (success) and release (failure)
- First execution bootstraps from undefined to concrete value

**Acceptance Criteria**:
- [ ] updateReputation() updates success_rate and avg_latency_ms using EWA
- [ ] Gateway calls updateReputation() after every capability.execute
- [ ] Reputation data persists in SQLite (survives restart)
- [ ] Re-publishing a card preserves existing reputation data

### R-015: Capability Card Marketplace
**Status**: Complete (02-02)
**Priority**: P1

Browse and filter capabilities with reputation-aware sorting:
- Pagination: limit (default 20, max 100) + offset
- Tag filtering via metadata.tags
- Reputation filtering (min_success_rate, max_latency_ms)
- Sort by success_rate or latency
- Unrated cards (undefined success_rate) sort after rated cards

**Acceptance Criteria**:
- [ ] Pagination returns correct slices with total count
- [ ] Tag filter matches cards with specified tag
- [ ] Reputation filters exclude cards below threshold
- [ ] Sort by success_rate puts highest first, unrated last
- [ ] Sort by latency puts fastest first, unrated last

## Phase 2.3: Remote Registry Discovery Requirements

### RRD-01: CLI Remote Registry Query
**Status**: Pending (02.3)
**Priority**: P0

The `agentbnb discover` command must support querying a remote registry HTTP API:
- `--registry <url>` option specifies the registry server URL (e.g., `http://host:7701`)
- Fetches from `GET <url>/cards` with query/filter params forwarded
- Supports same filters as local discover: q, level, online, tag
- Results displayed in same table/JSON format as local discover
- Graceful error handling for unreachable or invalid registry URLs

**Acceptance Criteria**:
- [ ] `agentbnb discover --registry http://host:7701` returns remote cards
- [ ] Query param `--query` forwarded as `?q=` to remote API
- [ ] Filter params (--level, --online, --tag) forwarded to remote API
- [ ] `--json` output works with remote results
- [ ] Timeout and connection errors produce actionable error messages

### RRD-02: Remote Discovery Integration Test
**Status**: Pending (02.3)
**Priority**: P0

End-to-end test proving cross-machine discovery works:
- Start registry server, publish cards, discover via HTTP from CLI
- Validates the full flow: init → publish → serve → discover (remote) → see results

**Acceptance Criteria**:
- [ ] Integration test starts registry server on random port
- [ ] Test publishes card, then discovers it via `--registry http://localhost:<port>`
- [ ] Test verifies discovered card matches published card
- [ ] Test covers error case (unreachable registry)
