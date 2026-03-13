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
**Status**: Pending
**Priority**: P1

OpenClaw skills that bridge AgentBnB:
- Auto-generate Capability Card from agent's SOUL.md
- Handle incoming requests as OpenClaw tasks
- Report results back through gateway

**Acceptance Criteria**:
- [ ] Skill installs in OpenClaw without errors
- [ ] Card auto-generation produces valid L1/L2 cards
- [ ] End-to-end: Agent A requests, Agent B executes, results return
