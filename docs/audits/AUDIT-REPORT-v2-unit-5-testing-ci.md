# Audit Report — Unit 5: Testing & CI Infrastructure
**Date:** 2026-04-27
**Auditor:** Unit 5 (Testing & CI)
**Scope:** `vitest.config.ts`, `.github/workflows/**`, `test/`, co-located `**/*.test.ts`, package CI scripts
**Branch:** `audit/unit-5-testing-ci`

---

## Executive Summary

The AgentBnB test suite is large (143 test files, 1,800+ tests across `src/`) and its critical path modules — auth/UCAN, identity/DID, credit/escrow, credentials/VC, relay, and gateway — all have dedicated test files. The **E2E canonical transaction flow** is partially covered (`src/gateway/e2e-canonical.test.ts`) and the credit/escrow lifecycle is well-exercised at unit level.

However, several significant gaps and risks were found:

| Category | CRITICAL | WARNING | INFO |
|----------|----------|---------|------|
| Coverage Gaps | 0 | 4 | 5 |
| Flaky Test Patterns | 0 | 3 | 2 |
| CI Pipeline Gaps | 1 | 3 | 2 |
| vitest.config Issues | 0 | 1 | 2 |
| E2E / Integration Gaps | 0 | 2 | 1 |
| **Totals** | **1** | **13** | **12** |

**Verdict: BLOCK on 1 CRITICAL (fly-deploy runs without CI gate). 13 WARNINGs should be addressed before the next production release.**

---

## Coverage Table

| Module | Test File Present | Notes |
|--------|-------------------|-------|
| `src/auth/` (5 files) | All covered | `canonical-json`, `ucan`, `ucan-delegation`, `ucan-escrow`, `ucan-resources` all have tests |
| `src/identity/` (8 files + index) | All covered | `did`, `did-rotation`, `did-revocation`, `evm-bridge`, `agent-identity`, `delegation`, `operators`, `identity`, `guarantor` all tested |
| `src/credit/` (20 files) | All covered | Comprehensive — `ledger`, `escrow`, `settlement`, `economic-system`, `p2p-integration`, etc. |
| `src/credentials/` (6 files) | All covered | `vc`, `reputation-vc`, `skill-vc`, `team-vc`, `vc-presentation`, `vc-scheduler` tested |
| `src/relay/` (4 source + types) | Partial | `websocket-relay`, `websocket-client`, `relay-credit`, `relay-escrow` tested; `types.ts` is type-only |
| `src/gateway/` (6 files) | **Partial — auth.ts untested** | `execute`, `execute-batch`, `server`, `client`, `provider-notifier`, `relay-dispatch`, `resolve-target-capability` tested; `auth.ts` has no dedicated test |
| `src/registry/` (22 files) | **Partial — 9 route files uncovered** | `activity-routes`, `agent-routes`, `batch-routes`, `card-routes`, `identity-routes`, `matcher`, `owner-routes`, `provider-routes`, `skill-routes` have no dedicated test files |
| `src/session/` (7 files) | **Partial — session-client untested** | `session-manager`, `session-escrow`, `session-executor`, `session-relay`, `openclaw-session-executor` covered in `session.test.ts`; `session-client.ts` (217 lines) has zero test coverage |
| `src/skills/` (9 files) | All covered | `executor`, `api-executor`, `command-executor`, `pipeline-executor`, `handle-request`, `openclaw-bridge`, `skill-config`, `publish-capability`, `integration` tested |
| `src/conductor/` (11 files) | Mostly covered | `role-schema.ts` and `types.ts` not tested (type-only) |
| `src/hub-agent/` (9 files) | Mostly covered | `types.ts` not tested (type-only) |
| `src/runtime/` (5 files) | All covered | `agent-runtime`, `daemon`, `process-guard`, `resolve-self-cli`, `service-coordinator` tested |
| `src/cli/` (19 files) | **Partial** | `config`, `credits-action`, `did-action`, `doctor`, `openclaw-setup`, `quickstart`, `session-action`, `vc-action` have no dedicated tests |
| `src/mcp/` (8 tools + server) | All covered | All 6 MCP tools plus server tested |
| `src/app/` | Covered | `agentbnb-service.test.ts` |
| `src/autonomy/` (5 files) | All covered | `auto-request`, `consumer-autonomy`, `idle-monitor`, `pending-requests`, `tiers` tested |
| `src/sdk/` (3 files) | Covered | `consumer`, `consumer-auth`, `provider` tested |
| `hub/` (React SPA) | Partial | 24 test files exist; hub tests run with `continue-on-error: true` in CI |
| `packages/skill-inspector` | Covered | Has own `vitest.config.ts` and `test/` dir |
| `packages/managed-agents-adapter` | Covered | Has `src/__tests__/` dir |
| `packages/genesis-template` | Partial | Only `scripts/init.test.ts` |

