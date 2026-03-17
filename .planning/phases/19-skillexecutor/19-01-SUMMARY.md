---
phase: 19-skillexecutor
plan: "01"
subsystem: skills
tags: [skill-executor, zod, yaml, config, dispatcher, tdd]
dependency_graph:
  requires: []
  provides: [SkillConfig schemas, parseSkillsFile, SkillExecutor, ExecutorMode, createSkillExecutor]
  affects: [src/skills/executor.ts, src/skills/skill-config.ts]
tech_stack:
  added: [js-yaml@4.1.1, "@types/js-yaml@4.0.9"]
  patterns: [discriminated-union-zod, executor-dispatcher-map, tdd-red-green]
key_files:
  created:
    - src/skills/skill-config.ts
    - src/skills/skill-config.test.ts
    - src/skills/executor.ts
    - src/skills/executor.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
decisions:
  - "js-yaml used for YAML parsing — battle-tested, well-typed with @types/js-yaml"
  - "expandEnvVarsDeep walks all object/array leaves recursively before Zod validation"
  - "Empty string env vars allowed — only undefined vars throw"
  - "SkillExecutor.execute() always returns ExecutionResult (never throws) — latency_ms included even on error"
  - "Dispatcher uses Map<string, ExecutorMode> so modes are injected by callers (19-02..05 will register)"
metrics:
  duration: "3 min 14 sec"
  completed_date: "2026-03-17"
  tasks_completed: 2
  files_created: 4
  files_modified: 2
  tests_added: 34
---

# Phase 19 Plan 01: SkillExecutor Foundation — Schema + Dispatcher Summary

**One-liner:** Zod discriminated-union schema for 4 skill types (api/pipeline/openclaw/command) + YAML parser with env var expansion + SkillExecutor dispatcher that routes execute() calls to registered ExecutorMode by type.

## What Was Built

### src/skills/skill-config.ts
- `ApiSkillConfigSchema` — REST API wrapper: endpoint, method, auth (bearer/apikey/basic), input/output mapping, timeout, retries
- `PipelineSkillConfigSchema` — sequential steps (skill_id or command), input_mapping per step
- `OpenClawSkillConfigSchema` — agent_name, channel (telegram/webhook/process), timeout
- `CommandSkillConfigSchema` — shell command, output_type (json/text/file), allowed_commands, working_dir
- `SkillConfigSchema` — z.discriminatedUnion('type', [...]) combining all four
- `SkillsFileSchema` — root schema: `{ skills: SkillConfig[] }`
- `parseSkillsFile(yamlContent: string): SkillConfig[]` — parse YAML, expand env vars, validate with Zod
- `expandEnvVars(value: string): string` — replaces `${VAR_NAME}` with process.env values, throws on undefined

### src/skills/executor.ts
- `ExecutionResult` interface: `{ success, result?, error?, latency_ms }`
- `ExecutorMode` interface: `execute(config, params): Promise<Omit<ExecutionResult, 'latency_ms'>>`
- `SkillExecutor` class: Map-based dispatcher, execute() with timing + error catching, listSkills(), getSkillConfig()
- `createSkillExecutor(configs, modes)` factory function

## Tests

- `src/skills/skill-config.test.ts` — 17 tests: all 4 types, env var expansion, empty array, Zod errors, invalid type, invalid YAML
- `src/skills/executor.test.ts` — 17 tests: dispatch by type, unknown skill, missing mode, latency_ms, error catching, multi-skill, ExecutionResult shape

**Total: 34 tests, all passing.**

## Commits

| Hash | Message |
|------|---------|
| dfa58e6 | test(19-01): add failing tests for SkillConfig YAML parser + Zod schema |
| 253e103 | feat(19-01): implement SkillConfig Zod schemas + YAML parser with env var expansion |
| 514592e | test(19-01): add failing tests for SkillExecutor dispatcher |
| 31d515b | feat(19-01): implement SkillExecutor dispatcher interface |

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Deferred Issues

**Pre-existing TypeScript errors in `src/conductor/task-decomposer.ts`** (lines 144, 148):
- `Type 'undefined' is not assignable to type 'string'` — pre-existing from before this plan
- Out of scope: not caused by this plan's changes
- Does not affect runtime or tests for 19-01

## Self-Check: PASSED

- FOUND: src/skills/skill-config.ts
- FOUND: src/skills/skill-config.test.ts
- FOUND: src/skills/executor.ts
- FOUND: src/skills/executor.test.ts
- FOUND: commit dfa58e6
- FOUND: commit 253e103
- FOUND: commit 514592e
- FOUND: commit 31d515b
