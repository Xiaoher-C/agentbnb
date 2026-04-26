# Audit Report — Unit 4: Orchestration / Runtime / SDK / CLI

**Scope**: `src/conductor/**`, `src/runtime/**`, `src/skills/**`, `src/autonomy/**`, `src/sdk/**`, `src/cli/**`
**Auditor**: code-reviewer agent (Unit 4 of 5)
**Date**: 2026-04-27
**Branch**: audit/unit-4-architecture-quality
**Files reviewed**: ~90 files, ~25k LOC

---

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| WARNING  | 9 |
| INFO     | 4 |

**Verdict: BLOCK** — 2 CRITICAL issues must be resolved before merge. One involves a private cryptographic key leaking through the request params dict; the other is a hardcoded placeholder auth token being used in actual relay calls.

---

## CRITICAL Findings

### [CRITICAL-1] Private key transmitted in params dict — `src/conductor/conductor-mode.ts:196`

**Issue**: The conductor orchestration path accepts `params.conductor_private_key` as a plain parameter field. This key travels unguarded through the params object, which is forwarded over HTTP/relay to remote agents.

```typescript
// src/conductor/conductor-mode.ts line ~196
const conductorKey = params.conductor_private_key instanceof Buffer
  ? params.conductor_private_key as Buffer
  : undefined;
```

Any logging, relay forwarding, or serialisation of `params` will expose the raw Ed25519 private key. The key should be sourced from the local keystore (DID layer) and never accepted as a runtime parameter from external callers.

**Fix**: Remove `conductor_private_key` from the params contract. Resolve the conductor's signing key from `src/identity/did.ts` at call time using the agent's own identity, scoped to the local runtime. Update `ExecuteParams` type to remove this field and audit all call sites.

---

### [CRITICAL-2] Hardcoded fake auth token used in real relay calls — `src/autonomy/auto-request.ts:480,559`

**Issue**: Two call sites in the autonomous request loop pass a hard-coded string as the authentication token to `requestViaTemporaryRelay`:

```typescript
// src/autonomy/auto-request.ts line ~480
token: 'auto-request-token',

// src/autonomy/auto-request.ts line ~559
token: 'auto-request-token',
```

Depending on relay server auth configuration this either silently bypasses authentication or causes all autonomous requests to fail. Neither outcome is acceptable in production. This is not a stub — it is invoked in the live `AutoRequestor.runAutoRequest()` path.

**Fix**: Replace the hardcoded string with a real UCAN token obtained from the agent's own identity (e.g. a self-delegated UCAN for `agentbnb://skill/*`). If a UCAN token is unavailable at this point, the call must fail explicitly rather than proceeding with a fake token.

---

## WARNING Findings

### [WARNING-1] TOCTOU window in `ensureRunning()` — `src/runtime/service-coordinator.ts`

`ensureRunning()` calls `this.guard.getRunningMeta()` (check) then later calls `this.guard.acquire()` (lock). Two concurrent callers can both pass the check before either acquires the lock, leading to a double-start attempt on the gateway/registry.

**Fix**: Wrap the check-and-acquire sequence in a module-level mutex (e.g. a `Promise` chain flag), or move the "already running" check to inside `acquire()`.

---

### [WARNING-2] Null-unsafe cron callback after shutdown — `src/runtime/service-coordinator.ts:334`

The credit-sync cron job captures `this.runtime!` via non-null assertion. If `shutdown()` is called while the cron fires, `this.runtime` will be `null` at the point of access, throwing an unhandled rejection.

```typescript
this.creditSyncJob = new Cron('*/5 * * * *', async () => {
  const result = await syncCreditsFromRegistry(this.config, this.runtime!.creditDb);
  // this.runtime can be null if shutdown() raced with this tick
});
```

**Fix**: Check `if (!this.runtime || this.draining) return;` at the top of every cron callback body that accesses `this.runtime`.

---

### [WARNING-3] Unbounded decomposition recursion — `src/conductor/conductor-mode.ts`

`orchestrationDepth >= 2` guards against recursive orchestration calls, but there is no equivalent guard on the `decompositionDepth` axis. A task whose decomposition produces sub-tasks that also decompose will exceed the intent of the depth guard.

**Fix**: Thread `decompositionDepth` through `TaskDecomposer.decompose()` and reject calls where `decompositionDepth >= 2` with a clear error.

---

### [WARNING-4] Hardcoded keyword-matching in TaskDecomposer — `src/conductor/task-decomposer.ts`

Only three task patterns are recognised (`video-production`, `deep-analysis`, `content-generation`). All other tasks silently return an empty array `[]`, causing the conductor to proceed with no sub-tasks and produce an empty result without any error signal.

**Fix**: Add a fallback that either throws a `DecompositionError` or returns a single-step plan wrapping the original task. Log a warning when no template matches so operators can see the gap.

---

### [WARNING-5] Dual concurrency accounting for CommandExecutor — `src/skills/command-executor.ts`

`CommandExecutor` maintains its own `inflight` map per `cmdConfig.id`, while `SkillExecutor.ConcurrencyGuard` independently tracks the same skill's concurrency via `semaphore`. These two counters can diverge (e.g. if an exception unwinds one but not the other), creating a state where the guard thinks capacity is available but the executor has already reached it, or vice versa.