---

## Findings

### Category: CI Pipeline Gaps

---

#### Finding 1: fly-deploy runs on every push to main with no dependency on the CI job passing
- **File:** `.github/workflows/fly-deploy.yml`
- **Severity:** CRITICAL
- **Description:** The `fly-deploy.yml` workflow triggers on `push: branches: [main]` independently of `ci.yml`. It has no `needs:` dependency on the CI job. This means a commit that breaks tests or typecheck can be deployed to production immediately, before CI finishes or fails. There is no explicit status gate preventing broken code from reaching the live service.
- **Suggested fix:** Add a `needs: [ci]` dependency in `fly-deploy.yml`, or configure GitHub branch protection to require the CI check to pass before merges to `main` are allowed. Example:
  ```yaml
  jobs:
    deploy:
      needs: [ci]          # add this
      runs-on: ubuntu-latest
  ```

---

#### Finding 2: Typecheck runs with `continue-on-error: true` — TypeScript errors do not block CI
- **File:** `.github/workflows/ci.yml:37`
- **Severity:** WARNING
- **Description:** The `Typecheck` step is configured with `continue-on-error: true`. TypeScript compile errors are silently ignored; CI passes green even if the entire codebase fails to type-check. This undermines the value of strict TypeScript mode and means regressions in type safety are invisible in CI.
- **Suggested fix:** Remove `continue-on-error: true` from the Typecheck step once the typecheck is clean. If there are currently known errors, track them as issues and enforce `continue-on-error: false` as a milestone exit criterion.

---

#### Finding 3: Hub tests run with `continue-on-error: true` — hub test failures do not block merge
- **File:** `.github/workflows/ci.yml:52`
- **Severity:** WARNING
- **Description:** The `Test (hub)` step also uses `continue-on-error: true`. A broken hub component or hook will not prevent the PR from being merged. Combined with Finding 2, two of the four test/check steps in CI are non-blocking.
- **Suggested fix:** Either enforce hub tests as blocking (remove `continue-on-error: true`) or add a mandatory failing-test notification. At minimum, document the intent so contributors know what the expected failure threshold is.

---

#### Finding 4: No coverage report uploaded or enforced in CI
- **File:** `.github/workflows/ci.yml`
- **Severity:** WARNING
- **Description:** The CI pipeline runs `pnpm run test:run` (not `test:coverage`). The coverage thresholds declared in `vitest.config.ts` (`branches: 80, functions: 80, lines: 80, statements: 80`) are never exercised in CI. The 80% target is defined but not enforced — coverage could drop below threshold on any PR without CI noticing. There is no coverage artifact upload (e.g., Codecov, Coveralls).
- **Suggested fix:** Change the CI backend test step to use `pnpm run test:coverage`, or add a separate coverage step. Upload the resulting LCOV/json report to a coverage service so trends are visible. Example:
  ```yaml
  - name: Test (backend with coverage)
    run: pnpm run test:coverage
  ```

---

