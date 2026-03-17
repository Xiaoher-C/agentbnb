# Code Quality Audit

---
agent: code-auditor
status: COMPLETE
timestamp: 2026-03-17T19:50:00Z
duration: 180
findings: 16
files_scanned: 82
any_count: 0
console_log_count: 85
errors: []
skipped_checks: []
---

## Summary
| Category | Count |
|----------|-------|
| Type Safety | 3 |
| Complexity | 2 |
| Maintainability | 4 |
| Consistency | 2 |
| Code Hygiene | 5 |

## Metrics
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| `any` usage | 0 | < 5 | PASS |
| `as unknown as` casts | 27 | < 10 | FAIL |
| console.log count | 85 | 0 (non-CLI) | WARN |
| TODO/FIXME count | 0 | < 20 | PASS |
| Files > 500 lines | 3 | 0 | FAIL |
| Test failures | 67 | 0 | FAIL |
| TypeScript errors | 0 | 0 | PASS |

---

## Critical

### CODE-001: 67 Test Failures — Hub Tests All Broken
**Count:** 67 failing tests across 18 test files
**Root Cause:** Hub component tests (`hub/src/components/*.test.tsx`, `hub/src/hooks/*.test.ts`) run via the **root** vitest invocation, which has NO vitest config (no `vitest.config.ts` at root). Hub's own config in `hub/vite.config.ts` sets `environment: 'jsdom'` and `setupFiles: ['./src/test-setup.ts']`, but the root `npx vitest run` does NOT pick up this config for hub files.

**Result:** All hub component tests get `ReferenceError: document is not defined` because they run in Node.js instead of jsdom.

**Failing file groups:**
- `hub/src/components/OwnerDashboard.test.tsx` — 11 failures
- `hub/src/components/ValuePropSection.test.tsx` — 5 failures
- `hub/src/components/TransactionHistory.test.tsx` — 8 failures
- `hub/src/components/SharePage.test.tsx` — 4 failures
- `hub/src/hooks/useOwnerCards.test.ts` — 4 failures
- `hub/src/hooks/useRequests.test.ts` — 4 failures
- `hub/src/components/EarningsChart.test.tsx` — 3 failures
- Plus: LoginForm, AuthGate, CapabilityCard, CardModal, NavBar, FAQSection, CompatibleWithSection, Skeleton, App, RequestHistory

**Fix:** Add a root `vitest.workspace.ts` that configures two projects:
```typescript
// vitest.workspace.ts
export default [
  {
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      include: ['hub/src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./hub/src/test-setup.ts'],
    },
  },
];
```

### CODE-002: `src/index.ts` Missing All v3.0 Exports
**File:** `/Users/leyufounder/Github/agentbnb/src/index.ts`
**Issue:** The public entry point only exports v1.x/v2.x modules. None of the v3.0 modules are exported:

**Missing exports:**
- `src/skills/executor.ts` — `SkillExecutor`, `createSkillExecutor`, `ExecutionResult`, `ExecutorMode`
- `src/skills/skill-config.ts` — `parseSkillsFile`, `SkillConfig`
- `src/skills/api-executor.ts` — `ApiExecutor`
- `src/skills/command-executor.ts` — `CommandExecutor`
- `src/skills/pipeline-executor.ts` — `PipelineExecutor`
- `src/skills/openclaw-bridge.ts` — `OpenClawBridge`
- `src/conductor/types.ts` — `SubTask`, `MatchResult`, `ExecutionBudget`, `OrchestrationResult`
- `src/conductor/task-decomposer.ts` — `decompose`, `TEMPLATES`
- `src/conductor/capability-matcher.ts` — `matchSubTasks`
- `src/conductor/budget-controller.ts` — `BudgetController`, `ORCHESTRATION_FEE`
- `src/conductor/card.ts` — `buildConductorCard`, `registerConductorCard`
- `src/credit/signing.ts` — `generateKeyPair`, `saveKeyPair`, `loadKeyPair`, `signEscrowReceipt`, `verifyEscrowReceipt`
- `src/credit/escrow-receipt.ts` — `createSignedEscrowReceipt`, `EscrowReceiptSchema`
- `src/credit/settlement.ts` — `settleProviderEarning`, `settleRequesterEscrow`, `releaseRequesterEscrow`
- `src/utils/interpolation.ts` — `interpolate`, `interpolateObject`, `resolvePath`

**Impact:** Any consumer importing from `agentbnb` (including the OpenClaw skill package) cannot access SkillExecutor, Conductor, or Signed Escrow features.

**Fix:** Add all public v3.0 exports to `src/index.ts`.

---

## High

