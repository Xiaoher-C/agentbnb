---
phase: 19-skillexecutor
plan: "04"
subsystem: skills
tags: [openclaw-bridge, executor-mode, webhook, process, telegram, child-process, abort-controller, tdd]

# Dependency graph
requires:
  - phase: 19-01
    provides: [ExecutorMode interface, SkillConfig types, OpenClawSkillConfig, SkillExecutor]

provides:
  - OpenClawBridge class implementing ExecutorMode for 'openclaw' skill type
  - webhook channel: HTTP POST with AbortController timeout
  - process channel: execSync subprocess with timeout option
  - telegram channel: fire-and-forget Bot API POST (MVP)

affects: [19-06-gateway-integration, SkillExecutor mode map registration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - switch-on-channel dispatch within ExecutorMode.execute()
    - AbortController for fetch timeout in Node 18+
    - vi.mock at module level for ESM-compatible child_process spying

key-files:
  created:
    - src/skills/openclaw-bridge.ts
    - src/skills/openclaw-bridge.test.ts

key-decisions:
  - "Base URL configurable via OPENCLAW_BASE_URL env var, defaults to http://localhost:3000 — supports non-standard ports without code changes"
  - "Telegram channel is fire-and-forget MVP — no response capture, returns { sent: true, channel: 'telegram' }"
  - "vi.mock('node:child_process') at module level required for ESM — vi.spyOn alone throws 'Cannot redefine property' in Node ESM"
  - "TELEGRAM_CHAT_ID from env var, not config field — avoids leaking chat IDs in skill config files"
  - "buildPayload helper always includes source:'agentbnb' and skill_id for OpenClaw traceability"

patterns-established:
  - "ESM mocking pattern: vi.mock() before import for node:child_process in test files"

requirements-completed: [EXEC-04]

# Metrics
duration: ~3min
completed: 2026-03-17
---

# Phase 19 Plan 04: OpenClaw Bridge Summary

**OpenClawBridge ExecutorMode (Mode C) dispatching AgentBnB requests to OpenClaw agents via webhook/process/telegram channels with timeout handling and ESM-compatible test mocking.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-17T10:16:55Z
- **Completed:** 2026-03-17T10:20:10Z
- **Tasks:** 1 (TDD — 2 commits: test + feat)
- **Files created:** 2

## Accomplishments

- `OpenClawBridge` implements `ExecutorMode` — registers under `'openclaw'` key in SkillExecutor mode map
- Webhook channel POSTs `{ task, params, source, skill_id }` payload with AbortController timeout, error on non-200
- Process channel spawns `openclaw run <agent_name> --input '<JSON>'` via execSync, parses stdout as JSON
- Telegram channel fire-and-forget: posts formatted message to Bot API, returns `{ sent: true, channel: 'telegram' }`
- Invalid channel returns `{ success: false, error: 'Unknown channel: ...' }` without throwing
- 15 tests, all passing

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests** - `10187a1` (test)
2. **Task 1 GREEN: Implementation** - `7318f79` (feat)

_Note: TDD tasks have multiple commits (test → feat)_

## Files Created/Modified

- `src/skills/openclaw-bridge.ts` — OpenClawBridge class, channel dispatch, buildPayload helper, per-channel executors
- `src/skills/openclaw-bridge.test.ts` — 15 tests covering all channels, timeout, invalid channel, env var behavior

## Decisions Made

- Base URL for webhook channel resolved from `OPENCLAW_BASE_URL` env var (defaults to `http://localhost:3000`), so non-standard ports work without code changes.
- Telegram channel reads `TELEGRAM_CHAT_ID` from env, not from skill config — prevents chat IDs leaking into skills.yaml.
- `vi.mock('node:child_process')` at module level is required for ESM compatibility — `vi.spyOn` alone fails with "Cannot redefine property" error in Node ESM environments.
- Telegram MVP returns success even if Telegram API fails softly (network error catches return `{ success: false }`), matching fire-and-forget semantics.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESM module mocking — vi.spyOn fails for node:child_process**
- **Found during:** Task 1 GREEN (running tests)
- **Issue:** `vi.spyOn(child_process, 'execSync')` throws `TypeError: Cannot redefine property: execSync` in Node ESM — named exports from built-in modules are non-configurable
- **Fix:** Added `vi.mock('node:child_process', ...)` before the import at module level; Vitest hoists this above imports enabling mock replacement
- **Files modified:** src/skills/openclaw-bridge.test.ts
- **Verification:** All 15 tests pass after fix
- **Committed in:** 7318f79 (feat task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — Bug)
**Impact on plan:** Fix was necessary for test infrastructure, no scope creep. Implementation unchanged.

## Issues Encountered

- Pre-existing TypeScript errors in `src/conductor/task-decomposer.ts` (lines 144, 148) and `src/skills/command-executor.ts` (lines 74, 77) — documented in `deferred-items.md`, not caused by this plan.

## User Setup Required

For telegram channel, users must set:
- `TELEGRAM_BOT_TOKEN` — Telegram Bot API token
- `TELEGRAM_CHAT_ID` — Target chat/group ID

For webhook channel with non-default port:
- `OPENCLAW_BASE_URL` — e.g., `http://localhost:9000` (defaults to `http://localhost:3000`)

## Next Phase Readiness

- `OpenClawBridge` is ready to be registered in the SkillExecutor mode map as `modes.set('openclaw', new OpenClawBridge())`
- Plan 19-06 (Gateway Integration) can now wire all four executor modes into SkillExecutor

---
*Phase: 19-skillexecutor*
*Completed: 2026-03-17*