#### Finding 5: No Node.js version matrix — only Node 20 is tested
- **File:** `.github/workflows/ci.yml:23`
- **Severity:** INFO
- **Description:** CI tests only against Node 20. The `package.json` `engines` field declares support for Node `>=20.0.0 <25.0.0`. Node 22 (current LTS) and Node 24 are not tested, which means regressions from newer runtime behavior (e.g., native ESM changes, crypto API changes) will not surface until production.
- **Suggested fix:** Add a matrix strategy covering at minimum Node 20 and Node 22. Node 24 can be opt-in with `continue-on-error: true` while LTS adoption catches up:
  ```yaml
  strategy:
    matrix:
      node-version: [20, 22]
  ```

---

#### Finding 6: No CI for workspace packages (managed-agents-adapter, genesis-template)
- **File:** `.github/workflows/ci.yml`
- **Severity:** INFO
- **Description:** `vitest.config.ts` explicitly excludes `packages/**` from the root test run. Neither `packages/managed-agents-adapter` nor `packages/genesis-template` has its own CI step. Their tests (which exist) are never run in CI. `packages/skill-inspector` is built in CI but its tests are not explicitly run.
- **Suggested fix:** Add `pnpm -r test` or per-package `pnpm -F @agentbnb/managed-agents-adapter test` steps, or include the workspace packages in the root vitest run by removing the `packages/**` exclusion (requires ensuring their `vitest.config.ts` handles isolation correctly).

---

### Category: vitest.config Issues

---

#### Finding 7: Coverage thresholds declared but never enforced in CI (see Finding 4)
- **File:** `vitest.config.ts:15`
- **Severity:** WARNING
- **Description:** As noted in Finding 4, the coverage block has `thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 }`. These thresholds are only evaluated when running `vitest run --coverage`. Since CI runs `vitest run`, these thresholds are dead config from CI's perspective.
- **Suggested fix:** Enforce coverage in CI. See Finding 4.

---

#### Finding 8: No `retry` configured for known-flaky tests; no `bail` limit
- **File:** `vitest.config.ts`
- **Severity:** INFO
- **Description:** With multiple real-sleep tests (see Flaky Patterns section), individual test suites can take several seconds per assertion. There is no `retry` count for inherently timing-sensitive tests and no `bail` limit to prevent a single failing suite from hanging the entire run for up to `testTimeout * N` tests. The 20-second `testTimeout` and `hookTimeout` are reasonable, but the absence of `bail` means a cascade of slow tests is uncapped.
- **Suggested fix:** Consider `bail: 5` to abort the run early during obvious total failures. For tests like `session.test.ts` (idle timeout) and `websocket-client.test.ts` (reconnect), add `retry: 2` at the describe block level to reduce flake-induced CI failures.

---

#### Finding 9: Coverage excludes `**/types/**` — typed Zod schemas in `src/types/index.ts` are excluded
- **File:** `vitest.config.ts:16`
- **Severity:** INFO
- **Description:** The coverage `exclude` list includes `**/types/**`. There is a `src/types/index.test.ts` file that tests Zod schema validation. This exclusion means the `src/types/` directory (which contains the canonical `CapabilityCard` and `Skill` Zod schemas) is invisible to coverage reporting even though it is actively tested and the schemas are runtime-critical (they gate all card publishing validation).
- **Suggested fix:** Change the coverage exclusion to be more specific: `'**/types/*.d.ts'` rather than `'**/types/**'` to preserve coverage measurement for runtime schema files.

---

### Category: Flaky Test Patterns

---

#### Finding 10: Multiple real `setTimeout` sleeps in gateway and relay tests (slow + flake-prone)
- **Files:** `src/gateway/server.test.ts:247, 458, 600, 729` (4 occurrences of `setTimeout(resolve, 2000)`), `src/relay/websocket-client.test.ts:284` (`setTimeout(r, 2000)`)
- **Severity:** WARNING
- **Description:** Five test cases use hard `await new Promise(resolve => setTimeout(resolve, 2000))` waits to simulate timeout behavior. Each one adds 2 seconds of mandatory wall-clock time to the test run. At 4 instances in `server.test.ts` alone, this adds at least 8 seconds of unavoidable sleep. In CI with load or resource pressure, these are also flake vectors — if the test machine is slow, the actual operation may not complete within the sleep window.
- **Suggested fix:** Use `vi.useFakeTimers()` with `vi.advanceTimersByTime()` for timeout scenarios that do not involve real network I/O. For tests that do need real timeouts (e.g., actual HTTP server not responding), use deterministic event-based signaling rather than fixed sleeps where possible.