**Fix**: Remove the `inflight` tracking from `CommandExecutor` and rely solely on `ConcurrencyGuard`. If per-command concurrency is required, express it as a `max_concurrent` field that `ConcurrencyGuard` enforces rather than a separate counter.

---

### [WARNING-6] `shellEscape` / `safeInterpolateCommand` duplicated across executors — `src/skills/command-executor.ts` and `src/skills/pipeline-executor.ts`

Both files contain identical implementations of `shellEscape` and `safeInterpolateCommand`. DRY violation — any security fix to one implementation will not propagate to the other.

**Fix**: Extract to `src/skills/shell-utils.ts` and import from both executors.

---

### [WARNING-7] Busy-wait restart in daemon — `src/runtime/daemon.ts`

`restartDaemon` uses `setTimeout(1500)` to wait for port release before re-spawning:

```typescript
await new Promise(resolve => setTimeout(resolve, 1500));
```

There is no actual check that the port is free; if the previous process takes longer than 1.5 s to release, the restart will fail with `EADDRINUSE`. On loaded machines this is a reliable failure mode.

**Fix**: Poll `net.createServer().listen(port)` with a retry loop and exponential backoff, or use `SO_REUSEPORT` if the OS supports it. Maximum retry attempts should be bounded and produce a clear error on timeout.

---

### [WARNING-8] Remote card network errors silently swallowed — `src/conductor/capability-matcher.ts`

The remote fallback wraps the card-fetch in a bare `catch {}` with no logging. When all remote registry calls fail, the matcher silently returns an empty match list, causing the conductor to report "no capable agents" without any trace of the underlying network failure.

**Fix**: Log at `warn` level inside the `catch` block, including the registry URL and error message. Do not rethrow — silent fallback is acceptable, but silent failure is not.

---

### [WARNING-9] SDK `request()` deprecated but sole HTTP path — `src/sdk/consumer.ts`

`AgentBnBConsumer.request()` is marked `@deprecated` in JSDoc, but `requestViaRelay()` is the only alternative and requires a relay to be reachable. In environments without a relay, callers have no non-deprecated path. The deprecation is premature or underdocumented.

**Fix**: Either remove the `@deprecated` tag until a concrete replacement for offline/direct-HTTP scenarios exists, or document that `requestViaRelay()` is the sole supported path and that direct HTTP is intentionally sunset (with a target removal version).

---

## INFO Findings

### [INFO-1] God Module — `src/cli/index.ts` (2,305 lines)

Project rule: 800 lines max. `src/cli/index.ts` is nearly 3× the limit. It contains all CLI command registration, action handler implementations, and utility helpers in a single file. This is the largest file in the audited scope and impedes both readability and testability.

**Suggested split**:
- `src/cli/commands/did.ts` — DID/identity subcommands
- `src/cli/commands/vc.ts` — VC subcommands
- `src/cli/commands/skill.ts` — skill/executor subcommands
- `src/cli/commands/daemon.ts` — daemon lifecycle subcommands
- `src/cli/utils.ts` — shared CLI utilities
- `src/cli/index.ts` — registration only (~100 lines)

---

### [INFO-2] Dead interface stub — `src/app/agentbnb-service.ts`

```typescript
export interface ShareCapabilityInput {
  // TODO: finalize after supply bridge design
}
```

Empty exported interface with an open TODO. This pollutes the public type surface with a meaningless type.

**Fix**: Remove the export until the interface is actually specified, or add a lint rule preventing empty exported interfaces.

---

### [INFO-3] Unsafe cast in ServiceCoordinator — `src/runtime/service-coordinator.ts:378`

```typescript
as unknown as Record<string, unknown>[]
```

Double-cast via `unknown` indicates a type mismatch that should be resolved with a proper type annotation or a Zod parse, not a cast.

**Fix**: Introduce a typed schema for the value being cast and validate it with `z.array(z.record(z.unknown())).parse(...)`.

---

### [INFO-4] Individual task timeout set to 300,000 ms (5 min) — `src/conductor/pipeline-orchestrator.ts`

The default per-task orchestration timeout is 5 minutes. For most skill invocations this is far too long and will mask hung processes. The value should be configurable per skill and default to a lower value (e.g. 30 s).

**Fix**: Add a `timeout_ms` field to `SkillConfig` (or expose it in the conductor config) with a default of 30,000 ms. Reserve long timeouts for explicitly declared long-running skills.

---

## File Size Summary

| File | Lines | Status |
|------|-------|--------|
| `src/cli/index.ts` | 2,305 | OVER LIMIT (800 max) |
| `src/runtime/service-coordinator.ts` | 731 | AT LIMIT |
| `src/autonomy/auto-request.ts` | 667 | OK |
| `src/skills/command-executor.ts` | 437 | OK |
| `src/conductor/pipeline-orchestrator.ts` | 405 | OK |
| `src/skills/openclaw-bridge.ts` | 373 | OK |
| `src/conductor/conductor-mode.ts` | 277 | OK |
| `src/skills/executor.ts` | 254 | OK |
| `src/sdk/consumer.ts` | 250 | OK |
| `src/skills/pipeline-executor.ts` | 251 | OK |

---

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 2     | block  |
| WARNING  | 9     | warn   |
| INFO     | 4     | note   |

**Verdict: BLOCK** — CRITICAL-1 (private key in params) and CRITICAL-2 (fake auth token in live relay calls) must be resolved before this code ships to production.
