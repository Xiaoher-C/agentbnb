---
phase: 19-skillexecutor
plan: "06"
subsystem: skills
tags: [integration, gateway, runtime, skill-executor]
dependency_graph:
  requires: [19-01, 19-02, 19-03, 19-04, 19-05]
  provides: [SkillExecutor-gateway-dispatch, AgentRuntime-skillsyaml-init]
  affects: [src/gateway/server.ts, src/runtime/agent-runtime.ts]
tech_stack:
  added: []
  patterns:
    - Mutable Map reference passed to SkillExecutor constructor enables post-construction mode registration (solves PipelineExecutor circular dep)
    - Gateway dispatch uses resolvedSkillId ?? skillId ?? cardId for v1/v2 card compat
key_files:
  created:
    - src/skills/skill-executor-integration.test.ts
  modified:
    - src/runtime/agent-runtime.ts
    - src/gateway/server.ts
decisions:
  - Mutable Map passed to SkillExecutor so PipelineExecutor can be added after construction — no new setModes() API needed
  - Gateway targetSkillId resolves as resolvedSkillId ?? skillId ?? cardId — handles v1/v2 cards and raw skill_id param
  - skillExecutor property on AgentRuntime is non-readonly (initialized in start()) to allow nullable assignment
metrics:
  duration: "~8 minutes"
  completed_date: "2026-03-17"
  tasks: 2
  files: 3
---

# Phase 19 Plan 06: SkillExecutor Gateway + Runtime Integration Summary

Wire SkillExecutor into Gateway and AgentRuntime — `agentbnb serve` with `skills.yaml` now dispatches capability calls through local executors instead of `fetch(handlerUrl)`.

## What Was Built

### Task 1: AgentRuntime SkillExecutor Integration (commit: be17afc)

Modified `src/runtime/agent-runtime.ts`:

- Added `skillsYamlPath?: string` to `RuntimeOptions`
- Added `skillExecutor?: SkillExecutor` property (set by `start()`)
- Added `initSkillExecutor()` private method: reads file if exists, parses YAML, creates all 4 executor modes
- Solved PipelineExecutor circular dependency via mutable Map: create Map → create SkillExecutor (holds reference) → create PipelineExecutor(executor) → populate map with all 4 modes — SkillExecutor's internal modeMap reflects the populated Map

### Task 2: Gateway SkillExecutor Dispatch + Integration Test (commit: a220d92)

Modified `src/gateway/server.ts`:

- Added `skillExecutor?: SkillExecutor` to `GatewayOptions`
- Added SkillExecutor dispatch path before legacy handlerUrl path
- Full escrow/reputation/logging logic preserved in both paths
- `targetSkillId = resolvedSkillId ?? skillId ?? cardId` — v1 cards pass raw `skill_id` param, v2 cards have `resolvedSkillId`
- Backward compat: when `skillExecutor` is absent, falls through to existing `fetch(handlerUrl)` code unchanged

Created `src/skills/skill-executor-integration.test.ts` (5 tests):

1. Gateway → SkillExecutor dispatches command skill and returns result
2. Credits deducted from requester on success (escrow settled)
3. Owner credited on success
4. Unknown skill_id returns JSON-RPC error and escrow is released (balance unchanged)
5. Backward compat: gateway without `skillExecutor` uses `handlerUrl` fetch path

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] skillId param not used as fallback for v1 cards**
- **Found during:** Task 2 (test failure)
- **Issue:** Gateway sets `resolvedSkillId = undefined` for v1 cards. The SkillExecutor dispatch used `resolvedSkillId ?? cardId` — targeting the card UUID instead of the `skill_id` param.
- **Fix:** Changed targetSkillId to `resolvedSkillId ?? skillId ?? cardId`
- **Files modified:** src/gateway/server.ts
- **Commit:** a220d92 (included in task commit)

## Verification Results

- `pnpm exec vitest run src/skills/skill-executor-integration.test.ts` — 5/5 pass
- `pnpm exec vitest run src/skills/ src/gateway/ src/runtime/` — 141/141 pass
- `pnpm exec tsc --noEmit` — no errors in modified files (2 pre-existing errors in conductor/task-decomposer.ts unrelated to this plan)

## Self-Check: PASSED

Files exist:
- [x] src/runtime/agent-runtime.ts (modified)
- [x] src/gateway/server.ts (modified)
- [x] src/skills/skill-executor-integration.test.ts (created)

Commits exist:
- [x] be17afc — feat(19-06): AgentRuntime SkillExecutor integration
- [x] a220d92 — feat(19-06): Gateway SkillExecutor dispatch + integration test
