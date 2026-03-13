# External Integrations

**Analysis Date:** 2026-03-13

## APIs & External Services

**Agent-to-Agent Communication:**
- Fastify HTTP Server - Inter-agent capability requests and responses
  - SDK/Client: `fastify` 5.1.0
  - Protocol: JSON-RPC over HTTP (as specified in CLAUDE.md)
  - Auth: Simple token-based auth (planned in `src/gateway/auth.ts`, not yet implemented)
  - Port: 7700 (gateway server port, from `src/cli/index.ts`)

**Third-Party Capability APIs (Referenced in Capability Cards):**
- ElevenLabs TTS - Example Level 1 (Atomic) capability
- Kling Video Generation - Example Level 1 capability
- Other external APIs - Declared via `apis_used` field in Capability Card metadata

*Note:* The platform itself does not integrate with specific third-party APIs. Instead, agents publish capabilities that wrap those APIs. Capability Cards track which external APIs are used via the `metadata.apis_used: string[]` field.

## Data Storage

**Databases:**
- SQLite (via better-sqlite3 11.6.0)
  - Connection: Local file-based (pattern: `*.db` or `*.sqlite`, as per `.gitignore`)
  - Client: better-sqlite3 (synchronous native bindings)
  - Purpose: Stores Capability Card registry and matching indexes
  - Planned schema: Not yet implemented (Phase 0 is spec validation only)

**File Storage:**
- None currently. Database is file-based SQLite stored locally.

**Caching:**
- None detected. Early-stage project without caching requirements.

## Authentication & Identity

**Auth Provider:**
- Custom implementation (planned in `src/gateway/auth.ts`)
  - Mechanism: Token-based authentication for inter-agent requests
  - Agent Identity: Identified by `owner` field in Capability Card
  - Scope: Agent-to-agent authorization, not user authentication

**Environment Variables:**
- Not yet in use. Future requirements will likely include:
  - Agent tokens
  - Database path configuration
  - Gateway listening address/port

## Monitoring & Observability

**Error Tracking:**
- None integrated. Custom error class defined: `AgentBnBError` in `src/types/index.ts`
  - Base class for all AgentBnB exceptions with `code` property for categorization
  - No external error reporting service configured

**Logs:**
- Console-based only (e.g., `console.log()` in `src/cli/index.ts`)
- No logging framework integrated (Pino, Winston, etc.)
- Structured logging not yet implemented

## CI/CD & Deployment

**Hosting:**
- Not specified. Phase 0 is local dogfood only (internal testing with OpenClaw agents at 樂洋集團)
- Future: Deployment approach TBD

**CI Pipeline:**
- None configured. No GitHub Actions, GitLab CI, or similar detected.
- Project uses GSD (Get Shit Done) for spec-driven development with Claude Code
- Manual test execution: `pnpm test:run`

## Environment Configuration

**Required env vars:**
- None currently enforced or documented
- `.env` and `.env.local` files are in `.gitignore` but pattern not yet used

**Secrets location:**
- Not applicable at Phase 0 (local testing only)
- Future: Will need to secure agent tokens and API keys referenced in Capability Cards

## Webhooks & Callbacks

**Incoming:**
- Fastify server (`src/gateway/server.ts` - planned) will accept HTTP requests from other agents

**Outgoing:**
- Agents will make outbound requests to other agents' Fastify servers for capability execution
- No webhook pattern yet implemented; planned as part of gateway layer

## Agent-to-Agent Protocol (Planned)

**Communication Pattern:**
- Agent A publishes Capability Card to shared registry
- Agent B discovers Agent A's capability and requests it via HTTP/JSON-RPC
- Escrow system holds Agent B's credits during execution
- Agent A executes capability and returns result
- Credits transferred on success (ledger updates via `src/credit/ledger.ts`)

**Status:**
- Schema and types defined in `src/types/index.ts`
- Execution layer not yet implemented (Phase 0 focus: spec validation)

---

*Integration audit: 2026-03-13*