### CODE-003: CLI Missing `conduct` Command for Phase 22
**File:** `/Users/leyufounder/Github/agentbnb/src/cli/index.ts`
**Issue:** The CLI has no `agentbnb conduct` command. Phase 22 (Conductor Integration) requires a CLI entry point for multi-agent orchestration. Currently the only way to use the Conductor is programmatically.

**Expected commands (per v3.0 roadmap):**
- `agentbnb conduct <task>` — decompose and execute a multi-agent task
- `agentbnb conduct --plan-only <task>` — show execution plan without running
- `agentbnb conduct --max-budget <N> <task>` — set budget ceiling

**Status:** Phase 22 is NOT STARTED, so this is expected. Flagging as a pre-launch gap.

### CODE-004: CLI File is a God File (1050 lines)
**File:** `/Users/leyufounder/Github/agentbnb/src/cli/index.ts` — 1050 lines
**Issue:** All 12+ CLI commands are in a single file. This is the largest source file and will grow further when `conduct` is added in Phase 22.
**Fix:** Extract each command into its own module:
```
src/cli/commands/init.ts
src/cli/commands/publish.ts
src/cli/commands/discover.ts
src/cli/commands/request.ts
src/cli/commands/serve.ts
src/cli/commands/status.ts
src/cli/commands/connect.ts
src/cli/commands/peers.ts
src/cli/commands/config.ts
src/cli/commands/openclaw.ts
src/cli/commands/conduct.ts  (Phase 22)
```

### CODE-005: Hub Has Zero v3.0 Feature Integration
**Files:** `hub/src/components/`, `hub/src/hooks/`
**Issue:** The Hub frontend has no pages, components, or hooks for any v3.0 features:
- No Conductor UI (task submission, execution plan viewer, orchestration status)
- No SkillExecutor monitoring (skill execution logs, latency metrics)
- No Signed Escrow visibility (escrow receipt viewer, cross-machine credit flow)
- No keypair management UI

**Assessment:** If v3.0 features are backend/CLI-only, this is acceptable. But the Hub is described as "the recruiting tool" and should at minimum show Conductor card in the card grid (the `buildConductorCard()` in `src/conductor/card.ts` produces a v2.0 card that would appear if registered).

### CODE-006: No Deployment Artifacts (Phase 23 Prerequisite)
**Missing files:**
- `Dockerfile` — not created yet
- `fly.toml` — not created yet
- `.github/workflows/*.yml` — no CI/CD pipeline

**Status:** Phase 23 (Ship) is PLANNED. These are expected gaps but block production launch.

---

## Medium

### CODE-007: 27 `as unknown as` Type Assertions in Production Code
**Count:** 27 occurrences (13 in production code, 14 in test code)
**Top offenders in production code:**
- `src/cli/index.ts:895,901,932,937` — config object treated as `Record<string, unknown>` for dynamic key access
- `src/gateway/server.ts:153,155` — casting cards between v1/v2 shapes
- `src/registry/server.ts:258,307` — casting to CapabilityCardV2 for skill counting
- `src/openclaw/soul-sync.ts:91` — checking spec_version on untyped card
- `src/skills/pipeline-executor.ts:89,111` — casting context objects
- `src/autonomy/idle-monitor.ts:138` — casting card to v2 record shape
- `src/openclaw/skill.ts:70` — checking card shape

**Fix for CLI:** Replace `(config as unknown as Record<string, unknown>)[key]` with a proper typed config interface that includes dynamic keys or a dedicated `getConfigValue`/`setConfigValue` method.

**Fix for v1/v2 casts:** Create a type guard `isV2Card(card): card is CapabilityCardV2` and use it instead of unsafe assertions.

### CODE-008: CLAUDE.md Not Updated for v3.0 Architecture
**File:** `/Users/leyufounder/Github/agentbnb/CLAUDE.md`
**Issue:** The Architecture section does not mention:
- `src/conductor/` directory (task-decomposer, capability-matcher, budget-controller, card, types)
- `src/skills/executor.ts`, `api-executor.ts`, `command-executor.ts`, `pipeline-executor.ts`, `openclaw-bridge.ts`, `skill-config.ts`
- `src/credit/signing.ts`, `escrow-receipt.ts`, `settlement.ts`
- `src/utils/interpolation.ts`

The "Current State" section still says "v2.1 complete. Repo ready for public launch." but v3.0 is actively in progress.

**Fix:** Update the architecture tree, add v3.0 milestone status, and document the new modules.

### CODE-009: Large Source Files
| File | Lines | Issue |
|------|-------|-------|
| `src/cli/index.ts` | 1050 | God file (see CODE-004) |
| `src/registry/store.ts` | 618 | Store + migrations + FTS in one file |
| `src/registry/server.ts` | 563 | HTTP routes + auth + Hub serving |