---

#### Finding 11: Hardcoded port 17799 in CLI integration test risks port collision in parallel runs
- **File:** `src/cli/index.test.ts:812`
- **Severity:** WARNING
- **Description:** The serve-command integration test spawns a real CLI process bound to port `17799` (hardcoded gateway port) while using a random port `17800 + random(1000)` for the registry. If two test workers run this test concurrently (e.g., in a matrix CI or with Vitest workers), or if port 17799 is already occupied on the CI host, the test will fail non-deterministically. The `pool: 'forks'` setting in `vitest.config.ts` uses process forks, which could cause concurrent port usage.
- **Suggested fix:** Use `port: 0` (OS-assigned ephemeral port) for all test server bindings, or serialize CLI integration tests via `sequential: true` or a dedicated describe-level `singleFork: true` pragma. Write the assigned port to a temp file (the pattern is already used for the internal test server at line ~637) and use that for the gateway as well.

---

#### Finding 12: Idle timeout test relies on a real 700ms wall-clock sleep
- **File:** `src/session/session.test.ts:266`
- **Severity:** WARNING
- **Description:** The `handles idle timeout` test in `SessionManager` uses `await new Promise(resolve => setTimeout(resolve, 700))` to wait for a 500ms idle timeout to fire. This couples test correctness to wall-clock timing. On a loaded CI runner, 700ms may not be enough margin after the 500ms timeout fires and the event loop processes the consequence. The test is marked as `async` but uses a real timer, not fake timers.
- **Suggested fix:** Replace with `vi.useFakeTimers()` / `vi.advanceTimersByTime(600)` so the timeout behavior is deterministic:
  ```ts
  vi.useFakeTimers();
  manager.openSession(msg, 'requester-1');
  vi.advanceTimersByTime(600); // past 500ms idle
  vi.useRealTimers();
  ```

---

#### Finding 13: Real network URLs in test fixtures (`https://registry.agentbnb.dev`, `https://fly.agentbnb.dev`)
- **Files:** `src/credit/registry-credit-ledger.test.ts:169`, `src/credit/registry-sync.test.ts:46`, `src/mcp/tools/request-relay-agent-id.test.ts:14`
- **Severity:** INFO
- **Description:** Production registry URLs appear as constants in test files. These tests mock `globalThis.fetch` correctly and do not make real network calls, but the URLs leak production endpoints into test fixtures. If `AGENTBNB_TEST_MODE` is ever not set (e.g., running a single test file outside the global setup), the chance of accidentally hitting production increases.
- **Suggested fix:** Replace production URLs in test fixtures with `http://localhost` or `http://test.invalid` to make intent explicit. The `test/setup-env.ts` already sets `AGENTBNB_TEST_MODE=1`, which is the right pattern — ensure all tests that use real URLs also validate that `fetch` is mocked before proceeding.

---

#### Finding 14: `Math.random()` used for temporary directory names and port offsets — not seeded
- **Files:** `src/cli/openclaw-skills.test.ts:9`, `src/workspace/scanner.test.ts:9`, `src/workspace/writer.test.ts:14`, `src/workspace/gep-init.test.ts:8`, `src/cli/index.test.ts:806`
- **Severity:** INFO
- **Description:** Multiple tests use `Math.random()` to generate unique temp directory names and port numbers. While this is a common and acceptable pattern, it means test outputs are non-reproducible: running the same test suite twice produces different filesystem paths in CI logs, making artifact comparison harder. The random port selection (`17800 + Math.floor(Math.random() * 1000)`) can still collide across parallel test processes.
- **Suggested fix:** Use `crypto.randomUUID()` (already used elsewhere in tests) for temp dirs to get guaranteed uniqueness. For ports, prefer `port: 0` OS assignment.

