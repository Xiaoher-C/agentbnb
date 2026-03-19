---
phase: 35-openapi-spec
plan: 01
subsystem: registry
tags: [openapi, swagger, gpt-actions, api-documentation]
dependency_graph:
  requires: [src/registry/server.ts, src/registry/credit-routes.ts]
  provides: [openapi-spec, swagger-ui, gpt-actions-export]
  affects: [src/registry/server.ts, src/registry/credit-routes.ts]
tech_stack:
  added: ["@fastify/swagger@9.7.0", "@fastify/swagger-ui@5.2.5"]
  patterns: [json-schema-route-documentation, openapi-3.0.3, gpt-actions-converter]
key_files:
  created:
    - src/registry/openapi-gpt-actions.ts
    - src/registry/openapi-gpt-actions.test.ts
  modified:
    - src/registry/server.ts
    - src/registry/credit-routes.ts
    - src/registry/server.test.ts
    - package.json
    - pnpm-lock.yaml
decisions:
  - "Wrap API routes in Fastify plugin for swagger schema capture — routes registered directly on server are invisible to @fastify/swagger"
  - "GPT Actions filter: exclude /me, /draft, /docs, /ws, /api/credits paths — only public GET/POST endpoints"
  - "operationId auto-generation from method + path segments (e.g., getCards, postApiIdentityRegister)"
metrics:
  duration: 598s
  completed: "2026-03-19T07:16:39Z"
---

# Phase 35 Plan 01: OpenAPI 3.0 Auto-Generation Summary

OpenAPI 3.0 spec auto-generation via @fastify/swagger with Swagger UI at /docs, JSON at /docs/json, and GPT Actions export at /api/openapi/gpt-actions

## What Was Built

### Task 1: Swagger Plugin + JSON Schema on All Routes
- Installed `@fastify/swagger` (9.7.0) and `@fastify/swagger-ui` (5.2.5)
- Registered swagger plugins before all routes in `createRegistryServer()`
- Added JSON Schema definitions (tags, summary, params, querystring, body, response) to all ~25 routes across `server.ts` and `credit-routes.ts`
- Wrapped all API routes in a Fastify plugin so `@fastify/swagger` captures them via its `onRoute` hook
- Commit: 7b191da

### Task 2: GPT Actions Export + Integration Tests
- Created `openapi-gpt-actions.ts` with `convertToGptActions()` function that:
  - Filters to only public GET/POST endpoints (removes owner, credit, docs, WebSocket paths)
  - Removes DELETE/PATCH methods
  - Adds `operationId` to all operations (derived from method + path)
  - Removes `securitySchemes` and per-operation `security`
  - Sets absolute server URL
  - Filters tags to only referenced ones
- Added `GET /api/openapi/gpt-actions` route with `server_url` query parameter
- 11 unit tests for the converter (filtering, URL, operationId, immutability)
- 3 integration tests for /docs, /docs/json, /api/openapi/gpt-actions
- Commit: a888a37

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Routes invisible to @fastify/swagger when registered directly on server**
- **Found during:** Task 1 verification
- **Issue:** Routes registered synchronously on the Fastify server instance (outside any plugin) were not captured by `@fastify/swagger`'s `onRoute` hook, resulting in empty `paths` in the generated spec
- **Fix:** Wrapped all API route definitions inside `void server.register(async (api) => { ... })` plugin block, changing `server.get(...)` to `api.get(...)` etc. Static file serving and `setNotFoundHandler` remain on the top-level server
- **Files modified:** src/registry/server.ts
- **Commit:** a888a37

## Test Results

- 172 registry tests passing (9 test files)
- 14 new tests added (11 converter unit tests + 3 integration tests)
- All 66 pre-existing server tests continue to pass
- All 10 credit-routes tests continue to pass

## Commits

| Task | Commit  | Description                                             |
|------|---------|---------------------------------------------------------|
| 1    | 7b191da | feat(35-01): add OpenAPI 3.0 via @fastify/swagger       |
| 2    | a888a37 | feat(35-01): add GPT Actions export + integration tests |
