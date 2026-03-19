---
phase: 38-framework-adapters
plan: 01
subsystem: adapters
tags: [langchain, crewai, autogen, openai, python, ed25519, httpx, function-calling]

# Dependency graph
requires:
  - phase: 35-openapi-gpt-actions
    provides: "GPT Actions OpenAPI spec for generate.ts"
  - phase: 27-registry-credit-endpoints
    provides: "Ed25519 identity-auth protocol for credit operations"
provides:
  - "LangChain BaseTool adapter for AgentBnB (Python)"
  - "CrewAI @tool adapter for AgentBnB (Python)"
  - "AutoGen tool functions adapter for AgentBnB (Python)"
  - "OpenAI function calling JSON schema"
  - "OpenAI schema generator script (TypeScript)"
affects: [39-hub-agent-ui]

# Tech tracking
tech-stack:
  added: [httpx, cryptography, langchain-core, crewai, pyautogen]
  patterns: [inline-ed25519-auth, self-contained-adapter-file]

key-files:
  created:
    - adapters/langchain/agentbnb_tools.py
    - adapters/langchain/README.md
    - adapters/crewai/agentbnb_tool.py
    - adapters/crewai/README.md
    - adapters/autogen/agentbnb_agent.py
    - adapters/autogen/README.md
    - adapters/openai/functions.json
    - adapters/openai/generate.ts
    - adapters/openai/README.md
  modified: []

key-decisions:
  - "Each Python adapter is fully self-contained with inline Ed25519 auth -- no shared module per user decision"
  - "LangChain request tool does search+hold in one call (not separate hold) for better developer UX"
  - "OpenAI functions.json is pre-generated statically and also regeneratable from live registry"

patterns-established:
  - "Inline Ed25519 auth pattern: _Ed25519Auth class with lazy key loading, sign_headers() returning 3 headers"
  - "Adapter file convention: single self-contained file per framework, copy-paste ready"

requirements-completed: [ADAPT-01, ADAPT-02, ADAPT-03, ADAPT-04]

# Metrics
duration: 3min
completed: 2026-03-19
---

# Phase 38 Plan 01: Framework Adapters Summary

**LangChain, CrewAI, AutoGen Python adapters with Ed25519 auth + OpenAI function calling JSON schema**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-19T08:10:36Z
- **Completed:** 2026-03-19T08:14:06Z
- **Tasks:** 2
- **Files created:** 9

## Accomplishments
- Three self-contained Python adapters (LangChain BaseTool, CrewAI @tool, AutoGen functions) all with inline Ed25519 signing
- OpenAI function calling JSON schema with 3 function definitions (discover, request, status)
- TypeScript generator script that rebuilds functions.json from live registry GPT Actions export
- Each adapter directory has a README with copy-paste quick start examples

## Task Commits

Each task was committed atomically:

1. **Task 1: Python adapters -- LangChain, CrewAI, AutoGen with Ed25519 auth** - `ff17041` (feat)
2. **Task 2: OpenAI function calling JSON schema + generator script** - `6ab666f` (feat)

## Files Created/Modified
- `adapters/langchain/agentbnb_tools.py` - 3 BaseTool subclasses (Discover, Request, Status) with sync+async
- `adapters/langchain/README.md` - Usage with LangChain agents
- `adapters/crewai/agentbnb_tool.py` - 3 @tool decorated functions for CrewAI crews
- `adapters/crewai/README.md` - Usage with CrewAI agents
- `adapters/autogen/agentbnb_agent.py` - 3 tool functions + register_agentbnb_tools helper
- `adapters/autogen/README.md` - Usage with AutoGen AssistantAgent
- `adapters/openai/functions.json` - Static OpenAI function calling schema (3 functions)
- `adapters/openai/generate.ts` - Script to regenerate from live registry
- `adapters/openai/README.md` - Usage with Chat Completions and Assistants API

## Decisions Made
- Each Python adapter is fully self-contained with inline Ed25519 auth (no shared module) per user decision
- LangChain request tool combines search+hold in one call for better DX (follows plan simplification)
- OpenAI functions.json is pre-generated statically so it works without a running registry

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Users need `agentbnb init` for Ed25519 keys and `pip install httpx cryptography` for Python adapters.

## Next Phase Readiness
- All four framework adapters complete and ready for developer adoption
- OpenAI schema can be regenerated when new API endpoints are added
- Phase 39 (Hub Agent UI) can proceed independently

---
*Phase: 38-framework-adapters*
*Completed: 2026-03-19*
