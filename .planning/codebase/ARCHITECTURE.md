# Architecture

**Analysis Date:** 2026-03-13

## Pattern Overview

**Overall:** Modular capability-based system with CLI interface and planned layered architecture.

**Key Characteristics:**
- Zod-based schema validation for all data structures
- Capability Cards as the central domain model
- CLI-driven development (command interface patterns established)
- Planned layering: registry → gateway → credit → types
- Type-safe with strict TypeScript mode
- No runtime (actions are currently stubs)

## Layers

**Types Layer:**
- Purpose: Define and validate all domain models and data contracts
- Location: `src/types/index.ts`
- Contains: Zod schemas, TypeScript type exports, custom error classes
- Depends on: `zod` only
- Used by: All other layers, CLI, external consumers

**CLI Layer:**
- Purpose: Provide command-line interface for agent operators to interact with AgentBnB
- Location: `src/cli/index.ts`
- Contains: Commander-based command definitions (init, publish, discover, request, status, serve)
- Depends on: Types layer, planned gateway and registry layers
- Used by: Agent operators via npm bin script (`agentbnb` command)

**Registry Layer (Planned):**
- Purpose: Store and search Capability Cards with SQLite backend
- Location: `src/registry/` (not yet implemented)
- Will contain: Card storage (`card.ts`), SQLite store (`store.ts`), matching algorithm (`matcher.ts`)
- Will depend on: Types layer, `better-sqlite3`
- Will be used by: CLI (discover, publish), gateway (capability matching)

**Gateway Layer (Planned):**
- Purpose: Handle agent-to-agent communication via JSON-RPC over HTTP
- Location: `src/gateway/` (not yet implemented)
- Will contain: HTTP server (`server.ts`), outbound client (`client.ts`), token auth (`auth.ts`)
- Will depend on: Types layer, registry, credit layer, `fastify`
- Will be used by: Other agents, serve command

**Credit Layer (Planned):**
- Purpose: Track credit balances and manage escrow during capability execution
- Location: `src/credit/` (not yet implemented)
- Will contain: Ledger management (`ledger.ts`), escrow hold logic (`escrow.ts`)
- Will depend on: Types layer, SQLite backend
- Will be used by: Gateway (before/after execution), request command

## Data Flow

**Publishing a Capability Card:**

1. CLI user runs `agentbnb publish <card-file>`
2. Card file is parsed and validated against `CapabilityCardSchema`
3. Registry stores the card in SQLite with timestamp
4. Card becomes discoverable by other agents
5. Owner can see it in their registry with unique UUID

**Discovering Capabilities:**

1. CLI user runs `agentbnb discover [query]`
2. Registry.matcher searches stored cards against query
3. Results filtered by availability (online status, schedule)
4. Results ranked by metadata (success_rate, avg_latency_ms)
5. CLI displays results with owner, pricing, I/O schema

**Requesting a Capability:**

1. CLI user runs `agentbnb request <card-id>`
2. Credit layer checks requester's balance
3. Credit layer places hold on `pricing.credits_per_call`
4. Gateway sends JSON-RPC request to capability owner's agent
5. Owner's agent executes capability (receives inputs, returns outputs)
6. On success: credits transferred to owner, requester charged
7. On failure: credits released, request marked failed

**State Management:**

- **Card State:** Immutable records stored in SQLite with timestamps (created_at, updated_at)
- **Credit State:** Ledger tracks balance per agent in SQLite, escrow holds temporarily locked funds
- **Request State:** Transaction log tracks requests with status (pending, executing, completed, failed)
- **Agent State:** Online status controlled by `availability.online` boolean and optional cron schedule

## Key Abstractions

**CapabilityCard:**
- Purpose: Describe what an agent can do with inputs, outputs, pricing, and availability
- Examples: `src/types/index.ts` (schema definition), `src/types/index.test.ts` (test cases)
- Pattern: Zod schema with TypeScript type inference; three-level model (Atomic, Pipeline, Environment)
- Structure:
  - Level 1 (Atomic): Single API call (e.g., ElevenLabs TTS)
  - Level 2 (Pipeline): Multiple Atomics chained (e.g., text → voice → video)
  - Level 3 (Environment): Full deployable environment with all dependencies
- Validation: Enforces owner, name constraints; supports optional metadata (APIs used, latency, success rate)

**IOSchema:**
- Purpose: Define inputs and outputs for capability cards with type safety
- Pattern: Union of predefined types (text, json, file, audio, image, video, stream)
- Contains: Name, type, description, required flag, and optional JSON Schema
- Used by: CapabilityCard inputs/outputs arrays

**AgentBnBError:**
- Purpose: Custom error class extending Error with domain-specific code
- Location: `src/types/index.ts`
- Pattern: Constructor takes message and code; provides error context for callers
- Used by: All layers to throw structured errors that preserve error codes

## Entry Points

**CLI Entry Point:**
- Location: `src/cli/index.ts`
- Triggers: User runs `agentbnb <command>` from shell
- Responsibilities: Parse command-line arguments, dispatch to appropriate action handlers
- Commands available: `init`, `publish`, `discover`, `request`, `status`, `serve`

**Module Entry Point:**
- Location: `src/index.ts`
- Triggers: Import via `import { CapabilityCardSchema } from 'agentbnb'`
- Responsibilities: Export public API (CapabilityCard types and schema)
- Exported: `CapabilityCardSchema`, `CapabilityCard` type

## Error Handling

**Strategy:** Custom error class with domain codes for structured error tracking.

**Patterns:**
- All public functions use `async/await` (no raw Promises)
- Validation errors: Zod `safeParse` returns `{success: false, error: ZodError}` (no throw)
- Runtime errors: Throw `AgentBnBError` with semantic code (e.g., 'CARD_NOT_FOUND', 'INSUFFICIENT_CREDITS')
- Test expectations: Use `expect(result.success).toBe(false)` for validation failures

## Cross-Cutting Concerns

**Logging:** Not yet implemented. Planned to use `console` for CLI output; structured logging for gateway/registry.

**Validation:** All external input validated with Zod schemas before processing. No data reaches business logic without validation.

**Authentication:** Planned token-based auth in gateway layer (`src/gateway/auth.ts`). CLI operates as local agent (no authentication needed yet).

**Timestamping:** CapabilityCard schema supports ISO 8601 datetime strings for `created_at` and `updated_at` (optional, can be set by registry on insert).

---

*Architecture analysis: 2026-03-13*