---

### Category: Coverage Gaps on Critical Paths

---

#### Finding 15: `src/registry/identity-routes.ts` — DID resolution, VC, and agent registration endpoints have no dedicated tests
- **File:** `src/registry/identity-routes.ts` (549 lines)
- **Severity:** WARNING
- **Description:** `identity-routes.ts` registers the following endpoints that are central to the V1.0 identity stack: `POST /api/identity/register`, `GET /api/agents/challenge`, `POST /api/agents/register`, `POST /api/agents/login`, `POST /api/identity/link`, `GET /api/identity/:agent_id`, `GET /api/did/:agent_id`, `GET /api/credentials/:agent_id`, `GET /api/identity/github/callback`. None of these routes are hit directly in `registry/server.test.ts` (verified by grep). The DID resolution API (`/api/did/:agent_id`) and the Verifiable Credentials endpoint (`/api/credentials/:agent_id`) are advertised as production features with no HTTP-level test coverage.
- **Suggested fix:** Add a `src/registry/identity-routes.test.ts` that exercises at minimum: DID document resolution, agent challenge/register flow, and VC endpoint returning real credential structure. The existing `registry/hub-identities.test.ts` and `registry/identity-auth.test.ts` cover lower-level utilities but not the Fastify route handlers.

---

#### Finding 16: `src/registry/card-routes.ts`, `skill-routes.ts`, `batch-routes.ts` — publish, delete, and batch-request paths untested at route level
- **Files:** `src/registry/card-routes.ts` (532 lines), `src/registry/skill-routes.ts` (483 lines), `src/registry/batch-routes.ts` (198 lines)
- **Severity:** WARNING
- **Description:** `card-routes.ts` registers `POST /cards` (publish), `DELETE /cards/:id`, `GET /cards/:id`, `GET /cards` (all with auth variants), and `GET /api/cards/trending`. `skill-routes.ts` and `batch-routes.ts` are entirely untested at the HTTP layer. The card publishing path (`POST /cards`) is the entry point for the core publish-card → discover → request flow and is not covered at the integration level. `server.test.ts` tests some `GET /cards` variants via the server composite, but `POST /cards` and `DELETE /cards/:id` are not visible in its describe blocks.
- **Suggested fix:** Add dedicated route tests or expand `server.test.ts` to cover the card publish path end-to-end: authenticate, publish a card via `POST /cards`, verify it appears in `GET /cards`, and delete it via `DELETE /cards/:id`. The batch-request path needs its own test covering the JSON-RPC batch format.

---

#### Finding 17: `src/session/session-client.ts` (217 lines) has zero test coverage
- **File:** `src/session/session-client.ts`
- **Severity:** WARNING
- **Description:** `session-client.ts` is the consumer-facing WebSocket session client — the component agent consumers use to initiate and maintain persistent sessions. It is 217 lines with no test file and no imports from any `*.test.ts` file (confirmed by grep). It is distinct from `session-manager.ts` (which is tested) and contains independent connection management, message handling, and error recovery logic.
- **Suggested fix:** Create `src/session/session-client.test.ts` covering: session open, message round-trip, budget exhaustion close, idle timeout, and reconnection behavior.

---

#### Finding 18: `src/gateway/auth.ts` has no dedicated test file
- **File:** `src/gateway/auth.ts`
- **Severity:** INFO
- **Description:** The gateway `authPlugin` (Bearer token validation) has no dedicated `auth.test.ts`. It is exercised indirectly through `server.test.ts` (which correctly verifies 401 responses for missing and invalid tokens), so the functional coverage is adequate. However, the direct test is absent, meaning if `auth.ts` is refactored in isolation, no test captures the edge cases of the Fastify hook lifecycle (e.g., correct scoping of the plugin, health endpoint bypass).
- **Suggested fix:** Low priority given indirect coverage. Consider adding a focused `auth.test.ts` when the auth middleware is extended (e.g., to support UCAN Bearer tokens alongside static tokens).

---

