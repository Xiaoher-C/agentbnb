# Audit: Execution Core Integrity (Issues 7, 9)

Audited: 2026-03-21 | Auditor: execution-core-agent + Claude Code

---

## Issue 7a: Batch Request — DB split bug (CRITICAL)

**Status**: FIXED

**Files**:
- `src/gateway/execute.ts` — `BatchExecuteOptions`, `executeCapabilityBatch()`
- `src/registry/server.ts` — batch route call site (line ~1310)
- `src/gateway/execute-batch.test.ts` — `baseOptions` fixture

**Finding**:
`BatchExecuteOptions` had a single `db: Database` field. The function used this one DB for both:
- Registry operations: `getCard()`, `updateReputation()`, `insertRequestLog()`
- Credit operations: `getBalance()`, `holdEscrow()`, `settleEscrow()`

The call site in `server.ts` passed `db: opts.creditDb` (the credit database). Since the credit DB has no `capability_cards` table, `getCard(creditDb, skill_id)` always returned `null`. **Every single batch item failed with "Card/skill not found" — the batch API was completely non-functional in production.**

**Fix applied**:
- Split `BatchExecuteOptions.db` into `registryDb` (for store/log/reputation) and `creditDb` (for escrow/ledger)
- Updated all internal usages in `executeCapabilityBatch()` to use the correct DB
- Updated `server.ts` call site: `registryDb: db, creditDb: opts.creditDb`
- Updated test `baseOptions`: `registryDb: fakeDb, creditDb: fakeDb`
- All 12 batch tests pass after fix

**Risk**: Critical — batch API was dead in production.

---

## Issue 7b: Batch — simulates execution without calling SkillExecutor

**Status**: DOCUMENTED (intentional design)

**Files**: `src/gateway/execute.ts` (lines 437-444)

**Finding**:
The batch `executeItem()` function has a code comment explicitly stating:
> "A real skill execution path (SkillExecutor) is intentionally NOT wired here — the batch function is primarily a credit-orchestration layer."

After escrow hold, the function immediately settles and logs `status: 'success'` without calling any executor. This means:
- Credits are charged for batch items regardless of whether any real work happens
- Reputation scores are updated with false positives (always success, 0ms latency)
- No actual skill execution occurs

**Action taken**: DOCUMENTED — this is the declared design for the current batch layer. The comment says "credit-orchestration layer", implying real execution is a future concern. However, the reputation corruption is a side-effect worth tracking.

**Risk**: Medium — skews reputation/trust metrics; misleads callers who expect results.

---

## Issue 7c: Feedback API — execution link enforced, reputation not unified

**Status**: DOCUMENTED (split reputation — covered by Issue 8)

**Files**: `src/feedback/api.ts`, `src/feedback/reputation.ts`, `src/registry/store.ts`

**Finding**:
- `POST /api/feedback` correctly validates that `transaction_id` references a real `request_log` entry before accepting. Execution link is enforced. ✓
- However: two independent reputation systems exist:
  - `updateReputation()` in `store.ts` — execution-based EWA on `cards` table
  - `computeReputation()` in `feedback/reputation.ts` — feedback-based aggregation on `feedback` table
  - These are never combined for search/display (see Issue 8 audit)

**Action taken**: DOCUMENTED — unification is Issue 8 scope.

---

## Issue 7d: Evolution API — intentional metadata layer

**Status**: NO_ISSUE

**Files**: `src/evolution/`

**Finding**: Evolution API documents genesis template version history. No execution link by design — it tracks schema/capability evolution, not runtime outcomes. Correct as designed.

---

## Issue 9: Batch / Conductor / Relay — overlapping orchestration surfaces

**Status**: DOCUMENTED

**Files**:
- `src/conductor/` (ConductorMode, PipelineOrchestrator, task-decomposer, etc.)
- `src/cli/index.ts` (`conduct` command)
- `src/hub-agent/relay-bridge.ts`
- `src/gateway/execute.ts` (batch)

**Finding**:
Three separate orchestration surfaces with NO shared core:

| Path | Real execution? | Escrow? | Timeout? | Request log? |
|------|----------------|---------|----------|--------------|
| Batch API (`/api/batch`) | No (simulated) | Yes | No | Yes (false success) |
| Conductor/CLI (`conduct`) | Yes (remote) | No (at destination) | Yes | No (at destination) |
| WebSocket Relay | Forwarded | Yes | Yes | Only agent_joined |

None of these call `executeCapabilityRequest()` — that function is used only by the HTTP `/rpc` handler.

The CLI `conduct` command and `ConductorMode` skill duplicate the same decompose→match→budget→orchestrate pipeline with no shared primitives.

**Risk**: Medium — inconsistent escrow/logging guarantees across paths. Deduplication requires Conductor refactor; flagged for future phase.