**Fix:** `store.ts` could extract migrations into `store-migrations.ts`. `server.ts` could extract route handlers.

### CODE-010: `package.json` Version Mismatch
**File:** `/Users/leyufounder/Github/agentbnb/package.json`
**Issue:** Version is `2.2.0` but the project is building v3.0 features (SkillExecutor, Conductor, Signed Escrow). The version should be bumped to `3.0.0-alpha` or similar to reflect the breaking changes.

---

## Low

### CODE-011: Console.log Saturation in CLI (85 occurrences)
**File:** `/Users/leyufounder/Github/agentbnb/src/cli/index.ts`
**Issue:** 85 `console.log` calls in the CLI file. While acceptable for a CLI tool, many could be replaced with a structured logger for machine-parseable output consistency. The `--json` flag pattern is already implemented for some commands but not all.

**Assessment:** Low priority since this is CLI code, not library code. No `console.log` found in non-CLI source files.

### CODE-012: Non-null Assertions in Test Code
**Count:** ~30 occurrences, primarily in `src/conductor/capability-matcher.test.ts` and `src/registry/store.test.ts`
**Pattern:** `results[0]!.subtask_id`, `row!.data`
**Assessment:** Acceptable in test code where the assertion itself validates the value exists. Not a production risk.

### CODE-013: Magic Number in Gateway Server
**File:** `src/gateway/server.ts:203`
```typescript
if (receiptAge > 5 * 60 * 1000) {
```
**Issue:** Escrow receipt expiry window (5 minutes) is hardcoded. Should be a named constant.
**Fix:**
```typescript
const ESCROW_RECEIPT_EXPIRY_MS = 5 * 60 * 1000;
```

### CODE-014: Inconsistent Error Code Pattern
**Files:** `src/gateway/server.ts`, `src/gateway/auth.ts`
**Issue:** JSON-RPC error codes use `-32000` for auth errors in auth.ts and `-32603` for most errors in server.ts, but these are mixed without a central error code registry.
**Fix:** Create an enum or const object for all JSON-RPC error codes used in the gateway.

### CODE-015: CommandExecutor Interpolation into Shell Commands
**File:** `/Users/leyufounder/Github/agentbnb/src/skills/command-executor.ts:67-81`
**Issue:** User-supplied `params` are interpolated directly into shell commands via `interpolate()` then passed to `exec()`. The `allowed_commands` check only validates the base command name, not arguments. While this is a design choice (agents are trusted), it means any parameter value can inject shell metacharacters.
**Assessment:** This is a security concern but per audit scope rules, flagging only as a code quality issue (tight coupling between interpolation and shell execution). The security-auditor should evaluate the injection risk in depth.

### CODE-016: Duplicate v1/v2 Card Shape Detection Logic
**Files:**
- `src/gateway/server.ts:153-155` — `const rawCard = card as unknown as Record<string, unknown>`
- `src/openclaw/skill.ts:70` — `const anyCard = card as unknown as { spec_version?: string; skills?: unknown[] }`
- `src/autonomy/idle-monitor.ts:138` — `const maybeV2 = card as unknown as CardV2Record`
- `src/registry/server.ts:258,307` — `(card as unknown as CapabilityCardV2).skills?.length`

**Issue:** Four separate modules implement ad-hoc v1 vs v2 card detection with unsafe casts. There is no shared type guard.
**Fix:** Create a shared utility:
```typescript
// src/types/guards.ts
export function isV2Card(card: CapabilityCard): card is CapabilityCardV2 {
  return (card as Record<string, unknown>).spec_version === '2.0';
}
```

---

## Checklist

### Must Fix Before Launch
- [ ] Fix hub test environment (vitest workspace or per-file `@vitest-environment jsdom` pragma) — 67 tests failing
- [ ] Add v3.0 exports to `src/index.ts` — consumers cannot access new features
- [ ] Add `conduct` CLI command (Phase 22 deliverable)
- [ ] Create Dockerfile + fly.toml + CI/CD (Phase 23 deliverable)
- [ ] Bump package.json version to 3.0.0-alpha or similar

### Should Fix
- [ ] Update CLAUDE.md with v3.0 architecture
- [ ] Extract CLI into per-command modules (1050-line god file)
- [ ] Create shared `isV2Card()` type guard to replace 4 duplicate cast patterns
- [ ] Extract named constant for escrow receipt expiry (5 min)
- [ ] Reduce `as unknown as` casts in production code

### Recommended
- [ ] Add vitest workspace config for proper project isolation
- [ ] Create JSON-RPC error code registry
- [ ] Split `store.ts` (618 lines) by extracting migrations
- [ ] Consider structured logging for CLI instead of raw console.log