#### Finding 19: CLI action files for `did-action`, `vc-action`, `session-action`, `credits-action` have no tests
- **Files:** `src/cli/did-action.ts`, `src/cli/vc-action.ts`, `src/cli/session-action.ts`, `src/cli/credits-action.ts`
- **Severity:** INFO
- **Description:** Four CLI action modules that wrap V1.0 identity-layer features (DID management, VC display, session control, credit management) have no dedicated tests. The `src/cli/index.test.ts` tests the end-to-end CLI via subprocess spawning for some commands, but the individual action handlers are not unit-tested. If the API they call changes, the failure surface is only detectable through the heavyweight subprocess tests.
- **Suggested fix:** Add lightweight unit tests for each action module that mock the underlying service calls and verify correct argument parsing and output formatting.

---

### Category: E2E / Integration Gaps

---

#### Finding 20: No full cross-process E2E test covering publish → discover → request → escrow → settle via HTTP
- **File:** N/A (gap)
- **Severity:** WARNING
- **Description:** The `src/gateway/e2e-canonical.test.ts` covers the in-process transaction flow (escrow hold → execute → settle) but currently asserts that the direct HTTP paid receipt path is **disabled** in favor of relay routing (see scenario 1). There is no cross-process test that exercises the full agent lifecycle over real HTTP: publish a card on a live registry, discover it, send a request through the relay, and verify credits transfer. The `src/credit/p2p-integration.test.ts` gets close but uses in-process SQLite only. The CLI integration test at `src/cli/index.test.ts` exercises serve/publish/discover but does not drive a complete escrow-and-settle cycle.
- **Suggested fix:** Add an integration test (or expand `p2p-integration.test.ts`) that spawns two in-process Fastify servers (provider + registry), publishes a card, discovers it, submits a relay-routed request, and asserts post-settle credit balances. This would give regression coverage for the relay → escrow → settle path, which is currently the only supported paid execution path.

---

#### Finding 21: No E2E test for UCAN delegation chain: issue → delegate → verify flow over the relay
- **File:** N/A (gap)
- **Severity:** WARNING
- **Description:** `src/auth/ucan-delegation.test.ts` tests delegation chain verification in-process. `src/auth/ucan-escrow.test.ts` tests the escrow binding. But there is no integration test that chains all three: create a UCAN with escrow binding, relay a request that includes the UCAN as a Bearer token, and verify the gateway accepts it and the escrow binding is honored. The relay's UCAN path (`ucan_token` field in `RegisterMessage`) is tested structurally in `src/relay/websocket-relay.test.ts` but not through a full auth→route→settle scenario.
- **Suggested fix:** Add a scenario in `e2e-canonical.test.ts` or a new `auth-integration.test.ts` that exercises the UCAN Bearer token path end-to-end through the gateway's token validation middleware.

---

## Additional Observations

- **`test/setup-env.ts` is minimal but correct.** Setting `AGENTBNB_TEST_MODE=1` globally prevents outbound HTTP calls. The approach is sound and propagates to subprocess tests.
- **`pool: 'forks'` is appropriate** for tests that use SQLite (avoids shared-memory issues between workers), but it does increase test startup overhead compared to `pool: 'threads'`. Given the 20-second timeout, this is acceptable.
- **In-memory SQLite is used consistently** across credit, registry, and relay tests. The `beforeEach` / `afterEach` lifecycle is correctly managed in all reviewed test suites — no shared mutable database state across tests was found.
- **The hub test suite** (24 files, React Testing Library + jsdom) is complete enough for the component surface it covers. The `continue-on-error: true` flag in CI (Finding 3) is the main concern, not the tests themselves.
- **`pnpm run test:coverage` exists** as a script but is never invoked in CI. The 80% threshold in `vitest.config.ts` is aspirational until CI enforces it (Finding 4 / 7).
- **Workspace package tests are excluded** from the root run (`packages/**` in vitest exclude). `skill-inspector` and `managed-agents-adapter` tests exist and pass in isolation but are invisible to root coverage metrics.
