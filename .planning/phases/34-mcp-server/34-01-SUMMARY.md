---
phase: 34-mcp-server
plan: 01
subsystem: api
tags: [mcp, model-context-protocol, stdio, json-rpc, ide-integration]

# Dependency graph
requires:
  - phase: 31-fix-downstream
    provides: remote registry search fallback for discover tool
provides:
  - MCP server with 6 tools over stdio transport
  - agentbnb mcp-server CLI command
  - IDE integration for Claude Code, Cursor, Windsurf, Cline
affects: [39-hub-agent-ui, documentation, readme]

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk"]
  patterns: [registerTool with Zod raw shape inputSchema, handler functions exported for direct testing]

key-files:
  created:
    - src/mcp/server.ts
    - src/mcp/index.ts
    - src/mcp/tools/discover.ts
    - src/mcp/tools/status.ts
    - src/mcp/tools/publish.ts
    - src/mcp/tools/request.ts
    - src/mcp/tools/conduct.ts
    - src/mcp/tools/serve-skill.ts
    - src/mcp/server.test.ts
  modified:
    - src/cli/index.ts
    - package.json

key-decisions:
  - "Used @modelcontextprotocol/sdk (not /server) — /server does not exist on npm"
  - "All console output goes to stderr — stdout reserved for MCP JSON-RPC protocol"
  - "Each tool handler exported as standalone function (handleXxx) for direct unit testing"
  - "Action tools dynamically imported in startMcpServer to avoid circular deps"
  - "serve_skill stores RelayClient on McpServerContext for graceful shutdown"

patterns-established:
  - "MCP tool pattern: registerXxxTool(server, ctx) + handleXxx(args, ctx) pair"
  - "Error handling: tools never throw — catch and return JSON error content"

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06]

# Metrics
duration: 12min
completed: 2026-03-19
---

# Phase 34 Plan 01: MCP Server Summary

**stdio MCP server exposing 6 tools (discover, request, publish, status, conduct, serve_skill) for IDE integration via @modelcontextprotocol/sdk**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-19T07:07:26Z
- **Completed:** 2026-03-19T07:19:17Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- MCP server with stdio transport, auto-identity creation, and graceful SIGINT/SIGTERM shutdown
- 6 MCP tools registered: discover (local+remote search), status (identity+balance), publish (validate+insert+remote sync), request (auto+direct with escrow), conduct (multi-agent orchestration), serve_skill (relay provider)
- CLI `agentbnb mcp-server` command for easy integration: `claude mcp add agentbnb -- agentbnb mcp-server`
- 17 tests covering all tool exports, handler logic, and error paths

## Task Commits

Each task was committed atomically:

1. **Task 1: Install MCP SDK, create server scaffold and 3 read-only tools** - `f225afa` (feat)
2. **Task 2: Create 3 action tools, wire CLI command, and tests** - `a957436` (feat)

## Files Created/Modified
- `src/mcp/server.ts` - McpServer setup, McpServerContext interface, startMcpServer(), stdio transport
- `src/mcp/index.ts` - Barrel export
- `src/mcp/tools/discover.ts` - agentbnb_discover: local + remote registry search with mergeResults
- `src/mcp/tools/status.ts` - agentbnb_status: identity, balance (registry or local fallback), config
- `src/mcp/tools/publish.ts` - agentbnb_publish: AnyCardSchema validation, minimum price enforcement, local+remote insert
- `src/mcp/tools/request.ts` - agentbnb_request: auto-request (query via AutoRequestor) + direct (card_id with escrow lifecycle)
- `src/mcp/tools/conduct.ts` - agentbnb_conduct: delegates to conductAction for task decomposition and pipeline orchestration
- `src/mcp/tools/serve-skill.ts` - agentbnb_serve_skill: relay provider with executeCapabilityRequest handler
- `src/mcp/server.test.ts` - 17 unit tests for all tool handlers
- `src/cli/index.ts` - Added `agentbnb mcp-server` command
- `package.json` - Added @modelcontextprotocol/sdk dependency

## Decisions Made
- Used `@modelcontextprotocol/sdk` package (the `@modelcontextprotocol/server` name does not exist on npm)
- All stderr logging (stdout reserved for JSON-RPC protocol messages)
- Each tool handler exported as a standalone `handleXxx()` function for direct unit testing without starting MCP transport
- Dynamic imports for action tools in startMcpServer() to prevent circular dependency issues at module load time
- serve_skill stores RelayClient reference on McpServerContext for cleanup on SIGINT/SIGTERM

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Package name @modelcontextprotocol/server does not exist**
- **Found during:** Task 1 (MCP SDK installation)
- **Issue:** `@modelcontextprotocol/server` returned 404 from npm registry
- **Fix:** Used `@modelcontextprotocol/sdk` instead (plan anticipated this fallback)
- **Files modified:** package.json
- **Verification:** Package installed successfully, imports work
- **Committed in:** f225afa

**2. [Rule 1 - Bug] v2.0 card type has agent_name not name, no top-level pricing**
- **Found during:** Task 1 (publish tool)
- **Issue:** TypeScript discriminated union error: v2.0 cards use `agent_name` and per-skill pricing
- **Fix:** Used rawCard accessor with proper type casting for both v1 and v2 card shapes
- **Files modified:** src/mcp/tools/publish.ts
- **Verification:** TypeScript compiles without errors
- **Committed in:** f225afa

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MCP server fully functional and testable via `agentbnb mcp-server`
- Ready for Phase 35 (OpenAPI Spec) and Phase 33 (Conductor dual role)
- Users can integrate with: `claude mcp add agentbnb -- npx agentbnb mcp-server`

## Self-Check: PASSED

- All 9 created files verified present
- Commit f225afa (Task 1) verified in git log
- Commit a957436 (Task 2) verified in git log
- 17 MCP tests pass
- 934 total tests pass (full suite)
- TypeScript compiles with zero MCP-related errors

---
*Phase: 34-mcp-server*
*Completed: 2026-03-19*
