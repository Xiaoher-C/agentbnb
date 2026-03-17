# Deferred Items — Phase 19 SkillExecutor

## Pre-existing TypeScript Errors (out of scope for 19-02)

### src/conductor/task-decomposer.ts (lines 144, 148)
- `Type '...UUID | undefined' is not assignable to type 'string'`
- Origin: Plan 20-01 — pre-existing before 19-02 started

### src/skills/command-executor.ts (lines 58, 61, 67, 68)
- `'stderr' declared but never read`
- `ExecOptions shell type incompatibility`
- `string | NonSharedBuffer not assignable to string`
- Origin: Plan 19-03 — pre-existing before 19-02 started

These should be fixed in their respective plans (19-03 and 20-01).
